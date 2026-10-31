-- Hybrid operating model, wave 6: export audit, connection revocation, end and retention purge.
-- end_tenant reuses pause_tenant_execution and then sets the existing 'ended' status; ended_at starts the retention clock.
-- purge_ended_tenants is the single purge path. It keeps the tenants row as a scrubbed tombstone plus the financial
-- records (payments, fees, quotes, proposals) and the agency AI spend ledger (build_usage), and writes a keyed
-- suppression record (HMAC computed in the Worker with a server secret) before any contact is deleted.
-- The RESTRICT/NO ACTION foreign keys to tenants and leads stay: the purge and erase delete those rows explicitly.

-- One named retention constant for the trigger and the purge (the Worker's RETENTION_DAYS is test-checked against it).
create function public.tenant_retention() returns interval language sql immutable set search_path='' as $$ select interval '90 days' $$;

alter table public.tenants add column ended_at timestamptz, add column purged_at timestamptz,
 add check(purged_at is null or (status='ended' and ended_at is not null));
-- Accounts already ended start their retention period now.
update public.tenants set ended_at=now() where status='ended';

-- ended_at is stamped by the end transition only; purged_at is set once, after retention, by the purge.
create function public.guard_tenant_retention() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.purged_at is not null or (new.ended_at is not null and current_user<>'postgres') then raise exception 'Retention state is set by end and purge' using errcode='23514'; end if;
  return new;
 end if;
 if new.status='ended' and old.status<>'ended' and new.ended_at is not distinct from old.ended_at then new.ended_at:=now(); end if;
 -- Database owners may restore historical fixtures; application roles never move the retention clock.
 if new.ended_at is distinct from old.ended_at and current_user<>'postgres' and (old.ended_at is not null or new.status<>'ended' or new.ended_at<>now()) then
  raise exception 'Retention state is set by end and purge' using errcode='23514'; end if;
 if new.purged_at is distinct from old.purged_at and (old.purged_at is not null or new.status<>'ended' or new.ended_at>now()-public.tenant_retention()) then
  raise exception 'Purge is allowed once, after the retention period' using errcode='23514'; end if;
 return new;
end $$;
revoke all on function public.guard_tenant_retention() from public,anon,authenticated;
create trigger tenant_retention_guard before insert or update on public.tenants for each row execute function public.guard_tenant_retention();

-- Survives the purge (no FK). email_hmac = HMAC-SHA256(server secret, tenant_id || ':' || lower(email)), hex.
create table public.tenant_suppression (
 tenant_id uuid not null,
 email_hmac text not null check(email_hmac ~ '^[0-9a-f]{64}$'),
 reason text not null check(octet_length(reason) between 1 and 64),
 created_at timestamptz not null default now(),
 primary key(tenant_id,email_hmac)
);
alter table public.tenant_suppression enable row level security;
revoke all on public.tenant_suppression from public,anon,authenticated,service_role;
grant select,insert on public.tenant_suppression to service_role;

-- Append-only history (setups, envelopes, Revive outcomes) may be deleted only by the purge of its tenant.
do $purge_guards$
declare m record; src text; hits int;
begin
 for m in select * from (values
  ('public.guard_revive_setup()','not exists[(]select 1 from public[.]tenants where id=old[.]tenant_id[)]','not exists(select 1 from public.tenants where id=old.tenant_id and purged_at is null)'),
  ('public.guard_operating_envelope()','not exists[(]select 1 from public[.]tenants where id=old[.]tenant_id[)]','not exists(select 1 from public.tenants where id=old.tenant_id and purged_at is null)'),
  ('public.guard_revive_outcome_attribution()','if tg_op=''DELETE'' or new is distinct from old then',
   'if (tg_op=''DELETE'' and not exists(select 1 from public.tenants where id=old.tenant_id and purged_at is not null)) or (tg_op=''UPDATE'' and new is distinct from old) then')
 ) v(fn,pattern,replacement) loop
  src:=pg_get_functiondef(m.fn::regprocedure);
  select count(*) into hits from regexp_matches(src,m.pattern,'g');
  if hits<>1 then raise exception 'Purge guard rewrite drift in %: expected 1 match, found %',m.fn,hits; end if;
  execute regexp_replace(src,m.pattern,m.replacement);
 end loop;
end $purge_guards$;

-- ---------------------------------------------------------------- RPCs (service_role only)
-- Owner, or a non-member reading through an active grant (can_operate 'read'); a viewer cannot export. Audited.
create function public.record_tenant_export(p_tenant uuid,p_actor uuid) returns boolean language plpgsql set search_path='' as $$
begin
 if current_user<>'service_role' then raise exception 'Not authorised' using errcode='42501'; end if;
 if not (ripepiper_private.is_tenant_owner(p_tenant,p_actor) or (ripepiper_private.can_operate(p_tenant,p_actor,'read')
  and not exists(select 1 from public.memberships where tenant_id=p_tenant and user_id=p_actor))) then return false; end if;
 perform ripepiper_private.log_connection(p_tenant,p_actor,'Full data export downloaded');
 return true;
end $$;

-- Every connection still holding authority or a sealed secret, for provider-side revocation before the registry revoke.
create function public.tenant_connections_to_revoke(p_tenant uuid) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'provider',c.provider,'version',c.version,'status',c.status,
  'keyId',s.key_id,'iv',encode(s.iv,'base64'),'ciphertext',encode(s.ciphertext,'base64')) order by c.id),'[]')
 from public.tenant_connections c left join ripepiper_private.tenant_connection_secrets s on s.connection_id=c.id
 where current_user='service_role' and c.tenant_id=p_tenant and (c.status<>'revoked' or s.connection_id is not null)
