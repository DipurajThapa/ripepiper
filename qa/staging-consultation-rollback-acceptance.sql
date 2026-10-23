-- Independent QA: wgomywhuzyboxlckopca isolated staging ONLY, after consultation migration.
-- Synthetic SQL acknowledgement is not Gmail delivery. No provider/Auth API or DDL.
BEGIN;
DO $$
DECLARE
 a uuid:='fa600000-0000-4000-8000-000000000001';
 l uuid:='fa600000-0000-4000-8000-000000000021';
 past uuid:='fa600000-0000-4000-8000-000000000031';
 upcoming uuid:='fa600000-0000-4000-8000-000000000032';
 fence uuid:='fa600000-0000-4000-8000-000000000041';
 request_id uuid:='fa600000-0000-4000-8000-000000000051';
 s jsonb;j jsonb;receipt jsonb;rejected boolean;
BEGIN
 IF EXISTS(SELECT 1 FROM public.tenants) OR EXISTS(SELECT 1 FROM auth.users) OR EXISTS(SELECT 1 FROM public.meetings) THEN RAISE EXCEPTION 'QA requires empty isolated staging baseline'; END IF;
 INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES(a,'qa-consultation-staff@example.invalid',now(),'{}');
 UPDATE public.profiles SET is_admin=true WHERE id=a;
 INSERT INTO public.leads(id,source,email,status) VALUES(l,'import','qa-consultation@example.invalid','meeting_booked');
 INSERT INTO public.meetings(id,lead_id,start_at,end_at,attendee_email) VALUES(past,l,now()-interval '12 hours',now()-interval '11 hours','qa-consultation@example.invalid');
 SELECT public.consultation_snapshot(m) INTO s FROM public.meetings m WHERE id=past;
 EXECUTE 'SET LOCAL ROLE authenticated'; PERFORM set_config('request.jwt.claim.sub',a::text,true);
 rejected:=false;
 BEGIN UPDATE public.meetings SET status='no_show' WHERE id=past; EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Authenticated admin forged no-show'; END IF;
 EXECUTE 'RESET ROLE'; EXECUTE 'SET LOCAL ROLE service_role';
 j:=public.save_meeting_draft(past,s,null,null,null,null,'attendance_source_unavailable');
 IF j->>'attendance'<>'unknown' OR NOT EXISTS(SELECT 1 FROM public.meetings WHERE id=past AND status='attendance_unknown') OR NOT EXISTS(SELECT 1 FROM public.leads WHERE id=l AND status='meeting_booked') THEN RAISE EXCEPTION 'Missing source inferred attendance or blocked unknown state'; END IF;
 EXECUTE 'RESET ROLE';
 -- Unknown ended attendance must not prevent this lead's next consultation.
 INSERT INTO public.meetings(id,lead_id,start_at,end_at,attendee_email,google_event_id,meet_url,meet_code) VALUES(upcoming,l,now()+interval '2 hours',now()+interval '2 hours 15 minutes','qa-consultation@example.invalid','qa_event','https://meet.google.com/abc-defg-hij','abc-defg-hij');
 EXECUTE 'SET LOCAL ROLE service_role';
 rejected:=false;
 BEGIN PERFORM public.review_consultation_attendance(past,a,1,s,'no_show','QA incomplete roster','Incomplete roster cannot establish absence',true,false,request_id); EXCEPTION WHEN invalid_parameter_value THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Incomplete negative evidence accepted'; END IF;
 receipt:=public.review_consultation_attendance(past,a,1,s,'held','QA authoritative attendee record','Staff verifies intended attendee presence',true,false,request_id);
 IF receipt->>'classification'<>'held' OR NOT EXISTS(SELECT 1 FROM public.leads WHERE id=l AND status='meeting_held') THEN RAISE EXCEPTION 'Reviewed held attribution failed'; END IF;
 IF public.review_consultation_attendance(past,a,1,s,'held','QA authoritative attendee record','Staff verifies intended attendee presence',true,false,request_id) IS DISTINCT FROM receipt||jsonb_build_object('replayed',true) THEN RAISE EXCEPTION 'Attendance replay failed'; END IF;
 j:=public.save_meeting_draft(past,s,'Synthetic text',jsonb_build_object('summary','Draft only'),'Draft minutes','{}','transcript_unverified');
 IF j->>'attendance'<>'held' OR j->>'reviewVersion'<>'2' THEN RAISE EXCEPTION 'Draft overwrote reviewed attendance'; END IF;
 PERFORM public.review_consultation_attendance(past,a,2,s,'unknown','QA corrected evidence record','Previous presence evidence was insufficient',false,false,gen_random_uuid());
 IF NOT EXISTS(SELECT 1 FROM public.meetings WHERE id=past AND status='attendance_unknown') OR NOT EXISTS(SELECT 1 FROM public.meetings WHERE id=upcoming AND status='booked') OR NOT EXISTS(SELECT 1 FROM public.leads WHERE id=l AND status='meeting_booked') THEN RAISE EXCEPTION 'Historical correction broke current booking or retained unsupported attribution'; END IF;
 j:=public.claim_consultation_reminder(upcoming,'24h',fence);
 IF j->>'state'<>'claimed' OR EXISTS(SELECT 1 FROM public.meetings WHERE id=upcoming AND reminder_24h_at IS NOT NULL) THEN RAISE EXCEPTION 'Claim falsely acknowledged delivery'; END IF;
 IF public.claim_consultation_reminder(upcoming,'24h',gen_random_uuid()) IS NOT NULL OR public.authorize_consultation_reminder(upcoming,'24h',gen_random_uuid()) IS NOT NULL THEN RAISE EXCEPTION 'Duplicate/wrong reminder fence accepted'; END IF;
 PERFORM public.authorize_consultation_reminder(upcoming,'24h',fence);
 IF public.confirm_consultation_dispatch(upcoming,'24h',fence) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Current dispatch fence denied'; END IF;
 UPDATE public.meetings SET status='cancelled' WHERE id=upcoming;
 IF public.confirm_consultation_dispatch(upcoming,'24h',fence) THEN RAISE EXCEPTION 'Cancelled booking remained dispatchable'; END IF;
 j:=public.finish_consultation_reminder(upcoming,'24h',fence,'qa_synthetic_late_ack');
 IF j->>'state'<>'review' OR j->>'messageId'<>'qa_synthetic_late_ack' OR EXISTS(SELECT 1 FROM public.meetings WHERE id=upcoming AND reminder_24h_at IS NOT NULL) THEN RAISE EXCEPTION 'Late ack falsely certified cancelled booking'; END IF;
 IF public.claim_consultation_reminder(upcoming,'24h',gen_random_uuid()) IS NOT NULL THEN RAISE EXCEPTION 'Uncertain reminder was reacquired'; END IF;
 EXECUTE 'RESET ROLE';
END $$;
ROLLBACK;
SELECT 'PASS: hosted consultation role guard/unknown-rebook/staff-CAS/replay/correction/draft/fenced-claim/cancel/late-ack/no-resend; fixtures rolled back' AS qa_result;
