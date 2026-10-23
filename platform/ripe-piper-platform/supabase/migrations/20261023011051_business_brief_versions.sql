-- Versioned operator-reviewed brief. Existing lead observations remain the source graph.
create table public.business_briefs (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  version integer not null check (version > 0),
  body jsonb not null check (jsonb_typeof(body)='object'),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (tenant_id,version)
);
alter table public.business_briefs enable row level security;
revoke all on public.business_briefs from public, anon, authenticated, service_role;
grant select on public.business_briefs to authenticated;
create policy admin_read on public.business_briefs for select to authenticated using (public.is_admin());
grant select,insert on public.business_briefs to service_role;
grant select on public.profiles to service_role;

alter table public.lead_observations
  add column assessment_facts jsonb not null default '{}' check (jsonb_typeof(assessment_facts)='object'),
  add column assessment_excerpt text check (length(assessment_excerpt) <= 2000),
  add column assessment_reviewed_by uuid references public.profiles(id);

-- Compare-and-append prevents two operators silently overwriting one another.
create function public.save_business_brief(p_tenant_id uuid,p_expected_version integer,p_body jsonb,p_actor uuid)
returns integer language plpgsql security invoker set search_path = '' as $$
declare previous public.business_briefs%rowtype; next_version integer;
begin
  if current_user <> 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  if not exists(select 1 from public.profiles where id=p_actor and is_admin) then
    raise exception 'Staff required' using errcode='42501';
  end if;
  perform 1 from public.tenants where id=p_tenant_id for update;
  if not found then raise exception 'Tenant not found' using errcode='23503'; end if;
  select * into previous from public.business_briefs where tenant_id=p_tenant_id order by version desc limit 1;
  -- Same-body retry is harmless, even after the first response was lost.
  if previous.body = p_body then return previous.version; end if;
  if p_expected_version is null or p_expected_version <> coalesce(previous.version,0) then
    raise exception 'Brief changed; reload before saving' using errcode='40001';
  end if;
  next_version := coalesce(previous.version,0)+1;
  insert into public.business_briefs(tenant_id,version,body,created_by) values(p_tenant_id,next_version,p_body,p_actor);
  return next_version;
end $$;
revoke all on function public.save_business_brief(uuid,integer,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.save_business_brief(uuid,integer,jsonb,uuid) to service_role;
