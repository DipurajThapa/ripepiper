-- Independent QA. Execute ONLY on isolated wgomywhuzyboxlckopca.
-- All synthetic fixture writes and budget arming are rolled back. No provider APIs.
-- Current source includes reviewed client setup, asset strategy and audiences; earlier hosted receipts
-- apply to their original packet hashes, not this amended fixture.
BEGIN;
DO $$
DECLARE
 a uuid:='fa100000-0000-4000-8000-000000000001';
 u uuid:='fa100000-0000-4000-8000-000000000002';
 v uuid:='fa100000-0000-4000-8000-000000000003';
 t uuid:='fa100000-0000-4000-8000-000000000011';
 x uuid:='fa100000-0000-4000-8000-000000000012';
 l uuid:='fa100000-0000-4000-8000-000000000021';
 f uuid:='fa100000-0000-4000-8000-000000000022';
 s uuid:='fa100000-0000-4000-8000-000000000031';
 c uuid:='fa100000-0000-4000-8000-000000000041';
 q uuid:='fa100000-0000-4000-8000-000000000051';
 k uuid:='fa100000-0000-4000-8000-000000000061';
 r uuid:='fa100000-0000-4000-8000-000000000071';
 b uuid:='fa100000-0000-4000-8000-000000000081';
 response jsonb; audience jsonb; strategy_input jsonb; strategy jsonb; snap text; n integer; rejected boolean;
