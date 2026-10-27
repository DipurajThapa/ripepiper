-- These tabs contain only the agency's own pipeline. Tenant records cannot
-- be read by the sheet worker and must not occupy its bounded queue.
-- Proposal and payment tabs intentionally include records with a tenant.
drop trigger leads_to_sheet on public.leads;
create trigger leads_to_sheet after insert or update on public.leads
  for each row when (new.tenant_id is null) execute function public.enqueue_sheet_sync('lead');

drop trigger meetings_to_sheet on public.meetings;
create trigger meetings_to_sheet after insert or update on public.meetings
  for each row when (new.tenant_id is null) execute function public.enqueue_sheet_sync('meeting');
