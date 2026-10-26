-- RP-020 EGM correction: SQL fit, exact approver and fenced synthetic receipts.
-- Forward/local-only migration. No seeds, provider calls or live activation.
create function public.revive_fit_current(p_tenant uuid,p_lead uuid,p_now timestamptz) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare b jsonb; version integer; email text; current_obs jsonb:='[]'; o public.lead_observations%rowtype; fact jsonb; f text; wanted text; raw text; canonical text; vals text[]; aliases record;
begin
 select body,bv.version into b,version from public.business_briefs bv where tenant_id=p_tenant order by bv.version desc limit 1;
 select l.email into email from public.leads l where l.tenant_id=p_tenant and l.id=p_lead;
 if email is null or p_now is null or not public.revive_setup_brief_valid(b,p_now) or not public.campaign_brief_current(p_tenant,version,p_now)
  or (select count(*) from public.lead_observations where tenant_id=p_tenant and lead_id=p_lead)>=1000 then return false;end if;
 for o in select * from public.lead_observations where tenant_id=p_tenant and lead_id=p_lead and synthetic=(lower(email) like '%.invalid') and assessment_reviewed_by is not null
  and observed_at<=p_now and observed_at>=p_now-(b->>'maxAgeDays')::integer*interval '1 day' loop
  if length(o.assessment_excerpt) between 1 and 2000 and public.signal_facts_valid(o.assessment_facts,o.assessment_excerpt) and not exists(select 1 from jsonb_each_text(o.assessment_facts) f where length(f.value) not between 1 and 100) then
   if coalesce(length(trim(o.rights_reference)),0)=0
    or o.assessment_excerpt ~* E'\\m(no|not|never|without|neither|denied|unknown|uncertain|maybe|might|possibly|former|previously|competitor|hypothetical|example)\\M|n[''’]t\\M|\\?' then return false;end if;
   current_obs:=current_obs||jsonb_build_array(o.assessment_facts);
  end if;
 end loop;
 foreach f in array array['industry','market','role','need'] loop
  vals:='{}';wanted:=case f when 'industry' then 'industries' when 'market' then 'markets' when 'role' then 'roles' else 'needs' end;
  for fact in select value from jsonb_array_elements(current_obs) where value ? f loop
   raw:=lower(trim(fact->>f));canonical:=raw;
   for aliases in select * from jsonb_each(coalesce(b->'aliases'->f,'{}')) loop
    if exists(select 1 from jsonb_array_elements_text(aliases.value) v where lower(trim(v))=raw) then canonical:=lower(trim(aliases.key));end if;
   end loop;
   if f='industry' and exists(select 1 from jsonb_array_elements_text(b->'excludedIndustries') v where lower(trim(v))=raw) then return false;end if;
   vals:=array_append(vals,canonical);
  end loop;
  select array_agg(distinct v order by v) into vals from unnest(vals) v;
  if coalesce(cardinality(vals),0)<>1 or not exists(select 1 from jsonb_array_elements_text(b->wanted) v where lower(trim(v))=vals[1]) then return false;end if;
 end loop;
 return true;
 exception when others then return false;
end $$;
revoke all on function public.revive_fit_current(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.revive_fit_current(uuid,uuid,timestamptz) to service_role;

create function public.guard_revive_review_fit() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.tenants where id=new.tenant_id for update;
 if new.state='accepted' and not public.revive_fit_current(new.tenant_id,new.lead_id,now()) then raise exception 'Current reviewed Revive fit required' using errcode='22023';end if;
 return new;
end $$;
revoke all on function public.guard_revive_review_fit() from public,anon,authenticated;
create trigger revive_review_fit_guard before insert or update on public.revive_reviews for each row execute function public.guard_revive_review_fit();

create or replace function public.revive_candidate_current(p_tenant uuid,p_lead uuid,p_now timestamptz) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.revive_reviews r join public.leads l on l.tenant_id=r.tenant_id and l.id=r.lead_id
  where r.tenant_id=p_tenant and r.lead_id=p_lead and r.state='accepted' and r.expires_at>p_now and r.reviewed_at<=p_now
  and r.snapshot=public.revive_input_snapshot(p_tenant,p_lead)
  and public.revive_fit_current(p_tenant,p_lead,p_now) and public.campaign_brief_current(p_tenant,r.brief_version,p_now) and public.revive_history_current(p_tenant,p_lead,p_now)
  and (select count(*) from public.lead_observations o where o.tenant_id=p_tenant and o.lead_id=p_lead)<1000
  and exists(select 1 from public.profiles p where p.id=r.reviewer_id and p.is_admin)
  and l.status<>'unsubscribed'
  and not exists(select 1 from public.suppression s where s.email=lower(l.email))
  and not exists(select 1 from public.lead_suppression s where s.tenant_id=p_tenant and s.lead_id=p_lead)
  and not exists(select 1 from public.lead_observations o where o.tenant_id=p_tenant and o.lead_id=p_lead
   and o.product_context->>'product'='response' and o.product_context->>'kind' in ('enquiry','reply')))
