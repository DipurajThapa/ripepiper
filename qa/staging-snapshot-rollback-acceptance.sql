-- ONLY wgomywhuzyboxlckopca; caller pins connector project_id and verifies identity.
-- Requires reviewed 35th migration LF SHA256 5c129cd80a540f3918fd95870db6a8cd0a8cdaa11f56759360c529506e2a7d84.
-- Synthetic fixtures and SELECT/EXPLAIN only. No providers, Auth API or DDL.
-- EXPLAIN ANALYZE executes only the read-only scalar body over this transaction's fixtures.
BEGIN;
SET LOCAL statement_timeout='8s';
SET LOCAL lock_timeout='8s';
DO $$
DECLARE
 a uuid:='fa800000-0000-4000-8000-000000000001';
 own uuid:='fa800000-0000-4000-8000-000000000002';
 viewer uuid:='fa800000-0000-4000-8000-000000000003';
 foreign_owner uuid:='fa800000-0000-4000-8000-000000000004';
 t uuid:='fa800000-0000-4000-8000-000000000011';
 foreign_t uuid:='fa800000-0000-4000-8000-000000000012';
 first_lead uuid:='fa800000-0000-4000-8001-000000000001';
 extra_lead uuid:='fa800000-0000-4000-8001-000000000101';
 foreign_lead uuid:='fa800000-0000-4000-8002-000000000001';
 extra_obs uuid:='fa800000-0000-4000-8003-000000001000';
 wide_obs uuid:='fa800000-0000-4000-8003-000000001001';
 j jsonb; plan jsonb; receipt jsonb:='{}'; plans jsonb:='{}'; summary jsonb;
 relation record; probe record; role_name text; body text; n bigint; wide_nodes bigint; executed_wide bigint;
 rejected boolean; captured_at timestamptz; success_bytes bigint; started timestamptz; scalar_ms numeric;
