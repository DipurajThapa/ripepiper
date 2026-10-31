-- Resume paused/edited campaigns, keep a cron margin in the working window,
-- let no-shows rebook, expose reviewed outcome counts to members, and add
-- WhatsApp consent columns. Every replaced function keeps its existing grants.

-- Pause/edit then re-approve resumes contacts whose earlier version was only
-- cancelled by that pause or edit. Replays and capacity count the current version.
create or replace function public.manage_campaign_plan(p_tenant uuid,p_campaign uuid,p_actor uuid,p_operation text,p_version integer,p_body jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.campaigns%rowtype; asset public.campaign_assets%rowtype; step jsonb; prior integer:=-1; offset_hours integer;
 current_brief integer; n integer; lead uuid; start_time timestamptz; ids jsonb; action_id uuid; audience jsonb; draft_context jsonb; strategy jsonb; schedule jsonb; signal_strategy jsonb;
begin
 if current_user<>'service_role' or not exists(select 1 from public.profiles where id=p_actor and is_admin) then raise exception 'Staff required' using errcode='42501'; end if;
 perform 1 from public.tenants where id=p_tenant for update;
 if not found then raise exception 'Tenant missing' using errcode='23503'; end if;
 select * into c from public.campaigns where tenant_id=p_tenant and id=p_campaign for update;
 select max(version) into current_brief from public.business_briefs where tenant_id=p_tenant;
 if p_operation='save' then
  if p_body ? 'signalStrategy' then
   if p_body->>'product' is distinct from 'signal' then raise exception 'Signal scope mismatch' using errcode='22023';end if;
   signal_strategy:=public.build_signal_strategy(p_tenant,p_actor,p_body->'signalStrategy',p_body->'steps');
   if p_body->>'market' is distinct from signal_strategy->'sourceSnapshot'->'setup'->'setup'->'body'->>'market' or p_body->>'timezone' is distinct from signal_strategy->'sourceSnapshot'->'setup'->'setup'->'body'->>'timezone' then raise exception 'Use reviewed setup market and timezone' using errcode='22023';end if;
  elsif exists(select 1 from public.campaign_assets ca where ca.tenant_id=p_tenant and ca.campaign_id=p_campaign and ca.signal_strategy is not null) then raise exception 'Signal binding cannot be removed' using errcode='22023';end if;
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
   if c.capability='signal' and (p_version is distinct from c.asset_version or c.status='ended') then raise exception 'Reload campaign before editing' using errcode='40001'; end if;
   if asset.signal_strategy is not distinct from signal_strategy and asset.steps=p_body->'steps' and asset.brief_version is not distinct from current_brief
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
  insert into public.campaign_assets(tenant_id,campaign_id,version,brief_version,steps,created_by,revive_audience,revive_draft_context,revive_strategy,signal_strategy)
   values(p_tenant,c.id,c.asset_version,current_brief,p_body->'steps',p_actor,audience,draft_context,strategy,signal_strategy);
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
 if c.capability='signal' and p_operation in ('approve','queue','rights') and not public.signal_campaign_strategy_current(p_tenant,c.id,c.asset_version,case when p_operation='approve' then null else (p_body->>'leadId')::uuid end,now()) then raise exception 'Current exact Signal binding required' using errcode='22023';end if;
 if p_operation='approve' then
  if c.capability='signal' and (p_body->'signalReview'->>'digest' is distinct from asset.signal_strategy->>'digest' or p_body->'signalReview'->'messageReviewed' is distinct from 'true'::jsonb or p_body->'signalReview'->'evidenceReviewed' is distinct from 'true'::jsonb or (p_body->>'expiresAt')::timestamptz>(asset.signal_strategy->'proposal'->>'validUntil')::timestamptz) then raise exception 'Review exact Signal message and evidence digest' using errcode='22023';end if;
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
  update public.campaign_assets set approved_by=p_actor,approved_at=now(),signal_review=case when c.capability='signal' then jsonb_build_object('digest',asset.signal_strategy->>'digest','reviewedBy',p_actor,'messageReviewed',true,'evidenceReviewed',true,'reviewedAt',now()) else null end where tenant_id=p_tenant and campaign_id=c.id and version=c.asset_version;
  update public.campaigns set status='approved',operator_id=case when c.capability='revive' then (asset.revive_strategy->>'ownerId')::uuid else operator_id end,client_authority_ref=p_body->>'clientAuthority',owner_authority_ref=p_body->>'ownerAuthority',cts_profile_ref=p_body->>'ctsProfile',max_actions=(p_body->>'maxActions')::integer,expires_at=(p_body->>'expiresAt')::timestamptz where id=c.id;
  return jsonb_build_object('id',c.id,'status','approved','version',c.asset_version);
 end if;
 if p_operation='rights' then
  lead:=(p_body->>'leadId')::uuid;
  if c.capability='signal' and not exists(select 1 from jsonb_array_elements(asset.signal_strategy->'proposal'->'evidence') e where e->>'id'=p_body->>'sourceId') then raise exception 'Use a bound evidence source' using errcode='22023';end if;
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
  select jsonb_agg(id order by message_step) into ids from public.outbound_actions where campaign_id=c.id and lead_id=lead and asset_version=c.asset_version;
  if ids is not null then
   if (p_body->>'startAt')::timestamptz is distinct from (select coalesce(min(schedule_requested_at),min(due_at)) from public.outbound_actions where campaign_id=c.id and lead_id=lead and asset_version=c.asset_version) then raise exception 'An enrolment schedule cannot be replaced by retry' using errcode='40001'; end if;
   return jsonb_build_object('actionIds',ids,'replayed',true);
  end if;
  -- Only work stopped by pause or a message edit resumes; any other history never restarts.
  if exists(select 1 from public.outbound_actions where campaign_id=c.id and lead_id=lead and asset_version<>c.asset_version and not(state='cancelled' and error_code in('campaign_paused','message_version_changed'))) then raise exception 'Existing enrolment cannot restart' using errcode='40001'; end if;
  start_time:=(p_body->>'startAt')::timestamptz;
  if c.capability='signal' and not public.signal_campaign_strategy_current(p_tenant,c.id,c.asset_version,lead,start_time) then raise exception 'Signal expires before scheduled execution' using errcode='22023';end if;
  n:=jsonb_array_length(asset.steps);
  if start_time is null or start_time<now() or start_time>now()+interval '7 days'
   or start_time+((asset.steps->(n-1)->>'offsetHours')::integer)*interval '1 hour'>=c.expires_at
   or (select count(*) from public.outbound_actions where campaign_id=c.id and state<>'cancelled')+n>c.max_actions
   or (select count(*) from public.outbound_actions where tenant_id=p_tenant and lead_id=lead and due_at>=now()-interval '30 days' and state in ('queued','claimed','tested','delivered','review'))+n>3 then raise exception 'Schedule or contact cap exceeded' using errcode='22023'; end if;
  if c.capability='revive' then schedule:=public.preview_revive_schedule(p_tenant,c.id,p_actor,c.asset_version,lead,start_time);end if;
  ids:='[]';
  for i in 0..n-1 loop
   insert into public.outbound_actions(tenant_id,campaign_id,lead_id,correlation_key,approval_version,asset_version,due_at,message_step,schedule_requested_at)
    values(p_tenant,c.id,lead,'plan:'||c.id||':v'||c.asset_version||':'||lead||':'||i,c.approval_version,c.asset_version,case when c.capability='revive' then (schedule->'steps'->i->>'dueAt')::timestamptz else start_time+((asset.steps->i->>'offsetHours')::integer)*interval '1 hour' end,i,start_time) returning id into action_id;
   if i=0 and not public.synthetic_action_allowed(action_id,case when c.capability='revive' then (schedule->'steps'->0->>'dueAt')::timestamptz else now() end) then raise exception 'Rights, stop or current authority prevents enrolment' using errcode='22023'; end if;
   ids:=ids||jsonb_build_array(action_id);
  end loop;
  return jsonb_build_object('actionIds',ids,'replayed',false);
 end if;
 raise exception 'Unsupported campaign operation' using errcode='22023';
end $$;

-- Earlier steps are those of the same message version.
create or replace function ripepiper_private.synthetic_action_allowed(p_id uuid, p_now timestamptz) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.outbound_actions a
    join public.campaigns c on c.id=a.campaign_id and c.tenant_id=a.tenant_id
    join public.campaign_assets v on v.tenant_id=a.tenant_id and v.campaign_id=a.campaign_id and v.version=a.asset_version
    join public.leads l on l.id=a.lead_id and l.tenant_id=a.tenant_id
    join public.tenants t on t.id=a.tenant_id
    where not exists(select 1 from public.outbound_actions earlier where earlier.campaign_id=a.campaign_id and earlier.lead_id=a.lead_id and earlier.asset_version=a.asset_version and earlier.message_step<a.message_step and earlier.state<>'tested')
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

create or replace function public.preview_revive_schedule(p_tenant uuid,p_campaign uuid,p_actor uuid,p_version integer,p_lead uuid,p_start timestamptz) returns jsonb
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
  due:=public.next_revive_working_instant(target,policy);
  -- Leave one cron interval inside the window so a step is never due as the window closes.
  if not public.revive_in_working_window(due+interval '5 minutes',policy) then due:=public.next_revive_working_instant(due+interval '5 minutes',policy);end if;if i=0 then first_due:=due;end if;
  if due-first_due>interval '720 hours' or not public.revive_campaign_strategy_current(p_tenant,p_campaign,p_version,p_lead,due)
   or (c.status='approved' and not public.revive_slot_authority_current(p_tenant,p_campaign,p_version,p_lead,due)) then
   raise exception 'A planned step exceeds the actual 30-day span or current approval, evidence or rights expiry' using errcode='22023';end if;
  if not public.revive_daily_capacity_available(p_tenant,p_lead,due,policy) then raise exception 'Daily contact capacity exceeded; choose another start date' using errcode='22023';end if;
  local_time:=due at time zone (policy->>'timezone');
  steps:=steps||jsonb_build_array(jsonb_build_object('step',i,'dueAt',due,'localDate',local_time::date,'localTime',to_char(local_time,'HH24:MI:SS')));prior_due:=due;
 end loop;
 return jsonb_build_object('campaignId',p_campaign,'assetVersion',p_version,'leadId',p_lead,'setupVersion',a.revive_strategy->'setupVersion','timezone',policy->'timezone','requestedStartAt',p_start,'steps',steps,'approvalStatus',c.status,'authorityStatus',case when c.status='approved' then 'current' else 'not_approved' end,'delivery','not_sent');
end $$;

create or replace function public.review_consultation_attendance(p_meeting uuid,p_actor uuid,p_expected integer,p_snapshot jsonb,p_classification text,p_evidence text,p_reason text,p_verified boolean,p_roster boolean,p_request uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.meetings%rowtype;r jsonb;history jsonb;body jsonb;
begin
 if current_user<>'service_role' or not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=p_actor and p.is_admin and u.email_confirmed_at is not null and lower(u.email)=lower(p.email)) then raise exception 'Current staff identity required' using errcode='42501';end if;
 select * into m from public.meetings where id=p_meeting and tenant_id is null for update;
 if not found or m.status in('cancelled','rescheduled') or public.consultation_snapshot(m) is distinct from p_snapshot or m.end_at>now() then raise exception 'Meeting changed or not finished' using errcode='40001';end if;
 if p_request is null or p_verified is null or p_roster is null or p_expected is null or p_expected<0 or p_classification is null or p_classification not in('held','no_show','unknown') or coalesce(length(trim(p_evidence)),0) not between 8 and 500 or coalesce(length(trim(p_reason)),0) not between 8 and 1000 or(p_classification<>'unknown' and p_verified is distinct from true) or(p_classification='no_show' and p_roster is distinct from true) then raise exception 'Reviewed authoritative attendance evidence required' using errcode='22023';end if;
 body:=jsonb_build_object('classification',p_classification,'actor',p_actor,'evidenceReference',trim(p_evidence),'reason',trim(p_reason),'verified',p_verified,'rosterComplete',p_roster,'snapshot',p_snapshot);
 if m.attendance_review->>'requestId'=p_request::text then
  if m.attendance_review_version=p_expected+1 and m.attendance_review - 'history' - 'reviewedAt' - 'requestId' - 'state'=body then return jsonb_build_object('meetingId',m.id,'version',m.attendance_review_version,'classification',p_classification,'replayed',true);end if;raise exception 'Review request reused' using errcode='40001';end if;
 if m.attendance_review_version<>p_expected then raise exception 'Attendance review changed' using errcode='40001';end if;
 history:=coalesce(m.attendance_review->'history','[]'::jsonb);if m.attendance_review is not null then history:=history||jsonb_build_array(m.attendance_review-'history');end if;
 if jsonb_array_length(history)>=50 then raise exception 'Review history needs retention review' using errcode='22023';end if;
 r:=body||jsonb_build_object('state','reviewed','requestId',p_request,'reviewedAt',now(),'history',history);
 if length(r::text)>64000 then raise exception 'Review history needs retention review' using errcode='22023';end if;
 update public.meetings set attendance_review=r,attendance_review_version=attendance_review_version+1,status=case when p_classification='unknown' then 'attendance_unknown' else p_classification end where id=m.id;
 if p_classification='held' and m.lead_id is not null then update public.leads set status='meeting_held' where id=m.lead_id and tenant_id is null and status in('qualified','meeting_booked');end if;
 if p_classification<>'held' and m.attendance_review->>'state'='reviewed' and m.attendance_review->>'classification'='held' then
  update public.leads set status='meeting_booked' where id=m.lead_id and tenant_id is null and status='meeting_held' and not exists(select 1 from public.meetings other where other.id<>m.id and other.lead_id=m.lead_id and other.tenant_id is null and other.status='held' and other.attendance_review->>'state'='reviewed' and other.attendance_review->>'classification'='held');
 end if;
 -- A prospect who did not attend can book again unless another consultation is still current.
 if p_classification in('no_show','unknown') and m.lead_id is not null then
  update public.leads set status='qualified' where id=m.lead_id and tenant_id is null and status='meeting_booked' and not exists(select 1 from public.meetings other where other.id<>m.id and other.lead_id=m.lead_id and other.tenant_id is null and other.status in('booked','rescheduled','held'));
 end if;
 insert into public.activity_log(actor,kind,message,visible_to_client)values(p_actor::text,'note','Consultation attendance reviewed: '||m.id::text||' version '||(m.attendance_review_version+1)::text||' classification '||p_classification,false);
 return jsonb_build_object('meetingId',m.id,'version',m.attendance_review_version+1,'classification',p_classification,'replayed',false);
end $$;

-- Member-readable reviewed outcome counts. Not security_invoker: lead_observations
-- is staff-only, so the view filters to the caller's tenants itself and exposes
-- no excerpt, rights or synthetic evidence. Counts are distinct contacts.
create or replace view public.v_tenant_outcomes_monthly as
select o.tenant_id, date_trunc('month', o.observed_at)::date as month,
       count(distinct o.lead_id) filter (where o.product_context->>'outcome'='qualified_conversation') as qualified_conversation,
       count(distinct o.lead_id) filter (where o.product_context->>'outcome'='meeting_held') as meeting_held,
       count(distinct o.lead_id) filter (where o.product_context->>'outcome'='opportunity') as opportunity,
       count(distinct o.lead_id) filter (where o.product_context->>'outcome'='won') as won,
       count(distinct o.lead_id) filter (where o.product_context->>'outcome'='lost') as lost
from public.lead_observations o
where o.product_context->>'kind'='outcome' and not o.synthetic and o.assessment_reviewed_by is not null and public.is_member(o.tenant_id)
group by 1, 2;
revoke all on public.v_tenant_outcomes_monthly from public, anon;
grant select on public.v_tenant_outcomes_monthly to authenticated;

-- WhatsApp reminders stay off until consent is recorded with its notice.
alter table public.meetings
  add column if not exists attendee_whatsapp text check (attendee_whatsapp ~ '^\+[1-9][0-9]{7,14}$'),
  add column if not exists whatsapp_consent_at timestamptz,
  add column if not exists whatsapp_notice text check (length(trim(whatsapp_notice)) between 1 and 80),
  add column if not exists whatsapp_opted_out_at timestamptz;
alter table public.meetings drop constraint if exists meetings_whatsapp_consent;
alter table public.meetings add constraint meetings_whatsapp_consent check (whatsapp_consent_at is null or (attendee_whatsapp is not null and whatsapp_notice is not null));
grant update(attendee_whatsapp,whatsapp_consent_at,whatsapp_notice,whatsapp_opted_out_at) on public.meetings to service_role;

-- Legacy entry points with no caller: the fenced RPCs and durable Gmail authority replace them.
drop function if exists public.complete_synthetic_action(uuid,timestamptz);
drop function if exists public.expire_synthetic_claim(uuid,timestamptz);
drop function if exists public.record_gmail_product_event(integer,timestamptz,uuid,uuid,uuid,text,text,text,timestamptz,boolean,jsonb);
