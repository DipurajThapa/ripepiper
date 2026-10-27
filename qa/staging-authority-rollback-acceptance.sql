-- Isolated wgomywhuzyboxlckopca only; integrator must pin the connector project_id.
-- Prepared for the current 37-migration schema; source/local rehearsal only.
-- Adapted from the immutable prior audit packet; no hosted execution is authorized.
-- Synthetic SQL fixtures only, including reserved .example addresses for live-mode predicates.
-- No DDL, provider/API calls, Auth API, deployment or persistent fixture authority.
-- PostgreSQL identity sequences can advance despite rollback; no fixture rows persist.
BEGIN;
DO $$
DECLARE
 a uuid:='fa700000-0000-4000-8000-000000000001';
 t uuid:='fa700000-0000-4000-8000-000000000011';
 l uuid:='fa700000-0000-4000-8000-000000000021';
 tl uuid:='fa700000-0000-4000-8000-000000000022';
 book_lead uuid:='fa700000-0000-4000-8000-000000000023';
 m uuid:='fa700000-0000-4000-8000-000000000031';
 tm uuid:='fa700000-0000-4000-8000-000000000032';
 booked uuid:='fa700000-0000-4000-8000-000000000033';
 proposal uuid:='fa700000-0000-4000-8000-000000000041';
 payment uuid:='fa700000-0000-4000-8000-000000000051';
 fixture_email text:='audit-preference@example.invalid';
 anchor timestamptz:=date_trunc('hour',now())+interval '7 days';
 observed timestamptz:=now()-interval '1 minute';
 expires timestamptz:=now()+interval '10 minutes';
 hash text:=repeat('7',64);
 gc uuid:='fa700000-0000-4000-8000-000000000061';
 gl uuid:='fa700000-0000-4000-8000-000000000062';
 other_t uuid:='fa700000-0000-4000-8000-000000000063';
 other_l uuid:='fa700000-0000-4000-8000-000000000064';
 receipt jsonb; stop_before timestamptz;
 token uuid; event_id uuid; replay_id uuid; version integer; current_version integer;
 tenant_before jsonb; lead_before jsonb; agency_before jsonb; confirmed_before timestamptz;
 n bigint; rejected boolean; relation record; signature text;
 context jsonb:='{"product":"response","kind":"reply","threadRef":"gmail:fa700000-0000-4000-8000-000000000061:thread","disposition":"human","need":"","authority":"","timing":""}';