BEGIN
 IF current_database()<>'postgres' OR current_user<>'postgres' THEN RAISE EXCEPTION 'Expected controlled staging postgres session'; END IF;
 IF EXISTS(SELECT 1 FROM auth.users) THEN RAISE EXCEPTION 'QA requires empty auth baseline'; END IF;
 FOR relation IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('build_budget','fx_rates') LOOP
  EXECUTE format('SELECT count(*) FROM public.%I',relation.tablename) INTO n;
  IF n<>0 THEN RAISE EXCEPTION 'QA requires empty table: %',relation.tablename; END IF;
 END LOOP;
 IF (SELECT count(*) FROM public.build_budget)<>1 OR EXISTS(SELECT 1 FROM public.build_budget WHERE enabled OR prior_micro IS NOT NULL) THEN RAISE EXCEPTION 'Expected dormant unreconciled budget'; END IF;
 IF has_function_privilege('anon','public.review_prospect_snapshot(uuid,uuid,boolean)','EXECUTE') OR has_function_privilege('authenticated','public.review_prospect_snapshot(uuid,uuid,boolean)','EXECUTE') OR NOT has_function_privilege('service_role','public.review_prospect_snapshot(uuid,uuid,boolean)','EXECUTE') THEN RAISE EXCEPTION 'Unexpected snapshot function grants'; END IF;
 INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES(a,'snapshot-staff@example.invalid',now(),'{}'),(own,'snapshot-owner@example.invalid',now(),'{}'),(viewer,'snapshot-viewer@example.invalid',now(),'{}'),(foreign_owner,'snapshot-foreign@example.invalid',now(),'{}');
 UPDATE public.profiles SET is_admin=true WHERE id=a;
 INSERT INTO public.tenants(id,name,slug,country,currency,status) VALUES(t,'Snapshot QA','snapshot-qa','AE','AED','onboarding'),(foreign_t,'Foreign snapshot QA','foreign-snapshot-qa','AE','AED','onboarding');
 INSERT INTO public.memberships(tenant_id,user_id,role) VALUES(t,a,'owner'),(t,own,'owner'),(t,viewer,'viewer'),(foreign_t,foreign_owner,'owner');
 INSERT INTO public.leads(id,tenant_id,source,email,status)
 SELECT ('fa800000-0000-4000-8001-'||lpad(g::text,12,'0'))::uuid,t,'import','snapshot-'||g||'@example.invalid',CASE WHEN g=1 THEN 'unsubscribed' ELSE 'new' END FROM generate_series(1,100) g;
 INSERT INTO public.leads(id,tenant_id,source,email) VALUES(foreign_lead,foreign_t,'import','foreign-snapshot-lead@example.invalid');
 INSERT INTO public.lead_observations(id,tenant_id,lead_id,source,external_ref,observed_at,original_purpose,synthetic,assessment_facts)
 SELECT ('fa800000-0000-4000-8003-'||lpad(g::text,12,'0'))::uuid,t,('fa800000-0000-4000-8001-'||lpad((((g-1)%100)+1)::text,12,'0'))::uuid,'qa','snapshot-'||g,now()-interval '1 minute','Synthetic snapshot QA',true,'{}'::jsonb FROM generate_series(1,999) g;
 INSERT INTO public.lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,synthetic) VALUES(t,first_lead,'qa','opposite-mode',now(),'Synthetic opposite mode',false),(foreign_t,foreign_lead,'qa','foreign-evidence',now(),'Synthetic foreign tenant',true);
 INSERT INTO public.suppression(email,reason) VALUES('snapshot-2@example.invalid','Synthetic global stop');
 INSERT INTO public.lead_suppression(tenant_id,lead_id,reason) VALUES(t,'fa800000-0000-4000-8001-000000000003','Synthetic lead stop');

 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  EXECUTE 'SET LOCAL ROLE '||quote_ident(role_name);rejected:=false;
  BEGIN PERFORM public.review_prospect_snapshot(t,a,true);EXCEPTION WHEN insufficient_privilege THEN rejected:=true;END;
  IF NOT rejected THEN RAISE EXCEPTION 'Browser role snapshot EXECUTE permitted';END IF;
  EXECUTE 'RESET ROLE';
 END LOOP;
 EXECUTE 'SET LOCAL ROLE service_role';
 IF public.review_prospect_snapshot(t,foreign_owner,true) IS DISTINCT FROM '{"version":1,"status":"unauthorized"}'::jsonb THEN RAISE EXCEPTION 'Nonstaff actor accepted'; END IF;
 IF public.review_prospect_snapshot('fa800000-0000-4000-8000-000000000099',a,true) IS DISTINCT FROM '{"version":1,"status":"missing"}'::jsonb THEN RAISE EXCEPTION 'Missing tenant envelope invalid'; END IF;
 started:=clock_timestamp();j:=public.review_prospect_snapshot(t,a,true);scalar_ms:=round(extract(epoch FROM clock_timestamp()-started)*1000,3);captured_at:=(j->>'snapshotAt')::timestamptz;
 IF jsonb_typeof(j) IS DISTINCT FROM 'object' OR j->>'status' IS DISTINCT FROM 'complete' OR j->>'tenantId' IS DISTINCT FROM t::text OR j->'synthetic' IS DISTINCT FROM 'true'::jsonb
  OR (j->>'leadCount')::int IS DISTINCT FROM 100 OR jsonb_array_length(j->'leads') IS DISTINCT FROM 100 OR (j->>'observationCount')::int IS DISTINCT FROM 999 OR jsonb_array_length(j->'observations') IS DISTINCT FROM 999
  OR (j->>'ownerCount')::int IS DISTINCT FROM 2 OR jsonb_array_length(j->'owners') IS DISTINCT FROM 2 OR NOT (j->'owners' @> jsonb_build_array(jsonb_build_object('id',a),jsonb_build_object('id',own)))
  OR jsonb_array_length(j->'stoppedLeadIds') IS DISTINCT FROM 3 OR NOT (j->'stoppedLeadIds' @> '["fa800000-0000-4000-8001-000000000001","fa800000-0000-4000-8001-000000000002","fa800000-0000-4000-8001-000000000003"]'::jsonb)
  OR captured_at IS DISTINCT FROM statement_timestamp() THEN RAISE EXCEPTION 'Complete scalar count/scope/owner/stop/time mismatch';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(j->'observations') x WHERE x->>'tenant_id'<>t::text OR x->'synthetic'<>'true'::jsonb) OR EXISTS(SELECT 1 FROM jsonb_array_elements(j->'leads') x WHERE x ? 'prospect_review_bytes' OR x->>'id'=foreign_lead::text) THEN RAISE EXCEPTION 'Snapshot leaked foreign/internal fields';END IF;
 success_bytes:=octet_length(j::text);IF success_bytes>8388608 THEN RAISE EXCEPTION 'Scalar exceeded transport size budget';END IF;
 j:=public.review_prospect_snapshot(t,a,false);IF j->>'status' IS DISTINCT FROM 'complete' OR (j->>'observationCount')::int IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Opposite mode isolation failed';END IF;

 -- Capture actual default-planner metadata probes; do not force enable_seqscan off.
 FOR probe IN SELECT * FROM (VALUES
  ('leads','select id,prospect_review_bytes from public.leads where tenant_id=$1 order by id limit 101'),
  ('observations','select id,prospect_review_bytes from public.lead_observations where tenant_id=$1 and synthetic=$2 order by id limit 1000'),
  ('brief','select version,prospect_review_bytes from public.business_briefs where tenant_id=$1 order by version desc limit 1'),
  ('admins','select id from public.profiles where is_admin order by id limit 101'),
  ('owners','select user_id id from public.memberships where tenant_id=$1 and role=''owner'' order by user_id limit 101')
 ) AS probes(label,sql) LOOP
  EXECUTE 'EXPLAIN (FORMAT JSON, COSTS ON) '||probe.sql INTO plan USING t,true;
  WITH RECURSIVE nodes(node) AS (SELECT plan->0->'Plan' UNION ALL SELECT child.value FROM nodes CROSS JOIN LATERAL jsonb_array_elements(coalesce(node->'Plans','[]'::jsonb)) child)
  SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('node',node->>'Node Type','index',node->>'Index Name','relation',node->>'Relation Name','rows',node->'Plan Rows','sort',node->'Sort Key'))) INTO summary FROM nodes;
  plans:=plans||jsonb_build_object(probe.label,summary);
 END LOOP;
 EXECUTE 'RESET ROLE';
 INSERT INTO public.leads(id,tenant_id,source,email) VALUES(extra_lead,t,'import','snapshot-101@example.invalid');
 EXECUTE 'SET LOCAL ROLE service_role';IF public.review_prospect_snapshot(t,a,true) IS DISTINCT FROM '{"version":1,"status":"capacity"}'::jsonb THEN RAISE EXCEPTION '101 contacts did not return only capacity';END IF;EXECUTE 'RESET ROLE';
 DELETE FROM public.leads WHERE id=extra_lead;
 INSERT INTO public.lead_observations(id,tenant_id,lead_id,source,external_ref,observed_at,original_purpose,synthetic) VALUES(extra_obs,t,first_lead,'qa','snapshot-1000',now(),'Synthetic observation bound',true);
 EXECUTE 'SET LOCAL ROLE service_role';IF public.review_prospect_snapshot(t,a,true) IS DISTINCT FROM '{"version":1,"status":"capacity"}'::jsonb THEN RAISE EXCEPTION '1000 observations did not return only capacity';END IF;EXECUTE 'RESET ROLE';
 DELETE FROM public.lead_observations WHERE id=extra_obs;
 INSERT INTO public.lead_observations(id,tenant_id,lead_id,source,external_ref,observed_at,original_purpose,synthetic,assessment_facts) VALUES(wide_obs,t,first_lead,'qa','snapshot-wide',now(),'Synthetic byte gate',true,jsonb_build_object('industry',repeat('x',2000000)));
 -- Keep observation count at 999 so byte rejection is independent of the count cap.
 DELETE FROM public.lead_observations WHERE id='fa800000-0000-4000-8003-000000000999';
 IF (SELECT prospect_review_bytes FROM public.lead_observations WHERE id=wide_obs)<=65536 THEN RAISE EXCEPTION 'Stored raw-byte fixture too small';END IF;
 SELECT prosrc INTO body FROM pg_proc WHERE oid='public.review_prospect_snapshot(uuid,uuid,boolean)'::regprocedure;
 body:=regexp_replace(regexp_replace(regexp_replace(body,'\mp_tenant\M','$1::uuid','g'),'\mp_actor\M','$2::uuid','g'),'\mp_synthetic\M','$3::boolean','g');
 EXECUTE 'SET LOCAL ROLE service_role';
 IF public.review_prospect_snapshot(t,a,true) IS DISTINCT FROM '{"version":1,"status":"capacity"}'::jsonb THEN RAISE EXCEPTION 'Wide compressed bytes did not return only capacity';END IF;
 -- Function SET prevents inlining; analyze the exact catalog body with bound fixture args.
 EXECUTE 'EXPLAIN (ANALYZE, VERBOSE, FORMAT JSON, TIMING OFF) '||body INTO plan USING t,a,true;
 WITH RECURSIVE nodes(node) AS (SELECT plan->0->'Plan' UNION ALL SELECT child.value FROM nodes CROSS JOIN LATERAL jsonb_array_elements(coalesce(node->'Plans','[]'::jsonb)) child),
 wide AS (SELECT node FROM nodes WHERE node->>'Node Type'='Aggregate' AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(node->'Output','[]'::jsonb)) o WHERE o LIKE '%jsonb_agg%'))
 SELECT count(*),count(*) FILTER(WHERE (node->>'Actual Loops')::int<>0) INTO wide_nodes,executed_wide FROM wide;
 IF wide_nodes<4 OR executed_wide<>0 THEN RAISE EXCEPTION 'Capacity path executed wide aggregation (nodes %, executed %)',wide_nodes,executed_wide;END IF;
 EXECUTE 'RESET ROLE';DELETE FROM public.lead_observations WHERE id=wide_obs;
 UPDATE public.profiles SET email=repeat('x',1030)||'@example.invalid' WHERE id=own;
 EXECUTE 'SET LOCAL ROLE service_role';IF public.review_prospect_snapshot(t,a,true) IS DISTINCT FROM '{"version":1,"status":"capacity"}'::jsonb THEN RAISE EXCEPTION 'Oversized owner email silently omitted';END IF;EXECUTE 'RESET ROLE';
 UPDATE public.profiles SET email='snapshot-owner@example.invalid' WHERE id=own;
 INSERT INTO auth.users(id,email) SELECT ('fa800000-0000-4000-8004-'||lpad(g::text,12,'0'))::uuid,'snapshot-raw-owner-'||g||'@example.invalid' FROM generate_series(1,99) g;
 INSERT INTO public.memberships(tenant_id,user_id,role) SELECT t,('fa800000-0000-4000-8004-'||lpad(g::text,12,'0'))::uuid,'owner' FROM generate_series(1,99) g;
 EXECUTE 'SET LOCAL ROLE service_role';IF public.review_prospect_snapshot(t,a,true) IS DISTINCT FROM '{"version":1,"status":"capacity"}'::jsonb THEN RAISE EXCEPTION '101 raw owners were filtered before capacity';END IF;EXECUTE 'RESET ROLE';
 receipt:=jsonb_build_object('result','PASS','scope','hosted scalar SQL; synthetic rollback only','completeLeadCount',100,'completeObservationCount',999,'ownerCount',2,'stoppedCount',3,'scalarBytes',success_bytes,'scalarElapsedMs',scalar_ms,'capacityChecks',jsonb_build_array('101 contacts','1000 observations','compressed raw observation bytes','owner email bytes','101 raw owners'),'wideJsonAggregateNodes',wide_nodes,'executedWideJsonAggregateNodes',executed_wide,'defaultProbePlans',plans,'statementTimeout',current_setting('statement_timeout'),'lockTimeout',current_setting('lock_timeout'));
 PERFORM set_config('ripepiper.qa_snapshot_receipt',receipt::text,true);
END $$;
SELECT current_setting('ripepiper.qa_snapshot_receipt')::jsonb AS qa_receipt;
ROLLBACK;
