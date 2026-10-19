-- Exchange rates used to convert ad spend into each client's currency (AED per 1 unit of the currency).
-- The AED is pegged to the USD at 3.6725. Update INR and any other rate monthly from your bank's published rate.
create table public.fx_rates (
  currency     text primary key,
  aed_per_unit numeric(14,6) not null check (aed_per_unit > 0),
  updated_at   timestamptz not null default now()
);
alter table public.fx_rates enable row level security;
create policy admin_all on public.fx_rates for all to authenticated using (public.is_admin()) with check (public.is_admin());
insert into public.fx_rates (currency, aed_per_unit) values ('AED', 1), ('USD', 3.6725);
