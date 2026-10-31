-- Staff change an accepted client member's role (owner <-> viewer). Owners approve quotations and payments,
-- so a client that has owners keeps at least one. Only the Worker's service role calls this, after an admin check.
create or replace function public.set_member_role(p_tenant uuid,p_email text,p_role text,p_actor uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.memberships%rowtype;
begin
 if current_user<>'service_role' or not exists(select 1 from public.profiles where id=p_actor and is_admin) then raise exception 'Staff required' using errcode='42501'; end if;
 if p_role not in ('owner','viewer') then raise exception 'Choose an owner or viewer role' using errcode='22023'; end if;
 perform 1 from public.tenants where id=p_tenant for update;
 if not found then raise exception 'Tenant missing' using errcode='23503'; end if;
 select ms.* into m from public.memberships ms join public.profiles p on p.id=ms.user_id
  where ms.tenant_id=p_tenant and lower(p.email)=lower(p_email) for update of ms;
 if not found then raise exception 'Member not found' using errcode='P0002'; end if;
 if m.role='owner' and p_role='viewer' and not exists(select 1 from public.memberships where tenant_id=p_tenant and role='owner' and user_id<>m.user_id) then
  raise exception 'Last owner' using errcode='23514'; end if;
 update public.memberships set role=p_role where tenant_id=p_tenant and user_id=m.user_id;
 update public.invites set role=p_role where tenant_id=p_tenant and lower(email)=lower(p_email);
 return jsonb_build_object('tenant_id',p_tenant,'user_id',m.user_id,'role',p_role,'previous_role',m.role);
end $$;
grant select,update on public.memberships,public.invites to service_role;
revoke all on function public.set_member_role(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.set_member_role(uuid,text,text,uuid) to service_role;
