-- Independent QA. Execute ONLY on empty isolated staging wgomywhuzyboxlckopca.
-- Requires Events migration and retention correction. No DDL or provider calls.
BEGIN;
DO $$
DECLARE
 a uuid:='fa200000-0000-4000-8000-000000000001';
 t uuid:='fa200000-0000-4000-8000-000000000011';
 c uuid:='fa200000-0000-4000-8000-000000000041';
 h text:=repeat('a',64); j jsonb; s jsonb; rejected boolean; n integer;
BEGIN
 IF EXISTS(SELECT 1 FROM public.tenants) OR EXISTS(SELECT 1 FROM auth.users) THEN RAISE EXCEPTION 'QA requires empty isolated staging baseline'; END IF;
 INSERT INTO public.tenants(id,name,slug,country,currency,status) VALUES(t,'QA Events rollback','qa-events-rollback','AE','AED','active');
 INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES(a,'qa-events-staff@example.invalid',now(),'{}');
 UPDATE public.profiles SET is_admin=true WHERE id=a;
 INSERT INTO public.business_briefs(tenant_id,version,body,created_by) VALUES(t,1,jsonb_build_object('maxAgeDays',30,'source',jsonb_build_object('observedAt',now())),a);
 INSERT INTO public.campaigns(id,tenant_id,capability,operator_id,purpose,channel,market,timezone,status,client_authority_ref,owner_authority_ref,cts_profile_ref,expires_at,max_actions)
 VALUES(c,t,'events',a,'event-only','event','AE','UTC','approved','qa-client','qa-owner','qa-profile',now()+interval '14 days',10);
 INSERT INTO public.campaign_assets(tenant_id,campaign_id,version,brief_version,steps,created_by,approved_by,approved_at)
 VALUES(t,c,1,1,'[{"offsetHours":0,"subject":"QA fixture","body":"Synthetic only","evidenceReference":"qa-event"}]',a,a,now());
 s:=jsonb_build_object('title','QA synthetic event','startsAt',now()+interval '2 days','endsAt',now()+interval '2 days 1 hour','timezone','UTC','capacity',1,'open',true,'noticeReference','QA event only','confirmed',true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 rejected:=false;
 BEGIN PERFORM public.register_synthetic_event(c,1,'qa-one@example.invalid','QA one',h); EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Authenticated Events RPC accepted'; END IF;
 EXECUTE 'RESET ROLE'; EXECUTE 'SET LOCAL ROLE service_role';
 j:=public.manage_event_settings(t,c,a,0,s);
 IF j->>'version'<>'1' OR public.event_public_metadata(c)->>'mode'<>'synthetic_only' THEN RAISE EXCEPTION 'Reviewed event setup failed'; END IF;
 rejected:=false;
 BEGIN PERFORM public.register_synthetic_event(c,1,'real@business.example','Real address',repeat('b',64)); EXCEPTION WHEN invalid_parameter_value THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Real email accepted'; END IF;
 j:=public.register_synthetic_event(c,1,'qa-one@example.invalid','QA one',h);
 IF j->>'state'<>'registered' OR j->>'identityStatus'<>'unverified' OR j->>'attendance'<>'unknown' OR j->>'marketingPermission'<>'not_granted' OR j->>'delivery'<>'not_sent' THEN RAISE EXCEPTION 'Registration truth boundary failed'; END IF;
 IF public.read_synthetic_registration(c,1,'qa-one@example.invalid','QA one',h) IS DISTINCT FROM j THEN RAISE EXCEPTION 'Committed receipt recovery failed'; END IF;
 IF public.register_synthetic_event(c,1,'qa-one@example.invalid','QA one',repeat('c',64))->>'state'<>'request_received' THEN RAISE EXCEPTION 'Different capability controlled existing registration'; END IF;
 rejected:=false;
 BEGIN PERFORM public.register_synthetic_event(c,1,'qa-two@example.invalid','QA two',repeat('d',64)); EXCEPTION WHEN invalid_parameter_value THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Capacity exceeded'; END IF;
 IF EXISTS(SELECT 1 FROM public.contact_rights WHERE tenant_id=t) OR EXISTS(SELECT 1 FROM public.outbound_actions WHERE tenant_id=t) THEN RAISE EXCEPTION 'Registration created rights or outbound action'; END IF;
 SELECT count(*) INTO n FROM public.lead_observations WHERE tenant_id=t AND source='event_registration' AND synthetic AND assessment_reviewed_by IS NULL;
 IF n<>1 THEN RAISE EXCEPTION 'Intake was duplicated or silently reviewed'; END IF;
 s:=jsonb_set(s,'{title}','"QA changed event"');
 PERFORM public.manage_event_settings(t,c,a,1,s);
 IF public.event_public_metadata(c) IS NOT NULL OR EXISTS(SELECT 1 FROM public.campaign_assets WHERE campaign_id=c AND approved_by IS NOT NULL) THEN RAISE EXCEPTION 'Material change retained approval'; END IF;
 IF public.read_synthetic_registration(c,1,'qa-one@example.invalid','QA one',h)->>'state'<>'schedule_changed' THEN RAISE EXCEPTION 'Schedule change hidden'; END IF;
 IF public.change_synthetic_registration(c,2,h,'cancel')->>'state'<>'cancelled' THEN RAISE EXCEPTION 'Cancellation while campaign draft failed'; END IF;
 IF public.register_synthetic_event(c,1,'qa-one@example.invalid','QA one',h)->>'state'<>'cancelled' THEN RAISE EXCEPTION 'Replay resurrected cancellation'; END IF;
 UPDATE public.campaigns SET event_settings=jsonb_set(event_settings,'{endsAt}',to_jsonb((now()-interval '8 days')::text)) WHERE id=c;
 UPDATE public.lead_observations SET product_context=jsonb_set(product_context,'{endsAt}',to_jsonb((now()-interval '8 days')::text)) WHERE tenant_id=t AND source='event_registration';
 rejected:=false;
 BEGIN PERFORM public.read_synthetic_registration(c,1,'qa-one@example.invalid','QA one',h); EXCEPTION WHEN invalid_parameter_value THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Expired capability receipt accepted'; END IF;
 rejected:=false;
 BEGIN PERFORM public.register_synthetic_event(c,1,'qa-one@example.invalid','QA one',h); EXCEPTION WHEN invalid_parameter_value THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Expired capability replay accepted'; END IF;
 EXECUTE 'RESET ROLE';
END $$;
ROLLBACK;
SELECT 'PASS: hosted Events grants/settings/intake/capacity/replay/approval/cancellation/retention; all synthetic fixtures rolled back' AS qa_result;