BEGIN
 IF current_database()<>'postgres' THEN RAISE EXCEPTION 'Unexpected database'; END IF;
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'Expected controlled postgres QA session'; END IF;
 IF EXISTS(SELECT 1 FROM auth.users) THEN RAISE EXCEPTION 'QA requires empty isolated staging auth'; END IF;
 FOR relation IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('build_budget','fx_rates') LOOP
  EXECUTE format('SELECT count(*) FROM public.%I',relation.tablename) INTO n;
  IF n<>0 THEN RAISE EXCEPTION 'QA requires empty isolated staging table: %',relation.tablename; END IF;
 END LOOP;
 IF (SELECT count(*) FROM public.build_budget)<>1 OR EXISTS(SELECT 1 FROM public.build_budget WHERE enabled OR prior_micro IS NOT NULL) THEN RAISE EXCEPTION 'QA requires dormant unreconciled budget'; END IF;

 -- Check every new callable function's client denial and service access.
 FOREACH signature IN ARRAY ARRAY[
  'public.reserve_consultation(uuid,text,uuid,text,timestamptz,timestamptz,text,text)',
  'public.confirm_agency_opt_out(text)','public.issue_agency_opt_out(text,text)',
  'public.request_agency_newsletter(text)','public.confirm_agency_newsletter(uuid)',
  'public.record_gmail_product_event(integer,timestamptz,uuid,uuid,uuid,text,text,text,timestamptz,boolean,jsonb)',
  'public.register_tenant_google_authority(uuid,uuid,integer,integer,uuid,text,text,text,text,timestamptz)',
  'public.revoke_tenant_google_authority(uuid,uuid,integer)',
  'public.tenant_google_authority_current(uuid,uuid,integer,integer,text)',
  'public.record_authorized_gmail_event(integer,timestamptz,uuid,uuid,uuid,text,text,text,timestamptz,boolean,jsonb,integer,text)',
  'public.issue_tenant_unsubscribe(uuid,uuid,uuid,text)',
  'public.confirm_tenant_unsubscribe(text)'
 ] LOOP
  IF has_function_privilege('anon',signature,'EXECUTE') OR has_function_privilege('authenticated',signature,'EXECUTE') OR NOT has_function_privilege('service_role',signature,'EXECUTE') THEN RAISE EXCEPTION 'Unexpected function grants: %',signature; END IF;
 END LOOP;
 INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES(a,'audit-staff@example.invalid',now(),'{}');
 UPDATE public.profiles SET is_admin=true WHERE id=a;
 -- Direct fixture setup models active authority only inside this rolled-back transaction.
 INSERT INTO public.tenants(id,name,slug,country,currency,status) VALUES(t,'Audit rollback fixture','audit-rollback','AE','AED','active');
 INSERT INTO public.leads(id,tenant_id,source,email,status) VALUES(l,null,'book_form',fixture_email,'qualified'),(tl,t,'import',fixture_email,'qualified');
 INSERT INTO public.meetings(id,tenant_id,lead_id,start_at,end_at,attendee_email) VALUES(m,null,l,anchor,anchor+interval '15 minutes',fixture_email),(tm,t,tl,anchor,anchor+interval '15 minutes',fixture_email);
 INSERT INTO public.proposals(id,tenant_id,lead_id,kind,plan,package,currency,fixed_amount,content_md,client_email) VALUES(proposal,t,tl,'pre','sprint','response','AED',1000,'Synthetic fixture',fixture_email);
 INSERT INTO public.payments(id,tenant_id,proposal_id,provider,provider_ref,purpose,amount,currency,status) VALUES(payment,t,proposal,'bank','audit-rollback-payment','advance',100,'AED','pending');
 UPDATE public.leads SET company='Synthetic tenant fixture' WHERE id=tl;
 UPDATE public.meetings SET attendee_name='Synthetic tenant fixture' WHERE id=tm;
 IF (SELECT count(*) FROM public.sheet_outbox)<>4
  OR (SELECT count(*) FROM public.sheet_outbox WHERE entity='lead' AND entity_id=l)<>1
  OR (SELECT count(*) FROM public.sheet_outbox WHERE entity='meeting' AND entity_id=m)<>1
  OR (SELECT count(*) FROM public.sheet_outbox WHERE entity='proposal' AND entity_id=proposal)<>1
  OR (SELECT count(*) FROM public.sheet_outbox WHERE entity='payment' AND entity_id=payment)<>1
  OR EXISTS(SELECT 1 FROM public.sheet_outbox WHERE entity_id IN(tl,tm)) THEN RAISE EXCEPTION 'Sheet outbox tenant isolation or retained finance path failed'; END IF;

 -- Public consultation: exclusion failure must not consume capability or leave a meeting.
 INSERT INTO public.leads(id,source,email,status,booking_token_hash,booking_token_expires_at) VALUES(book_lead,'book_form','audit-booking@example.invalid','qualified',hash,now()+interval '1 day');
 EXECUTE 'SET LOCAL ROLE service_role';
 rejected:=false;
 BEGIN PERFORM public.reserve_consultation(book_lead,hash,booked,'audit-booking-event',anchor,anchor+interval '15 minutes','audit-booking@example.invalid',null); EXCEPTION WHEN exclusion_violation THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Overlapping consultation accepted'; END IF;
 IF EXISTS(SELECT 1 FROM public.meetings WHERE id=booked) OR EXISTS(SELECT 1 FROM public.leads WHERE id=book_lead AND booking_token_used_at IS NOT NULL) THEN RAISE EXCEPTION 'Failed reservation left meeting or consumed capability'; END IF;
 IF public.reserve_consultation(book_lead,repeat('8',64),booked,'audit-booking-event',anchor+interval '1 hour',anchor+interval '75 minutes','audit-booking@example.invalid',null) IS DISTINCT FROM false THEN RAISE EXCEPTION 'Wrong consultation capability accepted'; END IF;
 IF public.reserve_consultation(book_lead,hash,booked,'audit-booking-event',anchor+interval '1 hour',anchor+interval '75 minutes','audit-booking@example.invalid',null) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Valid consultation reservation failed'; END IF;
 IF public.reserve_consultation(book_lead,hash,gen_random_uuid(),'audit-booking-replay',anchor+interval '2 hours',anchor+interval '135 minutes','audit-booking@example.invalid',null) IS DISTINCT FROM false THEN RAISE EXCEPTION 'Consultation capability reused'; END IF;
 IF (SELECT count(*) FROM public.meetings WHERE lead_id=book_lead)<>1 OR NOT EXISTS(SELECT 1 FROM public.leads WHERE id=book_lead AND booking_token_used_at IS NOT NULL) THEN RAISE EXCEPTION 'Reservation receipt/token mismatch'; END IF;
 EXECUTE 'RESET ROLE';
 EXECUTE 'SET LOCAL ROLE authenticated';PERFORM set_config('request.jwt.claim.sub',a::text,true);
 rejected:=false;BEGIN PERFORM public.reserve_consultation(book_lead,hash,gen_random_uuid(),'audit-denied',anchor+interval '2 hours',anchor+interval '135 minutes','audit-booking@example.invalid',null);EXCEPTION WHEN insufficient_privilege THEN rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Authenticated consultation RPC permitted'; END IF;
 rejected:=false;BEGIN PERFORM public.confirm_agency_opt_out(repeat('d',64));EXCEPTION WHEN insufficient_privilege THEN rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Authenticated preference RPC permitted'; END IF;
 rejected:=false;BEGIN PERFORM public.record_gmail_product_event(0,expires,t,tl,a,'gmail:audit:denied','synthetic-source','Synthetic message',observed,true,context);EXCEPTION WHEN insufficient_privilege THEN rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Authenticated Gmail RPC permitted'; END IF;
 EXECUTE 'RESET ROLE';

 -- Preference change affects agency newsletter/suppression only, never tenant lifecycle.
 SELECT to_jsonb(x) INTO tenant_before FROM public.tenants x WHERE id=t;
 SELECT to_jsonb(x) INTO lead_before FROM public.leads x WHERE id=tl;
 SELECT to_jsonb(x) INTO agency_before FROM public.leads x WHERE id=l;
 INSERT INTO public.suppression(email,reason) VALUES('audit-existing-objection@example.invalid','Preserve existing objection');
 EXECUTE 'SET LOCAL ROLE service_role';
 token:=public.request_agency_newsletter(fixture_email);
 IF token IS NULL THEN RAISE EXCEPTION 'Newsletter fixture preparation failed'; END IF;
 IF public.issue_agency_opt_out(fixture_email,repeat('d',64)) IS DISTINCT FROM true OR public.issue_agency_opt_out(fixture_email,repeat('f',64)) IS DISTINCT FROM false THEN RAISE EXCEPTION 'Preference issue/throttle failed'; END IF;
 INSERT INTO public.agency_opt_out_requests(token_hash,email) VALUES(repeat('f',64),fixture_email);
 IF public.confirm_agency_opt_out(repeat('d',64)) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Preference confirmation failed'; END IF;
 EXECUTE 'RESET ROLE';
 SELECT confirmed_at INTO confirmed_before FROM public.agency_opt_out_requests WHERE token_hash=repeat('d',64);
 IF confirmed_before IS NULL OR NOT EXISTS(SELECT 1 FROM public.newsletter_subscribers WHERE newsletter_subscribers.email=fixture_email AND status='unsubscribed' AND unsubscribed_at IS NOT NULL) THEN RAISE EXCEPTION 'Newsletter opt-out receipt missing'; END IF;
 EXECUTE 'SET LOCAL ROLE service_role';
 IF public.request_agency_newsletter(fixture_email) IS NOT NULL OR public.confirm_agency_newsletter(token) IS DISTINCT FROM false THEN RAISE EXCEPTION 'Newsletter objection was overwritten'; END IF;
 IF public.confirm_agency_opt_out(repeat('f',64)) IS DISTINCT FROM false THEN RAISE EXCEPTION 'Sibling preference token remained valid'; END IF;
 UPDATE public.agency_opt_out_requests SET expires_at=now()-interval '1 second' WHERE token_hash=repeat('d',64);
 IF public.confirm_agency_opt_out(repeat('d',64)) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Confirmed preference replay failed after expiry'; END IF;
 IF (SELECT confirmed_at FROM public.agency_opt_out_requests WHERE token_hash=repeat('d',64)) IS DISTINCT FROM confirmed_before THEN RAISE EXCEPTION 'Preference replay changed receipt'; END IF;
 INSERT INTO public.agency_opt_out_requests(token_hash,email,expires_at) VALUES(repeat('e',64),'audit-expired@example.invalid',now()-interval '1 second');
 IF public.confirm_agency_opt_out(repeat('e',64)) IS DISTINCT FROM false OR EXISTS(SELECT 1 FROM public.agency_suppression WHERE agency_suppression.email='audit-expired@example.invalid') THEN RAISE EXCEPTION 'Expired unconfirmed preference accepted'; END IF;
 IF public.request_agency_newsletter('audit-existing-objection@example.invalid') IS NOT NULL THEN RAISE EXCEPTION 'Existing global objection bypassed'; END IF;
 EXECUTE 'RESET ROLE';
 IF (SELECT to_jsonb(x) FROM public.tenants x WHERE id=t) IS DISTINCT FROM tenant_before
  OR (SELECT to_jsonb(x) FROM public.leads x WHERE id=tl) IS DISTINCT FROM lead_before
  OR (SELECT to_jsonb(x) FROM public.leads x WHERE id=l) IS DISTINCT FROM agency_before
  OR EXISTS(SELECT 1 FROM public.lead_observations) OR EXISTS(SELECT 1 FROM public.contact_rights)
  OR EXISTS(SELECT 1 FROM public.lead_suppression) OR EXISTS(SELECT 1 FROM public.outbound_actions)
  OR EXISTS(SELECT 1 FROM public.outbound_stops) THEN RAISE EXCEPTION 'Agency preference changed tenant or lead lifecycle'; END IF;
 IF (SELECT count(*) FROM public.agency_suppression)<>1 OR NOT EXISTS(SELECT 1 FROM public.suppression WHERE suppression.email='audit-existing-objection@example.invalid' AND reason='Preserve existing objection') THEN RAISE EXCEPTION 'Suppression scope or existing objection changed'; END IF;

 -- Fixture registration models a prior identity proof only; no OAuth/Google request occurs.
 INSERT INTO public.leads(id,tenant_id,source,email,status) VALUES(gl,t,'import','fixture@business.example','qualified');
 SELECT execution_version INTO version FROM public.tenants WHERE id=t;
 EXECUTE 'SET LOCAL ROLE service_role';
 receipt:=public.register_tenant_google_authority(t,a,0,version,gc,hash,'staff@example.invalid','calendar@example.invalid','synthetic-source',expires);
 IF receipt IS DISTINCT FROM jsonb_build_object('version',1,'status','verified','authorityVersion',1) THEN RAISE EXCEPTION 'Registration receipt mismatch'; END IF;
 rejected:=false;BEGIN PERFORM public.register_tenant_google_authority(t,a,0,version,gc,hash,'staff@example.invalid','calendar@example.invalid','synthetic-source',expires);EXCEPTION WHEN serialization_failure THEN rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Stale registration CAS accepted'; END IF;
 rejected:=false;BEGIN PERFORM public.record_gmail_product_event(version,expires,t,gl,a,'gmail:audit:legacy','synthetic-source','Synthetic message',observed,false,context);EXCEPTION WHEN insufficient_privilege THEN rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Legacy Gmail RPC remained callable'; END IF;
 event_id:=public.record_authorized_gmail_event(version,expires,t,gl,a,'gmail:'||gc||':message','synthetic-source','Synthetic message',observed,false,context,1,hash);
 replay_id:=public.record_authorized_gmail_event(version,expires,t,gl,a,'gmail:'||gc||':message','synthetic-source','Synthetic message',observed,false,context,1,hash);
 IF event_id IS NULL OR replay_id IS DISTINCT FROM event_id THEN RAISE EXCEPTION 'Gmail event replay failed'; END IF;
 rejected:=false;BEGIN PERFORM public.record_product_event(t,gl,a,'gmail:'||gc||':forged','synthetic-source','Synthetic message',observed,false,context);EXCEPTION WHEN invalid_parameter_value THEN rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Generic Gmail source accepted'; END IF;
 rejected:=false;BEGIN PERFORM public.record_product_event(t,gl,a,'manual-forged-reply','synthetic-source','Synthetic message',observed,false,context);EXCEPTION WHEN invalid_parameter_value THEN rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Generic Gmail reply accepted'; END IF;
 IF public.pause_tenant_execution(t,'Synthetic audit pause') IS DISTINCT FROM true THEN RAISE EXCEPTION 'Pause fixture failed'; END IF;
 rejected:=false;BEGIN PERFORM public.record_authorized_gmail_event(version,expires,t,gl,a,'gmail:'||gc||':paused','synthetic-source','Synthetic message',observed,false,context,1,hash);EXCEPTION WHEN serialization_failure THEN rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Paused Gmail import accepted'; END IF;
 -- Revocation remains available during pause.
 IF public.revoke_tenant_google_authority(t,a,1) IS DISTINCT FROM jsonb_build_object('version',1,'status','revoked','authorityVersion',2) THEN RAISE EXCEPTION 'Revocation receipt mismatch'; END IF;
 EXECUTE 'RESET ROLE';
 UPDATE public.tenants SET status='active' WHERE id=t;
 SELECT execution_version INTO current_version FROM public.tenants WHERE id=t;
 IF current_version=version THEN RAISE EXCEPTION 'Pause/reactivation did not advance execution version'; END IF;
 EXECUTE 'SET LOCAL ROLE service_role';
 rejected:=false;BEGIN PERFORM public.record_authorized_gmail_event(version,expires,t,gl,a,'gmail:'||gc||':reactivated','synthetic-source','Synthetic message',observed,false,context,1,hash);EXCEPTION WHEN serialization_failure THEN rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Stale Gmail authority accepted after reactivation'; END IF;
 -- Historical reviewed outcomes remain recordable after revoke, with no provider read.
 replay_id:=public.record_product_event(t,gl,a,'historical-outcome','synthetic-source','Historical business outcome',observed,false,jsonb_build_object('product','response','kind','outcome','threadRef','gmail:'||gc||':thread','outcome','opportunity','reason','Fixture reviewed outcome'));
 IF replay_id IS NULL THEN RAISE EXCEPTION 'Historical outcome lost after revoke'; END IF;
 rejected:=false;BEGIN PERFORM public.record_product_event(t,gl,a,'fabricated-outcome','synthetic-source','Fabricated thread',observed,false,jsonb_build_object('product','response','kind','outcome','threadRef','gmail:'||gc||':foreign','outcome','opportunity','reason','Must reject'));EXCEPTION WHEN invalid_parameter_value THEN rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Fabricated historical thread accepted'; END IF;
 rejected:=false;BEGIN PERFORM public.register_tenant_google_authority(t,a,2,current_version,gen_random_uuid(),hash,'staff@example.invalid','calendar@example.invalid','synthetic-source',expires);EXCEPTION WHEN serialization_failure THEN rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Connection namespace changed'; END IF;
 receipt:=public.register_tenant_google_authority(t,a,2,current_version,gc,repeat('9',64),'staff@example.invalid','calendar@example.invalid','synthetic-source',expires);
 IF receipt->>'authorityVersion'<>'3' THEN RAISE EXCEPTION 'Rotated binding registration failed'; END IF;
 rejected:=false;BEGIN PERFORM public.record_authorized_gmail_event(current_version,expires,t,gl,a,'gmail:'||gc||':stale-secret','synthetic-source','Synthetic message',observed,false,context,3,hash);EXCEPTION WHEN serialization_failure THEN rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Old secret binding accepted'; END IF;
 rejected:=false;BEGIN PERFORM public.record_authorized_gmail_event(current_version,now()-interval '1 second',t,gl,a,'gmail:'||gc||':expired','synthetic-source','Synthetic message',observed,false,context,3,repeat('9',64));EXCEPTION WHEN serialization_failure THEN rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Expired connection metadata accepted'; END IF;
 expires:=now()-interval '1 second';
 UPDATE public.tenant_google_authority SET expires_at=expires,version=4 WHERE tenant_id=t;
 rejected:=false;BEGIN PERFORM public.record_authorized_gmail_event(current_version,expires,t,gl,a,'gmail:'||gc||':expired-registry','synthetic-source','Synthetic message',observed,false,context,4,repeat('9',64));EXCEPTION WHEN serialization_failure THEN rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Expired durable authority accepted'; END IF;
 IF (SELECT count(*) FROM public.lead_observations WHERE tenant_id=t)<>2 THEN RAISE EXCEPTION 'Rejected Gmail import persisted data'; END IF;
 EXECUTE 'RESET ROLE';

 -- Tenant unsubscribe is private and scoped, including confirmed historical replay.
 INSERT INTO public.tenants(id,name,slug,country,currency,status) VALUES(other_t,'Other rollback fixture','authority-other','AE','AED','active');
 INSERT INTO public.leads(id,tenant_id,source,email,status) VALUES(other_l,other_t,'import',fixture_email,'qualified');
 SELECT to_jsonb(x) INTO lead_before FROM public.leads x WHERE id=tl;
 SELECT to_jsonb(x) INTO agency_before FROM public.newsletter_subscribers x WHERE email=fixture_email;
 EXECUTE 'SET LOCAL ROLE service_role';
 receipt:=public.issue_tenant_unsubscribe(t,tl,a,repeat('c',64));
 IF receipt->>'status'<>'issued' OR (SELECT count(*) FROM jsonb_object_keys(receipt))<>3 THEN RAISE EXCEPTION 'Tenant token issuance failed'; END IF;
 IF public.confirm_tenant_unsubscribe(repeat('c',64)) IS DISTINCT FROM '{"version":1,"status":"confirmed"}'::jsonb THEN RAISE EXCEPTION 'Tenant confirmation leaked identifiers or failed'; END IF;
 IF public.confirm_tenant_unsubscribe(repeat('0',64)) IS DISTINCT FROM '{"version":1,"status":"invalid"}'::jsonb THEN RAISE EXCEPTION 'Unknown token receipt failed'; END IF;
 SELECT confirmed_at INTO stop_before FROM ripepiper_private.tenant_unsubscribe_tokens WHERE token_hash=repeat('c',64);
 EXECUTE 'RESET ROLE';
 IF NOT EXISTS(SELECT 1 FROM public.lead_suppression WHERE tenant_id=t AND lead_id=tl)
  OR EXISTS(SELECT 1 FROM public.lead_suppression WHERE tenant_id=other_t)
  OR EXISTS(SELECT 1 FROM public.suppression WHERE email=fixture_email)
  OR (SELECT to_jsonb(x) FROM public.leads x WHERE id=tl) IS DISTINCT FROM lead_before
  OR (SELECT to_jsonb(x) FROM public.newsletter_subscribers x WHERE email=fixture_email) IS DISTINCT FROM agency_before THEN RAISE EXCEPTION 'Tenant stop changed foreign, global, agency or lifecycle state'; END IF;
 EXECUTE 'RESET ROLE';
 UPDATE public.leads SET email='changed@example.invalid' WHERE id=tl;
 UPDATE ripepiper_private.tenant_unsubscribe_tokens SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE token_hash=repeat('c',64);
 EXECUTE 'SET LOCAL ROLE service_role';
 IF public.confirm_tenant_unsubscribe(repeat('c',64)) IS DISTINCT FROM '{"version":1,"status":"confirmed"}'::jsonb
  OR (SELECT confirmed_at FROM ripepiper_private.tenant_unsubscribe_tokens WHERE token_hash=repeat('c',64)) IS DISTINCT FROM stop_before THEN RAISE EXCEPTION 'Historical confirmation replay changed state'; END IF;
 EXECUTE 'RESET ROLE';
 EXECUTE 'SET LOCAL ROLE authenticated';
 rejected:=false;BEGIN PERFORM 1 FROM public.tenant_google_authority;EXCEPTION WHEN insufficient_privilege THEN rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Browser authority table exposed'; END IF;
 rejected:=false;BEGIN PERFORM 1 FROM ripepiper_private.tenant_unsubscribe_tokens;EXCEPTION WHEN insufficient_privilege THEN rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Browser token table exposed'; END IF;
 rejected:=false;BEGIN PERFORM public.confirm_tenant_unsubscribe(repeat('c',64));EXCEPTION WHEN insufficient_privilege THEN rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Browser confirmation RPC permitted'; END IF;
 EXECUTE 'RESET ROLE';
END $$;
ROLLBACK;
SELECT 'PASS: authority registration/CAS/revoke/namespace/history/tenant-unsubscribe privacy/replay; all synthetic fixtures rolled back' AS qa_result;
