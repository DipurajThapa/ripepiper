-- RP-020: approval covers an explicit, immutable audience on the existing asset.
-- No backfill: legacy Revive plans need a newly reviewed version before execution.
alter table public.campaign_assets add column revive_audience jsonb;

create function public.revive_audience_shape(p_audience jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare member jsonb; identities uuid[]:='{}'; id uuid;
begin
 if p_audience is null then return false; end if;
 if jsonb_typeof(p_audience) is distinct from 'object' or jsonb_typeof(p_audience->'members') is distinct from 'array'
  or jsonb_array_length(p_audience->'members') not between 1 and 25
  or jsonb_typeof(p_audience->'reviewedBy') is distinct from 'string'
  or coalesce(p_audience->>'reviewedBy','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or jsonb_typeof(p_audience->'reviewedAt') is distinct from 'string' then return false; end if;
 perform (p_audience->>'reviewedAt')::timestamptz;
 for member in select value from jsonb_array_elements(p_audience->'members') loop
  if jsonb_typeof(member) is distinct from 'object' or jsonb_typeof(member->'leadId') is distinct from 'string'
   or coalesce(member->>'leadId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or jsonb_typeof(member->'reviewVersion') is distinct from 'number'
   or coalesce(member->>'reviewVersion','') !~ '^[1-9][0-9]{0,8}$'
   or jsonb_typeof(member->'snapshot') is distinct from 'string' or coalesce(member->>'snapshot','') !~ '^[0-9a-f]{32}$' then return false; end if;
  id:=(member->>'leadId')::uuid;
  if id=any(identities) then return false; end if;identities:=array_append(identities,id);
 end loop;
 return true;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then return false;
end $$;
revoke all on function public.revive_audience_shape(jsonb) from public,anon,authenticated;
grant execute on function public.revive_audience_shape(jsonb) to service_role;
alter table public.campaign_assets add constraint revive_audience_valid check(revive_audience is null or public.revive_audience_shape(revive_audience));

create function public.build_revive_audience(p_tenant uuid,p_actor uuid,p_input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare item jsonb; id uuid; identities uuid[]:='{}'; members jsonb:='[]'; r public.revive_reviews%rowtype;
begin
 if current_user<>'service_role' or not exists(select 1 from public.profiles p where p.id=p_actor and p.is_admin) then raise exception 'Staff required' using errcode='42501'; end if;
 if p_input is null or p_input='null'::jsonb then return null; end if;
 if jsonb_typeof(p_input) is distinct from 'object' or p_input->'confirmed' is distinct from 'true'::jsonb
  or jsonb_typeof(p_input->'leadIds') is distinct from 'array' or jsonb_array_length(p_input->'leadIds') not between 1 and 25 then
  raise exception 'Review an explicit audience of 1 to 25 contacts' using errcode='22023';
 end if;
 for item in select value from jsonb_array_elements(p_input->'leadIds') loop
  if jsonb_typeof(item) is distinct from 'string' or (item#>>'{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid audience identity' using errcode='22023'; end if;
  id:=(item#>>'{}')::uuid;
  if id=any(identities) then raise exception 'Duplicate audience contact' using errcode='22023'; end if;identities:=array_append(identities,id);
 end loop;
 for id in select unnest(identities) order by 1 loop
  if not public.revive_candidate_current(p_tenant,id,now()) then raise exception 'Audience contact requires current accepted Revive evidence' using errcode='22023'; end if;
  select * into r from public.revive_reviews where tenant_id=p_tenant and lead_id=id;
  members:=members||jsonb_build_array(jsonb_build_object('leadId',id,'reviewVersion',r.version,'snapshot',r.snapshot));
 end loop;
 return jsonb_build_object('members',members,'reviewedBy',p_actor,'reviewedAt',now());
end $$;
revoke all on function public.build_revive_audience(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.build_revive_audience(uuid,uuid,jsonb) to service_role;

create function public.revive_campaign_audience_current(p_tenant uuid,p_campaign uuid,p_version integer,p_lead uuid,p_now timestamptz) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare audience jsonb; member jsonb; id uuid; found_member boolean:=false;
begin
 select a.revive_audience into audience from public.campaign_assets a join public.campaigns c on c.tenant_id=a.tenant_id and c.id=a.campaign_id
  where a.tenant_id=p_tenant and a.campaign_id=p_campaign and a.version=p_version and c.capability='revive';
 if p_now is null or not public.revive_audience_shape(audience) or (audience->>'reviewedAt')::timestamptz>p_now
  or not exists(select 1 from public.profiles p where p.id=(audience->>'reviewedBy')::uuid and p.is_admin) then return false; end if;
 for member in select value from jsonb_array_elements(audience->'members') loop
  id:=(member->>'leadId')::uuid;
  if p_lead is not null and id<>p_lead then continue; end if;
  found_member:=true;
  if not public.revive_candidate_current(p_tenant,id,p_now) or not exists(
   select 1 from public.revive_reviews r where r.tenant_id=p_tenant and r.lead_id=id
    and r.version=(member->>'reviewVersion')::integer and r.snapshot=member->>'snapshot'
  ) then return false; end if;
 end loop;
 return found_member;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then return false;
end $$;
revoke all on function public.revive_campaign_audience_current(uuid,uuid,integer,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.revive_campaign_audience_current(uuid,uuid,integer,uuid,timestamptz) to service_role;

create function public.revive_audience_candidates(p_tenant uuid,p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if current_user<>'service_role' or not exists(select 1 from public.profiles where id=p_actor and is_admin) then raise exception 'Staff required' using errcode='42501'; end if;
 if not exists(select 1 from public.tenants where id=p_tenant) then raise exception 'Tenant missing' using errcode='23503'; end if;
 if (select count(*) from public.revive_reviews where tenant_id=p_tenant and state='accepted')>100 then raise exception 'Audience candidate capacity exceeded' using errcode='22023'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('leadId',r.lead_id,'email',l.email,'company',l.company,'reviewVersion',r.version,'snapshot',r.snapshot,'expiresAt',r.expires_at) order by r.lead_id)
  from public.revive_reviews r join public.leads l on l.tenant_id=r.tenant_id and l.id=r.lead_id
  where r.tenant_id=p_tenant and r.state='accepted' and public.revive_candidate_current(p_tenant,r.lead_id,now())),'[]'::jsonb);
end $$;
revoke all on function public.revive_audience_candidates(uuid,uuid) from public,anon,authenticated;
grant execute on function public.revive_audience_candidates(uuid,uuid) to service_role;

-- Even service application code cannot mutate an approved or prior audience in place.
create function public.guard_revive_asset_audience() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.revive_audience is distinct from old.revive_audience then raise exception 'Save a new asset version to change the reviewed audience' using errcode='23514'; end if;
 return new;
end $$;
revoke all on function public.guard_revive_asset_audience() from public,anon,authenticated;
create trigger immutable_revive_asset_audience before update of revive_audience on public.campaign_assets for each row execute function public.guard_revive_asset_audience();

-- Keep the existing campaign transaction and all its limits; bind its versioned audience.
create or replace function public.manage_campaign_plan(p_tenant uuid,p_campaign uuid,p_actor uuid,p_operation text,p_version integer,p_body jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.campaigns%rowtype; asset public.campaign_assets%rowtype; step jsonb; prior integer:=-1; offset_hours integer;
 current_brief integer; n integer; lead uuid; start_time timestamptz; ids jsonb; action_id uuid; audience jsonb; draft_context jsonb;
begin
 if current_user<>'service_role' or not exists(select 1 from public.profiles where id=p_actor and is_admin) then raise exception 'Staff required' using errcode='42501'; end if;
 perform 1 from public.tenants where id=p_tenant for update;
 if not found then raise exception 'Tenant missing' using errcode='23503'; end if;
 select * into c from public.campaigns where tenant_id=p_tenant and id=p_campaign for update;
 select max(version) into current_brief from public.business_briefs where tenant_id=p_tenant;
 if p_operation='save' then
  draft_context:=nullif(p_body->'draftContext','null'::jsonb);
  if draft_context is not null then
   if p_body->>'product' is distinct from 'revive' then raise exception 'Revive draft binding scope mismatch' using errcode='22023'; end if;
   perform public.assert_revive_draft_context(p_tenant,p_actor,draft_context);
  elsif exists(select 1 from public.campaign_assets where tenant_id=p_tenant and campaign_id=p_campaign and revive_draft_context is not null) then
   raise exception 'Generated draft binding cannot be omitted; prepare a new reviewed proposal' using errcode='22023';
  end if;
  if p_body->>'product'='revive' then audience:=public.build_revive_audience(p_tenant,p_actor,p_body->'audience'); end if;
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
   if asset.steps=p_body->'steps' and asset.brief_version is not distinct from current_brief
    and asset.revive_audience->'members' is not distinct from audience->'members'
    and asset.revive_audience->'reviewedBy' is not distinct from audience->'reviewedBy'
    and asset.revive_draft_context is not distinct from draft_context
    and not (c.capability='revive' and c.status='approved' and audience is null) then
    return jsonb_build_object('id',c.id,'version',c.asset_version,'status',c.status); end if;
   if p_version is distinct from c.asset_version or c.status='ended' then raise exception 'Reload campaign before editing' using errcode='40001'; end if;
   update public.campaigns set status='draft',asset_version=asset_version+1,approval_version=approval_version+1 where id=c.id returning * into c;
   update public.outbound_actions set state=case when state='claimed' then 'review' else 'cancelled' end,error_code='message_version_changed',lease_until=null where campaign_id=c.id and state in ('queued','claimed');
  end if;
  insert into public.campaign_assets(tenant_id,campaign_id,version,brief_version,steps,created_by,revive_audience,revive_draft_context)
   values(p_tenant,c.id,c.asset_version,current_brief,p_body->'steps',p_actor,audience,draft_context);
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
  if c.capability='revive' and not public.revive_campaign_audience_current(p_tenant,c.id,c.asset_version,null,now()) then
   raise exception 'Approval requires the exact current reviewed Revive audience' using errcode='22023'; end if;
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
  if c.capability='revive' and not public.revive_campaign_audience_current(p_tenant,c.id,c.asset_version,lead,now()) then
   raise exception 'Contact is outside the current reviewed campaign audience' using errcode='22023'; end if;
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


create or replace function public.guard_revive_enrolment() returns trigger
language plpgsql security invoker set search_path='' as $$
declare r public.revive_reviews%rowtype;
begin
 if exists(select 1 from public.campaigns where tenant_id=new.tenant_id and id=new.campaign_id and capability='revive') then
  perform 1 from public.tenants where id=new.tenant_id for update;
  if not public.revive_candidate_current(new.tenant_id,new.lead_id,now()) then raise exception 'Current accepted Revive cohort required' using errcode='22023'; end if;
  if not public.revive_campaign_audience_current(new.tenant_id,new.campaign_id,new.asset_version,new.lead_id,now()) then
   raise exception 'Contact is outside the current reviewed campaign audience' using errcode='22023'; end if;
  select * into r from public.revive_reviews where tenant_id=new.tenant_id and lead_id=new.lead_id;
  if r.expires_at<=new.due_at then raise exception 'Revive review expires before scheduled step' using errcode='22023'; end if;
  new.revive_review_version:=r.version;new.revive_review_snapshot:=r.snapshot;
 end if;
 return new;
end $$;
revoke all on function public.guard_revive_enrolment() from public,anon,authenticated;

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
      and (c.capability<>'revive' or (public.revive_campaign_audience_current(a.tenant_id,a.campaign_id,a.asset_version,a.lead_id,p_now)
        and public.revive_candidate_current(a.tenant_id,a.lead_id,p_now)
        and exists(select 1 from public.revive_reviews r where r.tenant_id=a.tenant_id and r.lead_id=a.lead_id
         and r.version=a.revive_review_version and r.snapshot=a.revive_review_snapshot)))
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



