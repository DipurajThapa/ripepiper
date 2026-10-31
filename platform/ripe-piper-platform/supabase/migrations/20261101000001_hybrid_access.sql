-- Hybrid operating model, wave 1: tenant-scoped access.
-- Roles map onto existing data: platform_admin=profiles.is_admin, operator=profiles.is_operator (eligibility only),
-- client_admin=memberships 'owner', client_user=memberships 'viewer'. tenants.ownership ('managed','client_owned')
-- is the operating mode; it is never an access input. Access comes only from memberships and operator_grants,
-- through one predicate: ripepiper_private.can_operate(tenant, actor, capability).
--
-- The manifest DO block below rewrites the live definition (pg_get_functiondef) of each function it names and
-- asserts the exact match count of every edit, so drift fails at migrate time. CREATE OR REPLACE keeps owner,
-- ACL, SECURITY and SET search_path. Never copy an older migration body of these functions: the effective source
-- lives in the catalog. Rewritten here:
--  actor checks -> can_operate: save_business_brief, save_response_review, import_review_lead, manage_campaign_plan,
--   response_review_owners, manage_event_settings, revive_review_context, review_revive_candidate,
--   revive_draft_context_current, record_revive_draft_proposal, build_revive_audience, assert_revive_draft_context,
--   save_reviewed_revive_draft, revive_audience_candidates, revive_setup_context, save_revive_setup,
--   build_revive_strategy, preview_revive_schedule, signal_binding_valid, signal_strategy_context,
--   review_prospect_snapshot, review_consultation_attendance (meeting tenant), record_tenant_unsubscribe,
--   issue_tenant_unsubscribe; google_authority_admin(p_tenant,p_actor,p_capability) callers
--   tenant_google_probe_current, register_tenant_google_authority, revoke_tenant_google_authority,
--   record_product_event_authorized_core.
--  stored approvers -> can_operate 'approve' (owner ids 'operate'): guard_revive_outcome_attribution, guard_signal_evidence,
--   revive_candidate_current, revive_campaign_audience_current, revive_setup_current, guard_revive_setup,
--   revive_campaign_strategy_current, revive_slot_authority_current, guard_signal_execution, guard_signal_review,
--   synthetic_action_allowed.
--  owner candidates -> tenant owners plus active 'operate' grantees: response_review_owners, save_response_review,
--   review_prospect_snapshot, revive_setup_context.
--  platform level -> is_platform_admin: authorize_build_budget, activate_tenant_execution, guard_tenant_activation,
--   reserve_payment_checkout and register_payment_checkout (admin OR owner), set_member_role (admin OR tenant owner).
--  lock_revive_reviewer also serializes is_operator changes.

alter table public.profiles add column is_operator boolean not null default false;

-- ---------------------------------------------------------------- managed-access grants (append only)
create table public.operator_grants (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 operator_id uuid not null references public.profiles(id),
 capabilities text[] not null check(cardinality(capabilities) between 1 and 3 and capabilities<@array['read','operate','approve']),
 authority text not null check(authority in ('client_admin','contract')),
 authorised_by uuid references public.profiles(id),
 contract_reference text check(contract_reference is null or octet_length(btrim(contract_reference)) between 1 and 200),
 starts_at timestamptz not null default now(),
 expires_at timestamptz not null,
 revoked_at timestamptz,
 revoked_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 check((authority='contract')=(contract_reference is not null)),
 -- Only the one-off pre-hybrid backfill below has no authoriser; the guard keeps that path away from API roles.
 check(authorised_by is not null or contract_reference='pre-hybrid-backfill'),
 check(authorised_by is distinct from operator_id),
 check(expires_at>starts_at and expires_at<=starts_at+interval '366 days'),
 check((revoked_at is null)=(revoked_by is null))
);
create index operator_grants_active on public.operator_grants(tenant_id,operator_id) where revoked_at is null;
alter table public.operator_grants enable row level security;
revoke all on public.operator_grants from public,anon,authenticated,service_role;
grant select on public.operator_grants to authenticated;
grant select,insert,update on public.operator_grants to service_role;
create policy grant_read on public.operator_grants for select using (public.is_admin() or public.is_member(tenant_id));

