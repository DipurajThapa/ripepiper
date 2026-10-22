-- M04 controlled execution: tenant-scoped approval and durable action ledger.
-- These functions can only claim a synthetic .invalid destination into a local test sink.
-- They do not send messages and cannot activate a real provider.
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  capability text not null check (capability in ('revive','signal','response','events')),
  operator_id uuid not null references public.profiles(id),
  purpose text not null,
  channel text not null check (channel in ('email','phone','whatsapp','event')),
  market text not null,
  timezone text not null,
  status text not null default 'draft' check (status in ('draft','approved','paused','ended')),
  approval_version integer not null default 1 check (approval_version > 0),
  asset_version integer not null default 1 check (asset_version > 0),
  client_authority_ref text,
  owner_authority_ref text,
  cts_profile_ref text,
  expires_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  max_actions integer not null default 0 check (max_actions >= 0),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (status <> 'approved' or (coalesce(length(trim(client_authority_ref)),0) > 0 and coalesce(length(trim(owner_authority_ref)),0) > 0
    and coalesce(length(trim(cts_profile_ref)),0) > 0 and expires_at is not null and max_actions > 0)),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create index campaigns_tenant_status on public.campaigns (tenant_id, status);

create table public.outbound_stops (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('global','tenant','campaign')),
  tenant_id uuid references public.tenants(id) on delete restrict,
  campaign_id uuid,
  reason text not null,
  created_at timestamptz not null default now(),
  lifted_at timestamptz,
  check ((scope='global' and tenant_id is null and campaign_id is null) or
    (scope='tenant' and tenant_id is not null and campaign_id is null) or
    (scope='campaign' and tenant_id is not null and campaign_id is not null)),
  foreign key (tenant_id, campaign_id) references public.campaigns (tenant_id, id)
);
create index outbound_stops_active on public.outbound_stops (scope, tenant_id, campaign_id) where lifted_at is null;

create table public.outbound_actions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  campaign_id uuid not null,
  lead_id uuid not null,
  correlation_key text not null check (length(correlation_key) between 1 and 160),
  approval_version integer not null,
  asset_version integer not null,
  due_at timestamptz not null,
  state text not null default 'queued' check (state in ('queued','claimed','tested','blocked','delivered','failed','review','cancelled')),
  attempts smallint not null default 0 check (attempts between 0 and 3),
  lease_until timestamptz,
  provider_ref text,
  error_code text,
  created_at timestamptz not null default now(),
  unique (tenant_id, correlation_key),
  foreign key (tenant_id, campaign_id) references public.campaigns (tenant_id, id),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id)
);
create index outbound_actions_due on public.outbound_actions (due_at, id) where state='queued';

alter table public.campaigns enable row level security;
alter table public.outbound_stops enable row level security;
alter table public.outbound_actions enable row level security;
revoke all on public.campaigns, public.outbound_stops, public.outbound_actions from anon, authenticated;
grant select on public.campaigns, public.outbound_stops, public.outbound_actions to authenticated;
grant all on public.campaigns, public.outbound_stops, public.outbound_actions to service_role;
grant select on public.tenants, public.leads, public.suppression, public.contact_rights, public.lead_suppression to service_role;
create policy admin_read on public.campaigns for select to authenticated using (public.is_admin());
create policy admin_read on public.outbound_stops for select to authenticated using (public.is_admin());
create policy admin_read on public.outbound_actions for select to authenticated using (public.is_admin());

-- One eligibility rule is shared by reservation and test-sink completion.
create function public.synthetic_action_allowed(p_id uuid, p_now timestamptz) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.outbound_actions a
    join public.campaigns c on c.id=a.campaign_id and c.tenant_id=a.tenant_id
    join public.leads l on l.id=a.lead_id and l.tenant_id=a.tenant_id
    join public.tenants t on t.id=a.tenant_id
    where a.id=p_id and p_now is not null and t.status='active' and c.status='approved'
      and c.expires_at>p_now and (c.starts_at is null or c.starts_at<=p_now)
      and (c.ends_at is null or c.ends_at>p_now)
      and a.approval_version=c.approval_version and a.asset_version=c.asset_version
      and lower(l.email) like '%.invalid' and l.status<>'unsubscribed'
      and not exists (select 1 from public.outbound_stops s where s.lifted_at is null and
        (s.scope='global' or (s.tenant_id=a.tenant_id and (s.scope='tenant' or s.campaign_id=a.campaign_id))))
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

-- A campaign row lock serialises cap checks across different actions and workers.
-- Nothing is sent here; later delivery must recheck safety just before its provider call.
create function public.claim_synthetic_action(p_id uuid, p_now timestamptz) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare a public.outbound_actions%rowtype; c public.campaigns%rowtype;
begin
  if current_user <> 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  if p_now is null then return false; end if;
  select * into a from public.outbound_actions where id=p_id for update skip locked;
  if not found or a.state <> 'queued' or a.attempts >= 3 or a.due_at > p_now then return false; end if;
  select * into c from public.campaigns where id=a.campaign_id and tenant_id=a.tenant_id for update;
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

-- A local test sink result. `tested` is deliberately distinct from provider delivery.
create function public.complete_synthetic_action(p_id uuid, p_now timestamptz) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare a public.outbound_actions%rowtype;
begin
  if current_user <> 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  select * into a from public.outbound_actions where id=p_id for update skip locked;
  if not found or a.state <> 'claimed' or p_now is null or a.lease_until<=p_now then return false; end if;
  perform 1 from public.campaigns where id=a.campaign_id and tenant_id=a.tenant_id for update;
  if not public.synthetic_action_allowed(a.id,p_now) then
    update public.outbound_actions set state='blocked', error_code='eligibility_or_authority_changed', lease_until=null where id=a.id;
    return false;
  end if;
  update public.outbound_actions set state='tested', provider_ref='test-sink:' || a.id::text, lease_until=null where id=a.id;
  return true;
end $$;
revoke all on function public.complete_synthetic_action(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.complete_synthetic_action(uuid,timestamptz) to service_role;

-- Restart after an uncertain result routes to review; never blindly repeats a send.
create function public.expire_synthetic_claim(p_id uuid, p_now timestamptz) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare expired boolean;
begin
  if current_user <> 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  update public.outbound_actions set state='review', error_code='uncertain_result', lease_until=null
  where id=p_id and state='claimed' and lease_until<=p_now;
  expired := found;
  if expired then
    update public.campaigns set status='paused'
      where id=(select campaign_id from public.outbound_actions where id=p_id) and status='approved';
  end if;
  return expired;
end $$;
revoke all on function public.expire_synthetic_claim(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.expire_synthetic_claim(uuid,timestamptz) to service_role;
