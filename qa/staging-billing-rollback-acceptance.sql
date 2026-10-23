-- Independent QA. Isolated staging wgomywhuzyboxlckopca ONLY, after billing migration.
-- No provider APIs, notifications, DDL or lasting financial/authority records.
BEGIN;
DO $$
DECLARE
 a uuid:='fa300000-0000-4000-8000-000000000001';
 l uuid:='fa300000-0000-4000-8000-000000000021';
 p uuid:='fa300000-0000-4000-8000-000000000031';
 q uuid:='fa300000-0000-4000-8000-000000000041';
 attempt uuid:='fa300000-0000-4000-8000-000000000051';
 qattempt uuid:='fa300000-0000-4000-8000-000000000052';
 t uuid; j jsonb; receipt jsonb; rejected boolean;
BEGIN
 IF EXISTS(SELECT 1 FROM public.tenants) OR EXISTS(SELECT 1 FROM auth.users) OR EXISTS(SELECT 1 FROM public.payments) OR EXISTS(SELECT 1 FROM public.sheet_outbox) THEN RAISE EXCEPTION 'QA requires empty isolated staging baseline'; END IF;
 INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES(a,'qa-billing-staff@example.invalid',now(),'{}');
 UPDATE public.profiles SET is_admin=true WHERE id=a;
 INSERT INTO public.leads(id,source,email,company,country) VALUES(l,'import','qa-billing@example.invalid','QA synthetic company','AE');
 INSERT INTO public.proposals(id,lead_id,kind,plan,package,currency,fixed_amount,content_md,status,client_email)
 VALUES(p,l,'pre','sprint','revive','AED',5000,'QA fixture only','sent','qa-billing@example.invalid');
 EXECUTE 'SET LOCAL ROLE authenticated';
 rejected:=false;
 BEGIN PERFORM public.reserve_payment_checkout(p,null,'stripe',50000,'AED',null,attempt); EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Authenticated checkout reservation accepted'; END IF;
 EXECUTE 'RESET ROLE'; EXECUTE 'SET LOCAL ROLE service_role';
 j:=public.reserve_payment_checkout(p,null,'stripe',50000,'AED',null,attempt);
 IF j->>'disposition'<>'reserved' THEN RAISE EXCEPTION 'Checkout reservation failed'; END IF;
 rejected:=false;
 BEGIN PERFORM public.reserve_payment_checkout(p,null,'stripe',50000,'AED',null,gen_random_uuid()); EXCEPTION WHEN raise_exception THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Unknown creation retried'; END IF;
 PERFORM public.register_payment_checkout(p,null,'stripe','cs_qa_rollback',50000,'AED',null,attempt);
 EXECUTE 'RESET ROLE'; EXECUTE 'SET LOCAL ROLE authenticated'; PERFORM set_config('request.jwt.claim.sub',a::text,true);
 rejected:=false;
 BEGIN UPDATE public.payments SET status='paid',settled_at=now(),raw=raw||'{"billing":{"receipt":{"disposition":"applied"}}}' WHERE id=(j->>'paymentId')::uuid; EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Authenticated admin forged a provider receipt'; END IF;
 rejected:=false;
 BEGIN DELETE FROM public.payments WHERE id=(j->>'paymentId')::uuid; EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Authenticated admin removed a tracked checkout'; END IF;
 EXECUTE 'RESET ROLE'; EXECUTE 'SET LOCAL ROLE service_role';
 j:=public.apply_payment_event(p,null,'stripe','cs_qa_rollback',49999,'AED','paid');
 IF j->>'disposition'<>'rejected' OR EXISTS(SELECT 1 FROM public.fees) OR EXISTS(SELECT 1 FROM public.tenants) THEN RAISE EXCEPTION 'Mismatched financial terms produced effects'; END IF;
 j:=public.apply_payment_event(p,null,'stripe','cs_qa_rollback',50000,'AED','failed');
 IF j->>'disposition'<>'failed' THEN RAISE EXCEPTION 'Initial failure not recorded'; END IF;
 receipt:=public.apply_payment_event(p,null,'stripe','cs_qa_rollback',50000,'AED','paid');
 IF receipt->>'disposition'<>'applied' OR receipt->>'status'<>'paid' THEN RAISE EXCEPTION 'Valid settlement failed'; END IF;
 IF public.apply_payment_event(p,null,'stripe','cs_qa_rollback',50000,'AED','paid') IS DISTINCT FROM receipt OR public.apply_payment_event(p,null,'stripe','cs_qa_rollback',50000,'AED','failed') IS DISTINCT FROM receipt THEN RAISE EXCEPTION 'Settlement replay/downgrade failed'; END IF;
 t:=(receipt->>'tenantId')::uuid;
 IF (SELECT count(*) FROM public.tenants)<>1 OR (SELECT count(*) FROM public.invites)<>1 OR (SELECT count(*) FROM public.fees)<>1 OR (SELECT count(*) FROM public.activity_log)<>1 THEN RAISE EXCEPTION 'Engagement effects duplicated or missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.payments WHERE provider_ref='cs_qa_rollback' AND status='paid' AND settled_at IS NOT NULL AND raw->'billing'->'notifications'->>'state'='human_review_required' AND raw->'billing'->'notifications'->'automaticDelivery'='false'::jsonb) THEN RAISE EXCEPTION 'Notification disposition missing'; END IF;
 IF EXISTS(SELECT 1 FROM public.payments WHERE raw::text LIKE '%https://%') OR EXISTS(SELECT 1 FROM public.outbound_actions) THEN RAISE EXCEPTION 'Settlement persisted capability URL or queued prospect delivery'; END IF;
 EXECUTE 'RESET ROLE'; EXECUTE 'SET LOCAL ROLE authenticated';
 rejected:=false;
 BEGIN UPDATE public.proposals SET fixed_amount=6000 WHERE id=p; EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Authenticated admin changed settled proposal financial terms'; END IF;
 EXECUTE 'RESET ROLE'; EXECUTE 'SET LOCAL ROLE service_role';
 INSERT INTO public.quotes(id,proposal_id,tenant_id,items,currency,total,status) VALUES(q,p,t,'[]','AED',125,'sent');
 PERFORM public.reserve_payment_checkout(p,q,'stripe',12500,'AED',a,qattempt);
 PERFORM public.register_payment_checkout(p,q,'stripe','cs_qa_quote_rollback',12500,'AED',a,qattempt);
 receipt:=public.apply_payment_event(p,q,'stripe','cs_qa_quote_rollback',12500,'AED','paid');
 IF receipt->>'quoteId'<>q::text OR public.apply_payment_event(p,q,'stripe','cs_qa_quote_rollback',12500,'AED','failed') IS DISTINCT FROM receipt THEN RAISE EXCEPTION 'Quote settlement/replay failed'; END IF;
 IF (SELECT count(*) FROM public.tenants)<>1 OR (SELECT count(*) FROM public.invites)<>1 OR (SELECT count(*) FROM public.fees)<>2 OR NOT EXISTS(SELECT 1 FROM public.quotes WHERE id=q AND paid_at IS NOT NULL) THEN RAISE EXCEPTION 'Quote financial effects invalid'; END IF;
 EXECUTE 'RESET ROLE'; EXECUTE 'SET LOCAL ROLE authenticated';
 rejected:=false;
 BEGIN UPDATE public.quotes SET total=999 WHERE id=q; EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Authenticated admin changed settled quote financial terms'; END IF;
 EXECUTE 'RESET ROLE';
END $$;
ROLLBACK;
SELECT 'PASS: hosted billing service grants/attempt hold/exact terms/failure-paid-replay/atomic engagement/quote/held notifications; fixtures rolled back' AS qa_result;