$$;

-- Approve authority (owner, or an approve grantee). Staff alone end a self-service account only on the client's written request.
-- Runs before any connection is revoked, so a refused end changes nothing. Idempotent once ended (no second pause or log) so
-- a retried offboard can finish revoking connections.
create function public.end_tenant(p_tenant uuid,p_actor uuid,p_reason text,p_request_reference text default null) returns jsonb
language plpgsql set search_path='' as $$
declare t public.tenants%rowtype; owner boolean;
begin
 if current_user<>'service_role' then raise exception 'Not authorised' using errcode='42501'; end if;
 select * into t from public.tenants where id=p_tenant for update;
 if not found or not ripepiper_private.can_operate(p_tenant,p_actor,'approve') then raise exception 'Not authorised' using errcode='42501'; end if;
 owner:=ripepiper_private.is_tenant_owner(p_tenant,p_actor);
 if t.ownership='client_owned' and not owner and coalesce(octet_length(btrim(p_request_reference)),0) not between 3 and 200 then
  raise exception 'Client request reference required' using errcode='22023'; end if;
 if t.status='ended' then return jsonb_build_object('id',t.id,'status',t.status,'endedAt',t.ended_at); end if;
 if not public.pause_tenant_execution(p_tenant,p_reason) then raise exception 'Reason required' using errcode='22023'; end if;
 update public.tenants set status='ended' where id=p_tenant returning * into t;
 perform ripepiper_private.log_connection(p_tenant,p_actor,format('Service ended: %s%s',btrim(p_reason),
  case when owner then '' else format(' (client request %s)',btrim(coalesce(p_request_reference,'contract'))) end));
 return jsonb_build_object('id',t.id,'status',t.status,'endedAt',t.ended_at);
end $$;

-- Contacts whose objection, denial or erase request must outlive their data. One row per normalised email.
create function public.tenant_suppression_candidates(p_tenant uuid,p_lead uuid default null) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('email',email,'reason',reason) order by email),'[]') from (
  select distinct on (email) email,reason from (
   select lower(btrim(l.email)) email,left(s.reason,64) reason,1 rank from public.leads l join public.lead_suppression s on s.tenant_id=l.tenant_id and s.lead_id=l.id where l.tenant_id=p_tenant
   union all select lower(btrim(l.email)),'denied',2 from public.leads l where l.tenant_id=p_tenant and exists(select 1 from public.contact_rights r where r.tenant_id=l.tenant_id and r.lead_id=l.id and r.decision='denied')
   union all select lower(btrim(l.email)),r.kind,3 from public.leads l join public.subject_requests r on r.tenant_id=l.tenant_id and r.lead_id=l.id where l.tenant_id=p_tenant and r.kind in ('object','erase')
  ) c where current_user in ('service_role','postgres') and email is not null and email<>'' and (p_lead is null or exists(select 1 from public.leads x where x.id=p_lead and x.tenant_id=p_tenant and lower(btrim(x.email))=c.email))
  order by email,rank) d
$$;

