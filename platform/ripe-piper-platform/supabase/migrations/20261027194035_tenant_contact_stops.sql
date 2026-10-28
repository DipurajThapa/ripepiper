begin;
set local lock_timeout='8s';
set local statement_timeout='30s';
-- Bearer material is never persisted: only its SHA-256 digest and scoped receipt.
create table ripepiper_private.tenant_unsubscribe_tokens (
 token_hash text primary key check(token_hash ~ '^[0-9a-f]{64}$'),
 tenant_id uuid not null references public.tenants(id),
 lead_id uuid not null,
 normalized_email text not null,
 issuer_id uuid not null references public.profiles(id),
 created_at timestamptz not null,
 expires_at timestamptz not null,
 confirmed_at timestamptz,
 foreign key(tenant_id,lead_id) references public.leads(tenant_id,id),
 check(expires_at>created_at)
);
create index tenant_unsubscribe_lead on ripepiper_private.tenant_unsubscribe_tokens(tenant_id,lead_id,created_at desc);
alter table ripepiper_private.tenant_unsubscribe_tokens enable row level security;
revoke all on ripepiper_private.tenant_unsubscribe_tokens from public,anon,authenticated;
grant select,insert,update,delete on ripepiper_private.tenant_unsubscribe_tokens to service_role;
grant usage on schema ripepiper_private to service_role;

