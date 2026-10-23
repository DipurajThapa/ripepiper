-- RP-012: public consultation booking capability. Existing lead rows stay intact.
-- Only a SHA-256 digest is stored; the one-time token is returned by /api/lead to that browser.
alter table public.leads add column booking_token_hash text unique;
alter table public.leads add column booking_token_expires_at timestamptz;
alter table public.leads add column booking_token_used_at timestamptz;
alter table public.leads add constraint booking_token_has_expiry
  check (booking_token_hash is null or booking_token_expires_at is not null);
-- Preflight: inspect any duplicate active discovery meetings per lead before rollout.
-- select lead_id, count(*) from public.meetings where kind='discovery'
-- and status in ('booked','rescheduled') and lead_id is not null group by lead_id having count(*)>1;
create unique index meetings_one_active_consultation_per_lead on public.meetings (lead_id)
  where kind='discovery' and status in ('booked','rescheduled') and lead_id is not null;
