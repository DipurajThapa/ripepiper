-- Reserve the public consultation and consume its capability in one transaction.
create function public.reserve_consultation(p_lead uuid, p_hash text, p_meeting uuid, p_event text, p_start timestamptz, p_end timestamptz, p_email text, p_name text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare l public.leads%rowtype;
begin
  select * into l from public.leads where id=p_lead and tenant_id is null for update;
  if not found or l.status <> 'qualified' or l.booking_token_hash is distinct from p_hash
     or l.email is distinct from p_email or l.name is distinct from p_name
     or l.booking_token_used_at is not null or l.booking_token_expires_at is null
     or l.booking_token_expires_at <= now() then return false; end if;
  insert into public.meetings(id,google_event_id,lead_id,kind,start_at,end_at,attendee_email,attendee_name)
    values(p_meeting,p_event,l.id,'discovery',p_start,p_end,l.email,l.name);
  update public.leads set booking_token_used_at=now() where id=l.id;
  return true;
end $$;
revoke all on function public.reserve_consultation(uuid,text,uuid,text,timestamptz,timestamptz,text,text) from public, anon, authenticated;
grant execute on function public.reserve_consultation(uuid,text,uuid,text,timestamptz,timestamptz,text,text) to service_role;

