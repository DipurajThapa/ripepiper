-- M04 step 1c: append-only source evidence and explicit unknown-by-default contact rights.
-- No rows are seeded and no outbound permission is inferred from a lead or a source.
create table public.lead_observations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null,
  source text not null check (length(trim(source)) between 1 and 80),
  external_ref text not null check (length(trim(external_ref)) between 1 and 240),
  observed_at timestamptz not null,
  original_purpose text not null check (length(trim(original_purpose)) between 1 and 160),
  rights_reference text,
  restrictions text,
  synthetic boolean not null default false,
  received_at timestamptz not null default now(),
  unique (tenant_id, lead_id, id),
  unique (tenant_id, source, external_ref),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id) on delete cascade
);
create index lead_observations_lead on public.lead_observations (tenant_id, lead_id, observed_at desc);

create table public.contact_rights (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null,
  source_id uuid not null,
  purpose text not null check (length(trim(purpose)) between 1 and 160),
  channel text not null check (channel in ('email','phone','whatsapp','event')),
  market text not null check (market ~ '^[A-Z]{2}$' or market = 'OTHER'),
  decision text not null default 'unknown' check (decision in ('unknown','permitted','denied')),
  reviewer_id uuid references public.profiles(id),
  notice_reference text,
  version integer not null default 1 check (version > 0),
  expires_at timestamptz,
  withdrawn_at timestamptz,
  objected_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (tenant_id, lead_id, purpose, channel, market),
  foreign key (tenant_id, lead_id, source_id) references public.lead_observations (tenant_id, lead_id, id),
  check (decision <> 'permitted' or (reviewer_id is not null and notice_reference is not null and length(trim(notice_reference)) > 0))
);
create index contact_rights_lead on public.contact_rights (tenant_id, lead_id);

create table public.lead_suppression (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null,
  reason text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, lead_id),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id) on delete restrict
);

create table public.subject_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null,
  kind text not null check (kind in ('access','correct','object','erase','restrict','export')),
  state text not null default 'pending_verification' check (state in ('pending_verification','open','fulfilled','rejected')),
  received_at timestamptz not null default now(),
  owner_id uuid references public.profiles(id),
  deadline_at timestamptz,
  resolution_reference text,
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id) on delete restrict
);
create index subject_requests_open on public.subject_requests (tenant_id, state, received_at);

-- Objection is a conservative stop even while request ownership/identity is reviewed.
create function public.freeze_on_objection() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'object' then
    insert into public.lead_suppression (tenant_id, lead_id, reason)
    values (new.tenant_id, new.lead_id, 'objection')
    on conflict (tenant_id, lead_id) do nothing;
    insert into public.suppression (email, reason)
    select lower(email), 'objection' from public.leads
    where id=new.lead_id and tenant_id=new.tenant_id
    on conflict (email) do nothing;
    update public.contact_rights set decision='denied', objected_at=coalesce(objected_at,new.received_at),
      version=version+1, updated_at=now()
    where tenant_id=new.tenant_id and lead_id=new.lead_id and decision <> 'denied';
  end if;
  return new;
end $$;
create trigger subject_request_objection after insert on public.subject_requests
for each row execute function public.freeze_on_objection();
revoke all on function public.freeze_on_objection() from public, anon, authenticated;

alter table public.lead_observations enable row level security;
alter table public.contact_rights enable row level security;
alter table public.lead_suppression enable row level security;
alter table public.subject_requests enable row level security;
revoke all on public.lead_observations, public.contact_rights, public.lead_suppression, public.subject_requests from anon, authenticated;
grant select, insert on public.lead_observations to authenticated;
grant select, insert, update on public.contact_rights to authenticated;
grant select, insert on public.lead_suppression to authenticated;
grant select, insert, update on public.subject_requests to authenticated;
grant all on public.lead_observations, public.contact_rights, public.lead_suppression, public.subject_requests to service_role;
create policy admin_all on public.lead_observations for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.contact_rights for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.lead_suppression for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.subject_requests for all to authenticated using (public.is_admin()) with check (public.is_admin());
