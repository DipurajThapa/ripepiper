-- Row-level security: a client user can read only rows of the tenants they belong to.
-- Admin can read and write everything. The server API uses the service role, which bypasses RLS.

alter table public.tenants            enable row level security;
alter table public.profiles           enable row level security;
alter table public.memberships        enable row level security;
alter table public.invites            enable row level security;
alter table public.leads              enable row level security;
alter table public.newsletter_subscribers enable row level security;
alter table public.suppression        enable row level security;
alter table public.meetings           enable row level security;
alter table public.proposals          enable row level security;
alter table public.quotes             enable row level security;
alter table public.payments           enable row level security;
alter table public.outreach_weekly    enable row level security;
alter table public.ad_accounts        enable row level security;
alter table public.ad_metrics_daily   enable row level security;
alter table public.deals              enable row level security;
alter table public.fees               enable row level security;
alter table public.activity_log       enable row level security;
alter table public.posts              enable row level security;
alter table public.sheet_outbox       enable row level security;

-- Admin: full access on every table.
do $$
declare t text;
begin
  foreach t in array array['tenants','profiles','memberships','invites','leads','newsletter_subscribers','suppression',
    'meetings','proposals','quotes','payments','outreach_weekly','ad_accounts','ad_metrics_daily','deals','fees',
    'activity_log','posts','sheet_outbox'] loop
    execute format('create policy admin_all on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- Clients: read their own tenant and tenant-scoped data. Ripe Piper's own rows (tenant_id is null) never match.
create policy client_read on public.tenants          for select to authenticated using (public.is_member(id));
create policy self_read   on public.profiles         for select to authenticated using (id = auth.uid());
create policy client_read on public.memberships      for select to authenticated using (public.is_member(tenant_id));
create policy client_read on public.leads            for select to authenticated using (tenant_id is not null and public.is_member(tenant_id));
create policy client_read on public.meetings         for select to authenticated using (tenant_id is not null and kind = 'client_prospect' and public.is_member(tenant_id));
create policy client_read on public.proposals        for select to authenticated using (tenant_id is not null and public.is_member(tenant_id));
create policy client_read on public.quotes           for select to authenticated using (tenant_id is not null and public.is_member(tenant_id));
create policy client_read on public.payments         for select to authenticated using (tenant_id is not null and public.is_member(tenant_id));
create policy client_read on public.outreach_weekly  for select to authenticated using (public.is_member(tenant_id));
create policy client_read on public.ad_accounts      for select to authenticated using (public.is_member(tenant_id));
create policy client_read on public.ad_metrics_daily for select to authenticated using (public.is_member(tenant_id));
create policy client_read on public.deals            for select to authenticated using (public.is_member(tenant_id));
create policy client_read on public.fees             for select to authenticated using (public.is_member(tenant_id));
create policy client_read on public.activity_log     for select to authenticated using (tenant_id is not null and visible_to_client and public.is_member(tenant_id));

-- Client owners can update their own deal stages and values (this keeps revenue and ROI accurate).
create policy owner_write on public.deals for update to authenticated
  using (public.is_owner(tenant_id)) with check (public.is_owner(tenant_id));
create policy owner_insert on public.deals for insert to authenticated
  with check (public.is_owner(tenant_id));
-- Client owners can invite viewers from their own company.
create policy owner_invite on public.invites for insert to authenticated
  with check (public.is_owner(tenant_id) and role = 'viewer');
create policy owner_invite_read on public.invites for select to authenticated using (public.is_owner(tenant_id));

-- Public blog: anyone can read published posts.
create policy public_read on public.posts for select to anon, authenticated using (status = 'published');

-- ---------------------------------------------------------------- dashboard views (security_invoker keeps RLS in force)
create or replace view public.v_tenant_monthly with (security_invoker = true) as
with months as (
  select t.id as tenant_id, t.currency, gs::date as month
  from public.tenants t,
       generate_series(date_trunc('month', t.created_at), date_trunc('month', now()), interval '1 month') gs
),
l as (
  select tenant_id, date_trunc('month', created_at)::date m,
         count(*) leads,
         count(*) filter (where status in ('qualified','meeting_booked','meeting_held','proposal','won')) qualified
  from public.leads where tenant_id is not null group by 1, 2
),
o as (
  select tenant_id, date_trunc('month', week_start)::date m,
         sum(sent) sent, sum(delivered) delivered, sum(replies) replies, sum(positive_replies) positive_replies,
         sum(meetings_booked) meetings_booked, sum(meetings_held) meetings_held, avg(icp_match_pct) icp_match_pct
  from public.outreach_weekly group by 1, 2
),
a as (
  select tenant_id, date_trunc('month', day)::date m, sum(spend) ad_spend, sum(clicks) clicks, sum(conversions) ad_conversions
  from public.ad_metrics_daily group by 1, 2
),
f as (select tenant_id, date_trunc('month', month)::date m, sum(amount) fees from public.fees group by 1, 2),
d as (
  select tenant_id, date_trunc('month', coalesce(closed_at, created_at::date))::date m,
         sum(value) filter (where stage = 'won') won_revenue,
         sum(value) filter (where stage in ('meeting','proposal','negotiation')) open_pipeline,
         count(*) filter (where stage = 'won') deals_won
  from public.deals group by 1, 2
)
select mo.tenant_id, mo.month, mo.currency,
       coalesce(l.leads, 0) leads, coalesce(l.qualified, 0) qualified_leads,
       coalesce(o.sent, 0) emails_sent, coalesce(o.delivered, 0) emails_delivered,
       coalesce(o.replies, 0) replies, coalesce(o.positive_replies, 0) positive_replies,
       coalesce(o.meetings_booked, 0) meetings_booked, coalesce(o.meetings_held, 0) meetings_held,
       o.icp_match_pct,
       coalesce(a.ad_spend, 0) ad_spend, coalesce(a.clicks, 0) ad_clicks, coalesce(a.ad_conversions, 0) ad_conversions,
       coalesce(f.fees, 0) fees,
       coalesce(d.won_revenue, 0) won_revenue, coalesce(d.open_pipeline, 0) open_pipeline, coalesce(d.deals_won, 0) deals_won,
       coalesce(f.fees, 0) + coalesce(a.ad_spend, 0) as total_cost,
       case when coalesce(l.qualified, 0) > 0 then round((coalesce(f.fees,0) + coalesce(a.ad_spend,0)) / l.qualified, 2) end as cost_per_qualified_lead,
       case when coalesce(o.meetings_held, 0) > 0 then round((coalesce(f.fees,0) + coalesce(a.ad_spend,0)) / o.meetings_held, 2) end as cost_per_meeting,
       case when coalesce(o.delivered, 0) > 0 then round(100.0 * o.replies / o.delivered, 2) end as reply_rate_pct,
       case when (coalesce(f.fees,0) + coalesce(a.ad_spend,0)) > 0
            then round(100.0 * (coalesce(d.won_revenue,0) - (coalesce(f.fees,0) + coalesce(a.ad_spend,0))) / (coalesce(f.fees,0) + coalesce(a.ad_spend,0)), 1) end as roi_pct
from months mo
left join l on l.tenant_id = mo.tenant_id and l.m = mo.month
left join o on o.tenant_id = mo.tenant_id and o.m = mo.month
left join a on a.tenant_id = mo.tenant_id and a.m = mo.month
left join f on f.tenant_id = mo.tenant_id and f.m = mo.month
left join d on d.tenant_id = mo.tenant_id and d.m = mo.month;

-- Leads by source (attribution) for the dashboard.
create or replace view public.v_tenant_sources with (security_invoker = true) as
select l.tenant_id, coalesce(l.utm_source, l.source) as source,
       count(*) leads,
       count(*) filter (where l.status in ('qualified','meeting_booked','meeting_held','proposal','won')) qualified,
       coalesce(sum(dl.value) filter (where dl.stage = 'won'), 0) won_revenue
from public.leads l left join public.deals dl on dl.lead_id = l.id
where l.tenant_id is not null
group by 1, 2;

grant usage on schema public to anon, authenticated;
grant select on public.posts to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on public.v_tenant_monthly, public.v_tenant_sources to authenticated;
