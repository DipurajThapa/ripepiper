-- RP-010 / M04 first slice: a deal cannot attribute revenue to another tenant's lead.
-- Run a read-only preflight before any future production rollout:
-- select d.id from public.deals d join public.leads l on l.id = d.lead_id
-- where d.tenant_id <> l.tenant_id or l.tenant_id is null;
-- select m.id from public.meetings m join public.leads l on l.id = m.lead_id
-- where m.tenant_id is not null and (m.tenant_id <> l.tenant_id or l.tenant_id is null);
-- Resolve any returned rows through a reviewed data correction; do not silently reassign them.
-- New product rows use non-null tenant IDs. Legacy NULL-tenant public intake remains intact.
alter table public.leads add constraint leads_tenant_id_id_key unique (tenant_id, id);
alter table public.deals drop constraint deals_lead_id_fkey;
alter table public.deals add constraint deals_tenant_lead_fk
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id)
  on delete set null (lead_id);
alter table public.meetings drop constraint meetings_lead_id_fkey;
alter table public.meetings add constraint meetings_tenant_lead_fk
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id)
  on delete set null (lead_id);
alter table public.meetings add constraint meetings_client_requires_tenant
  check (kind <> 'client_prospect' or tenant_id is not null);
