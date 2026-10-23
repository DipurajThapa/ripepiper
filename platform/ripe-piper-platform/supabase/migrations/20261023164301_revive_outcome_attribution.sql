-- Attribute reviewed Revive outcomes to an exact acknowledged action, never infer causality.
-- Legacy/pre-campaign decisions remain unlinked and are displayed as unattributed.
-- No provider, scheduler, permission grant or production seed is introduced.
create function public.guard_revive_outcome_attribution() returns trigger
language plpgsql security invoker set search_path='' as $$
declare a public.outbound_actions%rowtype; email text; campaign uuid; action uuid;
begin
 if tg_op in ('UPDATE','DELETE') and old.product_context->>'product'='revive' and old.product_context->>'kind'='outcome' then
  if tg_op='DELETE' or new is distinct from old then
   raise exception 'Revive outcomes are append-only; record a dated correction' using errcode='23514';
  end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 if new.product_context->>'product' is distinct from 'revive' or new.product_context->>'kind' is distinct from 'outcome' then return new; end if;
 if not (new.product_context ? 'campaignId') and not (new.product_context ? 'actionId') then return new; end if;
 if current_user<>'service_role' or not exists(select 1 from public.profiles where id=new.assessment_reviewed_by and is_admin) then
  raise exception 'Staff service attribution required' using errcode='42501';
 end if;
 if tg_op='UPDATE' then raise exception 'Append a new reviewed attribution' using errcode='23514'; end if;
 if jsonb_typeof(new.product_context->'campaignId') is distinct from 'string' or jsonb_typeof(new.product_context->'actionId') is distinct from 'string'
  or coalesce(new.product_context->>'campaignId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or coalesce(new.product_context->>'actionId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or coalesce(new.product_context->>'outcome','') not in ('accepted','rejected','qualified_conversation','meeting_held','opportunity','won','lost')
  or jsonb_typeof(new.product_context->'reason') is distinct from 'string' or coalesce(length(trim(new.product_context->>'reason')),0) not between 1 and 500 then
  raise exception 'Paired campaign/action identity and reviewed outcome required' using errcode='22023';
 end if;
 campaign:=(new.product_context->>'campaignId')::uuid;action:=(new.product_context->>'actionId')::uuid;
 -- The tenant lock matches campaign queue/claim/completion serialization.
 perform 1 from public.tenants where id=new.tenant_id for update;
 select oa.* into a from public.outbound_actions oa join public.campaigns c on c.id=oa.campaign_id and c.tenant_id=oa.tenant_id
  where oa.id=action and oa.campaign_id=campaign and oa.tenant_id=new.tenant_id and oa.lead_id=new.lead_id and c.capability='revive';
 select l.email into email from public.leads l where l.id=new.lead_id and l.tenant_id=new.tenant_id;
 if a.id is null or email is null or new.synthetic is null or new.synthetic<>(lower(email) like '%.invalid')
  or new.observed_at is null or new.observed_at>now() or a.acknowledged_at is null or new.observed_at<a.acknowledged_at
  or a.dispatch_token is null or a.acknowledged_at<a.due_at
  or not exists(select 1 from public.campaign_assets ca where ca.tenant_id=new.tenant_id and ca.campaign_id=campaign
    and ca.version=a.asset_version and ca.approved_by is not null and ca.approved_at<=a.acknowledged_at)
  or (new.synthetic and (a.state<>'tested' or a.provider_ref is distinct from 'test-sink:'||a.id::text))
  or (not new.synthetic and (a.state<>'delivered' or coalesce(length(trim(a.provider_ref)),0)=0 or a.provider_ref like 'test-sink:%')) then
  raise exception 'Outcome attribution requires this contact and mode exact acknowledged action and time' using errcode='22023';
 end if;
 return new;
end $$;
revoke all on function public.guard_revive_outcome_attribution() from public,anon,authenticated;
create trigger guard_revive_outcome_attribution before insert or update or delete on public.lead_observations
for each row execute function public.guard_revive_outcome_attribution();
