-- Ripe Piper platform: core schema
-- Multi-tenant: every client company is a tenant. Ripe Piper's own pipeline uses tenant_id = NULL (admin only).
-- Roles: platform admin (profiles.is_admin), client owner and client viewer (memberships.role).

-- gen_random_uuid() is built into Postgres 13+.

-- ---------------------------------------------------------------- tenants and people
create table public.tenants (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  country       text not null check (country in ('AE','IN','SA','QA','OTHER')),
  currency      text not null check (currency in ('AED','INR')),
  plan          text not null default 'engine' check (plan in ('sprint','engine')),
  package       text not null default 'revive' check (package in ('revive','signal','response','events')),
  ownership     text not null default 'managed' check (ownership in ('managed','client_owned')),
  status        text not null default 'onboarding' check (status in ('prospect','onboarding','active','paused','ended')),
  attribution_model text not null default 'first_touch' check (attribution_model in ('first_touch','last_touch','linear')),
  created_at    timestamptz not null default now()
);

create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null unique,
  full_name  text,
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.memberships (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null check (role in ('owner','viewer')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

-- An admin invites a client email (company domain or Gmail). On first sign-in the user is linked to the tenant.
create table public.invites (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  email       text not null,
  role        text not null check (role in ('owner','viewer')),
  accepted_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (tenant_id, email)
);

-- ---------------------------------------------------------------- helper functions used by row-level security
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_member(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m where m.tenant_id = t and m.user_id = auth.uid())
$$;

create or replace function public.is_owner(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m where m.tenant_id = t and m.user_id = auth.uid() and m.role = 'owner')
$$;

-- New auth user -> profile; accept any pending invites for that email.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, lower(new.email), coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  insert into public.memberships (tenant_id, user_id, role)
  select i.tenant_id, new.id, i.role from public.invites i
  where lower(i.email) = lower(new.email) and i.accepted_at is null
  on conflict do nothing;
  update public.invites set accepted_at = now() where lower(email) = lower(new.email) and accepted_at is null;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- leads, consent and suppression
create table public.leads (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid references public.tenants(id) on delete cascade,   -- NULL = Ripe Piper's own pipeline
  source          text not null check (source in ('book_form','calculator','whatsapp','outreach','event','ads','referral','import')),
  name            text,
  email           text not null,
  company         text,
  website         text,
  country         text,
  package_interest text,
  deal_band       smallint check (deal_band between 0 and 3),
  status          text not null default 'new' check (status in ('new','qualified','not_fit','meeting_booked','meeting_held','proposal','won','lost','unsubscribed')),
  score           smallint check (score between 0 and 100),
  consent_at      timestamptz,
  utm_source      text, utm_medium text, utm_campaign text, utm_content text, utm_term text,
  gclid           text, fbclid text, li_fat_id text,
  landing_page    text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- One lead per email per pipeline (dedupe on submit).
create unique index leads_email_per_tenant on public.leads (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(email));
create index leads_tenant_created on public.leads (tenant_id, created_at desc);

create table public.newsletter_subscribers (
  email        text primary key,
  status       text not null default 'pending' check (status in ('pending','confirmed','unsubscribed')),
  confirm_token uuid not null default gen_random_uuid(),
  consent_at   timestamptz not null default now(),
  confirmed_at timestamptz,
  unsubscribed_at timestamptz
);

create table public.suppression (
  email      text primary key,
  reason     text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- meetings (bookings), AI notes and minutes
create table public.meetings (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid references public.tenants(id) on delete cascade,     -- NULL = sales call with a Ripe Piper prospect
  lead_id        uuid references public.leads(id) on delete set null,
  kind           text not null default 'discovery' check (kind in ('discovery','kickoff','review','client_prospect')),
  start_at       timestamptz not null,
  end_at         timestamptz not null,
  timezone       text not null default 'Asia/Dubai',
  attendee_email text not null,
  attendee_name  text,
  google_event_id text unique,
  meet_url       text,
  meet_code      text,
  status         text not null default 'booked' check (status in ('booked','held','no_show','cancelled','rescheduled')),
  reminder_24h_at timestamptz,
  reminder_1h_at  timestamptz,
  transcript     text,
  notes          jsonb,          -- AI: key points, pains, budget, timeline, decision makers
  minutes        text,           -- AI: formal minutes with actions and owners
  requirements   jsonb,          -- AI: structured requirements used for the pre-proposal
  ai_processed_at timestamptz,
  created_at     timestamptz not null default now(),
  check (end_at > start_at)
);
-- No double booking: two active meetings cannot overlap.
create extension if not exists btree_gist;
alter table public.meetings add constraint meetings_no_overlap
  exclude using gist (tstzrange(start_at, end_at) with &&) where (status in ('booked','rescheduled') and tenant_id is null);
create index meetings_start on public.meetings (start_at) where status = 'booked';

-- ---------------------------------------------------------------- proposals, quotations and payments
create table public.proposals (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid references public.leads(id) on delete set null,
  tenant_id      uuid references public.tenants(id) on delete set null,  -- set once the client is created
  meeting_id     uuid references public.meetings(id) on delete set null,
  kind           text not null check (kind in ('pre','full')),
  plan           text not null check (plan in ('sprint','engine')),
  package        text not null check (package in ('revive','signal','response','events')),
  currency       text not null check (currency in ('AED','INR')),
  fixed_amount   numeric(12,2) not null check (fixed_amount > 0),   -- fixed-scope price from the published price list
  advance_pct    numeric(5,2) not null default 10 check (advance_pct > 0 and advance_pct <= 100),
  advance_amount numeric(12,2) generated always as (round(fixed_amount * advance_pct / 100, 2)) stored,
  content_md     text not null,
  status         text not null default 'draft' check (status in ('draft','sent','approved','paid','declined','superseded')),
  client_email   text not null,
  access_token   uuid not null default gen_random_uuid(),   -- secret link for the client to view and approve
  sent_at timestamptz, approved_at timestamptz, paid_at timestamptz,
  created_at     timestamptz not null default now()
);

-- Customisations are quoted separately after the proposal is locked.
create table public.quotes (
  id          uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  tenant_id   uuid references public.tenants(id) on delete cascade,
  items       jsonb not null,           -- [{description, quantity, unit_price}]
  currency    text not null check (currency in ('AED','INR')),
  total       numeric(12,2) not null check (total >= 0),
  status      text not null default 'draft' check (status in ('draft','sent','accepted','declined')),
  created_at  timestamptz not null default now()
);

create table public.payments (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid references public.tenants(id) on delete set null,
  proposal_id  uuid references public.proposals(id) on delete set null,
  provider     text not null check (provider in ('stripe','razorpay','bank')),
  provider_ref text not null,
  purpose      text not null check (purpose in ('advance','setup','retainer','performance','quote')),
  amount       numeric(12,2) not null,
  currency     text not null,
  status       text not null check (status in ('pending','paid','failed','refunded')),
  raw          jsonb,
  created_at   timestamptz not null default now(),
  unique (provider, provider_ref)       -- webhooks are idempotent
);

-- ---------------------------------------------------------------- client results data
create table public.outreach_weekly (
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  week_start       date not null,
  sent             int not null default 0,
  delivered        int not null default 0,
  replies          int not null default 0,
  positive_replies int not null default 0,
  meetings_booked  int not null default 0,
  meetings_held    int not null default 0,
  icp_match_pct    numeric(5,2),          -- share of contacted companies that match the agreed ideal customer
  primary key (tenant_id, week_start)
);

create table public.ad_accounts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  platform    text not null check (platform in ('google_ads','meta','linkedin')),
  account_ref text not null,
  status      text not null default 'connected' check (status in ('connected','error','disconnected')),
  last_synced_at timestamptz,
  last_error  text,
  unique (platform, account_ref)
);

create table public.ad_metrics_daily (
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  platform      text not null check (platform in ('google_ads','meta','linkedin')),
  day           date not null,
  campaign_ref  text not null,
  campaign_name text,
  spend         numeric(12,2) not null default 0,
  currency      text not null,
  impressions   bigint not null default 0,
  clicks        bigint not null default 0,
  conversions   numeric(12,2) not null default 0,
  primary key (tenant_id, platform, day, campaign_ref)
);

create table public.deals (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  lead_id     uuid references public.leads(id) on delete set null,   -- keeps source attribution through to revenue
  name        text not null,
  stage       text not null check (stage in ('meeting','proposal','negotiation','won','lost')),
  value       numeric(14,2) not null default 0,
  currency    text not null,
  source      text,           -- copied from the lead at creation
  campaign    text,
  updated_by  uuid references public.profiles(id),
  closed_at   date,
  created_at  timestamptz not null default now()
);

create table public.fees (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  month     date not null,
  type      text not null check (type in ('setup','retainer','performance','quote')),
  amount    numeric(12,2) not null,
  currency  text not null,
  note      text
);

-- What changed, why, and what happens next. Shown on the client dashboard as a timeline.
create table public.activity_log (
  id        bigint generated always as identity primary key,
  tenant_id uuid references public.tenants(id) on delete cascade,
  at        timestamptz not null default now(),
  actor     text not null,
  kind      text not null check (kind in ('note','change','milestone','alert')),
  message   text not null,
  visible_to_client boolean not null default true
);

-- ---------------------------------------------------------------- blog CMS
create table public.posts (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9-]{3,90}$'),
  title        text not null check (char_length(title) <= 120),
  description  text not null check (char_length(description) <= 170),
  body_md      text not null,
  cover_path   text,
  cover_alt    text,
  author_name  text not null default 'Dipuraj Thapa',
  status       text not null default 'draft' check (status in ('draft','published')),
  published_at timestamptz,
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------- Google Sheet CRM sync (outbox pattern)
create table public.sheet_outbox (
  id         bigint generated always as identity primary key,
  entity     text not null check (entity in ('lead','meeting','proposal','payment')),
  entity_id  uuid not null,
  attempts   int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  synced_at  timestamptz
);
create index sheet_outbox_pending on public.sheet_outbox (created_at) where synced_at is null;

create or replace function public.enqueue_sheet_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.sheet_outbox (entity, entity_id) values (tg_argv[0], new.id);
  return new;
end $$;
create trigger leads_to_sheet after insert or update on public.leads for each row execute function public.enqueue_sheet_sync('lead');
create trigger meetings_to_sheet after insert or update on public.meetings for each row execute function public.enqueue_sheet_sync('meeting');
create trigger proposals_to_sheet after insert or update on public.proposals for each row execute function public.enqueue_sheet_sync('proposal');
create trigger payments_to_sheet after insert or update on public.payments for each row execute function public.enqueue_sheet_sync('payment');

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger leads_touch before update on public.leads for each row execute function public.touch_updated_at();
create trigger posts_touch before update on public.posts for each row execute function public.touch_updated_at();
