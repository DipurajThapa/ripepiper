-- RP-020: one reviewed strategy and working-calendar policy per existing asset.
-- Nullable historical strategies are retained for audit and cannot execute.
alter table public.campaign_assets add column revive_strategy jsonb;
alter table public.outbound_actions add column schedule_requested_at timestamptz;

create function public.revive_booking_url_valid(p_url text) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare host text;
begin
 if p_url is null or length(p_url) not between 1 and 1000 or p_url !~ '^https://' or p_url ~ $re$[[:space:]\\<>"'`{}]|%(0[[:xdigit:]]|1[[:xdigit:]]|7f)$re$ then return false; end if;
 host:=lower(substring(p_url from '^https://([^/?#]+)'));
 return host is not null and host like '%.%' and host !~ '[:@]' and host !~ '^[0-9.]+$'
  and host !~ '(^|\.)(localhost|local|internal|invalid|test|example)$' and host !~ '\.\.' and host ~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$';
end $$;
revoke all on function public.revive_booking_url_valid(text) from public,anon,authenticated;
grant execute on function public.revive_booking_url_valid(text) to service_role;

create function public.revive_strategy_shape(p_strategy jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare key text; c jsonb;
begin
 if jsonb_typeof(p_strategy) is distinct from 'object' then return false; end if;
 for key in select jsonb_object_keys(p_strategy) loop
  if key not in ('setupVersion','canonicalNeed','segment','relationshipRationale','valueProposition','evidenceReference','cta','goal','confirmed') then return false; end if;
 end loop;
 if jsonb_typeof(p_strategy->'setupVersion') is distinct from 'number' or coalesce(p_strategy->>'setupVersion','') !~ '^[1-9][0-9]{0,8}$'
  or p_strategy->'confirmed' is distinct from 'true'::jsonb or coalesce(p_strategy->>'goal','') not in ('qualified_conversation','meeting_held')
  or not public.revive_draft_fragment_valid(p_strategy->>'canonicalNeed',100) or not public.revive_draft_fragment_valid(p_strategy->>'segment',160)
  or not public.revive_draft_fragment_valid(p_strategy->>'relationshipRationale',1000) or not public.revive_draft_fragment_valid(p_strategy->>'valueProposition',500)
  or not public.revive_draft_fragment_valid(p_strategy->>'evidenceReference',240) then return false; end if;
 for key in select unnest(array['canonicalNeed','segment','relationshipRationale','valueProposition','evidenceReference','goal']) loop
  if jsonb_typeof(p_strategy->key) is distinct from 'string' then return false; end if;
 end loop;
 c:=p_strategy->'cta';if jsonb_typeof(c) is distinct from 'object' then return false; end if;
 if c->>'kind'='reply' then
  for key in select jsonb_object_keys(c) loop if key not in ('kind','prompt') then return false; end if;end loop;
  return jsonb_typeof(c->'prompt')='string' and public.revive_draft_fragment_valid(c->>'prompt',240);
 elsif c->>'kind'='booking' then
  for key in select jsonb_object_keys(c) loop if key not in ('kind','url','reference','reviewed') then return false; end if;end loop;
  return c->'reviewed'='true'::jsonb and jsonb_typeof(c->'url')='string' and jsonb_typeof(c->'reference')='string'
   and public.revive_booking_url_valid(c->>'url') and public.revive_draft_fragment_valid(c->>'reference',80);
 end if;
 return false;
end $$;
revoke all on function public.revive_strategy_shape(jsonb) from public,anon,authenticated;
grant execute on function public.revive_strategy_shape(jsonb) to service_role;

create function public.revive_member_need_current(p_tenant uuid,p_lead uuid,p_brief integer,p_need text,p_now timestamptz) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.lead_observations o where o.tenant_id=p_tenant and o.lead_id=p_lead and o.assessment_facts ? 'need'
  and public.reviewed_revive_draft_need(p_tenant,p_lead,o.id,p_brief,p_now)=p_need)
$$;
revoke all on function public.revive_member_need_current(uuid,uuid,integer,text,timestamptz) from public,anon,authenticated;
grant execute on function public.revive_member_need_current(uuid,uuid,integer,text,timestamptz) to service_role;

create function public.build_revive_strategy(p_tenant uuid,p_actor uuid,p_strategy jsonb,p_audience jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare setup public.revive_setups%rowtype; brief public.business_briefs%rowtype; member jsonb; schedule jsonb;
begin
 if current_user<>'service_role' or not exists(select 1 from public.profiles p join auth.users u on u.id=p.id and u.email_confirmed_at is not null where p.id=p_actor and p.is_admin) then raise exception 'Verified staff required' using errcode='42501'; end if;
 if p_strategy is null or p_strategy='null'::jsonb then return null; end if;
 if not coalesce(public.revive_strategy_shape(p_strategy),false) or not public.revive_audience_shape(p_audience) then raise exception 'Reviewed strategy and audience required' using errcode='22023'; end if;
 select * into setup from public.revive_setups where tenant_id=p_tenant and version=(p_strategy->>'setupVersion')::integer;
 if not found or not public.revive_setup_current(p_tenant,setup.version,now()) then raise exception 'Current reviewed client setup required' using errcode='22023'; end if;
 select * into brief from public.business_briefs where tenant_id=p_tenant and version=setup.brief_version;
 if not (brief.body->'needs') @> jsonb_build_array(p_strategy->>'canonicalNeed')
  or not (p_strategy->>'evidenceReference'=brief.body->'source'->>'reference' or exists(select 1 from jsonb_array_elements(setup.body->'sourceInventory') s where s->>'reference'=p_strategy->>'evidenceReference')) then
  raise exception 'Strategy needs current brief and cited setup source' using errcode='22023'; end if;
 for member in select value from jsonb_array_elements(p_audience->'members') loop
  if not public.revive_candidate_current(p_tenant,(member->>'leadId')::uuid,now())
   or not public.revive_member_need_current(p_tenant,(member->>'leadId')::uuid,brief.version,p_strategy->>'canonicalNeed',now()) then
   raise exception 'Every audience contact must support the reviewed strategy need' using errcode='22023'; end if;
 end loop;
 schedule:=jsonb_build_object('timezone',setup.body->'timezone','workingDays',setup.body->'workingDays','startMinute',setup.body->'startMinute','endMinute',setup.body->'endMinute','dailyContactCap',setup.body->'dailyContactCap');
 return p_strategy||jsonb_build_object('ownerId',setup.body->'ownerId','schedule',schedule,'salesCapacityPerWeek',setup.body->'salesCapacityPerWeek',
  'exclusions',brief.body->'excludedIndustries','stopRules',jsonb_build_array('reply','opt_out','suppression','pause','expiry','evidence_changed','setup_changed','outside_window','daily_capacity'),
  'reviewedBy',p_actor,'reviewedAt',now());
end $$;
revoke all on function public.build_revive_strategy(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.build_revive_strategy(uuid,uuid,jsonb,jsonb) to service_role;

create function public.revive_campaign_strategy_current(p_tenant uuid,p_campaign uuid,p_version integer,p_lead uuid,p_now timestamptz) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare asset public.campaign_assets%rowtype; setup public.revive_setups%rowtype; member jsonb; strategy jsonb; input jsonb; checked boolean:=false; brief jsonb;
begin
 select * into asset from public.campaign_assets where tenant_id=p_tenant and campaign_id=p_campaign and version=p_version;
 if not found or asset.revive_strategy is null or p_now is null then return false; end if;
 strategy:=asset.revive_strategy;input:=strategy-array['ownerId','schedule','salesCapacityPerWeek','exclusions','stopRules','reviewedBy','reviewedAt'];
 if not coalesce(public.revive_strategy_shape(input),false) or not public.revive_setup_current(p_tenant,(strategy->>'setupVersion')::integer,p_now)
  or not exists(select 1 from public.profiles p join auth.users u on u.id=p.id and u.email_confirmed_at is not null where p.id=(strategy->>'reviewedBy')::uuid and p.is_admin) then return false; end if;
 select * into setup from public.revive_setups where tenant_id=p_tenant and version=(strategy->>'setupVersion')::integer;
 select body into brief from public.business_briefs where tenant_id=p_tenant and version=asset.brief_version;
 if setup.brief_version is distinct from asset.brief_version or strategy->'ownerId' is distinct from setup.body->'ownerId'
  or (select market from public.campaigns where tenant_id=p_tenant and id=p_campaign) is distinct from setup.body->>'market'
  or (select timezone from public.campaigns where tenant_id=p_tenant and id=p_campaign) is distinct from setup.body->>'timezone'
  or (strategy->'schedule') is distinct from jsonb_build_object('timezone',setup.body->'timezone','workingDays',setup.body->'workingDays','startMinute',setup.body->'startMinute','endMinute',setup.body->'endMinute','dailyContactCap',setup.body->'dailyContactCap')
  or not (brief->'needs') @> jsonb_build_array(strategy->>'canonicalNeed')
  or not (strategy->>'evidenceReference'=brief->'source'->>'reference' or exists(select 1 from jsonb_array_elements(setup.body->'sourceInventory') s where s->>'reference'=strategy->>'evidenceReference'))
  or strategy->'exclusions' is distinct from brief->'excludedIndustries' or strategy->'salesCapacityPerWeek' is distinct from setup.body->'salesCapacityPerWeek'
  or strategy->>'reviewedAt' is null or (strategy->>'reviewedAt')::timestamptz>p_now then return false; end if;
 if asset.revive_draft_context is not null and (asset.revive_draft_context->'setupVersion' is distinct from strategy->'setupVersion' or asset.revive_draft_context->>'canonicalNeed' is distinct from strategy->>'canonicalNeed') then return false; end if;
 if not public.revive_campaign_audience_current(p_tenant,p_campaign,p_version,p_lead,p_now) then return false; end if;
 for member in select value from jsonb_array_elements(asset.revive_audience->'members') loop
  if p_lead is not null and (member->>'leadId')::uuid<>p_lead then continue;end if;
  checked:=true;
  if not public.revive_member_need_current(p_tenant,(member->>'leadId')::uuid,asset.brief_version,strategy->>'canonicalNeed',p_now) then return false; end if;
 end loop;
 return checked;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then return false;
end $$;
revoke all on function public.revive_campaign_strategy_current(uuid,uuid,integer,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.revive_campaign_strategy_current(uuid,uuid,integer,uuid,timestamptz) to service_role;

create function public.guard_revive_asset_strategy() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.revive_strategy is distinct from old.revive_strategy then raise exception 'Save a new asset version to change the strategy' using errcode='23514'; end if;return new;
end $$;
revoke all on function public.guard_revive_asset_strategy() from public,anon,authenticated;
create trigger immutable_revive_asset_strategy before update of revive_strategy on public.campaign_assets for each row execute function public.guard_revive_asset_strategy();

create function public.revive_in_working_window(p_at timestamptz,p_policy jsonb) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare local_time timestamp; minute integer;
begin
 if p_at is null or p_policy is null then return false;end if;
 local_time:=p_at at time zone (p_policy->>'timezone');minute:=extract(hour from local_time)::integer*60+extract(minute from local_time)::integer;
 return coalesce((p_policy->'workingDays') @> jsonb_build_array(extract(isodow from local_time)::integer)
  and minute>=(p_policy->>'startMinute')::integer and minute<(p_policy->>'endMinute')::integer,false);
exception when invalid_parameter_value or invalid_text_representation or datetime_field_overflow then return false;
end $$;
revoke all on function public.revive_in_working_window(timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.revive_in_working_window(timestamptz,jsonb) to service_role;

-- Search actual UTC instants so skipped/folded local DST minutes are never invented.
create function public.next_revive_working_instant(p_at timestamptz,p_policy jsonb) returns timestamptz
language plpgsql stable security invoker set search_path='' as $$
declare candidate timestamptz; i integer;
begin
 if public.revive_in_working_window(p_at,p_policy) then return p_at;end if;
 candidate:=date_trunc('minute',p_at);if candidate<p_at then candidate:=candidate+interval '1 minute';end if;
 for i in 0..11520 loop
  if public.revive_in_working_window(candidate,p_policy) then return candidate;end if;
  candidate:=candidate+interval '1 minute';
 end loop;
 raise exception 'No working window within the bounded eight-day search' using errcode='22023';
end $$;
revoke all on function public.next_revive_working_instant(timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.next_revive_working_instant(timestamptz,jsonb) to service_role;

create function public.revive_daily_capacity_available(p_tenant uuid,p_lead uuid,p_at timestamptz,p_policy jsonb) returns boolean
language sql stable security invoker set search_path='' as $$
 select (select count(distinct a.lead_id) from public.outbound_actions a where a.tenant_id=p_tenant and a.lead_id<>p_lead
  and a.state in ('queued','claimed','tested','delivered','review') and (a.due_at at time zone (p_policy->>'timezone'))::date=(p_at at time zone (p_policy->>'timezone'))::date)<(p_policy->>'dailyContactCap')::integer
$$;
revoke all on function public.revive_daily_capacity_available(uuid,uuid,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.revive_daily_capacity_available(uuid,uuid,timestamptz,jsonb) to service_role;

-- Shared future-slot authority excludes only execution ordering/claim state.
-- Schedule preview and queue both require rights valid for every planned step.
create function public.revive_slot_authority_current(p_tenant uuid,p_campaign uuid,p_version integer,p_lead uuid,p_at timestamptz) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.campaigns c join public.campaign_assets a on a.tenant_id=c.tenant_id and a.campaign_id=c.id and a.version=c.asset_version
  join public.tenants t on t.id=c.tenant_id join public.leads l on l.tenant_id=t.id and l.id=p_lead
  where c.tenant_id=p_tenant and c.id=p_campaign and c.asset_version=p_version and c.capability='revive' and c.status='approved'
   and c.operator_id=(a.revive_strategy->>'ownerId')::uuid
   and t.status='active' and a.approved_by is not null and c.expires_at>p_at and (c.starts_at is null or c.starts_at<=p_at) and (c.ends_at is null or c.ends_at>p_at)
   and public.revive_campaign_strategy_current(p_tenant,p_campaign,p_version,p_lead,p_at)
   and lower(l.email) like '%.invalid' and l.status<>'unsubscribed'
   and not exists(select 1 from public.outbound_stops s where s.lifted_at is null and (s.scope='global' or s.tenant_id=p_tenant and (s.scope='tenant' or s.campaign_id=p_campaign)))
   and exists(select 1 from public.contact_rights r where r.tenant_id=p_tenant and r.lead_id=p_lead and r.purpose=c.purpose and r.channel=c.channel and r.market=c.market
    and r.decision='permitted' and r.reviewer_id is not null and r.notice_reference is not null and r.objected_at is null and r.withdrawn_at is null and (r.expires_at is null or r.expires_at>p_at)))
$$;
revoke all on function public.revive_slot_authority_current(uuid,uuid,integer,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.revive_slot_authority_current(uuid,uuid,integer,uuid,timestamptz) to service_role;

create function public.preview_revive_schedule(p_tenant uuid,p_campaign uuid,p_actor uuid,p_version integer,p_lead uuid,p_start timestamptz) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.campaigns%rowtype; a public.campaign_assets%rowtype; policy jsonb; due timestamptz; first_due timestamptz; prior_due timestamptz; target timestamptz; steps jsonb:='[]'; local_time timestamp; i integer;
begin
 if current_user<>'service_role' or not exists(select 1 from public.profiles p where p.id=p_actor and p.is_admin) then raise exception 'Staff required' using errcode='42501'; end if;
 select * into c from public.campaigns where tenant_id=p_tenant and id=p_campaign;
 if not found then raise exception 'Campaign missing' using errcode='23503';end if;
 if c.asset_version is distinct from p_version then raise exception 'Campaign changed' using errcode='40001';end if;
 select * into a from public.campaign_assets where tenant_id=p_tenant and campaign_id=p_campaign and version=p_version;
 if c.status not in ('draft','approved') or p_start is null or p_start<now() or p_start>now()+interval '7 days' or not public.revive_campaign_strategy_current(p_tenant,p_campaign,p_version,p_lead,now()) then
  raise exception 'Current reviewed strategy and start within seven days required' using errcode='22023';end if;
 policy:=a.revive_strategy->'schedule';
 for i in 0..jsonb_array_length(a.steps)-1 loop
  target:=case when i=0 then p_start else greatest(first_due+((a.steps->i->>'offsetHours')::integer)*interval '1 hour',prior_due+interval '24 hours') end;
  due:=public.next_revive_working_instant(target,policy);if i=0 then first_due:=due;end if;
  if due-first_due>interval '720 hours' or not public.revive_campaign_strategy_current(p_tenant,p_campaign,p_version,p_lead,due)
   or (c.status='approved' and not public.revive_slot_authority_current(p_tenant,p_campaign,p_version,p_lead,due)) then
   raise exception 'A planned step exceeds the actual 30-day span or current approval, evidence or rights expiry' using errcode='22023';end if;
  if not public.revive_daily_capacity_available(p_tenant,p_lead,due,policy) then raise exception 'Daily contact capacity exceeded; choose another start date' using errcode='22023';end if;
  local_time:=due at time zone (policy->>'timezone');
  steps:=steps||jsonb_build_array(jsonb_build_object('step',i,'dueAt',due,'localDate',local_time::date,'localTime',to_char(local_time,'HH24:MI:SS')));prior_due:=due;
 end loop;
 return jsonb_build_object('campaignId',p_campaign,'assetVersion',p_version,'leadId',p_lead,'setupVersion',a.revive_strategy->'setupVersion','timezone',policy->'timezone','requestedStartAt',p_start,'steps',steps,'approvalStatus',c.status,'authorityStatus',case when c.status='approved' then 'current' else 'not_approved' end,'delivery','not_sent');
end $$;
revoke all on function public.preview_revive_schedule(uuid,uuid,uuid,integer,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.preview_revive_schedule(uuid,uuid,uuid,integer,uuid,timestamptz) to service_role;

create function public.revive_action_readiness(p_tenant uuid,p_id uuid,p_now timestamptz) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare a public.outbound_actions%rowtype; strategy jsonb; policy jsonb; disposition text:='ready'; reason text:='working_window'; local_date date; due_date date;
begin
 if current_user<>'service_role' then raise exception 'Service required' using errcode='42501';end if;
 select * into a from public.outbound_actions where tenant_id=p_tenant and id=p_id;
 if not found then return null;end if;
 select revive_strategy into strategy from public.campaign_assets where tenant_id=p_tenant and campaign_id=a.campaign_id and version=a.asset_version;
 policy:=strategy->'schedule';
 if p_now is null or not public.revive_campaign_strategy_current(p_tenant,a.campaign_id,a.asset_version,a.lead_id,p_now)
  or not public.revive_slot_authority_current(p_tenant,a.campaign_id,a.asset_version,a.lead_id,p_now) then disposition:='expired';reason:='strategy_changed';
 else
  local_date:=(p_now at time zone (policy->>'timezone'))::date;due_date:=(a.due_at at time zone (policy->>'timezone'))::date;
  if local_date>due_date then disposition:='expired';reason:='missed_local_day';
  elsif p_now<a.due_at or local_date<due_date then disposition:='wait';reason:='not_due';
  elsif not public.revive_in_working_window(p_now,policy) then disposition:='wait';reason:='outside_working_window';
  elsif not public.revive_daily_capacity_available(p_tenant,a.lead_id,p_now,policy) then disposition:='expired';reason:='daily_capacity';end if;
 end if;
 return jsonb_build_object('tenantId',p_tenant,'actionId',p_id,'campaignId',a.campaign_id,'assetVersion',a.asset_version,'disposition',disposition,'reason',reason);
end $$;
revoke all on function public.revive_action_readiness(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.revive_action_readiness(uuid,uuid,timestamptz) to service_role;

-- Extend the existing campaign transaction, preserving every prior control.
create or replace function public.manage_campaign_plan(p_tenant uuid,p_campaign uuid,p_actor uuid,p_operation text,p_version integer,p_body jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.campaigns%rowtype; asset public.campaign_assets%rowtype; step jsonb; prior integer:=-1; offset_hours integer;
 current_brief integer; n integer; lead uuid; start_time timestamptz; ids jsonb; action_id uuid; audience jsonb; draft_context jsonb; strategy jsonb; schedule jsonb;
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
  if p_body->>'product'='revive' then
   audience:=public.build_revive_audience(p_tenant,p_actor,p_body->'audience');
   strategy:=public.build_revive_strategy(p_tenant,p_actor,p_body->'strategy',audience);
   if strategy is not null and (p_body->>'timezone' is distinct from strategy->'schedule'->>'timezone'
    or p_body->>'market' is distinct from (select body->>'market' from public.revive_setups where tenant_id=p_tenant and version=(strategy->>'setupVersion')::integer)) then raise exception 'Campaign market and timezone must match the reviewed setup' using errcode='22023';end if;
   if strategy is not null and draft_context is not null and (draft_context->'setupVersion' is distinct from strategy->'setupVersion' or draft_context->>'canonicalNeed' is distinct from strategy->>'canonicalNeed') then
    raise exception 'Regenerate the proposal for this exact setup and strategy need' using errcode='22023';end if;
  end if;
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
    and asset.revive_strategy-'reviewedAt' is not distinct from strategy-'reviewedAt'
    and not (c.capability='revive' and c.status='approved' and (audience is null or strategy is null)) then
    return jsonb_build_object('id',c.id,'version',c.asset_version,'status',c.status); end if;
   if p_version is distinct from c.asset_version or c.status='ended' then raise exception 'Reload campaign before editing' using errcode='40001'; end if;
   update public.campaigns set status='draft',asset_version=asset_version+1,approval_version=approval_version+1 where id=c.id returning * into c;
   update public.outbound_actions set state=case when state='claimed' then 'review' else 'cancelled' end,error_code='message_version_changed',lease_until=null where campaign_id=c.id and state in ('queued','claimed');
  end if;
  insert into public.campaign_assets(tenant_id,campaign_id,version,brief_version,steps,created_by,revive_audience,revive_draft_context,revive_strategy)
   values(p_tenant,c.id,c.asset_version,current_brief,p_body->'steps',p_actor,audience,draft_context,strategy);
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
  if c.capability='revive' and not public.revive_campaign_strategy_current(p_tenant,c.id,c.asset_version,null,now()) then raise exception 'Approval requires the current reviewed setup and strategy' using errcode='22023';end if;
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
  update public.campaigns set status='approved',operator_id=case when c.capability='revive' then (asset.revive_strategy->>'ownerId')::uuid else operator_id end,client_authority_ref=p_body->>'clientAuthority',owner_authority_ref=p_body->>'ownerAuthority',cts_profile_ref=p_body->>'ctsProfile',max_actions=(p_body->>'maxActions')::integer,expires_at=(p_body->>'expiresAt')::timestamptz where id=c.id;
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
  if c.capability='revive' and not public.revive_campaign_strategy_current(p_tenant,c.id,c.asset_version,lead,now()) then raise exception 'Current reviewed setup and strategy required for enrolment' using errcode='22023';end if;
  select jsonb_agg(id order by message_step) into ids from public.outbound_actions where campaign_id=c.id and lead_id=lead;
  if ids is not null then
   if (p_body->>'startAt')::timestamptz is distinct from (select coalesce(min(schedule_requested_at),min(due_at)) from public.outbound_actions where campaign_id=c.id and lead_id=lead) then raise exception 'An enrolment schedule cannot be replaced by retry' using errcode='40001'; end if;
   if exists(select 1 from public.outbound_actions where campaign_id=c.id and lead_id=lead and asset_version<>c.asset_version) then raise exception 'Existing enrolment cannot restart' using errcode='40001'; end if;
   return jsonb_build_object('actionIds',ids,'replayed',true);
  end if;
  start_time:=(p_body->>'startAt')::timestamptz;n:=jsonb_array_length(asset.steps);
  if start_time is null or start_time<now() or start_time>now()+interval '7 days'
   or start_time+((asset.steps->(n-1)->>'offsetHours')::integer)*interval '1 hour'>=c.expires_at
   or (select count(*) from public.outbound_actions where campaign_id=c.id)+n>c.max_actions
   or (select count(*) from public.outbound_actions where tenant_id=p_tenant and lead_id=lead and due_at>=now()-interval '30 days' and state in ('queued','claimed','tested','delivered','review'))+n>3 then raise exception 'Schedule or contact cap exceeded' using errcode='22023'; end if;
  if c.capability='revive' then schedule:=public.preview_revive_schedule(p_tenant,c.id,p_actor,c.asset_version,lead,start_time);end if;
  ids:='[]';
  for i in 0..n-1 loop
   insert into public.outbound_actions(tenant_id,campaign_id,lead_id,correlation_key,approval_version,asset_version,due_at,message_step,schedule_requested_at)
    values(p_tenant,c.id,lead,'plan:'||c.id||':'||lead||':'||i,c.approval_version,c.asset_version,case when c.capability='revive' then (schedule->'steps'->i->>'dueAt')::timestamptz else start_time+((asset.steps->i->>'offsetHours')::integer)*interval '1 hour' end,i,start_time) returning id into action_id;
   if i=0 and not public.synthetic_action_allowed(action_id,case when c.capability='revive' then (schedule->'steps'->0->>'dueAt')::timestamptz else now() end) then raise exception 'Rights, stop or current authority prevents enrolment' using errcode='22023'; end if;
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
  if not public.revive_slot_authority_current(new.tenant_id,new.campaign_id,new.asset_version,new.lead_id,new.due_at) then raise exception 'Scheduled Revive authority expired or missing' using errcode='22023';end if;
  if not public.revive_in_working_window(new.due_at,(select revive_strategy->'schedule' from public.campaign_assets where tenant_id=new.tenant_id and campaign_id=new.campaign_id and version=new.asset_version)) then raise exception 'Scheduled step is outside the working window' using errcode='22023';end if;
  if not public.revive_daily_capacity_available(new.tenant_id,new.lead_id,new.due_at,(select revive_strategy->'schedule' from public.campaign_assets where tenant_id=new.tenant_id and campaign_id=new.campaign_id and version=new.asset_version)) then raise exception 'Daily contact capacity exceeded' using errcode='22023';end if;
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
      and (c.capability<>'revive' or ((public.revive_action_readiness(a.tenant_id,a.id,p_now)->>'disposition')='ready'
        and public.revive_campaign_audience_current(a.tenant_id,a.campaign_id,a.asset_version,a.lead_id,p_now)
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
  -- A temporary closed window never consumes a claim or cancels future work.
  if c.capability='revive' and (public.revive_action_readiness(a.tenant_id,a.id,p_now)->>'disposition')='wait' then return false;end if;
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

