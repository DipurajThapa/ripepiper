-- Fenced acknowledgement on the existing ledger. No real provider is activated.
-- The receipt proves only a local test sink accepted an exact action/version/claim.
alter table public.outbound_actions
 add column dispatch_token uuid,
 add column acknowledged_at timestamptz;

-- Preserve old callers for old claims, but never let them complete a fenced claim.
create or replace function public.complete_synthetic_action(p_id uuid, p_now timestamptz) returns boolean
language plpgsql security invoker set search_path='' as $$
declare a public.outbound_actions%rowtype;
begin
 if current_user<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 select * into a from public.outbound_actions where id=p_id;
 if not found then return false; end if;
 perform 1 from public.tenants where id=a.tenant_id for update;
 perform 1 from public.campaigns where id=a.campaign_id and tenant_id=a.tenant_id for update;
 select * into a from public.outbound_actions where id=p_id for update skip locked;
 if not found or a.dispatch_token is not null or a.state<>'claimed' or p_now is null
  or a.lease_until is null or a.lease_until<=p_now then return false; end if;
 if not public.synthetic_action_allowed(a.id,p_now) then
  update public.outbound_actions set state='blocked',error_code='eligibility_or_authority_changed',lease_until=null where id=a.id;
  return false;
 end if;
 update public.outbound_actions set state='tested',provider_ref='test-sink:'||a.id::text,lease_until=null where id=a.id;
 return true;
end $$;
revoke all on function public.complete_synthetic_action(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.complete_synthetic_action(uuid,timestamptz) to service_role;

create function public.claim_fenced_synthetic_action(p_tenant uuid,p_id uuid,p_token uuid,p_now timestamptz) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a public.outbound_actions%rowtype;
begin
 if current_user<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 select * into a from public.outbound_actions where id=p_id and tenant_id=p_tenant;
 if not found or p_token is null or a.dispatch_token is not null then return null; end if;
 -- Existing implementation holds tenant/campaign/action locks through this transaction.
 if not public.claim_synthetic_action(p_id,p_now) then return null; end if;
 update public.outbound_actions set dispatch_token=p_token where id=p_id and tenant_id=p_tenant returning * into a;
 return jsonb_build_object('token',p_token,'approvalVersion',a.approval_version,'assetVersion',a.asset_version);
end $$;
revoke all on function public.claim_fenced_synthetic_action(uuid,uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.claim_fenced_synthetic_action(uuid,uuid,uuid,timestamptz) to service_role;

create function public.complete_fenced_synthetic_action(p_tenant uuid,p_id uuid,p_token uuid,p_approval integer,p_asset integer,p_now timestamptz) returns boolean
language plpgsql security invoker set search_path='' as $$
declare a public.outbound_actions%rowtype;
begin
 if current_user<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 select * into a from public.outbound_actions where id=p_id and tenant_id=p_tenant;
 if not found then return false; end if;
 perform 1 from public.tenants where id=p_tenant for update;
 perform 1 from public.campaigns where id=a.campaign_id and tenant_id=p_tenant for update;
 select * into a from public.outbound_actions where id=p_id and tenant_id=p_tenant for update skip locked;
 if not found or p_token is null or a.dispatch_token is distinct from p_token
  or a.approval_version is distinct from p_approval or a.asset_version is distinct from p_asset then return false; end if;
 -- Replay reports the old receipt only; it does not execute another sink operation.
 if a.state='tested' and a.acknowledged_at is not null
  and a.provider_ref='test-sink:'||a.id::text then return true; end if;
 if a.state<>'claimed' or p_now is null or a.lease_until is null or a.lease_until<=p_now then return false; end if;
 if not public.synthetic_action_allowed(a.id,p_now) then
  update public.outbound_actions set state='blocked',error_code='eligibility_or_authority_changed',lease_until=null where id=a.id;
  return false;
 end if;
 update public.outbound_actions set state='tested',provider_ref='test-sink:'||a.id::text,
  acknowledged_at=p_now,lease_until=null,error_code=null where id=a.id;
 return true;
end $$;
revoke all on function public.complete_fenced_synthetic_action(uuid,uuid,uuid,integer,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.complete_fenced_synthetic_action(uuid,uuid,uuid,integer,integer,timestamptz) to service_role;

create function public.expire_fenced_synthetic_action(p_tenant uuid,p_id uuid,p_token uuid,p_now timestamptz) returns boolean
language plpgsql security invoker set search_path='' as $$
declare a public.outbound_actions%rowtype;
begin
 if current_user<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 if p_now is null or p_token is null then return false; end if;
 select * into a from public.outbound_actions where id=p_id and tenant_id=p_tenant;
 if not found then return false; end if;
 perform 1 from public.tenants where id=p_tenant for update;
 perform 1 from public.campaigns where id=a.campaign_id and tenant_id=p_tenant for update;
 select * into a from public.outbound_actions where id=p_id and tenant_id=p_tenant for update;
 if not found or a.dispatch_token is distinct from p_token or a.state<>'claimed' then return false; end if;
 -- A failed response is uncertain even before the lease expires. Never requeue it.
 update public.outbound_actions set state='review',error_code='uncertain_result',lease_until=null where id=a.id;
 update public.campaigns set status='paused' where id=a.campaign_id and tenant_id=p_tenant and status='approved';
 return true;
end $$;
revoke all on function public.expire_fenced_synthetic_action(uuid,uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.expire_fenced_synthetic_action(uuid,uuid,uuid,timestamptz) to service_role;
