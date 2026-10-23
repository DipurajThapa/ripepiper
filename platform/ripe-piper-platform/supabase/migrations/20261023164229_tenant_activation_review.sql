-- Explicit account activation/resumption. Historical active rows are retained;
-- this adds no contact rights, campaign approval or provider connection.
alter table public.tenants add column execution_version integer not null default 0 check(execution_version>=0);
alter table public.outbound_stops add column origin text not null default 'manual' check(origin in ('manual','tenant_pause'));

create table public.tenant_activation_reviews (
 tenant_id uuid not null references public.tenants(id),
 execution_version integer not null check(execution_version>0),
 from_status text not null check(from_status in ('onboarding','paused')),
 brief_version integer not null,
 actor_id uuid not null references public.profiles(id),
 reason text not null check(length(trim(reason)) between 8 and 500),
 reviewed_at timestamptz not null default now(),
 primary key(tenant_id,execution_version),
 foreign key(tenant_id,brief_version) references public.business_briefs(tenant_id,version)
);
alter table public.tenant_activation_reviews enable row level security;
revoke all on public.tenant_activation_reviews from public,anon,authenticated,service_role;
grant select on public.tenant_activation_reviews to authenticated;
create policy admin_read on public.tenant_activation_reviews for select to authenticated using(public.is_admin());
grant select,insert on public.tenant_activation_reviews to service_role;
grant update(execution_version) on public.tenants to service_role;

create function public.guard_tenant_activation() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.status='active' and current_user<>'postgres' then
   raise exception 'Prepare onboarding before reviewed activation' using errcode='23514';
  end if;
  return new;
 end if;
 if new.status is distinct from old.status then
  if current_user not in ('service_role','postgres') then raise exception 'Staff service state transition required' using errcode='42501'; end if;
  if old.status='ended' and current_user<>'postgres' then raise exception 'Ended accounts cannot resume' using errcode='23514'; end if;
  new.execution_version:=old.execution_version+1;
  -- Database owners can maintain/restore historical fixtures; application roles
  -- require an immutable review matching this exact transition/version.
  if new.status='active' and current_user<>'postgres' and not exists(
   select 1 from public.tenant_activation_reviews r join public.profiles p on p.id=r.actor_id and p.is_admin
   where r.tenant_id=new.id and r.execution_version=new.execution_version and r.from_status=old.status
    and public.campaign_brief_current(new.id,r.brief_version,now())
  ) then raise exception 'Current activation review required' using errcode='23514'; end if;
 elsif new.execution_version is distinct from old.execution_version then
  raise exception 'Execution version is managed by account state transitions' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function public.guard_tenant_activation() from public,anon,authenticated;
create trigger tenant_activation_guard before insert or update of status,execution_version on public.tenants
for each row execute function public.guard_tenant_activation();

create function public.activate_tenant_execution(p_tenant uuid,p_actor uuid,p_status text,p_version integer,p_brief integer,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.tenants%rowtype;
begin
 if current_user<>'service_role' or not exists(select 1 from public.profiles where id=p_actor and is_admin) then raise exception 'Staff required' using errcode='42501'; end if;
 select * into t from public.tenants where id=p_tenant for update;
 if not found then raise exception 'Tenant missing' using errcode='23503'; end if;
 if p_version is distinct from t.execution_version or p_status is distinct from t.status then raise exception 'Account state changed' using errcode='40001'; end if;
 if t.status not in ('onboarding','paused') or p_reason is null or length(trim(p_reason)) not between 8 and 500 then raise exception 'Reviewed onboarding or paused account required' using errcode='22023'; end if;
 if not public.campaign_brief_current(p_tenant,p_brief,now()) then raise exception 'Brief changed or expired' using errcode='40001'; end if;
 insert into public.tenant_activation_reviews(tenant_id,execution_version,from_status,brief_version,actor_id,reason)
 values(p_tenant,t.execution_version+1,t.status,p_brief,p_actor,trim(p_reason));
 update public.tenants set status='active' where id=p_tenant returning * into t;
 -- A deliberate account resume lifts only stops created by account pause.
 -- Manual, legacy, campaign/global and lead suppression stops stay intact.
 update public.outbound_stops set lifted_at=now() where tenant_id=p_tenant and scope='tenant' and origin='tenant_pause' and lifted_at is null;
 return jsonb_build_object('id',t.id,'status',t.status,'version',t.execution_version,'briefVersion',p_brief);
end $$;
revoke all on function public.activate_tenant_execution(uuid,uuid,text,integer,integer,text) from public,anon,authenticated;
grant execute on function public.activate_tenant_execution(uuid,uuid,text,integer,integer,text) to service_role;

-- Keep the existing emergency-stop transaction; tag only the stop it creates.
create or replace function public.pause_tenant_execution(p_tenant_id uuid,p_reason text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare t public.tenants%rowtype;
begin
 if current_user<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 if p_reason is null or length(trim(p_reason))<8 or length(p_reason)>500 then return false; end if;
 select * into t from public.tenants where id=p_tenant_id for update;
 if not found or t.status='ended' then return false; end if;
 if t.status<>'paused' then update public.tenants set status='paused' where id=p_tenant_id; end if;
 update public.campaigns set status='paused' where tenant_id=p_tenant_id and status='approved';
 update public.outbound_actions set state='cancelled',error_code='tenant_paused' where tenant_id=p_tenant_id and state='queued';
 update public.outbound_actions set state='review',error_code='uncertain_at_tenant_pause',lease_until=null where tenant_id=p_tenant_id and state='claimed';
 update public.ad_accounts set status='disconnected' where tenant_id=p_tenant_id and status<>'disconnected';
 if not exists(select 1 from public.outbound_stops where scope='tenant' and tenant_id=p_tenant_id and origin='tenant_pause' and lifted_at is null) then
  insert into public.outbound_stops(scope,tenant_id,reason,origin) values('tenant',p_tenant_id,trim(p_reason),'tenant_pause');
 end if;
 return true;
end $$;
