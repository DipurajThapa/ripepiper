-- Existing NULL-tenant consultation lifecycle only; no activation, backfill or new queue.
grant select on public.meetings to service_role;

alter table public.meetings drop constraint meetings_status_check;
alter table public.meetings add constraint meetings_status_check check(status in('booked','held','no_show','cancelled','rescheduled','attendance_unknown'));
alter table public.meetings add column reminder_receipts jsonb not null default '{}', add column attendance_review jsonb, add column attendance_review_version integer not null default 0 check(attendance_review_version>=0);
grant update(reminder_receipts,attendance_review,attendance_review_version,reminder_24h_at,reminder_1h_at,transcript,notes,minutes,requirements,ai_processed_at,status) on public.meetings to service_role;
grant update(status) on public.leads to service_role;
alter table public.meetings add constraint consultation_review_shape check(jsonb_typeof(reminder_receipts)='object' and reminder_receipts - '24h' - '1h'='{}'::jsonb and length(reminder_receipts::text)<=24000 and (attendance_review is null or(jsonb_typeof(attendance_review)='object' and attendance_review->>'state' in('needs_review','reviewed') and attendance_review->>'classification' in('unknown','held','no_show') and length(attendance_review::text)<=64000)));
create function public.consultation_snapshot(m public.meetings) returns jsonb language sql immutable security invoker set search_path='' as $$select jsonb_build_object('id',m.id,'tenantId',m.tenant_id,'leadId',m.lead_id,'kind',m.kind,'startAt',to_char(m.start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'endAt',to_char(m.end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'email',m.attendee_email,'name',m.attendee_name,'eventId',m.google_event_id,'meetUrl',m.meet_url,'meetCode',m.meet_code)$$;
revoke all on function public.consultation_snapshot(public.meetings) from public,anon,authenticated;
grant execute on function public.consultation_snapshot(public.meetings) to service_role;
create function public.guard_consultation_review() returns trigger language plpgsql security invoker set search_path='' as $$
declare w text;r jsonb;review_log bigint;
begin
 if current_user not in('service_role','postgres') and ((tg_op='INSERT' and(new.reminder_receipts<>'{}'::jsonb or new.attendance_review is not null or new.attendance_review_version<>0 or new.status in('held','no_show') or new.reminder_24h_at is not null or new.reminder_1h_at is not null)) or(tg_op='UPDATE' and(new.reminder_receipts is distinct from old.reminder_receipts or new.attendance_review is distinct from old.attendance_review or new.attendance_review_version<>old.attendance_review_version or new.reminder_24h_at is distinct from old.reminder_24h_at or new.reminder_1h_at is distinct from old.reminder_1h_at or(new.status is distinct from old.status and new.status in('held','no_show'))))) then raise exception 'Service-reviewed consultation evidence required' using errcode='42501';end if;
 if tg_op='UPDATE' and(new.status is distinct from old.status or row(new.tenant_id,new.lead_id,new.kind,new.start_at,new.end_at,new.attendee_email,new.attendee_name,new.google_event_id,new.meet_url,new.meet_code) is distinct from row(old.tenant_id,old.lead_id,old.kind,old.start_at,old.end_at,old.attendee_email,old.attendee_name,old.google_event_id,old.meet_url,old.meet_code)) then
  foreach w in array array['24h','1h'] loop r:=new.reminder_receipts->w;if r->>'state' in('claimed','dispatching') then new.reminder_receipts:=jsonb_set(new.reminder_receipts,array[w],r||jsonb_build_object('state','review','reason','booking_changed','reviewAt',now()));end if;end loop;
  if old.attendance_review is not null and ((new.status is distinct from old.status and (new.status in('cancelled','rescheduled') or current_user not in('service_role','postgres'))) or row(new.tenant_id,new.lead_id,new.kind,new.start_at,new.end_at,new.attendee_email,new.attendee_name,new.google_event_id,new.meet_url,new.meet_code) is distinct from row(old.tenant_id,old.lead_id,old.kind,old.start_at,old.end_at,old.attendee_email,old.attendee_name,old.google_event_id,old.meet_url,old.meet_code)) then
   insert into public.activity_log(actor,kind,message,visible_to_client) values(current_user,'note',jsonb_build_object('meeting',old.id,'reason','booking_identity_changed','previousAttendance',old.attendance_review,'previousVersion',old.attendance_review_version)::text,false) returning id into review_log;
   new.attendance_review:=jsonb_build_object('state','needs_review','classification','unknown','reason','booking_identity_changed','observedAt',now(),'priorReviewLog',review_log);new.attendance_review_version:=old.attendance_review_version+1;
   if new.status in('held','no_show') then new.status:=case when new.end_at>now() then 'booked' else 'attendance_unknown' end;end if;
   if old.tenant_id is null and old.attendance_review->>'classification'='held' and old.attendance_review->>'state'='reviewed' then
    update public.leads set status='meeting_booked' where id=old.lead_id and tenant_id is null and status='meeting_held' and not exists(select 1 from public.meetings other where other.id<>old.id and other.lead_id=old.lead_id and other.tenant_id is null and other.status='held' and other.attendance_review->>'state'='reviewed' and other.attendance_review->>'classification'='held');
   end if;
  end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_consultation_review() from public,anon,authenticated;
create trigger guard_consultation_review before insert or update on public.meetings for each row execute function public.guard_consultation_review();
create function public.consultation_window_due(m public.meetings,w text) returns boolean language sql stable security invoker set search_path='' as $$select m.tenant_id is null and m.status='booked' and m.start_at>now() and m.google_event_id is not null and m.meet_url ~ '^https://meet\.google\.com/[a-z]{3}-[a-z]{4}-[a-z]{3}$' and case when w='1h' then m.reminder_1h_at is null and m.start_at<=now()+interval '65 minutes' when w='24h' then m.reminder_24h_at is null and m.start_at>now()+interval '65 minutes' and m.start_at<=now()+interval '1445 minutes' else false end$$;
revoke all on function public.consultation_window_due(public.meetings,text) from public,anon,authenticated;
grant execute on function public.consultation_window_due(public.meetings,text) to service_role;
create function public.claim_consultation_reminder(p_meeting uuid,p_window text,p_token uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.meetings%rowtype;r jsonb;
begin
 if current_user<>'service_role' then raise exception 'Service required' using errcode='42501';end if;
 if p_token is null or p_window is null or p_window not in('24h','1h') then raise exception 'Invalid claim' using errcode='22023';end if;
 select * into m from public.meetings where id=p_meeting and tenant_id is null for update;if not found then return null;end if;
 r:=m.reminder_receipts->p_window;
 if r is not null then
  if r->>'state' in('claimed','dispatching') and(r->>'leaseUntil')::timestamptz<=now() then update public.meetings set reminder_receipts=jsonb_set(reminder_receipts,array[p_window],r||jsonb_build_object('state','review','reason','lease_expired_uncertain','reviewAt',now())) where id=m.id;end if;
  return null;
 end if;
 if exists(select 1 from jsonb_each(m.reminder_receipts) x where x.key<>p_window and x.value->>'state' in('claimed','dispatching','review')) or not public.consultation_window_due(m,p_window) then return null;end if;
 r:=jsonb_build_object('meetingId',m.id,'window',p_window,'token',p_token,'state','claimed','claimedAt',now(),'leaseUntil',now()+interval '2 minutes','snapshot',public.consultation_snapshot(m));
 update public.meetings set reminder_receipts=jsonb_set(reminder_receipts,array[p_window],r) where id=m.id;return r;
end $$;
revoke all on function public.claim_consultation_reminder(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.claim_consultation_reminder(uuid,text,uuid) to service_role;
create function public.authorize_consultation_reminder(p_meeting uuid,p_window text,p_token uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.meetings%rowtype;r jsonb;
begin
 if current_user<>'service_role' then raise exception 'Service required' using errcode='42501';end if;
 select * into m from public.meetings where id=p_meeting and tenant_id is null for update;r:=m.reminder_receipts->p_window;
 if r->>'token' is distinct from p_token::text or r->>'state' is distinct from 'claimed' then return null;end if;
 if not public.consultation_window_due(m,p_window) or(r->>'leaseUntil')::timestamptz<=now() or r->'snapshot' is distinct from public.consultation_snapshot(m) then
  update public.meetings set reminder_receipts=jsonb_set(reminder_receipts,array[p_window],r||jsonb_build_object('state','review','reason','booking_or_lease_changed','reviewAt',now())) where id=m.id;return null;end if;
 r:=r||jsonb_build_object('state','dispatching','authorizedAt',now(),'leaseUntil',now()+interval '2 minutes');update public.meetings set reminder_receipts=jsonb_set(reminder_receipts,array[p_window],r) where id=m.id;return r;
end $$;
revoke all on function public.authorize_consultation_reminder(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.authorize_consultation_reminder(uuid,text,uuid) to service_role;
-- Read-only final check after token refresh, immediately before the Gmail request.
create function public.confirm_consultation_dispatch(p_meeting uuid,p_window text,p_token uuid) returns boolean language plpgsql stable security invoker set search_path='' as $$
declare m public.meetings%rowtype;r jsonb;
begin
 if current_user<>'service_role' then raise exception 'Service required' using errcode='42501';end if;
 select * into m from public.meetings where id=p_meeting and tenant_id is null;r:=m.reminder_receipts->p_window;
 return coalesce(r->>'token'=p_token::text and r->>'state'='dispatching' and(r->>'leaseUntil')::timestamptz>now() and r->'snapshot'=public.consultation_snapshot(m) and public.consultation_window_due(m,p_window),false);
end $$;
revoke all on function public.confirm_consultation_dispatch(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.confirm_consultation_dispatch(uuid,text,uuid) to service_role;
create function public.hold_consultation_reminder(p_meeting uuid,p_window text,p_token uuid) returns boolean language plpgsql security invoker set search_path='' as $$
declare m public.meetings%rowtype;r jsonb;
begin
 if current_user<>'service_role' then raise exception 'Service required' using errcode='42501';end if;
 select * into m from public.meetings where id=p_meeting and tenant_id is null for update;r:=m.reminder_receipts->p_window;
 if r->>'token' is distinct from p_token::text then return false;end if;
 if r->>'state' in('claimed','dispatching') then update public.meetings set reminder_receipts=jsonb_set(reminder_receipts,array[p_window],r||jsonb_build_object('state','review','reason','delivery_uncertain','reviewAt',now())) where id=m.id;end if;return true;
end $$;
revoke all on function public.hold_consultation_reminder(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.hold_consultation_reminder(uuid,text,uuid) to service_role;
create function public.finish_consultation_reminder(p_meeting uuid,p_window text,p_token uuid,p_message text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.meetings%rowtype;r jsonb;current_booking boolean;
begin
 if current_user<>'service_role' then raise exception 'Service required' using errcode='42501';end if;
 if coalesce(p_message,'') !~ '^[a-zA-Z0-9_-]{1,128}$' then raise exception 'Provider acknowledgement required' using errcode='22023';end if;
 select * into m from public.meetings where id=p_meeting and tenant_id is null for update;r:=m.reminder_receipts->p_window;
 if r->>'token' is distinct from p_token::text or r->>'state' not in('dispatching','review','acknowledged') or r is null then raise exception 'Claim changed' using errcode='40001';end if;
 if r->>'messageId' is not null then if r->>'messageId'<>p_message then raise exception 'Acknowledgement changed' using errcode='40001';end if;return r;end if;
 current_booking:=r->>'state'='dispatching' and(r->>'leaseUntil')::timestamptz>now() and public.consultation_window_due(m,p_window) and r->'snapshot'=public.consultation_snapshot(m);
 r:=r||jsonb_build_object('state',case when current_booking then 'acknowledged' else 'review' end,'messageId',p_message,'acknowledgedAt',now(),'reason',case when current_booking then 'provider_acknowledged' else 'late_ack_booking_review' end);
 update public.meetings set reminder_receipts=jsonb_set(reminder_receipts,array[p_window],r),reminder_24h_at=case when current_booking and p_window='24h' then now() else reminder_24h_at end,reminder_1h_at=case when current_booking and p_window='1h' then now() else reminder_1h_at end where id=m.id;return r;
end $$;
revoke all on function public.finish_consultation_reminder(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.finish_consultation_reminder(uuid,text,uuid,text) to service_role;
create function public.save_meeting_draft(p_meeting uuid,p_snapshot jsonb,p_transcript text,p_notes jsonb,p_minutes text,p_requirements jsonb,p_reason text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.meetings%rowtype;review jsonb;v integer;
begin
 if current_user<>'service_role' then raise exception 'Service required' using errcode='42501';end if;
 select * into m from public.meetings where id=p_meeting for update;
 if not found or m.status in('cancelled','rescheduled') or public.consultation_snapshot(m) is distinct from p_snapshot then raise exception 'Meeting changed' using errcode='40001';end if;
 if m.tenant_id is not null and not exists(select 1 from public.tenants where id=m.tenant_id and status='active') then raise exception 'Tenant unavailable' using errcode='22023';end if;
 if length(coalesce(p_transcript,''))>256000 or length(coalesce(p_notes::text,''))>64000 or length(coalesce(p_minutes,''))>64000 or length(coalesce(p_requirements::text,''))>64000 or p_reason is null or p_reason not in('transcript_unverified','attendance_source_unavailable','analysis_unavailable') then raise exception 'Invalid draft' using errcode='22023';end if;
 review:=m.attendance_review;v:=m.attendance_review_version;
 if review is null or review->>'state'<>'reviewed' or review->'snapshot' is distinct from p_snapshot then v:=v+1;review:=jsonb_build_object('state','needs_review','classification','unknown','reason',p_reason,'observedAt',now(),'snapshot',p_snapshot);end if;
 update public.meetings set transcript=coalesce(p_transcript,transcript),notes=coalesce(p_notes,notes),minutes=coalesce(p_minutes,minutes),requirements=coalesce(p_requirements,requirements),ai_processed_at=now(),attendance_review=review,attendance_review_version=v,status=case when review->>'state'='reviewed' and review->>'classification' in('held','no_show') then status when m.end_at<=now() then 'attendance_unknown' else status end where id=m.id;
 return jsonb_build_object('meetingId',m.id,'reviewVersion',v,'attendance',review->>'classification','notesReady',p_notes is not null);
end $$;
revoke all on function public.save_meeting_draft(uuid,jsonb,text,jsonb,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.save_meeting_draft(uuid,jsonb,text,jsonb,text,jsonb,text) to service_role;
create function public.review_consultation_attendance(p_meeting uuid,p_actor uuid,p_expected integer,p_snapshot jsonb,p_classification text,p_evidence text,p_reason text,p_verified boolean,p_roster boolean,p_request uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.meetings%rowtype;r jsonb;history jsonb;body jsonb;
begin
 if current_user<>'service_role' or not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=p_actor and p.is_admin and u.email_confirmed_at is not null and lower(u.email)=lower(p.email)) then raise exception 'Current staff identity required' using errcode='42501';end if;
 select * into m from public.meetings where id=p_meeting and tenant_id is null for update;
 if not found or m.status in('cancelled','rescheduled') or public.consultation_snapshot(m) is distinct from p_snapshot or m.end_at>now() then raise exception 'Meeting changed or not finished' using errcode='40001';end if;
 if p_request is null or p_verified is null or p_roster is null or p_expected is null or p_expected<0 or p_classification is null or p_classification not in('held','no_show','unknown') or coalesce(length(trim(p_evidence)),0) not between 8 and 500 or coalesce(length(trim(p_reason)),0) not between 8 and 1000 or(p_classification<>'unknown' and p_verified is distinct from true) or(p_classification='no_show' and p_roster is distinct from true) then raise exception 'Reviewed authoritative attendance evidence required' using errcode='22023';end if;
 body:=jsonb_build_object('classification',p_classification,'actor',p_actor,'evidenceReference',trim(p_evidence),'reason',trim(p_reason),'verified',p_verified,'rosterComplete',p_roster,'snapshot',p_snapshot);
 if m.attendance_review->>'requestId'=p_request::text then
  if m.attendance_review_version=p_expected+1 and m.attendance_review - 'history' - 'reviewedAt' - 'requestId' - 'state'=body then return jsonb_build_object('meetingId',m.id,'version',m.attendance_review_version,'classification',p_classification,'replayed',true);end if;raise exception 'Review request reused' using errcode='40001';end if;
 if m.attendance_review_version<>p_expected then raise exception 'Attendance review changed' using errcode='40001';end if;
 history:=coalesce(m.attendance_review->'history','[]'::jsonb);if m.attendance_review is not null then history:=history||jsonb_build_array(m.attendance_review-'history');end if;
 if jsonb_array_length(history)>=50 then raise exception 'Review history needs retention review' using errcode='22023';end if;
 r:=body||jsonb_build_object('state','reviewed','requestId',p_request,'reviewedAt',now(),'history',history);
 if length(r::text)>64000 then raise exception 'Review history needs retention review' using errcode='22023';end if;
 update public.meetings set attendance_review=r,attendance_review_version=attendance_review_version+1,status=case when p_classification='unknown' then 'attendance_unknown' else p_classification end where id=m.id;
 if p_classification='held' and m.lead_id is not null then update public.leads set status='meeting_held' where id=m.lead_id and tenant_id is null and status in('qualified','meeting_booked');end if;
 if p_classification<>'held' and m.attendance_review->>'state'='reviewed' and m.attendance_review->>'classification'='held' then
  update public.leads set status='meeting_booked' where id=m.lead_id and tenant_id is null and status='meeting_held' and not exists(select 1 from public.meetings other where other.id<>m.id and other.lead_id=m.lead_id and other.tenant_id is null and other.status='held' and other.attendance_review->>'state'='reviewed' and other.attendance_review->>'classification'='held');
 end if;
 insert into public.activity_log(actor,kind,message,visible_to_client)values(p_actor::text,'note','Consultation attendance reviewed: '||m.id::text||' version '||(m.attendance_review_version+1)::text||' classification '||p_classification,false);
 return jsonb_build_object('meetingId',m.id,'version',m.attendance_review_version+1,'classification',p_classification,'replayed',false);
end $$;
revoke all on function public.review_consultation_attendance(uuid,uuid,integer,jsonb,text,text,text,boolean,boolean,uuid) from public,anon,authenticated;
grant execute on function public.review_consultation_attendance(uuid,uuid,integer,jsonb,text,text,text,boolean,boolean,uuid) to service_role;
