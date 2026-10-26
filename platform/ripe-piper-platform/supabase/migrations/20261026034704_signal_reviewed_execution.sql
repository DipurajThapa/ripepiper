-- Reviewed Signal strategies use the existing immutable campaign/action ledger.
-- Local rehearsal only. No existing data or live-provider capability is changed.
alter table public.campaign_assets add column signal_strategy jsonb,add column signal_review jsonb;
grant update(signal_review) on public.campaign_assets to service_role;

create function public.signal_strategy_context(p_tenant uuid,p_lead uuid,p_actor uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare t jsonb; l jsonb; obs jsonb;
begin
 if current_user<>'service_role' or not exists(select 1 from public.profiles where id=p_actor and is_admin) then raise exception 'Staff required' using errcode='42501';end if;
 select jsonb_build_object('id',id,'name',name,'status',status) into t from public.tenants where id=p_tenant;
 select jsonb_build_object('id',id,'tenant_id',tenant_id,'email',email,'status',status) into l from public.leads where id=p_lead and tenant_id=p_tenant;
 if t is null or l is null then raise exception 'Contact missing' using errcode='23503';end if;
 select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]') into obs from
 (select * from public.lead_observations where tenant_id=p_tenant and lead_id=p_lead and synthetic=(lower(l->>'email') like '%.invalid') order by id limit 1001) o;
 return jsonb_build_object('tenant',t,'lead',l,'setup',public.revive_setup_context(p_tenant,p_actor),'observations',obs,
 'stops',(select coalesce(jsonb_agg(jsonb_build_object('tenant_id',tenant_id,'lead_id',lead_id) order by lead_id),'[]') from public.lead_suppression where tenant_id=p_tenant and lead_id=p_lead),
 'globalStops',(select coalesce(jsonb_agg(jsonb_build_object('email',email) order by email),'[]') from public.suppression where email=lower(l->>'email')));
