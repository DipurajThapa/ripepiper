-- Remove exposed trigger entry points without changing their trigger semantics.
alter function public.touch_updated_at() set search_path='';
revoke execute on function public.touch_updated_at(),public.enqueue_sheet_sync(),public.handle_new_user(),public.guard_tenant_execution_status() from public,anon,authenticated;
-- These current-user membership predicates are intentional RLS dependencies,
-- not anonymous application APIs. Retain authenticated execution for policies.
revoke execute on function public.is_admin(),public.is_member(uuid),public.is_owner(uuid) from public,anon;
grant execute on function public.is_admin(),public.is_member(uuid),public.is_owner(uuid) to authenticated,service_role;
create schema if not exists extensions;
alter extension btree_gist set schema extensions;
