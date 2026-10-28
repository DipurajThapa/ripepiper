-- Durable read authority only. Credentials never enter the database.
create table public.tenant_google_authority (
 tenant_id uuid primary key references public.tenants(id), connection_id uuid not null,
 version integer not null check(version>0), binding_hash text not null check(binding_hash ~ '^[0-9a-f]{64}$'),
 mailbox text not null check(octet_length(mailbox) between 3 and 254 and mailbox=lower(mailbox)),
 calendar_id text not null check(octet_length(calendar_id) between 1 and 16384 and calendar_id<>'primary'),
 purpose_reference text not null check(octet_length(purpose_reference) between 1 and 960),
 expires_at timestamptz not null check(isfinite(expires_at)), verified_at timestamptz not null,
 verified_by uuid not null references public.profiles(id), revoked boolean not null default false
);
alter table public.tenant_google_authority enable row level security;
revoke all on public.tenant_google_authority from public,anon,authenticated;
grant select,insert,update on public.tenant_google_authority to service_role;

-- Keep the durable namespace and version monotonic even for direct service writes.
create function public.guard_google_authority_version() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (tg_op='INSERT' and new.version<>1) or (tg_op='UPDATE' and
  (new.tenant_id<>old.tenant_id or new.connection_id<>old.connection_id or new.version<>old.version+1)) then
  raise exception 'Connection authority changed' using errcode='40001';
 end if;
 return new;
end $$;
revoke all on function public.guard_google_authority_version() from public,anon,authenticated;
create trigger google_authority_version before insert or update on public.tenant_google_authority for each row execute function public.guard_google_authority_version();