-- Single-contact erasure on a live account: the keyed suppression lands first, then lead_suppression can go (fixes the
-- RESTRICT at 20261022083835:49). Request rows go too and are recorded on the timeline. A contact with outbound or review
-- history stays protected by those foreign keys; the account purge handles it. Definer (execute granted to service_role
-- only): erasure deletes from tables the service role holds no delete grant on.
create function public.erase_tenant_lead(p_tenant uuid,p_actor uuid,p_lead uuid,p_email_hmac text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare requests text;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if not found or not (ripepiper_private.can_operate(p_tenant,p_actor,'approve') or ripepiper_private.is_platform_admin(p_actor))
  or not exists(select 1 from public.leads where id=p_lead and tenant_id=p_tenant) then raise exception 'Not authorised' using errcode='42501'; end if;
 if coalesce(p_email_hmac,'') !~ '^[0-9a-f]{64}$' or coalesce(octet_length(btrim(p_reason)),0) not between 8 and 500 then raise exception 'Invalid erasure' using errcode='22023'; end if;
 insert into public.tenant_suppression(tenant_id,email_hmac,reason)
 values(p_tenant,p_email_hmac,coalesce(public.tenant_suppression_candidates(p_tenant,p_lead)->0->>'reason','erase')) on conflict do nothing;
 delete from ripepiper_private.tenant_unsubscribe_tokens where tenant_id=p_tenant and lead_id=p_lead;
 delete from public.contact_rights where tenant_id=p_tenant and lead_id=p_lead;
 delete from public.lead_suppression where tenant_id=p_tenant and lead_id=p_lead;
 with gone as (delete from public.subject_requests where tenant_id=p_tenant and lead_id=p_lead returning id,kind)
 select string_agg(kind||' '||id::text,', ' order by id) into requests from gone;
 delete from public.leads where id=p_lead and tenant_id=p_tenant;
 perform ripepiper_private.log_connection(p_tenant,p_actor,format('Contact erased (%s); suppression kept%s',btrim(p_reason),coalesce('; requests closed: '||requests,'')));
 return jsonb_build_object('leadId',p_lead,'erased',true);
end $$;

-- Dry run lists due tenants. A real run purges each due tenant whose suppression set (one HMAC per candidate email, from the
-- Worker) is complete; anything else is skipped. Definer: the purge needs delete on tables the service role cannot touch.
create function public.purge_ended_tenants(p_now timestamptz,p_dry_run boolean,p_suppression jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare due uuid[]; t uuid; s jsonb; purged uuid[]:='{}'; skipped uuid[]:='{}'; tbl text; left_over boolean;
 -- Dependency order. Kept: tenants (tombstone), payments, fees, quotes, proposals, build_usage, tenant_suppression.
 purge_order constant text[]:=array['public.outbound_actions','public.outbound_stops','public.campaign_assets','public.campaigns',
  'public.operating_envelopes','public.operator_grants','public.revive_reviews','ripepiper_private.tenant_unsubscribe_tokens',
  'ripepiper_private.oauth_states','public.tenant_google_authority','public.tenant_connections','public.tenant_activation_reviews',
  'public.contact_rights','public.lead_suppression','public.subject_requests','public.meetings','public.deals','public.lead_observations',
  'public.leads','public.revive_setups','public.business_briefs','public.activity_log','public.invites','public.memberships',
  'public.outreach_weekly','public.ad_metrics_daily','public.ad_accounts'];
 kept constant text[]:=array['public.tenants','public.payments','public.fees','public.quotes','public.proposals','public.build_usage','public.tenant_suppression'];
begin
 if p_now is null or p_dry_run is null or jsonb_typeof(coalesce(p_suppression,'{}'))<>'object' then raise exception 'Invalid purge request' using errcode='22023'; end if;
 select array_agg(id order by ended_at,id) into due from (select id,ended_at from public.tenants
  where status='ended' and purged_at is null and ended_at<=least(p_now,now())-public.tenant_retention() order by ended_at,id limit 5) d;
 if p_dry_run then return jsonb_build_object('due',coalesce(to_jsonb(due),'[]')); end if;
 foreach t in array coalesce(due,'{}') loop
  perform 1 from public.tenants where id=t for update;
  s:=p_suppression->(t::text);
  if jsonb_typeof(s) is distinct from 'array' or jsonb_array_length(s)<>jsonb_array_length(public.tenant_suppression_candidates(t))
   or exists(select 1 from jsonb_array_elements(s) x where coalesce(x->>'hmac','') !~ '^[0-9a-f]{64}$' or coalesce(octet_length(x->>'reason'),0) not between 1 and 64) then
   skipped:=skipped||t; continue; end if;
  insert into public.tenant_suppression(tenant_id,email_hmac,reason) select t,x->>'hmac',x->>'reason' from jsonb_array_elements(s) x on conflict do nothing;
  update public.tenants set purged_at=now(),name='Purged client',slug='purged-'||replace(t::text,'-','') where id=t;
  foreach tbl in array purge_order loop execute format('delete from %s where tenant_id=$1',tbl) using t; end loop;
  -- Drift guard: a tenant table added later without a purge decision stops the purge instead of keeping data.
  for tbl in select format('%I.%I',n.nspname,c.relname) from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid=a.attrelid
   join pg_catalog.pg_namespace n on n.oid=c.relnamespace where a.attname='tenant_id' and not a.attisdropped and c.relkind in ('r','p')
   and n.nspname in ('public','ripepiper_private') loop
   continue when tbl=any(kept);
   execute format('select exists(select 1 from %s where tenant_id=$1)',tbl) using t into left_over;
   if left_over then raise exception 'Purge drift: % still holds tenant rows',tbl using errcode='P0001'; end if;
  end loop;
  purged:=purged||t;
 end loop;
 return jsonb_build_object('due',coalesce(to_jsonb(due),'[]'),'purged',to_jsonb(purged),'skipped',to_jsonb(skipped));
end $$;

do $grants$
declare f text;
begin
 foreach f in array array['public.record_tenant_export(uuid,uuid)','public.tenant_connections_to_revoke(uuid)','public.end_tenant(uuid,uuid,text,text)',
  'public.tenant_suppression_candidates(uuid,uuid)','public.erase_tenant_lead(uuid,uuid,uuid,text,text)','public.purge_ended_tenants(timestamptz,boolean,jsonb)'] loop
  execute format('revoke all on function %s from public,anon,authenticated',f);
  execute format('grant execute on function %s to service_role',f);
 end loop;
end $grants$;
