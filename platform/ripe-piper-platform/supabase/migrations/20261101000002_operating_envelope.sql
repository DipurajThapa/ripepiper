-- Hybrid operating model, wave 2: approve once, then operate inside a bounded envelope.
-- One append-only table binds the current brief and setup versions (identity, market, schedule, claims stay in
-- revive_setups) and adds channels with legal basis, needs, templates, prohibited terms, limits, budget and stops.
-- A campaign inside the envelope is approved through the existing manage_campaign_plan 'approve' path with an
-- 'envelope:vN:...' authority; anything outside it stays draft and is escalated through activity_log.
-- No new campaign state, no escalation table and no AI judgement: every check is equality, subset or integer.
-- Approvers are re-checked at every use through can_operate, like every stored approver since wave 1.

create function public.operating_envelope_body_valid(b jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare item jsonb; field text; bounds integer[]; prior integer:=-1; v integer; part text;
begin
 if not public.revive_setup_keys(b,array['capabilities','purposes','channels','legalBasis','needs','templates','bookingUrl','prohibitedTerms','limits','budget','stopConditions']) then return false; end if;
 -- Distinct single-line strings: (min items, max items, max length).
 foreach field in array array['capabilities','purposes','channels','needs','prohibitedTerms'] loop
  bounds:=case field when 'purposes' then array[1,5,160] when 'needs' then array[1,20,100] when 'prohibitedTerms' then array[0,50,100] else array[1,1,20] end;
  if jsonb_typeof(b->field) is distinct from 'array' or jsonb_array_length(b->field) not between bounds[1] and bounds[2]
   or (select count(distinct lower(btrim(value#>>'{}'))) from jsonb_array_elements(b->field))<>jsonb_array_length(b->field) then return false; end if;
  for item in select value from jsonb_array_elements(b->field) loop
   if not public.revive_setup_text(item,bounds[3],true) then return false; end if;
  end loop;
 end loop;
 -- Revive over email only; Signal keeps its digest review and paid channels wait for metering.
 if not (b->'capabilities')<@'["revive"]'::jsonb or not (b->'channels')<@'["email"]'::jsonb then return false; end if;
 if jsonb_typeof(b->'legalBasis') is distinct from 'array' or jsonb_array_length(b->'legalBasis') not between 1 and 20 then return false; end if;
 for item in select value from jsonb_array_elements(b->'legalBasis') loop
  if not public.revive_setup_keys(item,array['channel','market','purpose','basis','noticeReference']) or not (b->'channels')@>jsonb_build_array(item->'channel')
   or not (b->'purposes')@>jsonb_build_array(item->'purpose') or jsonb_typeof(item->'market') is distinct from 'string' or item->>'market'!~'^[A-Z]{2}$'
   or coalesce(item->>'basis','') not in ('consent','legitimate_interest','existing_customer') or not public.revive_setup_text(item->'noticeReference',240,true) then return false; end if;
 end loop;
 -- Templates may use only the fixed slots; first step at hour 0, follow-ups 24h apart within 30 days.
 if jsonb_typeof(b->'templates') is distinct from 'array' or jsonb_array_length(b->'templates') not between 1 and 3 then return false; end if;
 for item in select value from jsonb_array_elements(b->'templates') loop
  if not public.revive_setup_keys(item,array['offsetHours','subject','body']) or jsonb_typeof(item->'offsetHours') is distinct from 'number' or item->>'offsetHours'!~'^[0-9]{1,3}$'
   or not public.revive_setup_text(item->'subject',160,true) or not public.revive_setup_text(item->'body',4000) then return false; end if;
  v:=(item->>'offsetHours')::integer;
  if v>720 or (prior=-1 and v<>0) or (prior>=0 and v-prior<24) then return false; end if;
  prior:=v;
  foreach part in array array[item->>'subject',item->>'body'] loop
   if regexp_replace(part,'\{\{(need|offer|sender|business|cta)\}\}','','g')~'[{}]' then return false; end if;
  end loop;
 end loop;
 if b->'bookingUrl'<>'null'::jsonb and (jsonb_typeof(b->'bookingUrl') is distinct from 'string' or not public.revive_booking_url_valid(b->>'bookingUrl')) then return false; end if;
 if not public.revive_setup_keys(b->'limits',array['perCampaignMaxActions','totalActions','maxActiveCampaigns','maxAudience','maxCampaignDays'])
  or not public.revive_setup_keys(b->'budget',array['currency','maxMinor'])
  or not public.revive_setup_keys(b->'stopConditions',array['minSample','maxOptOutPct','maxReviewActions','maxReplies']) then return false; end if;
 if jsonb_typeof(b->'budget'->'currency') is distinct from 'string' or b->'budget'->>'currency'!~'^[A-Z]{3}$'
  or jsonb_typeof(b->'budget'->'maxMinor') is distinct from 'number' or b->'budget'->>'maxMinor'!~'^[0-9]{1,12}$' then return false; end if;
 foreach field in array array['limits.perCampaignMaxActions','limits.totalActions','limits.maxActiveCampaigns','limits.maxAudience','limits.maxCampaignDays',
  'stopConditions.minSample','stopConditions.maxOptOutPct','stopConditions.maxReviewActions','stopConditions.maxReplies'] loop
  item:=b#>string_to_array(field,'.');
  if jsonb_typeof(item) is distinct from 'number' or item::text!~'^[0-9]{1,4}$' then return false; end if;
  v:=item::text::integer;
  bounds:=case split_part(field,'.',2) when 'perCampaignMaxActions' then array[1,100] when 'totalActions' then array[1,1000] when 'maxActiveCampaigns' then array[1,5]
   when 'maxAudience' then array[1,25] when 'maxCampaignDays' then array[1,30] when 'minSample' then array[5,1000] when 'maxOptOutPct' then array[0,100]
   when 'maxReviewActions' then array[1,100] else array[0,100] end;
  if v<bounds[1] or v>bounds[2] then return false; end if;
 end loop;
 return true;
exception when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then return false;
end $$;
revoke all on function public.operating_envelope_body_valid(jsonb) from public,anon,authenticated;
grant execute on function public.operating_envelope_body_valid(jsonb) to service_role;

create table public.operating_envelopes (
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 version integer not null check(version>0),
 brief_version integer not null,
 setup_version integer not null,
 google_authority_version integer check(google_authority_version>0),
 body jsonb not null check(public.operating_envelope_body_valid(body)),
 digest text not null check(digest~'^[0-9a-f]{32}$'),
 client_approved_by uuid references public.profiles(id), client_approved_at timestamptz,
 operator_approved_by uuid references public.profiles(id), operator_approved_at timestamptz,
 expires_at timestamptz not null,
 revoked_at timestamptz, revoked_by uuid references public.profiles(id),
 revoked_reason text check(revoked_reason is null or octet_length(btrim(revoked_reason)) between 1 and 500),
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 primary key(tenant_id,version),
 foreign key(tenant_id,brief_version) references public.business_briefs(tenant_id,version),
 foreign key(tenant_id,setup_version) references public.revive_setups(tenant_id,version),
 check(expires_at>created_at and expires_at<=created_at+interval '90 days'),
 check((client_approved_by is null)=(client_approved_at is null)),
 check((operator_approved_by is null)=(operator_approved_at is null)),
 check((revoked_at is null)=(revoked_by is null) and (revoked_at is null)=(revoked_reason is null)),
 check(client_approved_by is distinct from operator_approved_by or client_approved_by is null)
);
alter table public.operating_envelopes enable row level security;
revoke all on public.operating_envelopes from public,anon,authenticated,service_role;
grant select on public.operating_envelopes to authenticated;
grant select,insert,update on public.operating_envelopes to service_role;
create policy tenant_read on public.operating_envelopes for select to authenticated using(public.can_read_tenant(tenant_id));

alter table public.campaigns add column envelope_version integer,
 add foreign key(tenant_id,envelope_version) references public.operating_envelopes(tenant_id,version);

-- Insert the next unapproved version; afterwards only set-once approval and revoke columns may change.
create function public.guard_operating_envelope() returns trigger
language plpgsql security invoker set search_path='' as $$
declare k text; mutable constant text[]:=array['client_approved_by','client_approved_at','operator_approved_by','operator_approved_at','revoked_at','revoked_by','revoked_reason'];
begin
 if tg_op='DELETE' then
  if not exists(select 1 from public.tenants where id=old.tenant_id) then return old; end if;
  raise exception 'Operating envelopes are append only' using errcode='23514';
 end if;
 if current_user<>'service_role' then raise exception 'Envelope service required' using errcode='42501'; end if;
 if tg_op='INSERT' then
  if new.client_approved_by is not null or new.operator_approved_by is not null or new.revoked_at is not null
   or new.version is distinct from coalesce((select max(version) from public.operating_envelopes where tenant_id=new.tenant_id),0)+1 then
   raise exception 'Propose the next unapproved envelope version' using errcode='22023'; end if;
  return new;
 end if;
 if old.revoked_at is not null or to_jsonb(new)-mutable is distinct from to_jsonb(old)-mutable then raise exception 'Operating envelopes change only by set-once approval or revoke' using errcode='23514'; end if;
 foreach k in array mutable loop
  if to_jsonb(old)->k<>'null'::jsonb and to_jsonb(new)->k is distinct from to_jsonb(old)->k then raise exception 'Operating envelopes change only by set-once approval or revoke' using errcode='23514'; end if;
 end loop;
 return new;
end $$;
revoke all on function public.guard_operating_envelope() from public,anon,authenticated;
create trigger operating_envelope_guard before insert or update or delete on public.operating_envelopes for each row execute function public.guard_operating_envelope();

-- Reserved receipt payloads are JSON; anything else is an ordinary note.
create function public.activity_log_payload(p_message text) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
begin return p_message::jsonb; exception when invalid_text_representation then return null; end $$;
revoke all on function public.activity_log_payload(text) from public,anon;
grant execute on function public.activity_log_payload(text) to authenticated,service_role;

-- Extends the reserved-kind guard (20261024105646): proposal receipts stay private, envelope receipts are
-- client-visible; both are service owned and immutable.
create or replace function public.guard_revive_draft_receipt() returns trigger
language plpgsql security invoker set search_path='' as $$
declare reserved constant text[]:=array['revive_draft_proposed','envelope_proposed','envelope_approved','envelope_revoked','campaign_envelope_approved',
 'campaign_escalated','campaign_override_approved','campaign_stop_condition'];
 before_kind text; after_kind text;
begin
 if tg_op<>'INSERT' then before_kind:=public.activity_log_payload(old.message)->>'kind'; end if;
 if tg_op<>'DELETE' then after_kind:=public.activity_log_payload(new.message)->>'kind'; end if;
 if coalesce(before_kind=any(reserved),false) or coalesce(after_kind=any(reserved),false) then
  if current_user not in ('service_role','postgres') then raise exception 'Proposal receipts are service owned' using errcode='42501'; end if;
  if tg_op='INSERT' then
   if new.tenant_id is null or new.visible_to_client is distinct from (after_kind<>'revive_draft_proposed') then
    raise exception '% tenant receipt required',case when after_kind='revive_draft_proposed' then 'Private' else 'Client-visible' end using errcode='23514'; end if;
  elsif current_user<>'postgres' and not(tg_op='DELETE' and not exists(select 1 from public.tenants where id=old.tenant_id)) then
   raise exception 'Proposal receipts are immutable' using errcode='23514';
  end if;
 end if;
 if tg_op='DELETE' then return old; end if;return new;
end $$;

-- Missing (incl. revoked, superseded or not yet approved by every required party), expired, stale or unauthorised.
create function public.envelope_problems(p_tenant uuid,p_version integer,p_now timestamptz) returns text[]
language plpgsql stable security invoker set search_path='' as $$
declare t public.tenants%rowtype; e public.operating_envelopes%rowtype; problems text[]:='{}'; authority integer;
begin
 select * into t from public.tenants where id=p_tenant;
 select * into e from public.operating_envelopes where tenant_id=p_tenant and version=p_version;
 if e.version is null or p_now is null or e.revoked_at is not null or e.client_approved_by is null or (t.ownership='managed' and e.operator_approved_by is null)
  or exists(select 1 from public.operating_envelopes l where l.tenant_id=p_tenant and l.version>e.version and l.client_approved_by is not null and (t.ownership<>'managed' or l.operator_approved_by is not null))
 then return array['envelope_missing']; end if;
 if e.expires_at<=p_now then problems:=problems||'envelope_expired'::text; end if;
 select a.version into authority from public.tenant_google_authority a where a.tenant_id=p_tenant and not a.revoked and a.expires_at>p_now;
 if not public.campaign_brief_current(p_tenant,e.brief_version,p_now) or not public.revive_setup_current(p_tenant,e.setup_version,p_now)
  or (select brief_version from public.revive_setups where tenant_id=p_tenant and version=e.setup_version) is distinct from e.brief_version
  or authority is distinct from e.google_authority_version then problems:=problems||'envelope_stale'::text; end if;
 if not ripepiper_private.is_tenant_owner(p_tenant,e.client_approved_by) or (t.ownership='managed' and not ripepiper_private.can_operate(p_tenant,e.operator_approved_by,'approve')) then
  problems:=problems||'approver_not_authorised'::text; end if;
 return problems;
end $$;
create function public.envelope_effective(p_tenant uuid,p_version integer,p_now timestamptz) returns boolean
language sql stable security invoker set search_path='' as $$ select cardinality(public.envelope_problems(p_tenant,p_version,p_now))=0 $$;

-- Slot substitution only. Callers reject slot values that contain braces, so a value cannot inject a slot.
create function public.envelope_render_step(p_template jsonb,p_need text,p_offer text,p_sender text,p_business text,p_cta text) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare k text; v text; rendered jsonb:=jsonb_build_object('offsetHours',p_template->'offsetHours');
begin
 foreach k in array array['subject','body'] loop
  v:=replace(replace(replace(replace(replace(p_template->>k,'{{need}}',p_need),'{{offer}}',p_offer),'{{sender}}',p_sender),'{{business}}',p_business),'{{cta}}',p_cta);
  rendered:=rendered||jsonb_build_object(k,v);
 end loop;
 return rendered;
end $$;

-- An unlifted stop: a stop-condition receipt with no later human override for the campaign.
create function public.envelope_stop_active(p_tenant uuid,p_campaign uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.activity_log s where s.tenant_id=p_tenant and s.kind='alert' and s.message like '%campaign_stop_condition%'
  and public.activity_log_payload(s.message)@>jsonb_build_object('kind','campaign_stop_condition','campaignId',p_campaign)
  and not exists(select 1 from public.activity_log o where o.tenant_id=p_tenant and o.id>s.id and o.message like '%campaign_override_approved%'
   and public.activity_log_payload(o.message)@>jsonb_build_object('kind','campaign_override_approved','campaignId',p_campaign)))
$$;

-- Fixed reason codes, in a fixed order. Empty means the campaign is inside the current effective envelope.
create function public.envelope_campaign_fit(p_tenant uuid,p_campaign uuid,p_version integer,p_now timestamptz) returns text[]
language plpgsql stable security invoker set search_path='' as $$
declare t public.tenants%rowtype; c public.campaigns%rowtype; a public.campaign_assets%rowtype; e public.operating_envelopes%rowtype;
 setup jsonb; brief jsonb; r text[]; need text; offer text; sender text; business text; cta text; members integer; planned integer;
begin
 select * into t from public.tenants where id=p_tenant;
 select * into c from public.campaigns where tenant_id=p_tenant and id=p_campaign;
 if t.id is null or c.id is null then raise exception 'Campaign missing' using errcode='23503'; end if;
 if c.asset_version is distinct from p_version then raise exception 'Campaign changed' using errcode='40001'; end if;
 select * into a from public.campaign_assets where tenant_id=p_tenant and campaign_id=c.id and version=p_version;
 select * into e from public.operating_envelopes where tenant_id=p_tenant and client_approved_by is not null and (t.ownership<>'managed' or operator_approved_by is not null) order by version desc limit 1;
 r:=case when e.version is null then array['envelope_missing'] else public.envelope_problems(p_tenant,e.version,p_now) end;
 if t.status<>'active' then r:=r||'tenant_not_active'::text; end if;
 if 'envelope_missing'=any(r) then return r; end if;
 if not (e.body->'capabilities')@>jsonb_build_array(c.capability) then r:=r||'capability_out_of_scope'::text; end if;
 if not (e.body->'purposes')@>jsonb_build_array(c.purpose) then r:=r||'purpose_out_of_scope'::text; end if;
 if not (e.body->'channels')@>jsonb_build_array(c.channel) then r:=r||'channel_out_of_scope'::text; end if;
 select body into setup from public.revive_setups where tenant_id=p_tenant and version=e.setup_version;
 select body into brief from public.business_briefs where tenant_id=p_tenant and version=e.brief_version;
 if c.market is distinct from setup->>'market' then r:=r||'market_out_of_scope'::text; end if;
 if not exists(select 1 from jsonb_array_elements(e.body->'legalBasis') l where l->>'channel'=c.channel and l->>'market'=c.market and l->>'purpose'=c.purpose) then r:=r||'legal_basis_missing'::text; end if;
 need:=a.revive_strategy->>'canonicalNeed';
 if need is null or not (e.body->'needs')@>jsonb_build_array(need) or a.brief_version is distinct from e.brief_version
  or a.revive_strategy->'setupVersion' is distinct from to_jsonb(e.setup_version)
  -- The same strategy check manage_campaign_plan 'approve' enforces, so a fit never ends in a refused approval.
  or not public.revive_campaign_strategy_current(p_tenant,c.id,p_version,null,p_now) then r:=r||'icp_out_of_scope'::text; end if;
 members:=coalesce(jsonb_array_length(a.revive_audience->'members'),0);
 if members>(e.body->'limits'->>'maxAudience')::integer or not public.revive_campaign_audience_current(p_tenant,c.id,p_version,null,p_now) then r:=r||'audience_out_of_scope'::text; end if;
 -- The same slot values and call to action as proposeReviveDraft (src/foundation/revive-draft.ts).
 offer:=btrim(brief->>'offer');sender:=btrim(setup->>'senderName');business:=btrim(t.name);
 cta:=case when e.body->>'bookingUrl' is not null then 'If this is relevant, choose a time to discuss it: '||(e.body->>'bookingUrl') else 'Is '||need||' relevant for your team?' end;
 if a.steps is null or jsonb_array_length(a.steps)>jsonb_array_length(e.body->'templates') or concat(need,offer,sender,business,cta) ~ '[{}]'
  or exists(select 1 from jsonb_array_elements(a.steps) with ordinality s(step,n)
   where public.envelope_render_step(e.body->'templates'->(s.n::integer-1),need,offer,sender,business,cta) is distinct from s.step-'evidenceReference') then r:=r||'content_not_from_template'::text; end if;
 if exists(select 1 from jsonb_array_elements(a.steps) s,jsonb_array_elements_text(e.body->'prohibitedTerms') p
  where strpos(lower(regexp_replace(concat(s->>'subject',' ',s->>'body'),'\s+',' ','g')),lower(regexp_replace(btrim(p),'\s+',' ','g')))>0) then r:=r||'prohibited_claim'::text; end if;
 if exists(select 1 from jsonb_array_elements(a.steps) s where not coalesce(s->>'evidenceReference'=brief->'source'->>'reference'
  or s->>'evidenceReference' like 'brief:v'||e.brief_version||';%'
  or exists(select 1 from jsonb_array_elements(setup->'sourceInventory') i where i->>'reference'=s->>'evidenceReference')
  or exists(select 1 from jsonb_array_elements(setup->'supportedClaims') i where i->>'reference'=s->>'evidenceReference'),false)) then r:=r||'unknown_evidence'::text; end if;
 planned:=coalesce(jsonb_array_length(a.steps),0)*members;
 if planned>(e.body->'limits'->>'perCampaignMaxActions')::integer then r:=r||'campaign_limit'::text; end if;
 -- Reservations (max_actions) of campaigns still bound to this version, plus actions already used since it was approved
 -- by campaigns no longer bound (an edit clears envelope_version) and by earlier versions of this campaign: deterministic and conservative.
 if (select coalesce(sum(x.max_actions),0) from public.campaigns x where x.tenant_id=p_tenant and x.envelope_version=e.version and x.status<>'ended' and x.id<>c.id)
  +(select count(*) from public.outbound_actions o where o.tenant_id=p_tenant and o.state<>'cancelled' and o.created_at>=e.client_approved_at
     and not (o.campaign_id=c.id and o.asset_version=p_version)
     and not exists(select 1 from public.campaigns x where x.id=o.campaign_id and x.id<>c.id and x.envelope_version=e.version and x.status<>'ended'))
  +planned>(e.body->'limits'->>'totalActions')::integer then r:=r||'total_limit'::text; end if;
 if (select count(*) from public.campaigns x where x.tenant_id=p_tenant and x.status='approved' and x.id<>c.id)>=(e.body->'limits'->>'maxActiveCampaigns')::integer then r:=r||'active_campaign_limit'::text; end if;
 -- Only email has no per-message cost; budget metering does not exist yet.
 if c.channel<>'email' then r:=r||'paid_channel_unmetered'::text; end if;
 if public.envelope_stop_active(p_tenant,c.id) then r:=r||'stop_condition_tripped'::text; end if;
 return r;
end $$;

-- System approval: reuse manage_campaign_plan 'approve' as the envelope approver, or escalate with reasons.
create function public.approve_campaign_within_envelope(p_tenant uuid,p_campaign uuid,p_version integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare t public.tenants%rowtype; c public.campaigns%rowtype; a public.campaign_assets%rowtype; e public.operating_envelopes%rowtype;
 reasons text[]; receipt jsonb; actor uuid; expires timestamptz;
begin
 if current_user<>'service_role' then raise exception 'Envelope service required' using errcode='42501'; end if;
 select * into t from public.tenants where id=p_tenant for update;
 select * into c from public.campaigns where tenant_id=p_tenant and id=p_campaign for update;
 if t.id is null or c.id is null then raise exception 'Campaign missing' using errcode='23503'; end if;
 if c.asset_version is distinct from p_version then raise exception 'Campaign changed' using errcode='40001'; end if;
 -- Approved, paused and ended campaigns are never changed here: a stop or pause is never auto-resumed.
 if c.status<>'draft' then
  return jsonb_build_object('campaignId',c.id,'assetVersion',c.asset_version,'status',c.status,'by',case when c.envelope_version is null then 'human' else 'envelope' end,'envelopeVersion',c.envelope_version);
 end if;
 select * into e from public.operating_envelopes where tenant_id=p_tenant and client_approved_by is not null and (t.ownership<>'managed' or operator_approved_by is not null) order by version desc limit 1;
 reasons:=public.envelope_campaign_fit(p_tenant,c.id,p_version,now());
 if cardinality(reasons)>0 then
  receipt:=jsonb_build_object('kind','campaign_escalated','envelopeVersion',e.version,'digest',e.digest,'campaignId',c.id,'assetVersion',c.asset_version,'reasons',to_jsonb(reasons));
  -- The cron re-evaluates drafts every tick; record each distinct escalation once.
  if not exists(select 1 from public.activity_log l where l.tenant_id=p_tenant and l.kind='alert' and l.message like '%campaign_escalated%' and public.activity_log_payload(l.message)=receipt) then
   insert into public.activity_log(tenant_id,actor,kind,message,visible_to_client) values(p_tenant,'Operating envelope','alert',receipt::text,true);
  end if;
  return jsonb_build_object('campaignId',c.id,'assetVersion',c.asset_version,'status','escalated','envelopeVersion',e.version,'reasons',to_jsonb(reasons));
 end if;
 select * into a from public.campaign_assets where tenant_id=p_tenant and campaign_id=c.id and version=p_version;
 actor:=case when t.ownership='managed' then e.operator_approved_by else e.client_approved_by end;
 expires:=least(e.expires_at,now()+(e.body->'limits'->>'maxCampaignDays')::integer*interval '1 day',
  (select min(r.expires_at) from public.revive_reviews r join jsonb_array_elements(a.revive_audience->'members') m on r.lead_id=(m->>'leadId')::uuid and r.version=(m->>'reviewVersion')::integer where r.tenant_id=p_tenant));
 perform set_config('ripepiper.envelope_campaign',c.id::text,true);
 perform public.manage_campaign_plan(p_tenant,c.id,actor,'approve',p_version,jsonb_build_object(
  'clientAuthority',format('envelope:v%s:client:%s',e.version,e.client_approved_by),
  'ownerAuthority',format('envelope:v%s:operator:%s',e.version,coalesce(e.operator_approved_by::text,'self')),
  'ctsProfile',format('envelope:v%s:%s',e.version,e.digest),
  'maxActions',jsonb_array_length(a.steps)*jsonb_array_length(a.revive_audience->'members'),'expiresAt',expires));
 perform set_config('ripepiper.envelope_campaign','',true);
 update public.campaigns set envelope_version=e.version where id=c.id;
 insert into public.activity_log(tenant_id,actor,kind,message,visible_to_client) values(p_tenant,'Operating envelope','change',
  jsonb_build_object('kind','campaign_envelope_approved','envelopeVersion',e.version,'digest',e.digest,'campaignId',c.id,'assetVersion',c.asset_version,'reasons','[]'::jsonb)::text,true);
 return jsonb_build_object('campaignId',c.id,'assetVersion',c.asset_version,'status','approved','by','envelope','envelopeVersion',e.version);
end $$;

-- status | propose (compare-and-append, binds the current brief, setup and Google authority) | approve (exact digest) | revoke.
create function public.manage_operating_envelope(p_tenant uuid,p_actor uuid,p_operation text,p_version integer,p_body jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare t public.tenants%rowtype; e public.operating_envelopes%rowtype; body jsonb; brief integer; setup integer; authority integer; expires timestamptz; party text; label text;
begin
 if current_user<>'service_role' or not coalesce(ripepiper_private.can_operate(p_tenant,p_actor,case when p_operation='status' then 'read' else 'approve' end),false) then
  raise exception 'Not authorised' using errcode='42501'; end if;
 select * into t from public.tenants where id=p_tenant for update;
 select left(coalesce(nullif(btrim(full_name),''),email),320) into label from public.profiles where id=p_actor;
 if p_operation='status' then
  select * into e from public.operating_envelopes where tenant_id=p_tenant order by version desc limit 1;
  return jsonb_build_object('tenantId',p_tenant,'ownership',t.ownership,'envelope',case when e.version is null then null else to_jsonb(e) end,
   'problems',to_jsonb(case when e.version is null then array['envelope_missing'] else public.envelope_problems(p_tenant,e.version,now()) end));
 end if;
 if p_operation='propose' then
  select * into e from public.operating_envelopes where tenant_id=p_tenant order by version desc limit 1;
  body:=p_body->'body';
  select max(version) into brief from public.business_briefs where tenant_id=p_tenant;
  select max(version) into setup from public.revive_setups where tenant_id=p_tenant;
  select a.version into authority from public.tenant_google_authority a where a.tenant_id=p_tenant and not a.revoked and a.expires_at>now();
  begin expires:=(p_body->>'expiresAt')::timestamptz;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception 'Valid envelope expiry required' using errcode='22023'; end;
  if not coalesce(public.operating_envelope_body_valid(body),false) or expires is null or expires<=now() or expires>now()+interval '90 days'
   or not public.revive_setup_current(p_tenant,setup,now()) or (select brief_version from public.revive_setups where tenant_id=p_tenant and version=setup) is distinct from brief
   or not coalesce((select b.body->'needs' from public.business_briefs b where b.tenant_id=p_tenant and b.version=brief)@>(body->'needs'),false)
   -- The first approved envelope is bounded tighter.
   or ((body->'limits'->>'totalActions')::integer>300 and not exists(select 1 from public.operating_envelopes where tenant_id=p_tenant and client_approved_by is not null)) then
   raise exception 'A bounded envelope over the current reviewed brief and setup is required' using errcode='22023'; end if;
  -- Same-body retry is harmless, even after the first response was lost.
  if e.version is not null and e.revoked_at is null and e.body=body and e.brief_version=brief and e.setup_version=setup and e.google_authority_version is not distinct from authority and e.expires_at=expires then
   return jsonb_build_object('tenantId',p_tenant,'version',e.version,'digest',e.digest,'status','proposed','replayed',true); end if;
  if p_version is distinct from coalesce(e.version,0) then raise exception 'Envelope changed; reload before proposing' using errcode='40001'; end if;
  insert into public.operating_envelopes(tenant_id,version,brief_version,setup_version,google_authority_version,body,digest,expires_at,created_by)
  values(p_tenant,coalesce(e.version,0)+1,brief,setup,authority,body,md5(jsonb_build_object('tenantId',p_tenant,'version',coalesce(e.version,0)+1,'briefVersion',brief,'setupVersion',setup,
   'googleAuthorityVersion',authority,'expiresAt',to_char(expires at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'body',body)::text),expires,p_actor) returning * into e;
  insert into public.activity_log(tenant_id,actor,kind,message,visible_to_client) values(p_tenant,coalesce(label,'Ripe Piper'),'change',
   jsonb_build_object('kind','envelope_proposed','envelopeVersion',e.version,'digest',e.digest)::text,true);
  return jsonb_build_object('tenantId',p_tenant,'version',e.version,'digest',e.digest,'status','proposed','replayed',false);
 end if;
 select * into e from public.operating_envelopes where tenant_id=p_tenant and version=p_version for update;
 if not found then raise exception 'Envelope missing' using errcode='23503'; end if;
 if p_operation='approve' then
  if e.version<>(select max(version) from public.operating_envelopes where tenant_id=p_tenant) then raise exception 'A newer envelope exists' using errcode='40001'; end if;
  if e.revoked_at is not null or e.expires_at<=now() or p_body->>'digest' is distinct from e.digest then raise exception 'Review the exact current envelope digest' using errcode='22023'; end if;
  -- The client admin approves as the client; a granted operator approves as the operator.
  party:=case when ripepiper_private.is_tenant_owner(p_tenant,p_actor) then 'client' else 'operator' end;
  if (party='client' and e.client_approved_by is not null) or (party='operator' and e.operator_approved_by is not null) then
   if p_actor in (e.client_approved_by,e.operator_approved_by) then return jsonb_build_object('tenantId',p_tenant,'version',e.version,'digest',e.digest,'party',party,'effective',public.envelope_effective(p_tenant,e.version,now()),'replayed',true); end if;
   raise exception 'This party already approved the envelope' using errcode='40001';
  end if;
  if party='client' then update public.operating_envelopes set client_approved_by=p_actor,client_approved_at=now() where tenant_id=p_tenant and version=e.version;
  else update public.operating_envelopes set operator_approved_by=p_actor,operator_approved_at=now() where tenant_id=p_tenant and version=e.version; end if;
  insert into public.activity_log(tenant_id,actor,kind,message,visible_to_client) values(p_tenant,coalesce(label,'Ripe Piper'),'change',
   jsonb_build_object('kind','envelope_approved','envelopeVersion',e.version,'digest',e.digest,'party',party)::text,true);
  return jsonb_build_object('tenantId',p_tenant,'version',e.version,'digest',e.digest,'party',party,'effective',public.envelope_effective(p_tenant,e.version,now()),'replayed',false);
 end if;
 if p_operation='revoke' then
  if e.revoked_at is not null then return jsonb_build_object('tenantId',p_tenant,'version',e.version,'revokedAt',e.revoked_at,'replayed',true); end if;
  if coalesce(octet_length(btrim(p_body->>'reason')),0) not between 1 and 500 then raise exception 'A revoke reason is required' using errcode='22023'; end if;
  update public.operating_envelopes set revoked_at=now(),revoked_by=p_actor,revoked_reason=btrim(p_body->>'reason') where tenant_id=p_tenant and version=e.version returning * into e;
  insert into public.activity_log(tenant_id,actor,kind,message,visible_to_client) values(p_tenant,coalesce(label,'Ripe Piper'),'change',
   jsonb_build_object('kind','envelope_revoked','envelopeVersion',e.version,'digest',e.digest)::text,true);
  return jsonb_build_object('tenantId',p_tenant,'version',e.version,'revokedAt',e.revoked_at,'replayed',false);
 end if;
 raise exception 'Unsupported envelope operation' using errcode='22023';
end $$;

-- Revoke pauses the envelope's campaigns; a newly effective version sets older-version campaigns back to draft so
-- the cron re-approves those still in bounds. Cancelled work keeps 'campaign_paused' so a later version can resume it.
create function public.invalidate_envelope_campaigns() returns trigger
language plpgsql security invoker set search_path='' as $$
declare revoked boolean:=old.revoked_at is null and new.revoked_at is not null; affected uuid[];
begin
 if not revoked and not ((old.client_approved_by is null or (old.operator_approved_by is null and new.operator_approved_by is not null)) and new.client_approved_by is not null
  and ((select ownership from public.tenants where id=new.tenant_id)<>'managed' or new.operator_approved_by is not null)) then return new; end if;
 select coalesce(array_agg(id),'{}') into affected from public.campaigns where tenant_id=new.tenant_id and status='approved'
  and case when revoked then envelope_version=new.version else envelope_version<new.version end;
 update public.outbound_actions set state=case when state='claimed' then 'review' else 'cancelled' end,error_code='campaign_paused',lease_until=null
  where tenant_id=new.tenant_id and campaign_id=any(affected) and state in ('queued','claimed');
 -- Supersede also pauses: cancelled steps keep their correlation keys, so the campaign resumes by saving a new version.
 update public.campaigns set status='paused',approval_version=approval_version+case when revoked then 0 else 1 end where id=any(affected);
 return new;
end $$;
revoke all on function public.invalidate_envelope_campaigns() from public,anon,authenticated;
create trigger operating_envelope_invalidates_campaigns after update of client_approved_by,operator_approved_by,revoked_at on public.operating_envelopes
for each row execute function public.invalidate_envelope_campaigns();

-- Campaign-level stops after the minimum sample: opt-out rate, review actions and replies. Same updates as 'pause'.
create function public.enforce_envelope_stop_conditions(p_tenant uuid,p_campaign uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.campaigns%rowtype; s jsonb; sample integer; contacted integer; opted integer; reviews integer; replies integer; reasons text[]:='{}';
begin
 if current_user<>'service_role' then raise exception 'Envelope service required' using errcode='42501'; end if;
 perform 1 from public.tenants where id=p_tenant for update;
 select * into c from public.campaigns where tenant_id=p_tenant and id=p_campaign for update;
 if c.id is null or c.envelope_version is null or c.status<>'approved' then return jsonb_build_object('campaignId',p_campaign,'paused',false); end if;
 select body->'stopConditions' into s from public.operating_envelopes where tenant_id=p_tenant and version=c.envelope_version;
 select count(*) filter(where state in ('tested','delivered')),count(distinct lead_id) filter(where state in ('tested','delivered')),count(*) filter(where state='review')
  into sample,contacted,reviews from public.outbound_actions where tenant_id=p_tenant and campaign_id=c.id;
 select count(distinct a.lead_id) into opted from public.outbound_actions a where a.tenant_id=p_tenant and a.campaign_id=c.id and a.state in ('tested','delivered')
  and (exists(select 1 from public.lead_suppression x where x.tenant_id=p_tenant and x.lead_id=a.lead_id)
   or exists(select 1 from public.contact_rights x where x.tenant_id=p_tenant and x.lead_id=a.lead_id and (x.objected_at is not null or x.withdrawn_at is not null)));
 select count(*) into replies from public.lead_observations o where o.tenant_id=p_tenant and o.observed_at>=c.created_at
  and o.product_context->>'product'='response' and o.product_context->>'kind'='reply'
  and exists(select 1 from public.outbound_actions a where a.tenant_id=p_tenant and a.campaign_id=c.id and a.lead_id=o.lead_id);
 if sample>=(s->>'minSample')::integer and opted*100>(s->>'maxOptOutPct')::integer*contacted then reasons:=reasons||'opt_out_rate'::text; end if;
 if reviews>=(s->>'maxReviewActions')::integer then reasons:=reasons||'review_actions'::text; end if;
 if replies>(s->>'maxReplies')::integer then reasons:=reasons||'replies'::text; end if;
 if cardinality(reasons)=0 then return jsonb_build_object('campaignId',c.id,'paused',false); end if;
 update public.campaigns set status='paused' where id=c.id;
 update public.outbound_actions set state=case when state='claimed' then 'review' else 'cancelled' end,error_code='campaign_paused',lease_until=null where campaign_id=c.id and state in ('queued','claimed');
 insert into public.activity_log(tenant_id,actor,kind,message,visible_to_client) values(p_tenant,'Operating envelope','alert',
  jsonb_build_object('kind','campaign_stop_condition','envelopeVersion',c.envelope_version,'campaignId',c.id,'assetVersion',c.asset_version,'reasons',to_jsonb(reasons),
   'counts',jsonb_build_object('sample',sample,'contacted',contacted,'optedOut',opted,'review',reviews,'replies',replies))::text,true);
 return jsonb_build_object('campaignId',c.id,'paused',true,'reasons',to_jsonb(reasons));
end $$;

do $grants$
declare f text;
begin
 foreach f in array array['public.envelope_problems(uuid,integer,timestamptz)','public.envelope_effective(uuid,integer,timestamptz)',
  'public.envelope_render_step(jsonb,text,text,text,text,text)','public.envelope_stop_active(uuid,uuid)','public.envelope_campaign_fit(uuid,uuid,integer,timestamptz)',
  'public.approve_campaign_within_envelope(uuid,uuid,integer)','public.manage_operating_envelope(uuid,uuid,text,integer,jsonb)','public.enforce_envelope_stop_conditions(uuid,uuid)'] loop
  execute format('revoke all on function %s from public,anon,authenticated',f);
  execute format('grant execute on function %s to service_role',f);
 end loop;
end $grants$;

-- Live-definition edits (the wave-1 manifest pattern): exact match counts fail the migration on drift.
do $rewrite$
declare f record; e record; src text; hits int;
begin
 create temp table envelope_manifest(ord serial,fn regprocedure,pattern text,replacement text,n int);
 insert into envelope_manifest(fn,pattern,replacement,n) select fn::regprocedure,pattern,replacement,n from (values
  -- Resume: an identical save on a paused campaign creates the next version instead of returning early.
  ('public.manage_campaign_plan(uuid,uuid,uuid,text,integer,jsonb)','and not [(]c[.]capability=''revive'' and c[.]status=''approved'' and [(]audience is null or strategy is null[)][)] then',
   'and not (c.capability=''revive'' and c.status=''approved'' and (audience is null or strategy is null)) and c.status<>''paused'' then',1),
  -- A saved Revive draft is offered to the tenant's envelope in the same transaction (approved or escalated).
  ('public.manage_campaign_plan(uuid,uuid,uuid,text,integer,jsonb)','(  return jsonb_build_object[(]''id'',c[.]id,''version'',c[.]asset_version,''status'',''draft''[)];)',
   E'  if c.capability=''revive'' and exists(select 1 from public.operating_envelopes where tenant_id=p_tenant) then
   return jsonb_build_object(''id'',c.id,''version'',c.asset_version,''status'',''draft'',''envelope'',public.approve_campaign_within_envelope(p_tenant,c.id,c.asset_version));
  end if;
\\1',1),
  ('public.manage_campaign_plan(uuid,uuid,uuid,text,integer,jsonb)','update public[.]campaigns set status=''draft'',asset_version=asset_version[+]1,approval_version=approval_version[+]1 where id=c[.]id',
   'update public.campaigns set status=''draft'',asset_version=asset_version+1,approval_version=approval_version+1,envelope_version=null where id=c.id',1),
  -- Only approve_campaign_within_envelope may record an 'envelope:' authority, and only for the campaign it is approving.
  ('public.manage_campaign_plan(uuid,uuid,uuid,text,integer,jsonb)','(or coalesce[(]length[(]trim[(]p_body->>''clientAuthority''[)][)],0[)] not between 1 and 240)',
   E'\\1\n   or (concat(p_body->>''clientAuthority'',p_body->>''ownerAuthority'',p_body->>''ctsProfile'') like ''%envelope:%'') is distinct from (current_setting(''ripepiper.envelope_campaign'',true) is not distinct from c.id::text)',1),
  -- A human approval is the override path: record the envelope reasons it overrode.
  ('public.manage_campaign_plan(uuid,uuid,uuid,text,integer,jsonb)','(  update public[.]campaign_assets set approved_by=p_actor)',
   E'  if current_setting(''ripepiper.envelope_campaign'',true) is distinct from c.id::text then\n   insert into public.activity_log(tenant_id,actor,kind,message,visible_to_client) values(p_tenant,coalesce((select left(coalesce(nullif(btrim(full_name),''''),email),320) from public.profiles where id=p_actor),''Ripe Piper''),''change'',\n    jsonb_build_object(''kind'',''campaign_override_approved'',''envelopeVersion'',null,''campaignId'',c.id,''assetVersion'',c.asset_version,''reasons'',to_jsonb(public.envelope_campaign_fit(p_tenant,c.id,c.asset_version,now())))::text,true);\n  end if;\n\\1',1),
  ('public.manage_campaign_plan(uuid,uuid,uuid,text,integer,jsonb)','update public[.]campaigns set status=''approved'',',
   'update public.campaigns set status=''approved'',envelope_version=null,',1),
  ('public.manage_campaign_plan(uuid,uuid,uuid,text,integer,jsonb)','(  return jsonb_build_object[(]''id'',c[.]id,''status'',''paused''[)];)',
   E'  insert into public.activity_log(tenant_id,actor,kind,message,visible_to_client) values(p_tenant,coalesce((select left(coalesce(nullif(btrim(full_name),''''),email),320) from public.profiles where id=p_actor),''Ripe Piper''),''change'',\n   jsonb_build_object(''kind'',''campaign_paused'',''envelopeVersion'',c.envelope_version,''campaignId'',c.id,''assetVersion'',c.asset_version)::text,true);\n\\1',1),
  -- Expiry or revocation of the envelope stops execution even without the invalidation trigger.
  ('public.synthetic_action_allowed(uuid,timestamptz)','(\n and ripepiper_private[.]synthetic_action_allowed[(]p_id,p_now[)])',
   E'\n and not exists(select 1 from public.outbound_actions a join public.campaigns c on c.id=a.campaign_id and c.tenant_id=a.tenant_id where a.id=p_id and c.envelope_version is not null and not public.envelope_effective(c.tenant_id,c.envelope_version,p_now))\\1',1),
  ('public.revive_slot_authority_current(uuid,uuid,integer,uuid,timestamptz)','and t[.]status=''active'' and a[.]approved_by is not null',
   'and t.status=''active'' and (c.envelope_version is null or public.envelope_effective(p_tenant,c.envelope_version,p_at)) and a.approved_by is not null',1)
 ) m(fn,pattern,replacement,n);
 for f in select fn from envelope_manifest group by fn order by min(ord) loop
  src:=pg_get_functiondef(f.fn);
  for e in select * from envelope_manifest where fn=f.fn order by ord loop
   select count(*) into hits from regexp_matches(src,e.pattern,'g');
   if hits<>e.n then raise exception 'Envelope rewrite drift in %: expected % match(es), found %: %',f.fn,e.n,hits,e.pattern;end if;
   src:=regexp_replace(src,e.pattern,e.replacement,'g');
  end loop;
  execute src;
 end loop;
 drop table envelope_manifest;
end $rewrite$;
