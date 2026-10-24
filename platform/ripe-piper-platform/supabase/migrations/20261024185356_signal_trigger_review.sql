-- Bind new Signal outcomes to one reviewed trigger; preserve legacy history.
-- No new provider, permission, campaign engine or existing-row mutation.
create function public.guard_signal_evidence() returns trigger
language plpgsql security invoker set search_path='' as $$
declare source public.lead_observations%rowtype; source_id uuid;
begin
 if tg_op='UPDATE' and old.product_context->>'product'='signal'
  and (old.product_context->>'kind'='trigger' or old.product_context ? 'signalId') and new is distinct from old then
  raise exception 'Signal evidence is append-only; record a dated correction' using errcode='23514';
 end if;
 if new.product_context ? 'signalId' and (new.product_context->>'product' is distinct from 'signal' or new.product_context->>'kind' is distinct from 'outcome') then
  raise exception 'Signal identity belongs only to a Signal outcome' using errcode='22023';
 end if;
 if new.product_context->>'product' is distinct from 'signal' or new.product_context->>'kind' is distinct from 'outcome' then return new;end if;
 if tg_op='UPDATE' and new is not distinct from old then return new;end if;
 if current_user<>'service_role' or not exists(select 1 from public.profiles where id=new.assessment_reviewed_by and is_admin) then
  raise exception 'Staff service attribution required' using errcode='42501';
 end if;
 if tg_op='UPDATE' then raise exception 'Append a new reviewed Signal outcome' using errcode='23514';end if;
 if jsonb_typeof(new.product_context->'signalId') is distinct from 'string'
  or coalesce(new.product_context->>'signalId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or coalesce(new.product_context->>'outcome','') not in ('accepted','rejected','qualified_conversation','meeting_held','opportunity','won','lost')
  or jsonb_typeof(new.product_context->'reason') is distinct from 'string'
  or coalesce(length(trim(new.product_context->>'reason')),0) not between 1 and 500 then
  raise exception 'Reviewed Signal trigger identity and outcome reason required' using errcode='22023';
 end if;
 source_id:=(new.product_context->>'signalId')::uuid;
 -- Match the existing tenant serialization boundary and lock the source until commit.
 perform 1 from public.tenants where id=new.tenant_id for update;
 select * into source from public.lead_observations where id=source_id and tenant_id=new.tenant_id and lead_id=new.lead_id
  and synthetic=new.synthetic and assessment_reviewed_by is not null
  and product_context->>'product'='signal' and product_context->>'kind'='trigger' for key share;
 if not found or source.id=new.id or new.observed_at is null or new.observed_at>now() or source.observed_at>new.observed_at then
  raise exception 'Signal outcome requires its reviewed trigger, contact, mode and observation time' using errcode='22023';
 end if;
 return new;
end $$;
revoke all on function public.guard_signal_evidence() from public,anon,authenticated;
create trigger guard_signal_evidence before insert or update on public.lead_observations
for each row execute function public.guard_signal_evidence();
-- Existing authorized erasure/deletion paths are unchanged. Missing source records
-- are displayed as unattributed by the review model; no historical backfill is run.

-- Preserve the established Revive/provider safety predicate without duplicating it.
-- Its former entry point remains the sole callable eligibility path for shared jobs.
alter function public.synthetic_action_allowed(uuid,timestamptz) set schema ripepiper_private;
revoke all on function ripepiper_private.synthetic_action_allowed(uuid,timestamptz) from public,anon,authenticated;
grant usage on schema ripepiper_private to service_role;
grant execute on function ripepiper_private.synthetic_action_allowed(uuid,timestamptz) to service_role;
create function public.synthetic_action_allowed(p_id uuid,p_now timestamptz) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.outbound_actions a join public.campaigns c on c.id=a.campaign_id and c.tenant_id=a.tenant_id
   where a.id=p_id and c.capability<>'signal')
   and ripepiper_private.synthetic_action_allowed(p_id,p_now)
$$;
revoke all on function public.synthetic_action_allowed(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.synthetic_action_allowed(uuid,timestamptz) to service_role;

create function public.guard_signal_execution() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and new is not distinct from old then return new;end if;
 if new.state in ('queued','claimed','tested','delivered') and exists(
  select 1 from public.campaigns c where c.id=new.campaign_id and c.tenant_id=new.tenant_id and c.capability='signal') then
  raise exception 'Signal execution requires a trigger-bound reviewed strategy; currently unavailable' using errcode='22023';
 end if;
 return new;
end $$;
revoke all on function public.guard_signal_execution() from public,anon,authenticated;
create trigger guard_signal_execution before insert or update on public.outbound_actions
for each row execute function public.guard_signal_execution();
