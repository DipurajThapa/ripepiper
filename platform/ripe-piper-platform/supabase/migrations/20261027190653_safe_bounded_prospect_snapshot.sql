begin;
set local lock_timeout = '8s';
set local statement_timeout = '30s';
do $$ begin if current_setting('server_encoding') <> 'UTF8' then raise exception 'UTF8 database required'; end if; end $$;
-- Migration-time work is intentionally bounded by transaction timeouts. These STORED values
-- prevent review reads from detoasting large compressible JSON before capacity is known.
alter table public.leads add column prospect_review_bytes bigint generated always as (
 coalesce(octet_length(company),0)::bigint + coalesce(octet_length(email),0)::bigint + coalesce(octet_length(status),0)::bigint) stored;
alter table public.lead_observations add column prospect_review_bytes bigint generated always as (
 coalesce(octet_length(source),0)::bigint + coalesce(octet_length(external_ref),0)::bigint + coalesce(octet_length(assessment_facts::text),0)::bigint + coalesce(octet_length(assessment_excerpt),0)::bigint + coalesce(octet_length(product_context::text),0)::bigint) stored;
alter table public.business_briefs add column prospect_review_bytes bigint generated always as (coalesce(octet_length(body::text),0)::bigint) stored;
alter table public.profiles add column prospect_review_bytes bigint generated always as (
 coalesce(octet_length(full_name),0)::bigint + coalesce(octet_length(email),0)::bigint) stored;
create index leads_prospect_snapshot on public.leads(tenant_id,id) include(prospect_review_bytes);
create index observations_prospect_snapshot on public.lead_observations(tenant_id,synthetic,id) include(prospect_review_bytes);
create index profiles_prospect_admins on public.profiles(id) where is_admin;
create index memberships_prospect_owners on public.memberships(tenant_id,role,user_id);

create function public.review_prospect_snapshot(p_tenant uuid,p_actor uuid,p_synthetic boolean) returns jsonb
language sql stable security invoker set search_path='' as $$
with
 actor as materialized (
  select p.id from public.profiles p join auth.users u on u.id=p.id
  where p.id=p_actor and p.is_admin and u.email_confirmed_at is not null
   and case when octet_length(p.email)<=1024 and octet_length(u.email)<=1024 then lower(p.email)=lower(u.email) else false end
 ),
 lead_meta as materialized (select id,prospect_review_bytes from public.leads where tenant_id=p_tenant order by id limit 101),
 observation_meta as materialized (select id,prospect_review_bytes from public.lead_observations where tenant_id=p_tenant and synthetic=p_synthetic order by id limit 1000),
 brief_meta as materialized (select version,prospect_review_bytes from public.business_briefs where tenant_id=p_tenant order by version desc limit 1),
 admin_ids as materialized (select id from public.profiles where is_admin order by id limit 101),
 tenant_owner_ids as materialized (select user_id id from public.memberships where tenant_id=p_tenant and role='owner' order by user_id limit 101),
 owner_ids as materialized (
  select id from (select id from admin_ids union select id from tenant_owner_ids) candidates
  where (select count(*)<101 from admin_ids) and (select count(*)<101 from tenant_owner_ids)
 ),
 owner_meta as materialized (select p.id,p.prospect_review_bytes from owner_ids c join public.profiles p on p.id=c.id),
 -- CASE makes byte gates prerequisites to label/email projection, regardless of planner predicate order.
 owners as materialized (
  select p.id,p.prospect_review_bytes from owner_meta m join public.profiles p on p.id=m.id join auth.users u on u.id=p.id
  where case when m.prospect_review_bytes between 0 and 4096 and octet_length(p.email)<=1024 and octet_length(u.email)<=1024
    then u.email_confirmed_at is not null and lower(p.email)=lower(u.email) else false end
 ),
 totals as materialized (
  select (select count(*) from lead_meta) leads,(select count(*) from observation_meta) observations,
   (select count(*) from owners) owners,
   coalesce((select sum(prospect_review_bytes) from lead_meta),0)+coalesce((select sum(prospect_review_bytes) from observation_meta),0)+coalesce((select sum(prospect_review_bytes) from brief_meta),0)+coalesce((select sum(prospect_review_bytes) from owners),0) bytes
 )