-- ---------------------------------------------------------------- the single authority predicate
-- Verified actor (confirmed auth email equal to the profile email). Owner: read/operate/approve; viewer: read;
-- an active, unrevoked grant: its listed capabilities while the profile is still an operator. A null tenant is
-- the agency's own pre-sale records, which stay with platform admins.
create function ripepiper_private.can_operate(p_tenant uuid,p_actor uuid,p_capability text) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(p_capability in ('read','operate','approve'),false) and exists(select 1 from public.profiles p join auth.users u on u.id=p.id
  where p.id=p_actor and u.email_confirmed_at is not null and octet_length(u.email)<=1024 and octet_length(p.email)<=1024 and lower(u.email)=lower(p.email)
   and case when p_tenant is null then p.is_admin else
    exists(select 1 from public.memberships m where m.tenant_id=p_tenant and m.user_id=p.id and (m.role='owner' or p_capability='read'))
    or (p.is_operator and exists(select 1 from public.operator_grants g where g.tenant_id=p_tenant and g.operator_id=p.id and g.revoked_at is null
     and g.starts_at<=now() and g.expires_at>now() and p_capability=any(g.capabilities))) end)
$$;
create function ripepiper_private.is_platform_admin(p_actor uuid) returns boolean
language sql stable security definer set search_path='' as $$ select ripepiper_private.can_operate(null,p_actor,'approve') $$;
create function ripepiper_private.is_tenant_owner(p_tenant uuid,p_actor uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select p_tenant is not null and ripepiper_private.can_operate(p_tenant,p_actor,'read')
  and exists(select 1 from public.memberships where tenant_id=p_tenant and user_id=p_actor and role='owner')
$$;
revoke all on function ripepiper_private.can_operate(uuid,uuid,text) from public,anon,authenticated;
revoke all on function ripepiper_private.is_platform_admin(uuid) from public,anon,authenticated;
revoke all on function ripepiper_private.is_tenant_owner(uuid,uuid) from public,anon,authenticated;
grant usage on schema ripepiper_private to service_role;
grant execute on function ripepiper_private.can_operate(uuid,uuid,text) to service_role;
grant execute on function ripepiper_private.is_platform_admin(uuid) to service_role;
grant execute on function ripepiper_private.is_tenant_owner(uuid,uuid) to service_role;

-- Worker gate (PostgREST exposes public only). Service role only.
create function public.tenant_access(p_tenant uuid,p_actor uuid,p_capability text) returns boolean
language sql stable set search_path='' as $$ select current_user='service_role' and ripepiper_private.can_operate(p_tenant,p_actor,p_capability) $$;
revoke all on function public.tenant_access(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.tenant_access(uuid,uuid,text) to service_role;

-- RLS helper for the signed-in user, definer like is_member.
create function public.can_read_tenant(t uuid) returns boolean
language sql stable security definer set search_path='' as $$ select ripepiper_private.can_operate(t,auth.uid(),'read') $$;
revoke all on function public.can_read_tenant(uuid) from public,anon;
grant execute on function public.can_read_tenant(uuid) to authenticated,service_role;

create function public.guard_operator_grant() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.revoked_at is not null or not exists(select 1 from public.profiles where id=new.operator_id and is_operator)
   or (new.authorised_by is null and current_user in ('service_role','authenticated','anon'))
   or (new.authorised_by is not null and not case new.authority when 'client_admin' then ripepiper_private.is_tenant_owner(new.tenant_id,new.authorised_by)
     else ripepiper_private.is_platform_admin(new.authorised_by) end)
  then raise exception 'Operator grant not authorised' using errcode='42501';end if;
  return new;
 end if;
 if old.revoked_at is not null or new.revoked_at is null or to_jsonb(new)-'revoked_at'-'revoked_by' is distinct from to_jsonb(old)-'revoked_at'-'revoked_by' then
  raise exception 'Operator grants are append only and revoke once' using errcode='23514';end if;
 return new;
end $$;
revoke all on function public.guard_operator_grant() from public,anon,authenticated;
create trigger operator_grant_guard before insert or update on public.operator_grants for each row execute function public.guard_operator_grant();

-- Grant and revoke lock the tenant row (the same serialization as lock_revive_reviewer) and tell the client.
create function public.grant_operator_access(p_tenant uuid,p_actor uuid,p_operator uuid,p_capabilities text[],p_authority text,p_contract_reference text,p_expires_at timestamptz)
returns uuid language plpgsql set search_path='' as $$
declare g public.operator_grants%rowtype;
begin
 if current_user<>'service_role' then raise exception 'Not authorised' using errcode='42501';end if;
 perform 1 from public.tenants where id=p_tenant for update;
 if not found or not coalesce(case p_authority when 'client_admin' then ripepiper_private.is_tenant_owner(p_tenant,p_actor) when 'contract' then ripepiper_private.is_platform_admin(p_actor) end,false)
 then raise exception 'Not authorised' using errcode='42501';end if;
 insert into public.operator_grants(tenant_id,operator_id,capabilities,authority,authorised_by,contract_reference,expires_at)
 values(p_tenant,p_operator,(select array_agg(distinct c order by c) from unnest(p_capabilities) c),p_authority,p_actor,nullif(btrim(p_contract_reference),''),p_expires_at) returning * into g;
 insert into public.activity_log(tenant_id,actor,kind,message,visible_to_client)
 select p_tenant,left(coalesce(nullif(trim(a.full_name),''),a.email),320),'change',
  format('Operator access granted to %s (%s) until %s',left(coalesce(nullif(trim(o.full_name),''),o.email),320),array_to_string(g.capabilities,', '),to_char(g.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')),true
 from public.profiles a,public.profiles o where a.id=p_actor and o.id=p_operator;
 return g.id;
end $$;
create function public.revoke_operator_access(p_grant uuid,p_actor uuid) returns jsonb language plpgsql set search_path='' as $$
declare g public.operator_grants%rowtype;
begin
 if current_user<>'service_role' then raise exception 'Not authorised' using errcode='42501';end if;
 perform 1 from public.tenants t join public.operator_grants x on x.tenant_id=t.id where x.id=p_grant for update of t;
 select * into g from public.operator_grants where id=p_grant for update;
 if g.id is null or not (ripepiper_private.is_tenant_owner(g.tenant_id,p_actor) or ripepiper_private.is_platform_admin(p_actor)) then raise exception 'Not authorised' using errcode='42501';end if;
 if g.revoked_at is not null then return jsonb_build_object('id',g.id,'revokedAt',g.revoked_at,'alreadyRevoked',true);end if;
 update public.operator_grants set revoked_at=now(),revoked_by=p_actor where id=g.id returning * into g;
 insert into public.activity_log(tenant_id,actor,kind,message,visible_to_client)
 select g.tenant_id,left(coalesce(nullif(trim(a.full_name),''),a.email),320),'change',format('Operator access revoked for %s',left(coalesce(nullif(trim(o.full_name),''),o.email),320)),true
 from public.profiles a,public.profiles o where a.id=p_actor and o.id=g.operator_id;
 return jsonb_build_object('id',g.id,'revokedAt',g.revoked_at,'alreadyRevoked',false);
end $$;
revoke all on function public.grant_operator_access(uuid,uuid,uuid,text[],text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.revoke_operator_access(uuid,uuid) from public,anon,authenticated;
grant execute on function public.grant_operator_access(uuid,uuid,uuid,text[],text,text,timestamptz) to service_role;
grant execute on function public.revoke_operator_access(uuid,uuid) to service_role;

-- Operating mode: compare-and-set on the existing column. No data moves; access is unchanged.
create function public.set_tenant_ownership(p_tenant uuid,p_actor uuid,p_expected text,p_to text,p_reason text) returns jsonb
language plpgsql set search_path='' as $$
declare current_mode text;
begin
 if current_user<>'service_role' then raise exception 'Not authorised' using errcode='42501';end if;
 select ownership into current_mode from public.tenants where id=p_tenant for update;
 if not found or not (ripepiper_private.is_tenant_owner(p_tenant,p_actor) or ripepiper_private.is_platform_admin(p_actor)) then raise exception 'Not authorised' using errcode='42501';end if;
 if p_to is null or p_to not in ('managed','client_owned') or coalesce(octet_length(btrim(p_reason)),0) not between 1 and 500 then raise exception 'Valid mode and reason required' using errcode='22023';end if;
 if current_mode is distinct from p_expected then raise exception 'Operating mode changed' using errcode='40001';end if;
 if current_mode=p_to then return jsonb_build_object('tenantId',p_tenant,'ownership',p_to,'changed',false);end if;
 update public.tenants set ownership=p_to where id=p_tenant;
 insert into public.activity_log(tenant_id,actor,kind,message,visible_to_client)
 select p_tenant,left(coalesce(nullif(trim(a.full_name),''),a.email),320),'change',
  format('Operating mode changed from %s to %s: %s',case current_mode when 'client_owned' then 'self-service' else current_mode end,case p_to when 'client_owned' then 'self-service' else p_to end,btrim(p_reason)),true
 from public.profiles a where a.id=p_actor;
 return jsonb_build_object('tenantId',p_tenant,'ownership',p_to,'changed',true);
end $$;
revoke all on function public.set_tenant_ownership(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.set_tenant_ownership(uuid,uuid,text,text,text) to service_role;

-- Signature change: callers are rewritten below, then the actor-only overload is dropped.
create function public.google_authority_admin(p_tenant uuid,p_actor uuid,p_capability text) returns boolean
language sql stable set search_path='' as $$ select current_user='service_role' and ripepiper_private.can_operate(p_tenant,p_actor,p_capability) $$;
revoke all on function public.google_authority_admin(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.google_authority_admin(uuid,uuid,text) to service_role;

-- ---------------------------------------------------------------- manifest rewrite
do $rewrite$
declare
 -- Every textual staff check variant: plain, aliased, confirmed-join and verified-email (the id expression is %s).
 staff constant text:='exists[(]select 1 from public[.]profiles(?: \w+| p join auth[.]users u on u[.]id=p[.]id(?: and u[.]email_confirmed_at is not null)?)? where (?:\w+[.])?id=%s and (?:\w+[.])?is_admin(?: and u[.]email_confirmed_at is not null and lower[(][pu][.]email[)]=lower[(][pu][.]email[)])?[)]';
 f record; e record; src text; hits int;
begin
 create temp table hybrid_access_manifest(ord serial,fn regprocedure,pattern text,replacement text,n int);
 -- Staff checks: (function, id expression, tenant expression, capability SQL, expected matches).
 insert into hybrid_access_manifest(fn,pattern,replacement,n)
 select fn::regprocedure,format(staff,regexp_replace(id,'([^[:alnum:]_])','\\\1','g')),
  case when tenant='platform' then format('ripepiper_private.is_platform_admin(%s)',id) else format('ripepiper_private.can_operate(%s,%s,%s)',tenant,id,cap) end,n
 from (values
  ('public.save_business_brief(uuid,integer,jsonb,uuid)','p_actor','p_tenant_id','''operate''',1),
  ('public.save_response_review(uuid,uuid,text,uuid,uuid,integer,text,text,text,uuid,boolean)','p_actor','p_tenant','''operate''',1),
  ('public.import_review_lead(uuid,uuid,text,text,text,text,timestamptz,boolean)','p_actor','p_tenant','''operate''',1),
  ('public.manage_campaign_plan(uuid,uuid,uuid,text,integer,jsonb)','p_actor','p_tenant','case when p_operation=''approve'' then ''approve'' else ''operate'' end',1),
  ('public.response_review_owners(uuid,uuid)','p_actor','p_tenant','''read''',1),
  ('public.manage_event_settings(uuid,uuid,uuid,integer,jsonb)','p_actor','p_tenant','''operate''',1),
  ('public.revive_review_context(uuid,uuid,uuid)','p_actor','p_tenant','''read''',1),
  ('public.review_revive_candidate(uuid,uuid,uuid,integer,text,integer,text,text,timestamptz)','p_actor','p_tenant','''approve''',1),
  ('public.revive_draft_context_current(uuid,uuid,jsonb,timestamptz)','p_actor','p_tenant','''operate''',1),
  ('public.record_revive_draft_proposal(uuid,uuid,jsonb)','p_actor','p_tenant','''operate''',1),
  ('public.build_revive_audience(uuid,uuid,jsonb)','p_actor','p_tenant','''approve''',1),
  ('public.assert_revive_draft_context(uuid,uuid,jsonb)','p_actor','p_tenant','''operate''',1),
  ('public.save_reviewed_revive_draft(uuid,uuid,uuid,integer,jsonb)','p_actor','p_tenant','''operate''',1),
  ('public.revive_audience_candidates(uuid,uuid)','p_actor','p_tenant','''read''',1),
  ('public.revive_setup_context(uuid,uuid)','p_actor','p_tenant','''read''',1),
  ('public.save_revive_setup(uuid,uuid,integer,integer,text,jsonb)','p_actor','p_tenant','case when p_state=''reviewed'' then ''approve'' else ''operate'' end',1),
  ('public.save_revive_setup(uuid,uuid,integer,integer,text,jsonb)','(p_body->>''ownerId'')::uuid','p_tenant','''operate''',1),
  ('public.build_revive_strategy(uuid,uuid,jsonb,jsonb)','p_actor','p_tenant','''approve''',1),
  ('public.preview_revive_schedule(uuid,uuid,uuid,integer,uuid,timestamptz)','p_actor','p_tenant','''read''',1),
  ('public.signal_binding_valid(uuid,uuid,jsonb,jsonb,jsonb,timestamptz)','p_actor','p_tenant','''operate''',1),
  ('public.signal_binding_valid(uuid,uuid,jsonb,jsonb,jsonb,timestamptz)','(o->>''assessment_reviewed_by'')::uuid','p_tenant','''approve''',1),
  ('public.signal_binding_valid(uuid,uuid,jsonb,jsonb,jsonb,timestamptz)','(trigger_row->>''assessment_reviewed_by'')::uuid','p_tenant','''approve''',1),
  ('public.signal_strategy_context(uuid,uuid,uuid)','p_actor','p_tenant','''read''',1),
  ('public.record_tenant_unsubscribe(uuid,uuid,uuid,text)','p_actor','p_tenant','''operate''',1),
  ('public.issue_tenant_unsubscribe(uuid,uuid,uuid,text)','p_actor','p_tenant','''operate''',1),
  ('public.review_consultation_attendance(uuid,uuid,integer,jsonb,text,text,text,boolean,boolean,uuid)','p_actor','(select tenant_id from public.meetings where id=p_meeting)','''operate''',1),
  ('public.guard_revive_outcome_attribution()','new.assessment_reviewed_by','new.tenant_id','''approve''',1),
  ('public.guard_signal_evidence()','new.assessment_reviewed_by','new.tenant_id','''approve''',1),
  ('public.revive_candidate_current(uuid,uuid,timestamptz)','r.reviewer_id','p_tenant','''approve''',1),
  ('public.revive_campaign_audience_current(uuid,uuid,integer,uuid,timestamptz)','(audience->>''reviewedBy'')::uuid','p_tenant','''approve''',1),
  ('public.revive_setup_current(uuid,integer,timestamptz)','(s.body->>''ownerId'')::uuid','p_tenant','''operate''',1),
  ('public.revive_setup_current(uuid,integer,timestamptz)','s.created_by','p_tenant','''approve''',1),
  ('public.guard_revive_setup()','new.created_by','new.tenant_id','case when new.state=''reviewed'' then ''approve'' else ''operate'' end',1),
  ('public.guard_revive_setup()','(new.body->>''ownerId'')::uuid','new.tenant_id','''operate''',1),
  ('public.revive_campaign_strategy_current(uuid,uuid,integer,uuid,timestamptz)','(strategy->>''reviewedBy'')::uuid','p_tenant','''approve''',1),
  ('public.revive_slot_authority_current(uuid,uuid,integer,uuid,timestamptz)','a.approved_by','p_tenant','''approve''',1),
  ('public.guard_signal_execution()','a.approved_by','new.tenant_id','''approve''',1),
  ('public.guard_signal_review()','new.approved_by','new.tenant_id','''approve''',1),
  ('public.synthetic_action_allowed(uuid,timestamptz)','v.approved_by','a.tenant_id','''approve''',1),
  ('public.authorize_build_budget(uuid,bigint,text,text,timestamptz)','p_actor','platform',null,1),
  ('public.activate_tenant_execution(uuid,uuid,text,integer,integer,text)','p_actor','platform',null,1),
  ('public.reserve_payment_checkout(uuid,uuid,text,bigint,text,uuid,uuid)','p_actor','platform',null,1),
  ('public.register_payment_checkout(uuid,uuid,text,text,bigint,text,uuid,uuid)','p_actor','platform',null,1)
 ) m(fn,id,tenant,cap,n);
 -- Exact edits where the shape differs: (function, regex, replacement, expected matches).
 insert into hybrid_access_manifest(fn,pattern,replacement,n) select fn::regprocedure,pattern,replacement,n from (values
  ('public.set_member_role(uuid,text,text,uuid)','exists[(]select 1 from public[.]profiles where id=p_actor and is_admin[)]',
   '(ripepiper_private.is_platform_admin(p_actor) or ripepiper_private.is_tenant_owner(p_tenant,p_actor))',1),
  ('public.response_review_owners(uuid,uuid)','where p[.]is_admin or exists[(]select 1 from public[.]memberships m where m[.]user_id=p[.]id and m[.]tenant_id=p_tenant and m[.]role=''owner''[)]',
   'where ripepiper_private.can_operate(p_tenant,p.id,''operate'')',1),
  ('public.save_response_review(uuid,uuid,text,uuid,uuid,integer,text,text,text,uuid,boolean)','and [(]p[.]is_admin or exists[(]select 1 from public[.]memberships m where m[.]tenant_id=p_tenant and m[.]user_id=p[.]id and m[.]role=''owner''[)][)]',
   'and ripepiper_private.can_operate(p_tenant,p.id,''operate'')',1),
  ('public.revive_setup_context(uuid,uuid)','u[.]email_confirmed_at is not null where p[.]is_admin',
   'u.email_confirmed_at is not null where ripepiper_private.can_operate(p_tenant,p.id,''operate'')',2),
  ('public.review_prospect_snapshot(uuid,uuid,boolean)','where p[.]id=p_actor and p[.]is_admin and',
   'where p.id=p_actor and ripepiper_private.can_operate(p_tenant,p_actor,''read'') and',1),
  ('public.review_prospect_snapshot(uuid,uuid,boolean)','admin_ids as materialized [(]select id from public[.]profiles where is_admin order by id limit 101[)]',
   'admin_ids as materialized (select g.operator_id id from public.operator_grants g where g.tenant_id=p_tenant and ripepiper_private.can_operate(p_tenant,g.operator_id,''operate'') group by g.operator_id order by g.operator_id limit 101)',1),
  ('public.synthetic_action_allowed(uuid,timestamptz)','join public[.]profiles p on p[.]id=v[.]approved_by and p[.]is_admin join auth[.]users u on u[.]id=p[.]id and u[.]email_confirmed_at is not null where ',
   'where ripepiper_private.can_operate(a.tenant_id,v.approved_by,''approve'') and ',1),
  ('public.guard_tenant_activation()','join public[.]profiles p on p[.]id=r[.]actor_id and p[.]is_admin',
   'join public.profiles p on p.id=r.actor_id and ripepiper_private.is_platform_admin(p.id)',1),
  ('public.lock_revive_reviewer()','new[.]is_admin is distinct from old[.]is_admin',
   'new.is_admin is distinct from old.is_admin or new.is_operator is distinct from old.is_operator',1),
  ('public.tenant_google_probe_current(uuid,uuid,integer,integer)','public[.]google_authority_admin[(]p_actor[)]','public.google_authority_admin(p_tenant,p_actor,''operate'')',1),
  ('public.record_product_event_authorized_core(uuid,uuid,uuid,text,text,text,timestamptz,boolean,jsonb,integer,integer,text,timestamptz)','public[.]google_authority_admin[(]p_actor[)]','public.google_authority_admin(p_tenant,p_actor,''operate'')',1),
  ('public.register_tenant_google_authority(uuid,uuid,integer,integer,uuid,text,text,text,text,timestamptz)','public[.]google_authority_admin[(]p_actor[)]','public.google_authority_admin(p_tenant,p_actor,''approve'')',2),
  ('public.revoke_tenant_google_authority(uuid,uuid,integer)','public[.]google_authority_admin[(]p_actor[)]','public.google_authority_admin(p_tenant,p_actor,''approve'')',2)
 ) m(fn,pattern,replacement,n);
 for f in select fn from hybrid_access_manifest group by fn order by min(ord) loop
  src:=pg_get_functiondef(f.fn);
  for e in select * from hybrid_access_manifest where fn=f.fn order by ord loop
   select count(*) into hits from regexp_matches(src,e.pattern,'g');
   if hits<>e.n then raise exception 'Access rewrite drift in %: expected % match(es), found %: %',f.fn,e.n,hits,e.pattern;end if;
   src:=regexp_replace(src,e.pattern,e.replacement,'g');
  end loop;
  execute src;
 end loop;
 drop table hybrid_access_manifest;
end $rewrite$;
drop function public.google_authority_admin(uuid);
drop trigger revive_reviewer_lock on public.profiles;
create trigger revive_reviewer_lock before update of is_admin,is_operator or delete on public.profiles for each row execute function public.lock_revive_reviewer();

-- ---------------------------------------------------------------- tenant-confidential RLS
-- Platform admins keep the agency's own (tenant_id null) rows; tenant rows need membership or a grant.
-- Staff write policies are dropped: tenant writes go through the service RPCs above.
do $policies$
declare t text;
begin
 foreach t in array array['leads','meetings','lead_observations','contact_rights','lead_suppression','subject_requests','deals','ad_metrics_daily',
  'business_briefs','campaigns','campaign_assets','outbound_actions','revive_reviews','revive_setups','activity_log'] loop
  execute format('drop policy if exists admin_all on public.%I',t);
  execute format('drop policy if exists admin_read on public.%I',t);
  execute format('drop policy if exists staff_read on public.%I',t);
  -- Internal (not client-visible) log rows stay hidden from client members, as before.
  execute format('create policy staff_read on public.%I for select using ((tenant_id is null and public.is_admin()) or (public.can_read_tenant(tenant_id)%s))',t,
   case when t='activity_log' then ' and (visible_to_client or not public.is_member(tenant_id))' else '' end);
 end loop;
end $policies$;
-- An admin JWT writing memberships or invites would make itself a tenant owner with no grant, audit or tenant lock.
-- Membership changes go through service routes (accept_verified_invites, set_member_role); staff keep read access.
-- A granted operator (no membership) must see the tenant row to open its workspace.
create policy grant_read on public.tenants for select using (public.can_read_tenant(id));
-- Client-visible timeline notes from staff need an 'operate' grant (or ownership) on that tenant.
create function public.can_operate_tenant(t uuid) returns boolean
language sql stable security definer set search_path='' as $$ select ripepiper_private.can_operate(t,auth.uid(),'operate') $$;
revoke all on function public.can_operate_tenant(uuid) from public,anon;
grant execute on function public.can_operate_tenant(uuid) to authenticated,service_role;
create policy operator_note on public.activity_log for insert to authenticated
with check (tenant_id is not null and visible_to_client and kind in ('note','change','milestone','alert') and public.can_operate_tenant(tenant_id));
drop policy admin_all on public.memberships;
drop policy admin_all on public.invites;
create policy admin_read on public.memberships for select to authenticated using (public.is_admin());
create policy admin_read on public.invites for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------- platform view: counts and health only
create function public.platform_tenant_overview() returns table(tenant_id uuid,name text,ownership text,status text,package text,lead_count bigint,
 campaigns_by_status jsonb,actions_by_state jsonb,last_activity_at timestamptz,active_grants bigint,google_authority text)
language sql stable security definer set search_path='' as $$
 select t.id,t.name,t.ownership,t.status,t.package,
  (select count(*) from public.leads l where l.tenant_id=t.id),
  (select coalesce(jsonb_object_agg(s.k,s.n),'{}'::jsonb) from (select c.status k,count(*) n from public.campaigns c where c.tenant_id=t.id group by c.status) s),
  (select coalesce(jsonb_object_agg(s.k,s.n),'{}'::jsonb) from (select a.state k,count(*) n from public.outbound_actions a where a.tenant_id=t.id group by a.state) s),
  (select max(a.at) from public.activity_log a where a.tenant_id=t.id),
  (select count(*) from public.operator_grants g where g.tenant_id=t.id and g.revoked_at is null and g.starts_at<=now() and g.expires_at>now()),
  coalesce((select case when a.revoked then 'revoked' when a.expires_at<=now() then 'expired' else 'active' end from public.tenant_google_authority a where a.tenant_id=t.id),'none')
 from public.tenants t where public.is_admin() order by t.name,t.id
$$;
revoke all on function public.platform_tenant_overview() from public,anon;
grant execute on function public.platform_tenant_overview() to authenticated;

-- ---------------------------------------------------------------- backfill (seeded/staging data only; empty in tests)
-- Existing admins become operators with one 30-day contract grant per tenant, so nothing fails closed on deploy.
update public.profiles set is_operator=true where is_admin and not is_operator;
with g as (
 insert into public.operator_grants(tenant_id,operator_id,capabilities,authority,authorised_by,contract_reference,expires_at)
 select t.id,p.id,array['approve','operate','read'],'contract',null,'pre-hybrid-backfill',now()+interval '30 days'
 from public.tenants t cross join public.profiles p where p.is_admin returning tenant_id,operator_id
)
insert into public.activity_log(tenant_id,actor,kind,message,visible_to_client)
select g.tenant_id,'Ripe Piper','change',format('Operator access granted to %s (approve, operate, read) for 30 days under the existing service agreement',left(coalesce(nullif(trim(p.full_name),''),p.email),320)),true
from g join public.profiles p on p.id=g.operator_id;

-- Fail the migration if any unlisted function still carries a raw staff check.
do $check$
begin
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','ripepiper_private')
  and ((p.prosrc ~ 'is_admin' and p.oid not in ('public.is_admin()'::regprocedure,'ripepiper_private.can_operate(uuid,uuid,text)'::regprocedure,
    'public.lock_revive_reviewer()'::regprocedure,'public.platform_tenant_overview()'::regprocedure))
   or p.prosrc ~ 'google_authority_admin[(]p_actor[)]')) then
  raise exception 'Unlisted raw staff check remains: %',(select string_agg(p.oid::regprocedure::text,', ') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname in ('public','ripepiper_private') and p.prosrc ~ 'is_admin|google_authority_admin[(]p_actor[)]');
 end if;
end $check$;