$$;
revoke all on function public.revive_candidate_current(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.revive_candidate_current(uuid,uuid,timestamptz) to service_role;

create or replace function public.synthetic_action_allowed(p_id uuid,p_now timestamptz) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.outbound_actions a join public.campaigns c on c.id=a.campaign_id and c.tenant_id=a.tenant_id
 where a.id=p_id and (c.capability<>'signal' or (public.signal_campaign_strategy_current(a.tenant_id,a.campaign_id,a.asset_version,a.lead_id,p_now) and exists(select 1 from public.campaign_assets v where v.tenant_id=a.tenant_id and v.campaign_id=a.campaign_id and v.version=a.asset_version and exists(select 1 from public.profiles reviewer where reviewer.id=v.approved_by and reviewer.is_admin) and v.signal_review->>'digest'=v.signal_strategy->>'digest' and v.signal_review->>'reviewedBy'=v.approved_by::text and v.signal_review->'messageReviewed'='true'::jsonb and v.signal_review->'evidenceReviewed'='true'::jsonb))))
 and exists(select 1 from public.outbound_actions a join public.campaigns c on c.id=a.campaign_id and c.tenant_id=a.tenant_id where a.id=p_id and (c.capability<>'revive' or exists(select 1 from public.campaign_assets v join public.profiles p on p.id=v.approved_by and p.is_admin join auth.users u on u.id=p.id and u.email_confirmed_at is not null where v.tenant_id=a.tenant_id and v.campaign_id=a.campaign_id and v.version=a.asset_version)))
 and ripepiper_private.synthetic_action_allowed(p_id,p_now)
$$;

create or replace function public.revive_slot_authority_current(p_tenant uuid,p_campaign uuid,p_version integer,p_lead uuid,p_at timestamptz) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.campaigns c join public.campaign_assets a on a.tenant_id=c.tenant_id and a.campaign_id=c.id and a.version=c.asset_version
  join public.tenants t on t.id=c.tenant_id join public.leads l on l.tenant_id=t.id and l.id=p_lead
  where c.tenant_id=p_tenant and c.id=p_campaign and c.asset_version=p_version and c.capability='revive' and c.status='approved'
   and c.operator_id=(a.revive_strategy->>'ownerId')::uuid
   and t.status='active' and a.approved_by is not null and exists(select 1 from public.profiles p join auth.users u on u.id=p.id and u.email_confirmed_at is not null where p.id=a.approved_by and p.is_admin) and c.expires_at>p_at and (c.starts_at is null or c.starts_at<=p_at) and (c.ends_at is null or c.ends_at>p_at)
   and public.revive_campaign_strategy_current(p_tenant,p_campaign,p_version,p_lead,p_at)
   and lower(l.email) like '%.invalid' and l.status<>'unsubscribed'
   and not exists(select 1 from public.outbound_stops s where s.lifted_at is null and (s.scope='global' or s.tenant_id=p_tenant and (s.scope='tenant' or s.campaign_id=p_campaign)))
   and exists(select 1 from public.contact_rights r where r.tenant_id=p_tenant and r.lead_id=p_lead and r.purpose=c.purpose and r.channel=c.channel and r.market=c.market
    and r.decision='permitted' and r.reviewer_id is not null and r.notice_reference is not null and r.objected_at is null and r.withdrawn_at is null and (r.expires_at is null or r.expires_at>p_at)))
