-- Independent QA: ONLY empty isolated staging wgomywhuzyboxlckopca.
-- No DDL, provider request, Auth API or persistent fixture. Requires current
-- source migrations, including setup, strategy, immutable receipts and audiences.
-- Earlier hosted packet receipts do not execute these amended local fixtures.
BEGIN;
DO $$
DECLARE
 a uuid:='fa500000-0000-4000-8000-000000000001';
 t uuid:='fa500000-0000-4000-8000-000000000011';
 x uuid:='fa500000-0000-4000-8000-000000000012';
 l uuid:='fa500000-0000-4000-8000-000000000021';
 f uuid:='fa500000-0000-4000-8000-000000000022';
 s uuid:='fa500000-0000-4000-8000-000000000031';
 c uuid:='fa500000-0000-4000-8000-000000000041';
 d uuid:='fa500000-0000-4000-8000-000000000042';
 k uuid:='fa500000-0000-4000-8000-000000000061';
 action uuid; observation uuid; j jsonb; snap text; rejected boolean; strategy_input jsonb; draft_body jsonb;
BEGIN
 IF EXISTS(SELECT 1 FROM public.tenants) OR EXISTS(SELECT 1 FROM auth.users) OR EXISTS(SELECT 1 FROM public.leads) OR EXISTS(SELECT 1 FROM public.sheet_outbox) THEN RAISE EXCEPTION 'QA requires empty isolated staging baseline'; END IF;
 INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES(a,'qa-revive-staff@example.invalid',now(),'{}');
 UPDATE public.profiles SET is_admin=true WHERE id=a;
 INSERT INTO public.tenants(id,name,slug,country,currency,status,package) VALUES(t,'QA Revive rollback','qa-revive-rollback','AE','AED','onboarding','revive'),(x,'QA foreign rollback','qa-revive-foreign','AE','AED','onboarding','revive');
 -- Hybrid access: staff act on a tenant only through an operator grant from a separate verified platform admin.
 INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES('fa500000-0000-4000-8000-000000000009','qa-revive-grantor@example.invalid',now(),'{}');
 UPDATE public.profiles SET is_admin=true WHERE id='fa500000-0000-4000-8000-000000000009';UPDATE public.profiles SET is_operator=true WHERE id=a;
 INSERT INTO public.operator_grants(tenant_id,operator_id,capabilities,authority,authorised_by,contract_reference,expires_at)
  SELECT qa_t,a,'{read,operate,approve}','contract','fa500000-0000-4000-8000-000000000009','QA synthetic contract',now()+interval '1 day' FROM unnest(array[t,x]::uuid[]) qa_t;
 INSERT INTO public.business_briefs(tenant_id,version,body,created_by) VALUES(t,1,jsonb_build_object('offer','Reviewed reactivation','industries',jsonb_build_array('construction'),'markets',jsonb_build_array('AE'),'roles',jsonb_build_array('owner'),'needs',jsonb_build_array('quote follow-up'),'excludedIndustries','[]'::jsonb,'maxAgeDays',90,'source',jsonb_build_object('reference','qa-brief','excerpt','Approved construction offer','observedAt',now()-interval '1 hour')),a);
 INSERT INTO public.leads(id,tenant_id,source,email) VALUES(l,t,'import','qa-revive-contact@example.invalid'),(f,x,'import','qa-revive-foreign@example.invalid');
 INSERT INTO public.lead_observations(id,tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_facts,assessment_excerpt,assessment_reviewed_by,product_context)
 VALUES(s,t,l,'qa_fixture','qa-revive-source',now()-interval '1 hour','reactivation','qa-source-authority',true,'{"industry":"construction","market":"AE","role":"owner","need":"quote follow-up"}','construction AE owner quote follow-up',a,jsonb_build_object('product','revive','kind','history','lastContactAt',now()-interval '60 days','previousInterest','yes','stalledReason','Deferred previously'));
 EXECUTE 'SET LOCAL ROLE authenticated';PERFORM set_config('request.jwt.claim.sub',a::text,true);
 rejected:=false;BEGIN UPDATE public.tenants SET status='active' WHERE id=t;EXCEPTION WHEN insufficient_privilege THEN rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Direct admin activation accepted';END IF;
 rejected:=false;BEGIN PERFORM public.activate_tenant_execution(t,a,'onboarding',0,1,'Forged browser activation');EXCEPTION WHEN insufficient_privilege THEN rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Authenticated activation RPC accepted';END IF;
 rejected:=false;BEGIN UPDATE public.revive_reviews SET state='accepted';EXCEPTION WHEN insufficient_privilege THEN rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Direct admin cohort update permitted';END IF;
 EXECUTE 'RESET ROLE';EXECUTE 'SET LOCAL ROLE service_role';
 j:=public.save_revive_setup(t,a,0,1,'reviewed',jsonb_build_object(
  'website',null,'supportedClaims','[]'::jsonb,'sourceInventory',jsonb_build_array(jsonb_build_object('type','interview','reference','qa-brief','rightsReference','Synthetic fixture review only')),
  'relationshipSummary',jsonb_build_object('text','Reviewed earlier enquiries whose project was deferred.','reference','qa-brief'),
  'senderName','Fixture owner','senderEmail','staff@example.invalid','ownerId',a,'market','AE','language','en','timezone','UTC',
  'salesCapacityPerWeek',10,'outcomeWindowDays',30,'workingDays',jsonb_build_array(1,2,3,4,5,6,7),'startMinute',0,'endMinute',1440,'dailyContactCap',25));
 IF j->>'version'<>'1' OR j->>'state'<>'reviewed' OR j->'ready' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Current reviewed client setup unavailable';END IF;
 strategy_input:=jsonb_build_object('setupVersion',1,'canonicalNeed','quote follow-up','segment','Reviewed existing enquiries',
  'relationshipRationale','The reviewed earlier enquiry was deferred; current need is assessed separately.',
  'valueProposition','Discuss the reviewed offer where it remains relevant.','evidenceReference','qa-brief',
  'cta',jsonb_build_object('kind','reply','prompt','Is this still relevant for your team?'),'goal','qualified_conversation','confirmed',true);
 j:=public.activate_tenant_execution(t,a,'onboarding',0,1,'Reviewed account readiness');
 IF j->>'status'<>'active' OR j->>'version'<>'1' THEN RAISE EXCEPTION 'Activation receipt mismatch';END IF;
 rejected:=false;BEGIN PERFORM public.activate_tenant_execution(t,a,'onboarding',0,1,'Stale activation retry');EXCEPTION WHEN serialization_failure THEN rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Stale activation accepted';END IF;
 draft_body:=jsonb_build_object('product','revive','purpose','reactivation','market','AE','timezone','UTC','steps','[{"offsetHours":0,"subject":"QA fixture","body":"Synthetic only","evidenceReference":"qa-revive-source"}]'::jsonb,'audience',jsonb_build_object('leadIds',jsonb_build_array(l),'confirmed',true),'strategy',strategy_input);
 rejected:=false;BEGIN PERFORM public.manage_campaign_plan(t,c,a,'save',0,draft_body);EXCEPTION WHEN invalid_parameter_value THEN rejected:=true;END;
 IF NOT rejected OR EXISTS(SELECT 1 FROM public.campaigns WHERE id=c) THEN RAISE EXCEPTION 'Unreviewed Revive audience accepted';END IF;
 snap:=public.revive_input_snapshot(t,l);
 j:=public.review_revive_candidate(t,l,a,0,snap,1,'accepted','Reviewed current fit and prior relationship',now()+interval '3 days');
 IF j->>'state'<>'accepted' OR NOT public.revive_candidate_current(t,l,now()) THEN RAISE EXCEPTION 'Cohort acceptance failed';END IF;
 IF public.revive_candidate_current(x,l,now()) OR public.revive_review_context(x,l,a) IS NOT NULL THEN RAISE EXCEPTION 'Cross-tenant review leaked';END IF;
 rejected:=false;BEGIN PERFORM public.review_revive_candidate(t,l,a,0,snap,1,'accepted','Stale review retry',now()+interval '3 days');EXCEPTION WHEN serialization_failure THEN rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Stale cohort CAS accepted';END IF;
 j:=public.manage_campaign_plan(t,c,a,'save',0,draft_body);
 PERFORM public.manage_campaign_plan(t,c,a,'approve',1,jsonb_build_object('clientAuthority','qa-client','ownerAuthority','qa-owner','ctsProfile','qa-profile','maxActions',3,'expiresAt',now()+interval '7 days'));
 PERFORM public.manage_campaign_plan(t,c,a,'rights',1,jsonb_build_object('leadId',l,'sourceId',s,'noticeReference','qa-notice'));
 j:=public.manage_campaign_plan(t,c,a,'queue',1,jsonb_build_object('leadId',l,'startAt',now()));action:=(j->'actionIds'->>0)::uuid;
 IF action IS NULL OR NOT EXISTS(SELECT 1 FROM public.outbound_actions WHERE id=action AND revive_review_version=1 AND revive_review_snapshot=snap) THEN RAISE EXCEPTION 'Enrolment cohort fence missing';END IF;
 IF public.manage_campaign_plan(t,c,a,'queue',1,jsonb_build_object('leadId',l,'startAt',now()))->'replayed' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Enrolment replay failed';END IF;
 j:=public.claim_fenced_synthetic_action(t,action,k,now());IF j->>'token' IS DISTINCT FROM k::text THEN RAISE EXCEPTION 'Claim failed';END IF;
 IF public.complete_fenced_synthetic_action(x,action,k,1,1,now()) OR NOT public.complete_fenced_synthetic_action(t,action,k,1,1,now()) THEN RAISE EXCEPTION 'Exact tenant completion failure';END IF;
 IF NOT public.complete_fenced_synthetic_action(t,action,k,1,1,now()) THEN RAISE EXCEPTION 'Same token receipt replay failed';END IF;
 observation:=public.record_product_event(t,l,a,'qa-linked-outcome','qa-authority','Synthetic meeting fixture',now(),true,jsonb_build_object('product','revive','kind','outcome','outcome','meeting_held','reason','Synthetic rehearsal only','campaignId',c,'actionId',action));
 IF observation IS NULL THEN RAISE EXCEPTION 'Attributed synthetic outcome missing';END IF;
 IF public.record_product_event(t,l,a,'qa-linked-outcome','qa-authority','Synthetic meeting fixture',now(),true,jsonb_build_object('product','revive','kind','outcome','outcome','meeting_held','reason','Synthetic rehearsal only','campaignId',c,'actionId',action)) IS DISTINCT FROM observation THEN RAISE EXCEPTION 'Outcome source replay duplicated';END IF;
 rejected:=false;BEGIN PERFORM public.record_product_event(t,l,a,'qa-wrong-campaign','qa-authority','Wrong campaign fixture',now(),true,jsonb_build_object('product','revive','kind','outcome','outcome','won','reason','Must reject','campaignId',d,'actionId',action));EXCEPTION WHEN invalid_parameter_value THEN rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Foreign campaign attribution accepted';END IF;
 rejected:=false;BEGIN UPDATE public.lead_observations SET assessment_excerpt='Edited historical outcome' WHERE id=observation;EXCEPTION WHEN check_violation THEN rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Attributed outcome mutation accepted';END IF;

 -- New draft-save wrapper proof: no new engine, approval, contact rights or outbound work.
 draft_body:=jsonb_build_object('product','revive','purpose','qa generated draft','market','AE','timezone','UTC','steps','[{"offsetHours":0,"subject":"Reviewed cohort need","body":"Human reviewed draft only","evidenceReference":"qa-revive-source"}]'::jsonb,'audience',jsonb_build_object('leadIds',jsonb_build_array(l),'confirmed',true),'strategy',strategy_input,'draftContext',jsonb_build_object('setupVersion',1,'leadId',l,'sourceId',s,'canonicalNeed','quote follow-up','briefVersion',1,'reviewVersion',1,'businessName','QA Revive rollback','snapshot',public.revive_input_snapshot(t,l),'expiresAt',now()+interval '1 hour'));
 j:=public.record_revive_draft_proposal(t,a,draft_body->'draftContext');
 IF public.record_revive_draft_proposal(t,a,draft_body->'draftContext') IS DISTINCT FROM j THEN RAISE EXCEPTION 'Identical proposal receipt was not idempotent';END IF;
 draft_body:=jsonb_set(draft_body,'{draftContext}',(j->'draftContext')||jsonb_build_object('proposalId',j->'proposalId'));
 j:=public.save_reviewed_revive_draft(t,d,a,0,draft_body);
 IF j->>'status'<>'draft' OR j->>'version'<>'1' THEN RAISE EXCEPTION 'New reviewed draft not saved as draft';END IF;
 IF public.save_reviewed_revive_draft(t,d,a,0,draft_body) IS DISTINCT FROM j THEN RAISE EXCEPTION 'Same draft retry changed receipt';END IF;
 IF (SELECT count(*) FROM public.activity_log WHERE tenant_id=t AND message::jsonb->>'kind'='revive_draft_saved')<>1 THEN RAISE EXCEPTION 'Draft replay duplicated private audit';END IF;
 IF EXISTS(SELECT 1 FROM public.campaign_assets WHERE campaign_id=d AND approved_by IS NOT NULL) OR EXISTS(SELECT 1 FROM public.outbound_actions WHERE campaign_id=d) THEN RAISE EXCEPTION 'Draft save approved or queued itself';END IF;
 IF (SELECT count(*) FROM public.contact_rights WHERE tenant_id=t)<>1 THEN RAISE EXCEPTION 'Draft save granted contact rights';END IF;
 rejected:=false;BEGIN PERFORM public.save_reviewed_revive_draft(t,d,a,1,jsonb_set(draft_body,'{draftContext,sourceId}',to_jsonb('fa500000-0000-4000-8000-000000000099'::text)));EXCEPTION WHEN serialization_failure THEN rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Foreign/missing draft source accepted';END IF;
 rejected:=false;BEGIN PERFORM public.save_reviewed_revive_draft(t,d,a,1,jsonb_set(draft_body,'{draftContext,businessName}','"Foreign organization"'));EXCEPTION WHEN serialization_failure THEN rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Changed sender company accepted';END IF;
 rejected:=false;BEGIN PERFORM public.save_reviewed_revive_draft(t,d,a,1,jsonb_set(draft_body,'{draftContext,expiresAt}',to_jsonb(now()::text)));EXCEPTION WHEN serialization_failure THEN rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Expired draft accepted';END IF;
 j:=public.review_revive_candidate(t,l,a,1,public.revive_input_snapshot(t,l),1,'accepted','Repeated review of identical evidence',now()+interval '3 days');
 rejected:=false;BEGIN PERFORM public.save_reviewed_revive_draft(t,d,a,1,draft_body);EXCEPTION WHEN serialization_failure THEN rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Old same-snapshot review version accepted';END IF;
 EXECUTE 'RESET ROLE';EXECUTE 'SET LOCAL ROLE authenticated';
 rejected:=false;BEGIN PERFORM public.save_reviewed_revive_draft(t,d,a,1,draft_body);EXCEPTION WHEN insufficient_privilege THEN rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Authenticated draft wrapper executed';END IF;
 EXECUTE 'RESET ROLE';EXECUTE 'SET LOCAL ROLE service_role';
 PERFORM public.record_product_event(t,l,a,'qa-backdated-history','qa-authority','Backdated source fixture',now()-interval '2 hours',true,jsonb_build_object('product','revive','kind','history','lastContactAt',now()-interval '70 days','previousInterest','unknown','stalledReason','Unknown'));
 IF public.revive_candidate_current(t,l,now()) THEN RAISE EXCEPTION 'Backdated evidence retained acceptance';END IF;
 j:=public.review_revive_candidate(t,l,a,2,public.revive_input_snapshot(t,l),1,'accepted','Reviewed exact amended evidence',now()+interval '3 days');
 IF NOT public.revive_candidate_current(t,l,now()) THEN RAISE EXCEPTION 'Amended review unavailable';END IF;
 -- No source claim of fit recomputation: this service-only RPC relies on the reviewed Worker assessment.
 EXECUTE 'RESET ROLE';UPDATE public.profiles SET is_operator=false WHERE id=a;EXECUTE 'SET LOCAL ROLE service_role';
 IF public.revive_candidate_current(t,l,now()) THEN RAISE EXCEPTION 'Withdrawn reviewer still authorized';END IF;
 EXECUTE 'RESET ROLE';UPDATE public.profiles SET is_operator=true WHERE id=a;EXECUTE 'SET LOCAL ROLE service_role';
 INSERT INTO public.outbound_stops(scope,tenant_id,reason) VALUES('tenant',t,'QA separate manual hold');
 IF NOT public.pause_tenant_execution(t,'QA explicit account pause') THEN RAISE EXCEPTION 'Pause failed';END IF;
 j:=public.activate_tenant_execution(t,a,'paused',2,1,'Reviewed deliberate account resume');
 IF j->>'version'<>'3' OR NOT EXISTS(SELECT 1 FROM public.outbound_stops WHERE tenant_id=t AND origin='manual' AND lifted_at IS NULL)
 OR EXISTS(SELECT 1 FROM public.outbound_stops WHERE tenant_id=t AND origin='tenant_pause' AND lifted_at IS NULL)
 OR EXISTS(SELECT 1 FROM public.campaigns WHERE tenant_id=t AND status='approved') THEN RAISE EXCEPTION 'Resume removed unrelated hold or resumed campaign';END IF;
 EXECUTE 'RESET ROLE';
END $$;
ROLLBACK;
SELECT 'PASS: hosted Revive draft save/replay/no-auto-approval/stale-review/source/company/expiry/ACL plus existing workflow; all synthetic fixtures rolled back' AS qa_result;