select case
 when current_user<>'service_role' or not exists(select 1 from actor) then jsonb_build_object('version',1,'status','unauthorized')
 when not exists(select 1 from public.tenants where id=p_tenant) then jsonb_build_object('version',1,'status','missing')
 when p_synthetic is null or (select leads>100 or observations>=1000 or owners>100 or bytes>1048576 from totals)
  or (select count(*)>=101 from admin_ids) or (select count(*)>=101 from tenant_owner_ids)
  or exists(select 1 from lead_meta where prospect_review_bytes is null or prospect_review_bytes not between 0 and 8192)
  or exists(select 1 from observation_meta where prospect_review_bytes is null or prospect_review_bytes not between 0 and 65536)
  or exists(select 1 from brief_meta where prospect_review_bytes is null or prospect_review_bytes not between 0 and 262144)
  or exists(select 1 from owner_meta where prospect_review_bytes is null or prospect_review_bytes not between 0 and 4096)
 or exists(select 1 from owner_meta m join public.profiles p on p.id=m.id join auth.users u on u.id=p.id where octet_length(p.email)>1024 or octet_length(u.email)>1024)
 then jsonb_build_object('version',1,'status','capacity')
 else jsonb_build_object(
  'version',1,'status','complete','tenantId',p_tenant,'synthetic',p_synthetic,'snapshotAt',statement_timestamp(),
  'brief',(select jsonb_build_object('tenant_id',b.tenant_id,'version',b.version,'body',b.body,'created_by',b.created_by,'created_at',b.created_at) from brief_meta m join public.business_briefs b on b.tenant_id=p_tenant and b.version=m.version),
  'leads',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'company',l.company,'email',l.email,'status',l.status) order by l.id),'[]'::jsonb) from lead_meta m join public.leads l on l.id=m.id),
  'observations',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'tenant_id',o.tenant_id,'lead_id',o.lead_id,'source',o.source,'external_ref',o.external_ref,'observed_at',o.observed_at,'assessment_facts',o.assessment_facts,'assessment_excerpt',o.assessment_excerpt,'assessment_reviewed_by',o.assessment_reviewed_by,'synthetic',o.synthetic,'brief_version',o.brief_version,'product_context',o.product_context) order by o.id),'[]'::jsonb) from observation_meta m join public.lead_observations o on o.id=m.id),
  'stoppedLeadIds',(select coalesce(jsonb_agg(l.id order by l.id),'[]'::jsonb) from lead_meta m join public.leads l on l.id=m.id where l.status='unsubscribed' or exists(select 1 from public.lead_suppression s where s.tenant_id=p_tenant and s.lead_id=l.id) or exists(select 1 from public.suppression s where s.email=lower(l.email))),
  'owners',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'label',left(coalesce(nullif(trim(p.full_name),''),p.email),320)) order by p.id),'[]'::jsonb) from owners o join public.profiles p on p.id=o.id),
  'leadCount',(select leads from totals),'observationCount',(select observations from totals),'ownerCount',(select owners from totals)
 ) end;