create function public.google_authority_admin(p_actor uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select current_user='service_role' and exists(select 1 from public.profiles p join auth.users u on u.id=p.id
 where p.id=p_actor and p.is_admin and u.email_confirmed_at is not null and lower(u.email)=lower(p.email)
 and octet_length(u.email)<=1024 and octet_length(p.email)<=1024)
$$;
revoke all on function public.google_authority_admin(uuid) from public,anon,authenticated;
grant execute on function public.google_authority_admin(uuid) to service_role;

create function public.tenant_google_probe_current(p_tenant uuid,p_actor uuid,p_execution_version integer,p_authority_version integer)
returns boolean language sql volatile security invoker set search_path='' as $$
 select public.google_authority_admin(p_actor) and exists(select 1 from public.tenants t
 where t.id=p_tenant and t.status='active' and t.execution_version=p_execution_version
 and coalesce((select a.version from public.tenant_google_authority a where a.tenant_id=t.id),0)=p_authority_version)
$$;
revoke all on function public.tenant_google_probe_current(uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.tenant_google_probe_current(uuid,uuid,integer,integer) to service_role;

create function public.tenant_google_authority_current(p_tenant uuid,p_actor uuid,p_execution_version integer,p_authority_version integer,p_binding_hash text)
returns boolean language sql volatile security invoker set search_path='' as $$
 select public.tenant_google_probe_current(p_tenant,p_actor,p_execution_version,p_authority_version)
 and exists(select 1 from public.tenant_google_authority a where a.tenant_id=p_tenant and a.version=p_authority_version
 and a.binding_hash=p_binding_hash and not a.revoked and a.expires_at>clock_timestamp())
$$;
revoke all on function public.tenant_google_authority_current(uuid,uuid,integer,integer,text) from public,anon,authenticated;
grant execute on function public.tenant_google_authority_current(uuid,uuid,integer,integer,text) to service_role;

create function public.register_tenant_google_authority(p_tenant uuid,p_actor uuid,p_expected_version integer,p_execution_version integer,p_connection uuid,p_binding_hash text,p_mailbox text,p_calendar text,p_purpose text,p_expires timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare account public.tenants%rowtype; previous public.tenant_google_authority%rowtype; result integer;
begin
 if not public.google_authority_admin(p_actor) then raise exception 'Verified staff required' using errcode='42501'; end if;
 select * into account from public.tenants where id=p_tenant for update;
 if not found then raise exception 'Tenant missing' using errcode='22023'; end if;
 if not public.google_authority_admin(p_actor) then raise exception 'Verified staff required' using errcode='42501'; end if;
 select * into previous from public.tenant_google_authority where tenant_id=p_tenant;
 if p_expected_version is null or p_expected_version<0 or p_expected_version>=2147483647
 or p_execution_version is null or p_connection is null or p_binding_hash is null or p_binding_hash !~ '^[0-9a-f]{64}$'
 or coalesce(octet_length(p_mailbox),0) not between 3 and 254 or p_mailbox<>lower(p_mailbox)
 or p_mailbox !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
 or coalesce(length(p_calendar),0) not between 1 and 4096 or trim(p_calendar)='' or p_calendar='primary'
 or coalesce(length(p_purpose),0) not between 1 and 240 or trim(p_purpose)=''
 or p_expires is null or not isfinite(p_expires) or p_expires<=clock_timestamp() then
 raise exception 'Invalid connection metadata' using errcode='22023'; end if;
 if account.status<>'active' or account.execution_version<>p_execution_version
 or coalesce(previous.version,0)<>p_expected_version or (previous.connection_id is not null and previous.connection_id<>p_connection) then
 raise exception 'Connection authority changed' using errcode='40001'; end if;
 result:=p_expected_version+1;
 if previous.tenant_id is null then
  insert into public.tenant_google_authority(tenant_id,connection_id,version,binding_hash,mailbox,calendar_id,purpose_reference,expires_at,verified_at,verified_by,revoked)
  values(p_tenant,p_connection,result,p_binding_hash,p_mailbox,p_calendar,p_purpose,p_expires,clock_timestamp(),p_actor,false);
 else
  update public.tenant_google_authority set version=result,binding_hash=p_binding_hash,mailbox=p_mailbox,
   calendar_id=p_calendar,purpose_reference=p_purpose,expires_at=p_expires,verified_at=clock_timestamp(),verified_by=p_actor,revoked=false
  where tenant_id=p_tenant;
 end if;
 return jsonb_build_object('version',1,'status','verified','authorityVersion',result);
end $$;
revoke all on function public.register_tenant_google_authority(uuid,uuid,integer,integer,uuid,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.register_tenant_google_authority(uuid,uuid,integer,integer,uuid,text,text,text,text,timestamptz) to service_role;

create function public.revoke_tenant_google_authority(p_tenant uuid,p_actor uuid,p_expected_version integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare previous public.tenant_google_authority%rowtype;
begin
 if not public.google_authority_admin(p_actor) then raise exception 'Verified staff required' using errcode='42501'; end if;
 perform 1 from public.tenants where id=p_tenant for update;
 if not public.google_authority_admin(p_actor) then raise exception 'Verified staff required' using errcode='42501'; end if;
 if p_expected_version is null or p_expected_version<0 or p_expected_version>=2147483647 then raise exception 'Invalid expected version' using errcode='22023'; end if;
 select * into previous from public.tenant_google_authority where tenant_id=p_tenant;
 if not found or previous.version<>p_expected_version then raise exception 'Connection authority changed' using errcode='40001'; end if;
 update public.tenant_google_authority set version=version+1,revoked=true where tenant_id=p_tenant;
 return jsonb_build_object('version',1,'status','revoked','authorityVersion',p_expected_version+1);
end $$;
revoke all on function public.revoke_tenant_google_authority(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.revoke_tenant_google_authority(uuid,uuid,integer) to service_role;

create function public.record_product_event_authorized_core(p_tenant uuid,p_lead uuid,p_actor uuid,p_reference text,p_rights text,p_excerpt text,p_observed timestamptz,p_synthetic boolean,p_context jsonb,p_execution_version integer,p_authority_version integer,p_binding_hash text,p_connection_expires timestamptz)
returns uuid language plpgsql security invoker set search_path='' as $$
declare previous public.lead_observations%rowtype; lead_email text; result uuid;
begin
 if not public.google_authority_admin(p_actor) then
  raise exception 'Staff service required' using errcode='42501';
 end if;
 perform 1 from public.tenants where id=p_tenant for update;

 -- This core is service-callable, so it independently enforces every Gmail fence.
 if p_authority_version is not null or p_binding_hash is not null or p_execution_version is not null or p_connection_expires is not null then
  if not public.tenant_google_authority_current(p_tenant,p_actor,p_execution_version,p_authority_version,p_binding_hash)
   or not exists(select 1 from public.tenant_google_authority a where a.tenant_id=p_tenant
    and a.expires_at=p_connection_expires and a.purpose_reference=p_rights
    and p_reference ~ ('^gmail:'||a.connection_id::text||':[a-zA-Z0-9_-]{1,128}$')
    and p_context->>'threadRef' ~ ('^gmail:'||a.connection_id::text||':[a-zA-Z0-9_-]{1,128}$'))
   or p_synthetic is distinct from false or p_context->>'product' is distinct from 'response' or p_context->>'kind' is distinct from 'reply' then
   raise exception 'Connection authority changed' using errcode='40001'; end if;
 elsif lower(p_reference) like 'gmail:%' then
  raise exception 'Gmail evidence requires durable authority' using errcode='22023';
 elsif lower(p_context->>'threadRef') like 'gmail:%' then
  if p_context->>'product' is distinct from 'response' or p_context->>'kind' is distinct from 'outcome'
   or not exists(select 1 from public.lead_observations o where o.tenant_id=p_tenant and o.lead_id=p_lead
    and o.synthetic=p_synthetic and o.assessment_reviewed_by is not null
    and o.product_context->>'product'='response' and o.product_context->>'kind' in ('enquiry','reply')
    and o.product_context->>'threadRef'=p_context->>'threadRef') then
   raise exception 'Gmail thread requires existing reviewed response evidence' using errcode='22023'; end if;
 end if;
 select email into lead_email from public.leads where tenant_id=p_tenant and id=p_lead;
 if not found then raise exception 'Lead scope mismatch' using errcode='23503'; end if;
 if p_synthetic is null or p_synthetic <> (lower(lead_email) like '%.invalid') then raise exception 'Evidence mode mismatch' using errcode='22023'; end if;
 if p_observed is null or p_observed>now() or coalesce(length(trim(p_reference)),0) not between 1 and 240
  or coalesce(length(trim(p_rights)),0) not between 1 and 240 or coalesce(length(trim(p_excerpt)),0) not between 1 and 2000
  or p_context is null or coalesce(p_context->>'product','') not in ('revive','signal','response','events')
  or coalesce(p_context->>'kind','') not in ('history','trigger','enquiry','reply','registration','attendance','outcome') then
  raise exception 'Incomplete reviewed product event' using errcode='22023';
 end if;
 select * into previous from public.lead_observations where tenant_id=p_tenant and source='product_review' and external_ref=p_reference;
 if found then
  if previous.lead_id=p_lead and previous.product_context=p_context and previous.assessment_excerpt=p_excerpt
   and previous.observed_at=p_observed and previous.synthetic=p_synthetic and previous.rights_reference=p_rights then return previous.id; end if;
  raise exception 'Reference reused with different evidence' using errcode='23505';
 end if;
 insert into public.lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_excerpt,assessment_reviewed_by,product_context,brief_version)
 values(p_tenant,p_lead,'product_review',p_reference,p_observed,'managed product review',p_rights,p_synthetic,p_excerpt,p_actor,p_context,(select max(version) from public.business_briefs where tenant_id=p_tenant)) returning id into result;
 return result;
end $$;
revoke all on function public.record_product_event_authorized_core(uuid,uuid,uuid,text,text,text,timestamptz,boolean,jsonb,integer,integer,text,timestamptz) from public,anon,authenticated;
grant execute on function public.record_product_event_authorized_core(uuid,uuid,uuid,text,text,text,timestamptz,boolean,jsonb,integer,integer,text,timestamptz) to service_role;

create or replace function public.record_product_event(p_tenant uuid,p_lead uuid,p_actor uuid,p_reference text,p_rights text,p_excerpt text,p_observed timestamptz,p_synthetic boolean,p_context jsonb)
returns uuid language sql security invoker set search_path='' as $$
 select public.record_product_event_authorized_core(p_tenant,p_lead,p_actor,p_reference,p_rights,p_excerpt,p_observed,p_synthetic,p_context,null,null,null,null)
$$;

create or replace function public.record_gmail_product_event(p_expected_version integer,p_connection_expires timestamptz,p_tenant uuid,p_lead uuid,p_actor uuid,p_reference text,p_rights text,p_excerpt text,p_observed timestamptz,p_synthetic boolean,p_context jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
begin raise exception 'Legacy Gmail persistence is disabled; durable authority required' using errcode='42501'; end $$;

create function public.record_authorized_gmail_event(p_expected_version integer,p_connection_expires timestamptz,p_tenant uuid,p_lead uuid,p_actor uuid,p_reference text,p_rights text,p_excerpt text,p_observed timestamptz,p_synthetic boolean,p_context jsonb,p_authority_version integer,p_binding_hash text)
returns uuid language plpgsql security invoker set search_path='' as $$
begin
 if p_expected_version is null or p_connection_expires is null or p_authority_version is null or p_binding_hash is null then
 raise exception 'Connection authority changed' using errcode='40001'; end if;
 return public.record_product_event_authorized_core(p_tenant,p_lead,p_actor,p_reference,p_rights,p_excerpt,p_observed,p_synthetic,p_context,p_expected_version,p_authority_version,p_binding_hash,p_connection_expires);
end $$;
revoke all on function public.record_authorized_gmail_event(integer,timestamptz,uuid,uuid,uuid,text,text,text,timestamptz,boolean,jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.record_authorized_gmail_event(integer,timestamptz,uuid,uuid,uuid,text,text,text,timestamptz,boolean,jsonb,integer,text) to service_role;