end $$;
revoke all on function public.signal_strategy_context(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.signal_strategy_context(uuid,uuid,uuid) to service_role;

-- Literal boundary check avoids treating substring hits as supporting facts.
create function public.signal_literal_mention(excerpt text,needle text) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare hay text:=lower(trim(excerpt)); term text:=lower(trim(needle)); start integer:=1; pos integer;
begin
 if coalesce(length(term),0)=0 or hay is null then return false;end if;
 loop
  pos:=strpos(substr(hay,start),term);if pos=0 then return false;end if;pos:=pos+start-1;
  if (pos=1 or substr(hay,pos-1,1)!~'[[:alnum:]]') and (pos+length(term)>length(hay) or substr(hay,pos+length(term),1)!~'[[:alnum:]]') then return true;end if;
  start:=pos+1;
 end loop;
end $$;
revoke all on function public.signal_literal_mention(text,text) from public,anon,authenticated;
grant execute on function public.signal_literal_mention(text,text) to service_role;

create function public.signal_facts_valid(facts jsonb,excerpt text) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare f record;
begin
 if jsonb_typeof(facts) is distinct from 'object' or facts='{}' or coalesce(length(trim(excerpt)),0) not between 1 and 2000 then return false;end if;
 for f in select * from jsonb_each(facts) loop
  if f.key not in ('industry','market','role','need') or jsonb_typeof(f.value) is distinct from 'string' or length(trim(f.value#>>'{}')) not between 1 and 100 or not public.signal_literal_mention(excerpt,f.value#>>'{}') then return false;end if;
 end loop;return true;
end $$;
revoke all on function public.signal_facts_valid(jsonb,text) from public,anon,authenticated;
grant execute on function public.signal_facts_valid(jsonb,text) to service_role;

create function public.signal_binding_valid(p_tenant uuid,p_actor uuid,p_snapshot jsonb,p_proposal jsonb,p_steps jsonb,p_now timestamptz) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare b jsonb:=p_snapshot->'setup'->'brief'->'body'; setup jsonb:=p_snapshot->'setup'->'setup'; o jsonb; trigger_row jsonb; e jsonb; f text; raw text; canonical text; vals text[]; wanted text; aliases record; oldest timestamptz; expiry timestamptz; ids uuid[]:='{}'; field_ids uuid[]; expected_ids uuid[]; p jsonb:=p_proposal; lead uuid; signal uuid; valid_obs jsonb:='[]'; chosen jsonb; step jsonb;
begin
 if p_now is null or jsonb_typeof(p_snapshot) is distinct from 'object' or jsonb_typeof(p) is distinct from 'object' or not public.campaign_steps_valid(p_steps) or jsonb_array_length(p_steps)<>1 then return false;end if;
 lead:=(p->>'leadId')::uuid;signal:=(p->>'signalId')::uuid;step:=p_steps->0;
 if p->>'tenantId' is distinct from p_tenant::text or p->'synthetic' is distinct from 'true'::jsonb or p->'reviewRequired' is distinct from 'true'::jsonb or p->'persisted' is distinct from 'false'::jsonb
  or p_snapshot->'tenant'->>'id' is distinct from p_tenant::text or p_snapshot->'tenant'->>'status' is distinct from 'active'
  or p_snapshot->'lead'->>'id' is distinct from lead::text or p_snapshot->'lead'->>'tenant_id' is distinct from p_tenant::text
  or p_snapshot->'lead'->>'status'='unsubscribed' or p->>'recipient' is distinct from p_snapshot->'lead'->>'email' or lower(p->>'recipient') not like '%.invalid'
  or p_snapshot->'setup'->'ready' is distinct from 'true'::jsonb or p->'briefVersion' is distinct from p_snapshot->'setup'->'currentBriefVersion' or p->'setupVersion' is distinct from setup->'version'
  or p->'sender' is distinct from jsonb_build_object('name',setup->'body'->>'senderName','email',setup->'body'->>'senderEmail')
  or not public.revive_setup_current(p_tenant,(p->>'setupVersion')::integer,p_now)
  or not exists(select 1 from public.profiles where id=p_actor and is_admin)
  or p_snapshot->'stops' is distinct from '[]'::jsonb or p_snapshot->'globalStops' is distinct from '[]'::jsonb
  or step->'offsetHours' is distinct from '0'::jsonb or step->>'evidenceReference' is distinct from 'signal:'||signal::text
  or step->>'subject' ~ '[<>`{}\[\]]|%[[:alnum:]_]+%' or step->>'body' ~ '[<>`{}\[\]]|%[[:alnum:]_]+%'
  or step->>'subject' ~ '[[:cntrl:]]' or regexp_replace(step->>'body',E'[\n\r\t]','','g') ~ '[[:cntrl:]]'
  or jsonb_typeof(p_snapshot->'observations') is distinct from 'array' or jsonb_array_length(p_snapshot->'observations')>=1000 then return false;end if;
 if exists(select 1 from public.lead_observations where tenant_id=p_tenant and lead_id=lead and product_context->>'product'='response' and product_context->>'kind' in('reply','enquiry')) then return false;end if;
 oldest:=(b->'source'->>'observedAt')::timestamptz+(b->>'maxAgeDays')::integer*interval '1 day';
 for o in select value from jsonb_array_elements(p_snapshot->'observations') loop
  if o->>'tenant_id' is distinct from p_tenant::text or o->>'lead_id' is distinct from lead::text or o->'synthetic' is distinct from 'true'::jsonb then return false;end if;
  if o->>'id'=signal::text then trigger_row:=o;end if;
  if o->>'assessment_reviewed_by' is not null and (o->>'observed_at')::timestamptz<=p_now and (o->>'observed_at')::timestamptz>=p_now-(b->>'maxAgeDays')::integer*interval '1 day' and public.signal_facts_valid(o->'assessment_facts',o->>'assessment_excerpt') then
   if not exists(select 1 from public.profiles where id=(o->>'assessment_reviewed_by')::uuid and is_admin) or o->>'assessment_excerpt' ~* E'\\m(no|not|never|without|neither|denied|unknown|uncertain|maybe|might|possibly|former|previously|competitor|hypothetical|example)\\M|n[''’]t\\M|\\?' then return false;end if;
   valid_obs:=valid_obs||jsonb_build_array(o);oldest:=least(oldest,(o->>'observed_at')::timestamptz+(b->>'maxAgeDays')::integer*interval '1 day');ids:=array_append(ids,(o->>'id')::uuid);
  end if;
 end loop;
 if trigger_row is null or trigger_row->>'assessment_reviewed_by' is null or not exists(select 1 from public.profiles where id=(trigger_row->>'assessment_reviewed_by')::uuid and is_admin)
  or trigger_row->'product_context'->>'product' is distinct from 'signal' or trigger_row->'product_context'->>'kind' is distinct from 'trigger'
  or jsonb_typeof(trigger_row->'product_context'->'expiresAt') is distinct from 'string' or jsonb_typeof(trigger_row->'product_context'->'relevance') is distinct from 'string' or coalesce(length(trim(trigger_row->'product_context'->>'relevance')),0) not between 1 and 488
  or (trigger_row->>'observed_at')::timestamptz>p_now or coalesce(length(trim(trigger_row->>'assessment_excerpt')),0) not between 1 and 2000 then return false;end if;
 expiry:=date_trunc('milliseconds',least(oldest,(trigger_row->>'observed_at')::timestamptz+interval '30 days',(trigger_row->'product_context'->>'expiresAt')::timestamptz));
 if expiry<=p_now or (p->>'validUntil')::timestamptz is distinct from expiry or (trigger_row->'product_context'->>'expiresAt')::timestamptz<=(trigger_row->>'observed_at')::timestamptz then return false;end if;
 ids:=array_append(ids,signal);
 foreach f in array array['industry','market','role','need'] loop
  vals:='{}';field_ids:='{}';wanted:=case f when 'industry' then 'industries' when 'market' then 'markets' when 'role' then 'roles' else 'needs' end;
  for o in select value from jsonb_array_elements(valid_obs) where value->'assessment_facts' ? f loop
   raw:=lower(trim(o->'assessment_facts'->>f));canonical:=raw;
   for aliases in select * from jsonb_each(coalesce(b->'aliases'->f,'{}')) loop
    if exists(select 1 from jsonb_array_elements_text(aliases.value) v where lower(trim(v))=raw) then canonical:=lower(trim(aliases.key));end if;
   end loop;
   if f='industry' and exists(select 1 from jsonb_array_elements_text(b->'excludedIndustries') v where lower(trim(v))=raw) then return false;end if;
   vals:=array_append(vals,canonical);field_ids:=array_append(field_ids,(o->>'id')::uuid);
  end loop;
  select array_agg(distinct v order by v) into vals from unnest(vals) v;
  if coalesce(cardinality(vals),0)<>1 or not exists(select 1 from jsonb_array_elements_text(b->wanted) v where lower(trim(v))=vals[1]) then return false;end if;
  if f='market' and vals[1] is distinct from lower(setup->'body'->>'market') then return false;end if;
  if f in ('role','need') then
   if p->'strategy'->>(case f when 'role' then 'buyerRole' else 'canonicalNeed' end) is distinct from vals[1] then return false;end if;
   select array_agg(value::uuid order by value::uuid) into expected_ids from jsonb_array_elements_text(p->'claimSources'->(case f when 'role' then 'buyerRole' else 'canonicalNeed' end));
   select array_agg(v order by v) into field_ids from unnest(field_ids) v;
   if expected_ids is distinct from field_ids then return false;end if;
  end if;
 end loop;
 if p->'strategy'->>'cta' is distinct from 'Would a conversation about '||(p->'strategy'->>'canonicalNeed')||' be useful?'
  or p->'message'->>'subject' is distinct from 'A conversation about '||(p->'strategy'->>'canonicalNeed')
  or p->'message'->>'body' is distinct from E'Hello,\n\nI am reaching out about '||(p->'strategy'->>'canonicalNeed')||' for '||(p->'strategy'->>'buyerRole')||E' teams.\n\n'||(p_snapshot->'tenant'->>'name')||'''s reviewed offer: '||(b->>'offer')||E'\n\nWould a conversation about '||(p->'strategy'->>'canonicalNeed')||E' be useful?\n\n'||(p->'sender'->>'name')||E'\nReply stop if you would prefer no further contact.'
  or p->'strategy'->>'offer' is distinct from b->>'offer' or p->'claimSources'->'offer'->>'reference' is distinct from b->'source'->>'reference' or p->'claimSources'->'offer'->>'excerpt' is distinct from b->'source'->>'excerpt' or date_trunc('milliseconds',(p->'claimSources'->'offer'->>'observedAt')::timestamptz) is distinct from date_trunc('milliseconds',(b->'source'->>'observedAt')::timestamptz)
  or p->'strategy'->>'triggerHypothesis' is distinct from 'Hypothesis: '||(trigger_row->'product_context'->>'relevance') then return false;end if;
 select array_agg(distinct v order by v) into ids from unnest(ids) v;
 if jsonb_typeof(p->'evidence') is distinct from 'array' or jsonb_array_length(p->'evidence')<>cardinality(ids) then return false;end if;
 select array_agg((value->>'id')::uuid order by (value->>'id')::uuid) into expected_ids from jsonb_array_elements(p->'evidence');
 if expected_ids is distinct from ids then return false;end if;
 for e in select value from jsonb_array_elements(p->'evidence') loop
  select value into chosen from jsonb_array_elements(p_snapshot->'observations') where value->>'id'=e->>'id';
  if e->>'reference' is distinct from chosen->>'external_ref' or e->>'excerpt' is distinct from chosen->>'assessment_excerpt' or date_trunc('milliseconds',(e->>'observedAt')::timestamptz) is distinct from date_trunc('milliseconds',(chosen->>'observed_at')::timestamptz) then return false;end if;
 end loop;
 return true;
 exception when others then return false;
end $$;
revoke all on function public.signal_binding_valid(uuid,uuid,jsonb,jsonb,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.signal_binding_valid(uuid,uuid,jsonb,jsonb,jsonb,timestamptz) to service_role;

create function public.build_signal_strategy(p_tenant uuid,p_actor uuid,p_input jsonb,p_steps jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare snapshot jsonb; result jsonb; proposal jsonb:=p_input->'proposal';
begin
 if current_user<>'service_role' or p_input->'reviewed' is distinct from 'true'::jsonb or p_input->>'reviewedBy' is distinct from p_actor::text then raise exception 'Reviewed Signal binding required' using errcode='22023';end if;
 snapshot:=public.signal_strategy_context(p_tenant,(proposal->>'leadId')::uuid,p_actor);
 if snapshot is distinct from p_input->'sourceSnapshot' or not public.signal_binding_valid(p_tenant,p_actor,snapshot,proposal,p_steps,now()) then raise exception 'Signal evidence changed or is unsupported' using errcode='40001';end if;
 result:=jsonb_build_object('schemaVersion',1,'proposal',proposal-'preparedAt','sourceSnapshot',snapshot,'steps',p_steps,'reviewedBy',p_actor);
 return result||jsonb_build_object('digest',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
end $$;
revoke all on function public.build_signal_strategy(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.build_signal_strategy(uuid,uuid,jsonb,jsonb) to service_role;

create function public.signal_campaign_strategy_current(p_tenant uuid,p_campaign uuid,p_version integer,p_lead uuid,p_now timestamptz) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare a public.campaign_assets%rowtype; s jsonb; snapshot jsonb; actor uuid;
begin
 select * into a from public.campaign_assets where tenant_id=p_tenant and campaign_id=p_campaign and version=p_version;
 s:=a.signal_strategy;actor:=(s->>'reviewedBy')::uuid;
 if s is null or s->'schemaVersion' is distinct from '1'::jsonb or s->>'digest' is distinct from encode(sha256(convert_to((s-'digest')::text,'UTF8')),'hex')
  or s->'steps' is distinct from a.steps or a.brief_version is distinct from (s->'proposal'->>'briefVersion')::integer or (p_lead is not null and p_lead::text is distinct from s->'proposal'->>'leadId') then return false;end if;
 snapshot:=public.signal_strategy_context(p_tenant,(s->'proposal'->>'leadId')::uuid,actor);
 return snapshot=s->'sourceSnapshot' and public.signal_binding_valid(p_tenant,actor,snapshot,s->'proposal',a.steps,p_now);
 exception when others then return false;
end $$;
revoke all on function public.signal_campaign_strategy_current(uuid,uuid,integer,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.signal_campaign_strategy_current(uuid,uuid,integer,uuid,timestamptz) to service_role;

create function public.guard_signal_asset() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and new.signal_strategy is distinct from old.signal_strategy then raise exception 'Signal binding is immutable' using errcode='23514';end if;
 if tg_op='INSERT' and new.signal_strategy is not null and (not exists(select 1 from public.campaigns where tenant_id=new.tenant_id and id=new.campaign_id and capability='signal')
  or new.signal_strategy->'steps' is distinct from new.steps or new.signal_strategy->>'digest' is distinct from encode(sha256(convert_to((new.signal_strategy-'digest')::text,'UTF8')),'hex')
  or not public.signal_binding_valid(new.tenant_id,(new.signal_strategy->>'reviewedBy')::uuid,new.signal_strategy->'sourceSnapshot',new.signal_strategy->'proposal',new.steps,now())
  or new.signal_strategy->'sourceSnapshot' is distinct from public.signal_strategy_context(new.tenant_id,(new.signal_strategy->'proposal'->>'leadId')::uuid,(new.signal_strategy->>'reviewedBy')::uuid)) then raise exception 'Invalid Signal binding' using errcode='22023';end if;
 return new;
end $$;
revoke all on function public.guard_signal_asset() from public,anon,authenticated;
create trigger immutable_signal_asset before insert or update of signal_strategy on public.campaign_assets for each row execute function public.guard_signal_asset();

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
  select jsonb_agg(id order by message_step) into ids from public.outbound_actions where campaign_id=c.id and lead_id=lead;
  if ids is not null then
   if (p_body->>'startAt')::timestamptz is distinct from (select coalesce(min(schedule_requested_at),min(due_at)) from public.outbound_actions where campaign_id=c.id and lead_id=lead) then raise exception 'An enrolment schedule cannot be replaced by retry' using errcode='40001'; end if;
   if exists(select 1 from public.outbound_actions where campaign_id=c.id and lead_id=lead and asset_version<>c.asset_version) then raise exception 'Existing enrolment cannot restart' using errcode='40001'; end if;
   return jsonb_build_object('actionIds',ids,'replayed',true);
  end if;
  start_time:=(p_body->>'startAt')::timestamptz;
  if c.capability='signal' and not public.signal_campaign_strategy_current(p_tenant,c.id,c.asset_version,lead,start_time) then raise exception 'Signal expires before scheduled execution' using errcode='22023';end if;
  n:=jsonb_array_length(asset.steps);
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

create or replace function public.synthetic_action_allowed(p_id uuid,p_now timestamptz) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.outbound_actions a join public.campaigns c on c.id=a.campaign_id and c.tenant_id=a.tenant_id
 where a.id=p_id and (c.capability<>'signal' or (public.signal_campaign_strategy_current(a.tenant_id,a.campaign_id,a.asset_version,a.lead_id,p_now) and exists(select 1 from public.campaign_assets v where v.tenant_id=a.tenant_id and v.campaign_id=a.campaign_id and v.version=a.asset_version and exists(select 1 from public.profiles reviewer where reviewer.id=v.approved_by and reviewer.is_admin) and v.signal_review->>'digest'=v.signal_strategy->>'digest' and v.signal_review->>'reviewedBy'=v.approved_by::text and v.signal_review->'messageReviewed'='true'::jsonb and v.signal_review->'evidenceReviewed'='true'::jsonb))))
 and ripepiper_private.synthetic_action_allowed(p_id,p_now)
$$;
create or replace function public.guard_signal_execution() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and new is not distinct from old then return new;end if;
 if exists(select 1 from public.campaigns where id=new.campaign_id and tenant_id=new.tenant_id and capability='signal') then
  if new.state='delivered' then raise exception 'Signal live delivery is unavailable' using errcode='22023';end if;
  if new.state='tested' and (tg_op<>'UPDATE' or old.state<>'claimed' or old.dispatch_token is null or new.dispatch_token is distinct from old.dispatch_token
   or new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id or new.campaign_id is distinct from old.campaign_id or new.lead_id is distinct from old.lead_id
   or new.asset_version is distinct from old.asset_version or new.approval_version is distinct from old.approval_version
   or old.lease_until is null or old.lease_until<=now() or new.provider_ref is distinct from 'test-sink:'||new.id::text or new.acknowledged_at is null
   or new.acknowledged_at>old.lease_until or new.acknowledged_at<old.created_at) then raise exception 'Fenced Signal claim receipt required' using errcode='22023';end if;

  if new.state in ('queued','claimed','tested') and (not public.signal_campaign_strategy_current(new.tenant_id,new.campaign_id,new.asset_version,new.lead_id,greatest(now(),new.due_at))
   or not exists(select 1 from public.campaigns c join public.campaign_assets a on a.tenant_id=c.tenant_id and a.campaign_id=c.id and a.version=c.asset_version where c.tenant_id=new.tenant_id and c.id=new.campaign_id and c.status='approved' and c.asset_version=new.asset_version and c.approval_version=new.approval_version and exists(select 1 from public.profiles reviewer where reviewer.id=a.approved_by and reviewer.is_admin) and a.approved_by is not null and a.signal_review->>'digest'=a.signal_strategy->>'digest' and a.signal_review->>'reviewedBy'=a.approved_by::text and a.signal_review->'messageReviewed'='true'::jsonb and a.signal_review->'evidenceReviewed'='true'::jsonb and new.message_step=0 and c.expires_at>greatest(now(),new.due_at))) then raise exception 'Current approved Signal binding required' using errcode='22023';end if;
 end if;
 return new;
end $$;

-- Material source edits invalidate approval immediately. Existing evidence/identity
-- BEFORE triggers serialize these changes on tenant rows. Terminal receipts survive.
create function public.invalidate_signal_strategy() returns trigger language plpgsql security invoker set search_path='' as $$
declare tenant uuid; lead uuid; row_data jsonb; old_data jsonb;
begin
 if tg_op='UPDATE' and new is not distinct from old then return new;end if;
 row_data:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 old_data:=case when tg_op='UPDATE' then to_jsonb(old) else row_data end;
 for tenant in select distinct v from unnest(array[(row_data->>'tenant_id')::uuid,(old_data->>'tenant_id')::uuid]) v where v is not null order by v loop
  perform 1 from public.tenants where id=tenant for update;
  update public.campaigns c set status=case when c.status='approved' then 'draft' else c.status end,approval_version=c.approval_version+1
  where c.tenant_id=tenant and c.capability='signal' and c.status<>'ended' and exists(select 1 from public.campaign_assets a where a.tenant_id=c.tenant_id and a.campaign_id=c.id and a.version=c.asset_version and a.signal_strategy is not null
   and (tg_table_name in ('business_briefs','revive_setups') or a.signal_strategy->'proposal'->>'leadId' in (case when tg_table_name='leads' then row_data->>'id' else row_data->>'lead_id' end,case when tg_table_name='leads' then old_data->>'id' else old_data->>'lead_id' end)));
  update public.outbound_actions a set state=case when a.state='claimed' then 'review' else 'cancelled' end,error_code='signal_binding_changed',lease_until=null
  from public.campaigns c where c.tenant_id=tenant and c.id=a.campaign_id and a.tenant_id=tenant and c.capability='signal' and a.state in ('queued','claimed') and a.approval_version<>c.approval_version;
 end loop;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function public.invalidate_signal_strategy() from public,anon,authenticated;
create trigger signal_evidence_invalidates after insert or update or delete on public.lead_observations for each row execute function public.invalidate_signal_strategy();
create trigger signal_identity_invalidates after update of email,company,status,tenant_id or delete on public.leads for each row execute function public.invalidate_signal_strategy();
create trigger signal_setup_invalidates after insert on public.revive_setups for each row execute function public.invalidate_signal_strategy();
create trigger signal_brief_invalidates after insert on public.business_briefs for each row execute function public.invalidate_signal_strategy();

create function public.guard_signal_review() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.signal_strategy is not null then
  if old.signal_review is not null and new.signal_review is distinct from old.signal_review then raise exception 'Signal approval receipt is immutable; save a new asset version' using errcode='23514';end if;
  if new.approved_by is not null and (new.approved_at is null or new.signal_review->>'reviewedAt' is null or new.approved_at>now() or jsonb_typeof(new.signal_review) is distinct from 'object' or new.signal_review->>'digest' is distinct from new.signal_strategy->>'digest'
   or new.signal_review->>'reviewedBy' is distinct from new.approved_by::text or new.signal_review->'messageReviewed' is distinct from 'true'::jsonb or new.signal_review->'evidenceReviewed' is distinct from 'true'::jsonb
   or (new.signal_review->>'reviewedAt')::timestamptz is distinct from new.approved_at
   or not exists(select 1 from public.profiles where id=new.approved_by and is_admin)
   or not public.signal_campaign_strategy_current(new.tenant_id,new.campaign_id,new.version,null,now())) then raise exception 'Exact current Signal approval receipt required' using errcode='22023';end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_signal_review() from public,anon,authenticated;
create trigger signal_review_receipt before update of approved_by,approved_at,signal_review on public.campaign_assets for each row execute function public.guard_signal_review();

-- Extend existing authority serialization to Signal; no new callable definer.
create or replace function public.lock_revive_reviewer() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' or new.is_admin is distinct from old.is_admin then
  perform 1 from public.tenants t where
   exists(select 1 from public.revive_reviews r where r.tenant_id=t.id and r.reviewer_id=old.id)
   or exists(select 1 from public.revive_setups s where s.tenant_id=t.id and s.version=(select max(version) from public.revive_setups where tenant_id=t.id) and (s.created_by=old.id or s.body->>'ownerId'=old.id::text))
   or exists(select 1 from public.campaign_assets a join public.campaigns c on c.tenant_id=a.tenant_id and c.id=a.campaign_id and c.asset_version=a.version where a.tenant_id=t.id and (to_jsonb(a)->'revive_strategy'->>'reviewedBy'=old.id::text or a.signal_strategy->>'reviewedBy'=old.id::text or a.signal_review->>'reviewedBy'=old.id::text or exists(select 1 from jsonb_array_elements(coalesce(a.signal_strategy->'sourceSnapshot'->'observations','[]')) o where o->>'assessment_reviewed_by'=old.id::text)))
   order by t.id for update;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;

-- Extend existing authority serialization to Signal; no new callable definer.
create or replace function ripepiper_private.lock_revive_auth_authority() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_schema<>'auth' or tg_table_name<>'users' or tg_op not in ('UPDATE','DELETE') then raise exception 'Auth trigger context required' using errcode='42501';end if;
 if tg_op='UPDATE' and new.email_confirmed_at is not distinct from old.email_confirmed_at then return new;end if;
 perform 1 from public.tenants t where
  exists(select 1 from public.revive_reviews r where r.tenant_id=t.id and r.reviewer_id=old.id)
  or exists(select 1 from public.revive_setups s where s.tenant_id=t.id and s.version=(select max(version) from public.revive_setups where tenant_id=t.id) and (s.created_by=old.id or s.body->>'ownerId'=old.id::text))
  or exists(select 1 from public.campaign_assets a join public.campaigns c on c.tenant_id=a.tenant_id and c.id=a.campaign_id and c.asset_version=a.version where a.tenant_id=t.id and (to_jsonb(a)->'revive_strategy'->>'reviewedBy'=old.id::text or a.signal_strategy->>'reviewedBy'=old.id::text or a.signal_review->>'reviewedBy'=old.id::text or exists(select 1 from jsonb_array_elements(coalesce(a.signal_strategy->'sourceSnapshot'->'observations','[]')) o where o->>'assessment_reviewed_by'=old.id::text)))
  order by t.id for update;
 if tg_op='DELETE' then return old;end if;return new;
end $$;

-- AFTER validation sees newly inserted rows and reuses every inherited contact,
-- rights, reply, suppression and stop predicate without duplicating that policy.
create function public.guard_signal_action_eligibility() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.state in ('queued','claimed','tested') and exists(select 1 from public.campaigns where id=new.campaign_id and tenant_id=new.tenant_id and capability='signal')
  and not public.synthetic_action_allowed(new.id,greatest(now(),new.due_at)) then raise exception 'Current Signal contact rights and execution policy required' using errcode='22023';end if;
 return new;
end $$;
revoke all on function public.guard_signal_action_eligibility() from public,anon,authenticated;
create trigger signal_action_current_policy after insert or update on public.outbound_actions for each row execute function public.guard_signal_action_eligibility();
