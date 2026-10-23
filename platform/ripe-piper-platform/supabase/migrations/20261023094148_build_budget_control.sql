-- One total build budget, never a per-tenant/month allowance. Dormant until
-- an operator records reconciled prior charges and explicit paid-use authority.
create table public.build_budget (
 id text primary key check(id='ripepiper-build'),
 prior_micro bigint check(prior_micro between 0 and 20000000),
 enabled boolean not null default false,
 pricing_reference text,
 authorization_reference text,
 authorized_until timestamptz,
 reconciled_by uuid references public.profiles(id),
 reconciled_at timestamptz
);
insert into public.build_budget(id) values('ripepiper-build');
create table public.build_usage (
 id uuid primary key,
 budget_id text not null references public.build_budget(id),
 model text not null,
 pricing_reference text not null,
 reserved_micro bigint not null check(reserved_micro between 1 and 18000000),
 actual_micro bigint check(actual_micro between 0 and 20000000),
 state text not null default 'reserved' check(state in ('reserved','settled','review')),
 created_at timestamptz not null default now(),
 settled_at timestamptz,
 check(actual_micro is null or actual_micro<=reserved_micro)
);
alter table public.build_budget enable row level security;
alter table public.build_usage enable row level security;
revoke all on public.build_budget, public.build_usage from anon,authenticated;
grant select,insert,update on public.build_budget,public.build_usage to service_role;
create function public.authorize_build_budget(p_actor uuid,p_prior_micro bigint,p_pricing text,p_authority text,p_until timestamptz) returns void
language plpgsql security invoker set search_path='' as $$
declare b public.build_budget%rowtype;
begin
 if current_user<>'service_role' or not exists(select 1 from public.profiles where id=p_actor and is_admin) then raise exception 'Staff service required' using errcode='42501';end if;
 select * into b from public.build_budget where id='ripepiper-build' for update;
 if p_prior_micro is null or p_prior_micro<coalesce(b.prior_micro,0) or p_prior_micro>20000000
 or coalesce(length(trim(p_pricing)),0) not between 1 and 240 or coalesce(length(trim(p_authority)),0) not between 1 and 240
 or p_until is null or p_until<=now() or p_until>now()+interval '30 days' then raise exception 'Invalid reconciled authority' using errcode='22023';end if;
 update public.build_budget set prior_micro=p_prior_micro,enabled=true,pricing_reference=p_pricing,authorization_reference=p_authority,
 authorized_until=p_until,reconciled_by=p_actor,reconciled_at=now() where id=b.id;
end $$;
create function public.reserve_build_usage(p_id uuid,p_model text,p_pricing text,p_max_micro bigint) returns boolean
language plpgsql security invoker set search_path='' as $$
declare b public.build_budget%rowtype; committed bigint;
begin
 if current_user<>'service_role' then raise exception 'Service required' using errcode='42501';end if;
 select * into b from public.build_budget where id='ripepiper-build' for update;
 if not found or not b.enabled or b.prior_micro is null or b.reconciled_by is null or b.authorized_until<=now()
 or b.authorized_until is null or b.pricing_reference is distinct from p_pricing or p_id is null
 or coalesce(length(p_model),0) not between 1 and 120 or p_max_micro is null or p_max_micro not between 1 and 18000000 then return false;end if;
 -- An existing operation is never a fresh dispatch permit, even if settled.
 if exists(select 1 from public.build_usage where id=p_id) then return false;end if;
 select b.prior_micro+coalesce(sum(coalesce(actual_micro,reserved_micro)),0) into committed from public.build_usage where budget_id=b.id;
 if committed+p_max_micro>18000000 then return false;end if;
 insert into public.build_usage(id,budget_id,model,pricing_reference,reserved_micro) values(p_id,b.id,p_model,p_pricing,p_max_micro);
 return true;
end $$;
create function public.settle_build_usage(p_id uuid,p_actual_micro bigint) returns boolean
language plpgsql security invoker set search_path='' as $$
declare u public.build_usage%rowtype;
begin
 if current_user<>'service_role' then raise exception 'Service required' using errcode='42501';end if;
 perform 1 from public.build_budget where id='ripepiper-build' for update;
 select * into u from public.build_usage where id=p_id for update;
 if not found or p_actual_micro is null or p_actual_micro<0 then return false;end if;
 if u.state='settled' then return u.actual_micro=p_actual_micro;end if;
 if p_actual_micro>u.reserved_micro then
  update public.build_usage set state='review' where id=p_id;
  update public.build_budget set enabled=false where id='ripepiper-build';return false;
 end if;
 update public.build_usage set state='settled',actual_micro=p_actual_micro,settled_at=now() where id=p_id;
 return true;
end $$;
revoke all on function public.authorize_build_budget(uuid,bigint,text,text,timestamptz),public.reserve_build_usage(uuid,text,text,bigint),public.settle_build_usage(uuid,bigint) from public,anon,authenticated;
grant execute on function public.authorize_build_budget(uuid,bigint,text,text,timestamptz),public.reserve_build_usage(uuid,text,text,bigint),public.settle_build_usage(uuid,bigint) to service_role;
create function public.hold_build_budget(p_id uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if current_user<>'service_role' then raise exception 'Service required' using errcode='42501';end if;
 perform 1 from public.build_budget where id='ripepiper-build' for update;
 if not exists(select 1 from public.build_usage where id=p_id) then raise exception 'Reservation missing';end if;
 update public.build_usage set state='review' where id=p_id and state<>'settled';
 update public.build_budget set enabled=false where id='ripepiper-build';
end $$;
revoke all on function public.hold_build_budget(uuid) from public,anon,authenticated;
grant execute on function public.hold_build_budget(uuid) to service_role;
