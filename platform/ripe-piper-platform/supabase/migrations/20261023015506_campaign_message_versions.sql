create function public.campaign_steps_valid(steps jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare step jsonb; prior integer:=-1; offset_hours integer;
begin
 if jsonb_typeof(steps) is distinct from 'array' then return false; end if;
 if jsonb_array_length(steps) not between 1 and 3 then return false; end if;
 for step in select value from jsonb_array_elements(steps) loop
  if jsonb_typeof(step) is distinct from 'object' or jsonb_typeof(step->'offsetHours') is distinct from 'number'
   or coalesce(step->>'offsetHours','') !~ '^[0-9]{1,3}$' then return false; end if;
  offset_hours:=(step->>'offsetHours')::integer;
  if offset_hours>720 or (prior=-1 and offset_hours<>0) or (prior>=0 and offset_hours-prior<24)
   or jsonb_typeof(step->'subject') is distinct from 'string' or jsonb_typeof(step->'body') is distinct from 'string'
   or jsonb_typeof(step->'evidenceReference') is distinct from 'string'
   or coalesce(length(trim(step->>'subject')),0) not between 1 and 160
   or coalesce(length(trim(step->>'body')),0) not between 1 and 4000
   or coalesce(length(trim(step->>'evidenceReference')),0) not between 1 and 240
   or (step->>'subject') ~ E'[\r\n]' then return false; end if;
  prior:=offset_hours;
 end loop;
 return true;
end $$;
revoke all on function public.campaign_steps_valid(jsonb) from public,anon,authenticated;
grant execute on function public.campaign_steps_valid(jsonb) to service_role;
create function public.campaign_brief_current(p_tenant uuid,p_version integer,p_now timestamptz) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare b jsonb; days integer; observed timestamptz;
begin
 if p_version is null or p_now is null or p_version is distinct from (select max(version) from public.business_briefs where tenant_id=p_tenant) then return false; end if;
 select body into b from public.business_briefs where tenant_id=p_tenant and version=p_version;
 days:=(b->>'maxAgeDays')::integer;observed:=(b->'source'->>'observedAt')::timestamptz;
 return coalesce(days between 1 and 365 and observed<=p_now and observed>=p_now-days*interval '1 day',false);
 exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then return false;
end $$;
revoke all on function public.campaign_brief_current(uuid,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.campaign_brief_current(uuid,integer,timestamptz) to service_role;
-- Versioned plain-text message plans on the existing campaign/action ledger.
create table public.campaign_assets (
 tenant_id uuid not null,
 campaign_id uuid not null,
 version integer not null check(version>0),
 brief_version integer,
 steps jsonb not null check(public.campaign_steps_valid(steps)),
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 approved_by uuid references public.profiles(id),
 approved_at timestamptz,
 primary key(tenant_id,campaign_id,version),
 foreign key(tenant_id,campaign_id) references public.campaigns(tenant_id,id),
 foreign key(tenant_id,brief_version) references public.business_briefs(tenant_id,version)
);
alter table public.campaign_assets enable row level security;
revoke all on public.campaign_assets from public,anon,authenticated,service_role;
grant select on public.campaign_assets to authenticated;
create policy admin_read on public.campaign_assets for select to authenticated using(public.is_admin());
grant select,insert,update(approved_by,approved_at) on public.campaign_assets to service_role;
alter table public.outbound_actions add column message_step integer not null default 0 check(message_step between 0 and 2);

create function public.manage_campaign_plan(p_tenant uuid,p_campaign uuid,p_actor uuid,p_operation text,p_version integer,p_body jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.campaigns%rowtype; asset public.campaign_assets%rowtype; step jsonb; prior integer:=-1; offset_hours integer;
 current_brief integer; n integer; lead uuid; start_time timestamptz; ids jsonb; action_id uuid;
begin
 if current_user<>'service_role' or not exists(select 1 from public.profiles where id=p_actor and is_admin) then raise exception 'Staff required' using errcode='42501'; end if;
 perform 1 from public.tenants where id=p_tenant for update;
 if not found then raise exception 'Tenant missing' using errcode='23503'; end if;
 select * into c from public.campaigns where tenant_id=p_tenant and id=p_campaign for update;
 select max(version) into current_brief from public.business_briefs where tenant_id=p_tenant;
 if p_operation='save' then
  if p_body is null or jsonb_typeof(p_body->'steps') is distinct from 'array' then raise exception 'Steps required' using errcode='22023'; end if;
  n:=jsonb_array_length(p_body->'steps');
  if n not between 1 and 3 then raise exception 'One to three steps required' using errcode='22023'; end if;
  for step in select value from jsonb_array_elements(p_body->'steps') loop
   if coalesce(step->>'offsetHours','') !~ '^[0-9]{1,3}$' then raise exception 'Invalid delay' using errcode='22023'; end if;
   offset_hours:=(step->>'offsetHours')::integer;
   if offset_hours>720 or (prior=-1 and offset_hours<>0) or (prior>=0 and offset_hours-prior<24)
    or coalesce(length(trim(step->>'subject')),0) not between 1 and 160
    or coalesce(length(trim(step->>'body')),0) not between 1 and 4000
    or coalesce(length(trim(step->>'evidenceReference')),0) not between 1 and 240
    or (step->>'subject') ~ E'[\r\n]' then raise exception 'Invalid message, evidence or spacing' using errcode='22023'; end if;
   prior:=offset_hours;
  end loop;
  if c.id is null then
   if p_version is distinct from 0 or coalesce(p_body->>'product','') not in ('revive','signal','response','events')
    or coalesce(length(trim(p_body->>'purpose')),0) not between 1 and 160 or coalesce(p_body->>'market','') !~ '^[A-Z]{2}$'
    or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_body->>'timezone') then raise exception 'Invalid campaign scope' using errcode='22023'; end if;
   insert into public.campaigns(id,tenant_id,capability,operator_id,purpose,channel,market,timezone)
    values(p_campaign,p_tenant,p_body->>'product',p_actor,p_body->>'purpose','email',p_body->>'market',p_body->>'timezone') returning * into c;
  else
   if c.capability is distinct from p_body->>'product' or c.purpose is distinct from p_body->>'purpose' or c.market is distinct from p_body->>'market' or c.timezone is distinct from p_body->>'timezone' then raise exception 'Campaign scope is fixed; create a different campaign' using errcode='22023'; end if;
   select * into asset from public.campaign_assets where tenant_id=p_tenant and campaign_id=c.id and version=c.asset_version;
   if asset.steps=p_body->'steps' and asset.brief_version is not distinct from current_brief then return jsonb_build_object('id',c.id,'version',c.asset_version,'status',c.status); end if;
   if p_version is distinct from c.asset_version or c.status='ended' then raise exception 'Reload campaign before editing' using errcode='40001'; end if;
   update public.campaigns set status='draft',asset_version=asset_version+1,approval_version=approval_version+1 where id=c.id returning * into c;
   update public.outbound_actions set state=case when state='claimed' then 'review' else 'cancelled' end,error_code='message_version_changed',lease_until=null where campaign_id=c.id and state in ('queued','claimed');
  end if;
  insert into public.campaign_assets(tenant_id,campaign_id,version,brief_version,steps,created_by) values(p_tenant,c.id,c.asset_version,current_brief,p_body->'steps',p_actor);
  return jsonb_build_object('id',c.id,'version',c.asset_version,'status','draft');
 end if;
 if c.id is null then raise exception 'Campaign scope mismatch' using errcode='23503'; end if;
 if p_version is distinct from c.asset_version then raise exception 'Campaign changed' using errcode='40001'; end if;
 select * into asset from public.campaign_assets where tenant_id=p_tenant and campaign_id=c.id and version=c.asset_version;
 if p_operation='pause' then
  update public.campaigns set status='paused' where id=c.id;
  update public.outbound_actions set state=case when state='claimed' then 'review' else 'cancelled' end,error_code='campaign_paused',lease_until=null where campaign_id=c.id and state in ('queued','claimed');
  return jsonb_build_object('id',c.id,'status','paused');
 end if;
 if p_operation='approve' then
  if not public.campaign_brief_current(p_tenant,current_brief,now()) or c.status not in ('draft','approved') or asset.version is null or current_brief is null or asset.brief_version is distinct from current_brief
   or coalesce(length(trim(p_body->>'clientAuthority')),0) not between 1 and 240
   or coalesce(length(trim(p_body->>'ownerAuthority')),0) not between 1 and 240
   or coalesce(length(trim(p_body->>'ctsProfile')),0) not between 1 and 240
   or coalesce(p_body->>'maxActions','') !~ '^[0-9]{1,3}$'
   or (p_body->>'maxActions')::integer not between 1 and 100
   or (p_body->>'expiresAt') is null or (p_body->>'expiresAt')::timestamptz<=now()
   or (p_body->>'expiresAt')::timestamptz>now()+interval '30 days' then raise exception 'Current brief and bounded authority required' using errcode='22023'; end if;
  -- A different authority snapshot invalidates every previously queued action.
  if c.status='approved' then
   if c.client_authority_ref=p_body->>'clientAuthority' and c.owner_authority_ref=p_body->>'ownerAuthority'
    and c.cts_profile_ref=p_body->>'ctsProfile' and c.max_actions=(p_body->>'maxActions')::integer and c.expires_at=(p_body->>'expiresAt')::timestamptz then
    return jsonb_build_object('id',c.id,'status','approved','version',c.asset_version);
   end if;
   raise exception 'Edit a new version before changing approval scope' using errcode='40001';
  end if;
  update public.campaign_assets set approved_by=p_actor,approved_at=now() where tenant_id=p_tenant and campaign_id=c.id and version=c.asset_version;
  update public.campaigns set status='approved',client_authority_ref=p_body->>'clientAuthority',owner_authority_ref=p_body->>'ownerAuthority',cts_profile_ref=p_body->>'ctsProfile',max_actions=(p_body->>'maxActions')::integer,expires_at=(p_body->>'expiresAt')::timestamptz where id=c.id;
  return jsonb_build_object('id',c.id,'status','approved','version',c.asset_version);
 end if;
 if p_operation='rights' then
  lead:=(p_body->>'leadId')::uuid;
  if c.status<>'approved' or c.expires_at<=now() or coalesce(length(trim(p_body->>'noticeReference')),0) not between 1 and 240
   or not exists(select 1 from public.leads where id=lead and tenant_id=p_tenant and lower(email) like '%.invalid' and status<>'unsubscribed')
   or not exists(select 1 from public.lead_observations where id=(p_body->>'sourceId')::uuid and tenant_id=p_tenant and lead_id=lead and synthetic and assessment_reviewed_by is not null and coalesce(length(trim(rights_reference)),0)>0)
   or exists(select 1 from public.lead_suppression where tenant_id=p_tenant and lead_id=lead)
   or exists(select 1 from public.suppression where email=(select lower(email) from public.leads where id=lead))
   or exists(select 1 from public.contact_rights where tenant_id=p_tenant and lead_id=lead and purpose=c.purpose and channel=c.channel and market=c.market and (decision='denied' or objected_at is not null or withdrawn_at is not null)) then raise exception 'Eligible synthetic source required; stops cannot be overridden' using errcode='22023'; end if;
  insert into public.contact_rights(tenant_id,lead_id,source_id,purpose,channel,market,decision,reviewer_id,notice_reference,expires_at)
   values(p_tenant,lead,(p_body->>'sourceId')::uuid,c.purpose,c.channel,c.market,'permitted',p_actor,'synthetic:'||(p_body->>'noticeReference'),c.expires_at)
   on conflict(tenant_id,lead_id,purpose,channel,market) do update set source_id=excluded.source_id,reviewer_id=excluded.reviewer_id,notice_reference=excluded.notice_reference,expires_at=excluded.expires_at,decision='permitted',version=public.contact_rights.version+1,updated_at=now();
  return jsonb_build_object('id',c.id,'status','synthetic_rights_recorded');
 end if;
 if p_operation='queue' then
  lead:=(p_body->>'leadId')::uuid;
  if not exists(select 1 from public.leads where id=lead and tenant_id=p_tenant and lower(email) like '%.invalid') then raise exception 'Synthetic same-tenant lead required' using errcode='22023'; end if;
  if c.status<>'approved' or asset.approved_by is null or asset.brief_version is distinct from current_brief then raise exception 'Approved current plan required' using errcode='22023'; end if;
  select jsonb_agg(id order by message_step) into ids from public.outbound_actions where campaign_id=c.id and lead_id=lead;
  if ids is not null then
   if (p_body->>'startAt')::timestamptz is distinct from (select min(due_at) from public.outbound_actions where campaign_id=c.id and lead_id=lead) then raise exception 'An enrolment schedule cannot be replaced by retry' using errcode='40001'; end if;
   if exists(select 1 from public.outbound_actions where campaign_id=c.id and lead_id=lead and asset_version<>c.asset_version) then raise exception 'Existing enrolment cannot restart' using errcode='40001'; end if;
   return jsonb_build_object('actionIds',ids,'replayed',true);
  end if;
  start_time:=(p_body->>'startAt')::timestamptz;n:=jsonb_array_length(asset.steps);
  if start_time is null or start_time<now() or start_time>now()+interval '7 days'
   or start_time+((asset.steps->(n-1)->>'offsetHours')::integer)*interval '1 hour'>=c.expires_at
   or (select count(*) from public.outbound_actions where campaign_id=c.id)+n>c.max_actions
   or (select count(*) from public.outbound_actions where tenant_id=p_tenant and lead_id=lead and due_at>=now()-interval '30 days' and state in ('queued','claimed','tested','delivered','review'))+n>3 then raise exception 'Schedule or contact cap exceeded' using errcode='22023'; end if;
  ids:='[]';
  for i in 0..n-1 loop
   insert into public.outbound_actions(tenant_id,campaign_id,lead_id,correlation_key,approval_version,asset_version,due_at,message_step)
    values(p_tenant,c.id,lead,'plan:'||c.id||':'||lead||':'||i,c.approval_version,c.asset_version,start_time+((asset.steps->i->>'offsetHours')::integer)*interval '1 hour',i) returning id into action_id;
   if i=0 and not public.synthetic_action_allowed(action_id,now()) then raise exception 'Rights, stop or current authority prevents enrolment' using errcode='22023'; end if;
   ids:=ids||jsonb_build_array(action_id);
  end loop;
  return jsonb_build_object('actionIds',ids,'replayed',false);
 end if;
 raise exception 'Unsupported campaign operation' using errcode='22023';
end $$;
revoke all on function public.manage_campaign_plan(uuid,uuid,uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.manage_campaign_plan(uuid,uuid,uuid,text,integer,jsonb) to service_role;

create or replace function public.synthetic_action_allowed(p_id uuid, p_now timestamptz) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.outbound_actions a
    join public.campaigns c on c.id=a.campaign_id and c.tenant_id=a.tenant_id
    join public.campaign_assets v on v.tenant_id=a.tenant_id and v.campaign_id=a.campaign_id and v.version=a.asset_version
    join public.leads l on l.id=a.lead_id and l.tenant_id=a.tenant_id
    join public.tenants t on t.id=a.tenant_id
    where not exists(select 1 from public.outbound_actions earlier where earlier.campaign_id=a.campaign_id and earlier.lead_id=a.lead_id and earlier.message_step<a.message_step and earlier.state<>'tested')
      and v.approved_by is not null and a.message_step<jsonb_array_length(v.steps)
      and (v.brief_version is null or public.campaign_brief_current(a.tenant_id,v.brief_version,p_now))
      and a.id=p_id and p_now is not null and t.status='active' and c.status='approved'
      and c.expires_at>p_now and (c.starts_at is null or c.starts_at<=p_now)
      and (c.ends_at is null or c.ends_at>p_now)
      and a.approval_version=c.approval_version and a.asset_version=c.asset_version
      and lower(l.email) like '%.invalid' and l.status<>'unsubscribed'
      and not exists (select 1 from public.outbound_stops s where s.lifted_at is null and
        (s.scope='global' or (s.tenant_id=a.tenant_id and (s.scope='tenant' or s.campaign_id=a.campaign_id))))
      and not exists (select 1 from public.lead_observations o where o.tenant_id=a.tenant_id and o.lead_id=a.lead_id
        and o.product_context->>'product'='response' and o.product_context->>'kind' in ('enquiry','reply'))
      and not exists (select 1 from public.suppression s where s.email=lower(l.email))
      and not exists (select 1 from public.lead_suppression s where s.tenant_id=a.tenant_id and s.lead_id=a.lead_id)
      and exists (select 1 from public.contact_rights r where r.tenant_id=a.tenant_id and r.lead_id=a.lead_id
        and r.purpose=c.purpose and r.channel=c.channel and r.market=c.market and r.decision='permitted'
        and r.reviewer_id is not null and r.notice_reference is not null and r.objected_at is null
        and r.withdrawn_at is null and (r.expires_at is null or r.expires_at>p_now))
  )
$$;
revoke all on function public.synthetic_action_allowed(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.synthetic_action_allowed(uuid,timestamptz) to service_role;



-- Match plan edit/pause lock ordering: tenant, campaign, then action.
create or replace function public.claim_synthetic_action(p_id uuid, p_now timestamptz) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare a public.outbound_actions%rowtype; c public.campaigns%rowtype;
begin
  if current_user <> 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  if p_now is null then return false; end if;
  select * into a from public.outbound_actions where id=p_id;
  if not found then return false; end if;
  perform 1 from public.tenants where id=a.tenant_id for update;
  perform 1 from public.campaigns where id=a.campaign_id and tenant_id=a.tenant_id for update;
  select * into a from public.outbound_actions where id=p_id for update skip locked;
  if not found or a.state <> 'queued' or a.attempts >= 3 or a.due_at > p_now then return false; end if;
  select * into c from public.campaigns where id=a.campaign_id and tenant_id=a.tenant_id for update;
  if not found or not public.synthetic_action_allowed(a.id,p_now) or
     (select count(*) from public.outbound_actions x where x.campaign_id=c.id and x.state in ('claimed','tested','delivered')) >= c.max_actions
  then
    update public.outbound_actions set state='blocked', error_code='eligibility_or_authority_changed' where id=a.id;
    return false;
  end if;
  update public.outbound_actions set state='claimed', attempts=attempts+1, lease_until=p_now+interval '2 minutes'
    where id=a.id;
  return true;
end $$;
revoke all on function public.claim_synthetic_action(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.claim_synthetic_action(uuid,timestamptz) to service_role;

-- A local test sink result. `tested` is deliberately distinct from provider delivery.
create or replace function public.complete_synthetic_action(p_id uuid, p_now timestamptz) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare a public.outbound_actions%rowtype;
begin
  if current_user <> 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  select * into a from public.outbound_actions where id=p_id;
  if not found then return false; end if;
  perform 1 from public.tenants where id=a.tenant_id for update;
  perform 1 from public.campaigns where id=a.campaign_id and tenant_id=a.tenant_id for update;
  select * into a from public.outbound_actions where id=p_id for update skip locked;
  if not found or a.state <> 'claimed' or p_now is null or a.lease_until is null or a.lease_until<=p_now then return false; end if;
  perform 1 from public.campaigns where id=a.campaign_id and tenant_id=a.tenant_id for update;
  if not public.synthetic_action_allowed(a.id,p_now) then
    update public.outbound_actions set state='blocked', error_code='eligibility_or_authority_changed', lease_until=null where id=a.id;
    return false;
  end if;
  update public.outbound_actions set state='tested', provider_ref='test-sink:' || a.id::text, lease_until=null where id=a.id;
  return true;
end $$;
revoke all on function public.complete_synthetic_action(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.complete_synthetic_action(uuid,timestamptz) to service_role;

-- Restart after an uncertain result routes to review; never blindly repeats a send.
create or replace function public.expire_synthetic_claim(p_id uuid, p_now timestamptz) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare expired boolean; a public.outbound_actions%rowtype;
begin
  if current_user <> 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  select * into a from public.outbound_actions where id=p_id;
  if not found then return false; end if;
  perform 1 from public.tenants where id=a.tenant_id for update;
  perform 1 from public.campaigns where id=a.campaign_id and tenant_id=a.tenant_id for update;
  update public.outbound_actions set state='review', error_code='uncertain_result', lease_until=null
  where id=p_id and state='claimed' and lease_until<=p_now;
  expired := found;
  if expired then
    update public.campaigns set status='paused'
      where id=(select campaign_id from public.outbound_actions where id=p_id) and status='approved';
  end if;
  return expired;
end $$;
revoke all on function public.expire_synthetic_claim(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.expire_synthetic_claim(uuid,timestamptz) to service_role;