-- Called only by service RPCs and the existing controlled objection trigger owner.
create function ripepiper_private.apply_tenant_contact_stop(p_tenant uuid,p_lead uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare already boolean; at_time timestamptz;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if not found then raise exception 'Contact not found' using errcode='P0002';end if;
 perform 1 from public.leads where tenant_id=p_tenant and id=p_lead for update;
 if not found then raise exception 'Contact not found' using errcode='P0002';end if;
 at_time:=clock_timestamp();
 select exists(select 1 from public.lead_suppression where tenant_id=p_tenant and lead_id=p_lead) into already;
 insert into public.lead_suppression(tenant_id,lead_id,reason,created_at) values(p_tenant,p_lead,'objection',at_time) on conflict do nothing;
 update public.contact_rights set decision='denied',objected_at=coalesce(objected_at,at_time),version=version+1,updated_at=at_time
 where tenant_id=p_tenant and lead_id=p_lead and (decision<>'denied' or objected_at is null);
 update public.outbound_actions set state=case when state='queued' then 'cancelled' else 'review' end,lease_until=null,error_code='tenant_contact_stopped'
 where tenant_id=p_tenant and lead_id=p_lead and state in ('queued','claimed');
 return already;
end $$;
revoke all on function ripepiper_private.apply_tenant_contact_stop(uuid,uuid) from public,anon,authenticated;
grant execute on function ripepiper_private.apply_tenant_contact_stop(uuid,uuid) to service_role;
create or replace function public.freeze_on_objection() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.kind='object' then perform ripepiper_private.apply_tenant_contact_stop(new.tenant_id,new.lead_id);end if;
 return new;
end $$;
revoke all on function public.freeze_on_objection() from public,anon,authenticated;
-- CREATE OR REPLACE retains the established trigger owner. Grant that exact role
-- access to the invoker helper even when the migration executor is a different role.
do $$
declare trigger_owner name;
begin
 select r.rolname into trigger_owner from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner where p.oid='public.freeze_on_objection()'::regprocedure;
 if trigger_owner in ('anon','authenticated') then raise exception 'Controlled objection trigger owner required';end if;
 execute format('grant usage on schema ripepiper_private to %I',trigger_owner);
 execute format('grant execute on function ripepiper_private.apply_tenant_contact_stop(uuid,uuid) to %I',trigger_owner);
end $$;

-- The existing Response trigger can also be reached through direct staff evidence writes.
-- Take the same tenant lock before its action mutations, then let its objection row
-- invoke the controlled scoped stop above.
create or replace function public.apply_product_reply_stop() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.product_context->>'product'='response' and new.product_context->>'kind' in ('enquiry','reply') then
  perform 1 from public.tenants where id=new.tenant_id for update;
  update public.outbound_actions set state=case when state='claimed' then 'review' else 'cancelled' end,
   error_code='conversation_hold',lease_until=null where tenant_id=new.tenant_id and lead_id=new.lead_id and state in ('queued','claimed');
  if new.product_context->>'disposition'='opt_out' then
   insert into public.subject_requests(tenant_id,lead_id,kind,owner_id) values(new.tenant_id,new.lead_id,'object',new.assessment_reviewed_by);
  end if;
 end if;
 return new;
end $$;
revoke all on function public.apply_product_reply_stop() from public,anon,authenticated;
create function public.record_tenant_unsubscribe(p_tenant uuid,p_lead uuid,p_actor uuid,p_reference text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare already boolean;
begin
 if current_user<>'service_role' then raise exception 'Verified staff required' using errcode='42501';end if;
 perform 1 from public.tenants where id=p_tenant for update;
 if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=p_actor and p.is_admin and u.email_confirmed_at is not null and lower(p.email)=lower(u.email)) then raise exception 'Verified staff required' using errcode='42501';end if;
 if p_reference is null or length(trim(p_reference))<8 or length(p_reference)>240 then raise exception 'Invalid reference' using errcode='22023';end if;
 already:=ripepiper_private.apply_tenant_contact_stop(p_tenant,p_lead);
 if not already then
  insert into public.activity_log(tenant_id,actor,kind,message,visible_to_client) values(p_tenant,p_actor::text,'note',jsonb_build_object('kind','tenant_contact_stop','leadId',p_lead,'referenceHash',encode(sha256(convert_to(p_reference,'UTF8')),'hex'))::text,false);
 end if;
 return jsonb_build_object('version',1,'status','stopped','tenantId',p_tenant,'leadId',p_lead,'alreadyStopped',already);
end $$;

create function public.issue_tenant_unsubscribe(p_tenant uuid,p_lead uuid,p_actor uuid,p_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare address text; at_time timestamptz; expires timestamptz;
begin
 if current_user<>'service_role' then raise exception 'Verified staff required' using errcode='42501';end if;
 perform 1 from public.tenants where id=p_tenant for update;
 if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=p_actor and p.is_admin and u.email_confirmed_at is not null and lower(p.email)=lower(u.email)) then raise exception 'Verified staff required' using errcode='42501';end if;
 if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid hash' using errcode='22023';end if;
 select lower(trim(email)) into address from public.leads where tenant_id=p_tenant and id=p_lead for update;
 if not found then raise exception 'Contact not found' using errcode='P0002';end if;
 at_time:=clock_timestamp();expires:=at_time+interval '90 days';
 if exists(select 1 from public.lead_suppression where tenant_id=p_tenant and lead_id=p_lead) or exists(select 1 from public.suppression where lower(email)=address) then return '{"version":1,"status":"stopped"}'::jsonb;end if;
 delete from ripepiper_private.tenant_unsubscribe_tokens where tenant_id=p_tenant and lead_id=p_lead and confirmed_at is null and expires_at<=at_time;
 if exists(select 1 from ripepiper_private.tenant_unsubscribe_tokens where tenant_id=p_tenant and lead_id=p_lead and created_at>at_time-interval '60 seconds') or
 (select count(*) from ripepiper_private.tenant_unsubscribe_tokens where tenant_id=p_tenant and lead_id=p_lead and confirmed_at is null and expires_at>at_time)>=20 then return '{"version":1,"status":"limited"}'::jsonb;end if;
 insert into ripepiper_private.tenant_unsubscribe_tokens values(p_hash,p_tenant,p_lead,address,p_actor,at_time,expires,null);
 return jsonb_build_object('version',1,'status','issued','expiresAt',expires);
end $$;

create function public.confirm_tenant_unsubscribe(p_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare scope uuid; token ripepiper_private.tenant_unsubscribe_tokens%rowtype; address text; at_time timestamptz;
begin
 if current_user<>'service_role' then raise exception 'Service required' using errcode='42501';end if;
 if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then return '{"version":1,"status":"invalid"}'::jsonb;end if;
 select tenant_id into scope from ripepiper_private.tenant_unsubscribe_tokens where token_hash=p_hash;
 if not found then return '{"version":1,"status":"invalid"}'::jsonb;end if;
 perform 1 from public.tenants where id=scope for update;
 select * into token from ripepiper_private.tenant_unsubscribe_tokens where token_hash=p_hash and tenant_id=scope for update;
 if not found then return '{"version":1,"status":"invalid"}'::jsonb;end if;
 -- Historical confirmation takes precedence: no writes on replay, even after address change.
 if token.confirmed_at is not null then return '{"version":1,"status":"confirmed"}'::jsonb;end if;
 select lower(trim(email)) into address from public.leads where tenant_id=token.tenant_id and id=token.lead_id for update;
 at_time:=clock_timestamp();
 if not found or address is distinct from token.normalized_email or token.expires_at<=at_time then return '{"version":1,"status":"invalid"}'::jsonb;end if;
 perform ripepiper_private.apply_tenant_contact_stop(token.tenant_id,token.lead_id);
 update ripepiper_private.tenant_unsubscribe_tokens set confirmed_at=at_time where token_hash=p_hash;
 return '{"version":1,"status":"confirmed"}'::jsonb;
end $$;
revoke all on function public.record_tenant_unsubscribe(uuid,uuid,uuid,text),public.issue_tenant_unsubscribe(uuid,uuid,uuid,text),public.confirm_tenant_unsubscribe(text) from public,anon,authenticated;
grant execute on function public.record_tenant_unsubscribe(uuid,uuid,uuid,text),public.issue_tenant_unsubscribe(uuid,uuid,uuid,text),public.confirm_tenant_unsubscribe(text) to service_role;
commit;