BEGIN
 IF current_database()<>'postgres' THEN RAISE EXCEPTION 'Unexpected database'; END IF;
 IF EXISTS(SELECT 1 FROM public.tenants) OR EXISTS(SELECT 1 FROM auth.users) THEN RAISE EXCEPTION 'QA requires empty isolated staging baseline'; END IF;
 INSERT INTO public.tenants(id,name,slug,country,currency,status) VALUES(t,'QA isolated tenant one','qa-rollback-one','AE','AED','active'),(x,'QA isolated tenant two','qa-rollback-two','IN','INR','active');
 INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES(a,'qa-staff@example.invalid',now(),'{}'),(u,'qa-owner-one@example.invalid',now(),'{}'),(v,'qa-owner-two@example.invalid',now(),'{}');
 UPDATE public.profiles SET is_admin=true WHERE id=a;
 INSERT INTO public.memberships(tenant_id,user_id,role) VALUES(t,u,'owner'),(x,v,'owner');
 -- Hybrid access: staff act on a tenant only through an operator grant from a separate verified platform admin.
 INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES('fa100000-0000-4000-8000-000000000009','qa-grantor@example.invalid',now(),'{}');
 UPDATE public.profiles SET is_admin=true WHERE id='fa100000-0000-4000-8000-000000000009';UPDATE public.profiles SET is_operator=true WHERE id=a;
 INSERT INTO public.operator_grants(tenant_id,operator_id,capabilities,authority,authorised_by,contract_reference,expires_at)
  SELECT qa_t,a,'{read,operate,approve}','contract','fa100000-0000-4000-8000-000000000009','QA synthetic contract',now()+interval '1 day' FROM unnest(array[t]::uuid[]) qa_t;
 INSERT INTO public.leads(id,tenant_id,source,email) VALUES(l,t,'import','qa-contact-one@example.invalid'),(f,x,'import','qa-contact-two@example.invalid');
 INSERT INTO public.leads(tenant_id,source,email) VALUES(null,'book_form','qa-null-tenant@example.invalid');
 rejected:=false;
 BEGIN
  INSERT INTO public.meetings(tenant_id,lead_id,start_at,end_at,attendee_email) VALUES(t,f,now()+interval '2 days',now()+interval '2 days 15 minutes','qa-contact-two@example.invalid');
 EXCEPTION WHEN foreign_key_violation THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Cross-tenant meeting FK did not reject'; END IF;
 INSERT INTO public.business_briefs(tenant_id,version,body,created_by) VALUES(t,1,jsonb_build_object(
  'offer','Reviewed reactivation service','industries',jsonb_build_array('construction'),'markets',jsonb_build_array('AE'),
  'roles',jsonb_build_array('owner'),'needs',jsonb_build_array('dormant leads'),'excludedIndustries','[]'::jsonb,'maxAgeDays',30,
  'source',jsonb_build_object('reference','qa-brief','excerpt','Reviewed construction offer for AE owner with dormant leads','observedAt',now()-interval '1 hour')),a);
 INSERT INTO public.lead_observations(id,tenant_id,lead_id,source,external_ref,observed_at,original_purpose,synthetic,assessment_reviewed_by,rights_reference,assessment_facts,assessment_excerpt,product_context)
 VALUES(s,t,l,'qa_fixture','qa-source',now()-interval '1 hour','qa appointment',true,a,'qa reviewed source rights',
  '{"industry":"construction","market":"AE","role":"owner","need":"dormant leads"}','construction AE owner dormant leads',
  jsonb_build_object('product','revive','kind','history','lastContactAt',now()-interval '60 days','previousInterest','yes','stalledReason','Project deferred to next quarter'));
 EXECUTE 'SET LOCAL ROLE service_role';
 response:=public.save_revive_setup(t,a,0,1,'reviewed',jsonb_build_object(
  'website',null,'supportedClaims','[]'::jsonb,'sourceInventory',jsonb_build_array(jsonb_build_object('type','interview','reference','qa-brief','rightsReference','Synthetic fixture review only')),
  'relationshipSummary',jsonb_build_object('text','Reviewed earlier enquiries whose project was deferred.','reference','qa-brief'),
  'senderName','Fixture owner','senderEmail','staff@example.invalid','ownerId',a,'market','AE','language','en','timezone','UTC',
  'salesCapacityPerWeek',10,'outcomeWindowDays',30,'workingDays',jsonb_build_array(1,2,3,4,5,6,7),'startMinute',0,'endMinute',1440,'dailyContactCap',25));
 IF response->>'version'<>'1' OR response->>'state'<>'reviewed' OR response->'ready' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Current reviewed client setup unavailable';END IF;
 strategy_input:=jsonb_build_object('setupVersion',1,'canonicalNeed','dormant leads','segment','Reviewed existing enquiries',
  'relationshipRationale','The reviewed earlier enquiry was deferred; current need is assessed separately.',
  'valueProposition','Discuss the reviewed offer where it remains relevant.','evidenceReference','qa-brief',
  'cta',jsonb_build_object('kind','reply','prompt','Is this still relevant for your team?'),'goal','qualified_conversation','confirmed',true);
 response:=public.review_revive_candidate(t,l,a,0,public.revive_input_snapshot(t,l),1,'accepted','Reviewed evidence supports reactivation cohort',now()+interval '1 day');
 IF response->>'state' IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'Revive cohort review failed'; END IF;
 audience:=public.build_revive_audience(t,a,jsonb_build_object('leadIds',jsonb_build_array(l),'confirmed',true));
 strategy:=public.build_revive_strategy(t,a,strategy_input,audience);
 EXECUTE 'RESET ROLE';
 INSERT INTO public.contact_rights(tenant_id,lead_id,source_id,purpose,channel,market,decision,reviewer_id,notice_reference) VALUES(t,l,s,'qa appointment','email','AE','permitted',a,'qa synthetic rights');
 INSERT INTO public.campaigns(id,tenant_id,capability,operator_id,purpose,channel,market,timezone,status,client_authority_ref,owner_authority_ref,cts_profile_ref,expires_at,max_actions) VALUES(c,t,'revive',a,'qa appointment','email','AE','UTC','approved','qa-client','qa-owner','qa-profile',now()+interval '1 day',5);
 INSERT INTO public.campaign_assets(tenant_id,campaign_id,version,brief_version,steps,created_by,approved_by,revive_audience,revive_strategy) VALUES(t,c,1,1,'[{"subject":"QA fixture","body":"Synthetic only","offsetHours":0,"evidenceReference":"qa-source"}]',a,a,audience,strategy);
 -- The due action cannot predate the setup/strategy authority recorded above.
 INSERT INTO public.outbound_actions(id,tenant_id,campaign_id,lead_id,correlation_key,approval_version,asset_version,due_at) VALUES(q,t,c,l,'qa-rollback-action',1,1,now());
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 SELECT count(*) INTO n FROM public.leads;
 IF n<>1 THEN RAISE EXCEPTION 'Tenant owner RLS leaked or hid own lead: %',n; END IF;
 IF EXISTS(SELECT 1 FROM public.leads WHERE tenant_id IS NULL OR tenant_id=x) THEN RAISE EXCEPTION 'Tenant owner saw NULL/foreign pipeline'; END IF;
 rejected:=false;
 BEGIN PERFORM public.reserve_build_usage(b,'fixture','qa-tariff',100); EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Authenticated budget reservation was permitted'; END IF;
 EXECUTE 'RESET ROLE';
 EXECUTE 'SET LOCAL ROLE service_role';
 response:=public.claim_fenced_synthetic_action(t,q,k,now());
 IF response->>'token' IS DISTINCT FROM k::text THEN RAISE EXCEPTION 'Fenced claim failed'; END IF;
 IF public.claim_fenced_synthetic_action(t,q,gen_random_uuid(),now()) IS NOT NULL THEN RAISE EXCEPTION 'Duplicate claim accepted'; END IF;
 IF to_regprocedure('public.complete_synthetic_action(uuid,timestamptz)') IS NOT NULL OR to_regprocedure('public.expire_synthetic_claim(uuid,timestamptz)') IS NOT NULL THEN RAISE EXCEPTION 'Legacy completion bypassed fence'; END IF;
 IF public.complete_fenced_synthetic_action(x,q,k,1,1,now()) THEN RAISE EXCEPTION 'Foreign tenant completed claim'; END IF;
 IF public.complete_fenced_synthetic_action(t,q,gen_random_uuid(),1,1,now()) THEN RAISE EXCEPTION 'Wrong token completed claim'; END IF;
 IF NOT public.complete_fenced_synthetic_action(t,q,k,1,1,now()) THEN RAISE EXCEPTION 'Valid completion failed'; END IF;
 IF NOT public.complete_fenced_synthetic_action(t,q,k,1,1,now()) THEN RAISE EXCEPTION 'Idempotent receipt replay failed'; END IF;
 SELECT count(*) INTO n FROM public.outbound_actions WHERE id=q AND state='tested' AND provider_ref='test-sink:'||q::text AND acknowledged_at IS NOT NULL AND attempts=1;
 IF n<>1 THEN RAISE EXCEPTION 'Exact single sink acknowledgement not persisted'; END IF;
 PERFORM public.record_product_event(t,l,a,'qa-inbound','qa-rights','Synthetic inbound',now()-interval '1 minute',true,'{"product":"response","kind":"reply","threadRef":"qa-thread","disposition":"human","need":"","authority":"","timing":""}');
 SELECT string_agg(id::text,',' ORDER BY id) INTO snap FROM public.lead_observations WHERE tenant_id=t AND lead_id=l AND product_context->>'threadRef'='qa-thread' AND product_context->>'kind' IN('enquiry','reply');
 response:=public.response_review_owners(t,a);
 IF jsonb_array_length(response)<>2 OR NOT response @> jsonb_build_array(jsonb_build_object('id',u)) THEN RAISE EXCEPTION 'Authorized owners mismatch'; END IF;
 response:=public.save_response_review(t,l,'qa-thread',a,u,0,snap,'resolved','QA reviewed current inbound',r,true);
 IF (response->>'version')::integer<>1 THEN RAISE EXCEPTION 'Response review version mismatch'; END IF;
 response:=public.save_response_review(t,l,'qa-thread',a,u,0,snap,'resolved','QA reviewed current inbound',r,true);
 IF response->'replayed' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Response review replay failed'; END IF;
 rejected:=false;
 BEGIN PERFORM public.save_response_review(t,l,'qa-thread',a,u,0,snap,'resolved','QA stale review',gen_random_uuid(),true); EXCEPTION WHEN serialization_failure THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Stale response review accepted'; END IF;
 IF public.reserve_build_usage(b,'fixture','qa-tariff',700000) THEN RAISE EXCEPTION 'Dormant budget permitted spend'; END IF;
 PERFORM public.authorize_build_budget(a,17000000,'qa-tariff','QA synthetic authority only',now()+interval '1 day');
 IF NOT public.reserve_build_usage(b,'fixture','qa-tariff',700000) THEN RAISE EXCEPTION 'Budget reservation failed'; END IF;
 IF public.reserve_build_usage(gen_random_uuid(),'fixture','qa-tariff',700000) THEN RAISE EXCEPTION 'Global discretionary cap exceeded'; END IF;
 IF NOT public.settle_build_usage(b,200000) OR NOT public.settle_build_usage(b,200000) THEN RAISE EXCEPTION 'Budget settlement/replay failed'; END IF;
 IF public.settle_build_usage(b,100000) THEN RAISE EXCEPTION 'Conflicting budget settlement accepted'; END IF;
 EXECUTE 'RESET ROLE';
END $$;
ROLLBACK;
SELECT 'PASS: hosted SQL role/RLS/FK/fence/replay/response-CAS/global-budget assertions; all fixtures rolled back' AS qa_result;