$$;
revoke all on function public.revive_slot_authority_current(uuid,uuid,integer,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.revive_slot_authority_current(uuid,uuid,integer,uuid,timestamptz) to service_role;

create function public.guard_revive_execution_receipt() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and old.state='tested' and exists(select 1 from public.campaigns where id=old.campaign_id and tenant_id=old.tenant_id and capability='revive') then
  if new.state is distinct from old.state or new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id or new.campaign_id is distinct from old.campaign_id or new.lead_id is distinct from old.lead_id
   or new.dispatch_token is distinct from old.dispatch_token or new.asset_version is distinct from old.asset_version or new.approval_version is distinct from old.approval_version
   or new.message_step is distinct from old.message_step or new.due_at is distinct from old.due_at or new.provider_ref is distinct from old.provider_ref or new.acknowledged_at is distinct from old.acknowledged_at then raise exception 'Revive terminal receipt is immutable' using errcode='23514';end if;
  return new;
 end if;
 if exists(select 1 from public.campaigns where id=new.campaign_id and tenant_id=new.tenant_id and capability='revive') then
  if new.state='claimed' then
   if tg_op<>'UPDATE' or old.state not in ('queued','claimed') or new.lease_until is null then raise exception 'Queued Revive claim required' using errcode='22023';end if;
   -- Two-minute RPC lease plus at most one minute of synthetic clock tolerance.
   if old.state='queued' and (old.attempts>=3 or new.attempts<>old.attempts+1 or new.dispatch_token is not null or not isfinite(new.lease_until) or new.lease_until>greatest(now(),new.due_at)+interval '3 minutes' or new.lease_until<=greatest(now(),new.due_at)) then raise exception 'Bounded Revive claim required' using errcode='22023';end if;
   if old.state='claimed' and (new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id or new.campaign_id is distinct from old.campaign_id or new.lead_id is distinct from old.lead_id or new.asset_version is distinct from old.asset_version or new.approval_version is distinct from old.approval_version or new.message_step is distinct from old.message_step or new.due_at is distinct from old.due_at or new.attempts is distinct from old.attempts or new.lease_until is distinct from old.lease_until or (old.dispatch_token is not null and new.dispatch_token is distinct from old.dispatch_token)) then raise exception 'Revive claim fence is immutable' using errcode='22023';end if;
  end if;
  if new.state='delivered' then raise exception 'Revive live delivery is unavailable' using errcode='22023';end if;
  if new.state='tested' and (tg_op<>'UPDATE' or old.state<>'claimed' or old.dispatch_token is null or new.dispatch_token is distinct from old.dispatch_token
   or new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id or new.campaign_id is distinct from old.campaign_id or new.lead_id is distinct from old.lead_id
   or new.asset_version is distinct from old.asset_version or new.approval_version is distinct from old.approval_version or new.message_step is distinct from old.message_step or new.due_at is distinct from old.due_at
   or old.lease_until is null or old.lease_until<=now() or new.provider_ref is distinct from 'test-sink:'||new.id::text or new.acknowledged_at is null
   or new.acknowledged_at>old.lease_until or new.acknowledged_at<greatest(old.created_at,old.due_at)) then raise exception 'Fenced Revive claim receipt required' using errcode='22023';end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_revive_execution_receipt() from public,anon,authenticated;
create trigger revive_execution_receipt_guard before insert or update on public.outbound_actions for each row execute function public.guard_revive_execution_receipt();

create function public.guard_revive_action_policy() returns trigger
language plpgsql security invoker set search_path='' as $$
declare policy jsonb;
begin
 if tg_op='UPDATE' and old.state='tested' and new.state='tested' then return new;end if;
 if exists(select 1 from public.campaigns where id=new.campaign_id and tenant_id=new.tenant_id and capability='revive') then
  if new.state='queued' then
   -- Queue reserves future steps before predecessors have completed. Reuse the
   -- existing slot authority; ordering/readiness belongs to claim/completion.
   select revive_strategy->'schedule' into policy from public.campaign_assets where tenant_id=new.tenant_id and campaign_id=new.campaign_id and version=new.asset_version;
   if not public.revive_slot_authority_current(new.tenant_id,new.campaign_id,new.asset_version,new.lead_id,greatest(now(),new.due_at))
    or not public.revive_candidate_current(new.tenant_id,new.lead_id,greatest(now(),new.due_at))
    or not public.revive_campaign_audience_current(new.tenant_id,new.campaign_id,new.asset_version,new.lead_id,greatest(now(),new.due_at))
    or not public.revive_in_working_window(new.due_at,policy) or not public.revive_daily_capacity_available(new.tenant_id,new.lead_id,new.due_at,policy)
    or not exists(select 1 from public.revive_reviews r where r.tenant_id=new.tenant_id and r.lead_id=new.lead_id and r.version=new.revive_review_version and r.snapshot=new.revive_review_snapshot)
    or not exists(select 1 from public.campaigns c join public.campaign_assets a on a.tenant_id=c.tenant_id and a.campaign_id=c.id and a.version=c.asset_version where c.tenant_id=new.tenant_id and c.id=new.campaign_id and c.asset_version=new.asset_version and c.approval_version=new.approval_version and new.message_step<jsonb_array_length(a.steps)) then raise exception 'Current Revive slot policy required' using errcode='22023';end if;
  elsif new.state in ('claimed','tested') then
   if not public.synthetic_action_allowed(new.id,greatest(now(),new.due_at)) or (select count(*) from public.outbound_actions where campaign_id=new.campaign_id and state in ('claimed','tested','delivered'))>(select max_actions from public.campaigns where id=new.campaign_id) then raise exception 'Current Revive contact rights and execution policy required' using errcode='22023';end if;
  end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_revive_action_policy() from public,anon,authenticated;
create trigger revive_action_current_policy after insert or update on public.outbound_actions for each row execute function public.guard_revive_action_policy();

-- Extend existing authority serialization to the actual Revive message approver.
create or replace function public.lock_revive_reviewer() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' or new.is_admin is distinct from old.is_admin then
  perform 1 from public.tenants t where
   exists(select 1 from public.revive_reviews r where r.tenant_id=t.id and r.reviewer_id=old.id)
   or exists(select 1 from public.revive_setups s where s.tenant_id=t.id and s.version=(select max(version) from public.revive_setups where tenant_id=t.id) and (s.created_by=old.id or s.body->>'ownerId'=old.id::text))
   or exists(select 1 from public.campaign_assets a join public.campaigns c on c.tenant_id=a.tenant_id and c.id=a.campaign_id and c.asset_version=a.version where a.tenant_id=t.id and (to_jsonb(a)->'revive_strategy'->>'reviewedBy'=old.id::text or (c.capability='revive' and a.approved_by=old.id) or a.signal_strategy->>'reviewedBy'=old.id::text or a.signal_review->>'reviewedBy'=old.id::text or exists(select 1 from jsonb_array_elements(coalesce(a.signal_strategy->'sourceSnapshot'->'observations','[]')) o where o->>'assessment_reviewed_by'=old.id::text)))
   order by t.id for update;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;

-- Extend existing authority serialization to the actual Revive message approver.
create or replace function ripepiper_private.lock_revive_auth_authority() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_schema<>'auth' or tg_table_name<>'users' or tg_op not in ('UPDATE','DELETE') then raise exception 'Auth trigger context required' using errcode='42501';end if;
 if tg_op='UPDATE' and new.email_confirmed_at is not distinct from old.email_confirmed_at then return new;end if;
 perform 1 from public.tenants t where
  exists(select 1 from public.revive_reviews r where r.tenant_id=t.id and r.reviewer_id=old.id)
  or exists(select 1 from public.revive_setups s where s.tenant_id=t.id and s.version=(select max(version) from public.revive_setups where tenant_id=t.id) and (s.created_by=old.id or s.body->>'ownerId'=old.id::text))
  or exists(select 1 from public.campaign_assets a join public.campaigns c on c.tenant_id=a.tenant_id and c.id=a.campaign_id and c.asset_version=a.version where a.tenant_id=t.id and (to_jsonb(a)->'revive_strategy'->>'reviewedBy'=old.id::text or (c.capability='revive' and a.approved_by=old.id) or a.signal_strategy->>'reviewedBy'=old.id::text or a.signal_review->>'reviewedBy'=old.id::text or exists(select 1 from jsonb_array_elements(coalesce(a.signal_strategy->'sourceSnapshot'->'observations','[]')) o where o->>'assessment_reviewed_by'=old.id::text)))
  order by t.id for update;
 if tg_op='DELETE' then return old;end if;return new;
end $$;