$$;
revoke all on function public.review_prospect_snapshot(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.review_prospect_snapshot(uuid,uuid,boolean) to service_role;

-- Internal byte metadata is not material business evidence. Preserve existing digest receipts.
create or replace function public.revive_input_snapshot(p_tenant uuid,p_lead uuid) returns text
language sql stable security invoker set search_path='' as $$
 select md5(jsonb_build_object(
  'lead',(select jsonb_build_object('id',id,'tenant',tenant_id,'email',email,'company',company,'status',status) from public.leads where tenant_id=p_tenant and id=p_lead),
  'brief',(select (to_jsonb(b)-'prospect_review_bytes') from public.business_briefs b where tenant_id=p_tenant order by version desc limit 1),
  'observations',coalesce((select jsonb_agg((to_jsonb(o)-'prospect_review_bytes') order by o.id) from public.lead_observations o
   where o.tenant_id=p_tenant and o.lead_id=p_lead and
   (coalesce(o.assessment_facts,'{}')<>'{}'::jsonb or o.product_context->>'kind' in ('history','reply','enquiry'))),'[]'::jsonb))::text)
$$;
create or replace function public.signal_strategy_context(p_tenant uuid,p_lead uuid,p_actor uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare t jsonb; l jsonb; obs jsonb;
begin
 if current_user<>'service_role' or not exists(select 1 from public.profiles where id=p_actor and is_admin) then raise exception 'Staff required' using errcode='42501';end if;
 select jsonb_build_object('id',id,'name',name,'status',status) into t from public.tenants where id=p_tenant;
 select jsonb_build_object('id',id,'tenant_id',tenant_id,'email',email,'status',status) into l from public.leads where id=p_lead and tenant_id=p_tenant;
 if t is null or l is null then raise exception 'Contact missing' using errcode='23503';end if;
 select coalesce(jsonb_agg((to_jsonb(o)-'prospect_review_bytes') order by o.id),'[]') into obs from
 (select * from public.lead_observations where tenant_id=p_tenant and lead_id=p_lead and synthetic=(lower(l->>'email') like '%.invalid') order by id limit 1001) o;
 return jsonb_build_object('tenant',t,'lead',l,'setup',public.revive_setup_context(p_tenant,p_actor),'observations',obs,
 'stops',(select coalesce(jsonb_agg(jsonb_build_object('tenant_id',tenant_id,'lead_id',lead_id) order by lead_id),'[]') from public.lead_suppression where tenant_id=p_tenant and lead_id=p_lead),
 'globalStops',(select coalesce(jsonb_agg(jsonb_build_object('email',email) order by email),'[]') from public.suppression where email=lower(l->>'email')));
end $$;

create or replace function public.revive_review_context(p_tenant uuid,p_lead uuid,p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare l public.leads%rowtype; brief jsonb; observations jsonb; review jsonb; stopped boolean;
begin
 if current_user<>'service_role' or not exists(select 1 from public.profiles where id=p_actor and is_admin) then raise exception 'Staff required' using errcode='42501'; end if;
 perform 1 from public.tenants where id=p_tenant for update;
 select * into l from public.leads where tenant_id=p_tenant and id=p_lead;
 if not found then return null; end if;
 if (select count(*) from public.lead_observations where tenant_id=p_tenant and lead_id=p_lead)>=1000 then raise exception 'Review capacity exceeded' using errcode='22023'; end if;
 select (to_jsonb(b)-'prospect_review_bytes') into brief from public.business_briefs b where tenant_id=p_tenant order by version desc limit 1;
 select coalesce(jsonb_agg((to_jsonb(o)-'prospect_review_bytes') order by o.id),'[]') into observations from public.lead_observations o where tenant_id=p_tenant and lead_id=p_lead;
 select to_jsonb(r) into review from public.revive_reviews r where tenant_id=p_tenant and lead_id=p_lead;
 stopped:=l.status='unsubscribed' or exists(select 1 from public.lead_suppression where tenant_id=p_tenant and lead_id=p_lead) or exists(select 1 from public.suppression where email=lower(l.email));
 return jsonb_build_object('lead',jsonb_build_object('id',l.id,'tenant_id',l.tenant_id,'email',l.email,'status',l.status),
  'brief',brief,'observations',observations,'review',review,'suppressed',stopped,'snapshot',public.revive_input_snapshot(p_tenant,p_lead));
end $$;
commit;
