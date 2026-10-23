-- Staff emergency pause. This revokes local ad-account connection state; external
-- provider tokens/grants still require an operator-managed revocation workflow.
grant update (status) on public.tenants to service_role;
grant select, update (status) on public.ad_accounts to service_role;
create function public.pause_tenant_execution(p_tenant_id uuid, p_reason text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare t public.tenants%rowtype;
begin
  if current_user <> 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  if p_reason is null or length(trim(p_reason)) < 8 or length(p_reason) > 500 then return false; end if;
  select * into t from public.tenants where id=p_tenant_id for update;
  if not found or t.status='ended' then return false; end if;
  if t.status <> 'paused' then update public.tenants set status='paused' where id=p_tenant_id; end if;
  update public.campaigns set status='paused' where tenant_id=p_tenant_id and status='approved';
  update public.outbound_actions set state='cancelled', error_code='tenant_paused'
    where tenant_id=p_tenant_id and state='queued';
  update public.outbound_actions set state='review', error_code='uncertain_at_tenant_pause', lease_until=null
    where tenant_id=p_tenant_id and state='claimed';
  update public.ad_accounts set status='disconnected' where tenant_id=p_tenant_id and status<>'disconnected';
  if not exists (select 1 from public.outbound_stops where scope='tenant' and tenant_id=p_tenant_id and lifted_at is null) then
    insert into public.outbound_stops (scope, tenant_id, reason)
      values ('tenant', p_tenant_id, trim(p_reason));
  end if;
  return true;
end $$;
revoke all on function public.pause_tenant_execution(uuid,text) from public, anon, authenticated;
grant execute on function public.pause_tenant_execution(uuid,text) to service_role;

-- Direct admin table writes cannot reconnect an ad account or approve a
-- campaign for a paused/ended tenant without a separate activation decision.
create function public.guard_tenant_execution_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (tg_table_name='ad_accounts' and new.status='connected') or
     (tg_table_name='campaigns' and new.status='approved') then
    if not exists (select 1 from public.tenants where id=new.tenant_id and status='active') then
      raise exception 'Tenant is not active for execution' using errcode='23514';
    end if;
  end if;
  return new;
end $$;
create trigger ad_account_active_tenant before insert or update of status,tenant_id on public.ad_accounts
for each row execute function public.guard_tenant_execution_status();
create trigger campaign_active_tenant before insert or update of status,tenant_id on public.campaigns
for each row execute function public.guard_tenant_execution_status();
