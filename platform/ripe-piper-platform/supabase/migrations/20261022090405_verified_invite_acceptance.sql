-- Invitations are redeemed on a verified sign-in, including for existing users.
-- Account creation alone cannot grant a tenant membership.
-- Preflight before a future rollout: inspect memberships and accepted invites whose
-- auth.users.email_confirmed_at is null; decide their resolution individually.
-- select m.tenant_id, m.user_id, u.email from public.memberships m
-- join auth.users u on u.id=m.user_id where u.email_confirmed_at is null;
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, lower(new.email), coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

create or replace function public.accept_verified_invites(p_user_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_invite record;
  v_count integer := 0;
begin
  select lower(email) into v_email from auth.users
  where id = p_user_id and email_confirmed_at is not null and email is not null;
  if v_email is null then return 0; end if;

  -- Lock each pending invite so simultaneous sessions cannot claim it twice.
  for v_invite in
    select i.id, i.tenant_id, i.role from public.invites i
    join public.tenants t on t.id = i.tenant_id
    where lower(i.email) = v_email and i.accepted_at is null
      and t.status in ('onboarding', 'active')
    order by i.id for update of i
  loop
    insert into public.memberships (tenant_id, user_id, role)
    values (v_invite.tenant_id, p_user_id, v_invite.role)
    on conflict (tenant_id, user_id) do nothing;
    update public.invites set accepted_at = now() where id = v_invite.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

revoke all on function public.accept_verified_invites(uuid) from public, anon, authenticated;
grant execute on function public.accept_verified_invites(uuid) to service_role;
