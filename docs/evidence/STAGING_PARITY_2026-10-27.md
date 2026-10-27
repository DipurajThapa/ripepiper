# Staging parity — 27 October 2026

**Current result: isolated staging has 35 source-verified migrations. Snapshot scalar/capacity/EXPLAIN rollback acceptance passed on migration 35; the six existing packets and four-fix audit packet passed at the preceding 34-migration checkpoint. Final exact residue checks found no retained fixtures. See the hosted receipts below.**

The following preflight was read-only when written; its observed baseline and planned sequence are retained as historical evidence. Base HEAD: `d3075179d97d85405771f7582ca7c20456d1b371`; inspected working candidate includes four untracked 20261027 migrations, identified by hashes below. This is not a claim that all files exist in that commit. Target exclusively `ripepiper-staging`, `wgomywhuzyboxlckopca`; production `jtoafjjszqqrtwerxspw` was not queried or modified.

## Observed baseline

- Project ACTIVE_HEALTHY, PostgreSQL 17.11.0.003, ap-southeast-1.
- Hosted history has **25** entries, including source `20261024105646_revive_draft_source_receipts` at hosted version `20261026131138` and `20261024105757_revive_campaign_audience` at `20261026131144`. The older 23-entry documentation is historical.
- All 25 single stored-statement MD5 values match current repository SQL after CRLF-to-LF normalization. All 19 SHA-256 values in the initial migration manifest also match LF source. Preserve LF when applying from Windows.
- Metadata confirms existing Revive receipt/audience functions are security invoker with fixed empty search paths; later setup/Signal/agency objects are absent. History hashes are not a complete schema-drift proof.
- Aggregate-only counts: zero tenants, auth.users, leads, profiles, outbound_actions, sheet_outbox and build_usage. No private row contents or secrets retrieved.
- Security advisors: two informational no-policy notices on private build_budget/build_usage, and three warnings on authenticated current-user is_admin/is_member/is_owner helpers. This matches the documented baseline; it is not a clean-advisor claim.

## Exact append order

Apply sequentially after current-source regression acceptance. Paths are under `platform/ripe-piper-platform/supabase/migrations/`. SHA-256 values cover UTF-8 LF source. Preserve existing `ripepiper_` hosted name prefix and the full source stem, record returned hosted versions and compare stored-statement hashes. Do not replay the first 25 or repair history to force hosted timestamps to equal filenames.

| Order | File | SHA-256 |
|---|---|---|
| 26 | `20261024161910_revive_client_setup.sql` | `9095af247b7c4620c019e29ea5bb03f88820ec9b7a81fd00495ea0d775847e93` |
| 27 | `20261024162439_revive_strategy_schedule.sql` | `d22e08e86559550b1237b90f4fc413214b38c11e84c985c80bfba9c0339f5c52` |
| 28 | `20261024185356_signal_trigger_review.sql` | `70dc1668c2cdb004f0efb227b2da044dcd755d566afd995aec4ac7ca7060a518` |
| 29 | `20261026034704_signal_reviewed_execution.sql` | `1e225ee11e07aa967bfab07f9456eab72fd38ccf82c7a4c1b789fcefb641ae52` |
| 30 | `20261026041450_revive_egm_execution_guards.sql` | `eef81d1890d9a221b97017c775cf07d62c8675269e918d2556ef3428c1492e3c` |
| 31 | `20261027000000_scope_sheet_outbox.sql` | `cc0a7eb03e256c0398355a2363fa3057f90ee7a05a3f79604c64f6b8609231e6` |
| 32 | `20261027000001_atomic_consultation_reservation.sql` | `5c265c5c3ca609413c98b93327b21f2b16c33a23746dfda735108bb7ef81eb20` |
| 33 | `20261027000002_agency_opt_out.sql` | `906f1b8519c8a3b27386fbb2c0b3713e3d57e5055b5e4e1448866a1ab0475b0c` |
| 34 | `20261027000003_gmail_pause_fence.sql` | `e12e624c7a6683639856d66bffaf6fd88fc969ac27095a2e3fc3a36c4b2e3803` |

Setup/strategy replace shared guards; Signal precedes the Revive EGM function that calls Signal fact validation. Final four migrations narrow sheet triggers, add atomic reservation, add agency suppression/newsletter functions, and fence Gmail import. These SQL files do not call external providers. Consultation/agency SECURITY DEFINER functions have empty search paths and service-only EXECUTE; explicitly verify grants. Agency tables have RLS and revoked public/client access. Do not add broad policies merely to suppress informational notices.

## Verification sequence

1. Recheck project identity, history, empty baseline and source hashes immediately before execution. Single integrator only. Accept fresh local full-schema rehearsal (`test/migration-upgrade.test.ts`) and relevant Revive/Signal, sheet, consultation, agency and Gmail tests. This preflight did not run regressions.
2. Append the nine migrations in order. Stop on error, inspect confirmed history/state and correct forward. Never automatically reset/delete hosted schema.
3. Expect 34 history entries; compare stored hashes, inspect RLS and function grants/security/search_path, and explain advisor deltas.
4. Run each existing `qa/staging-*-rollback-acceptance.sql` separately and sequentially as one complete BEGIN/DO/ROLLBACK query. Never split into committed calls. Fixtures use synthetic identities; shared packet arms a synthetic budget inside its rolled-back transaction. After error verify rollback before continuing. Database/empty-state guards do not prove project identity: pin connector project_id to staging.
5. Recheck aggregate residue on every fixture table: auth/users/profiles, tenants/membership/activation, lead/source/observation/rights, campaign/assets/actions, Revive/setup/reviews, event receipts, meeting/reminders, billing/quote/invite/payment, activity, sheet_outbox, build_usage. Confirm budget remains disabled. Capture results and hashes without fixture payloads.

| Existing packet under `qa/` | SHA-256 (LF) |
|---|---|
| `staging-billing-rollback-acceptance.sql` | `098bd385ce2e0b959aca6443e3968cdbf7415d9ecbd9dba8fcf455defab9cd2f` |
| `staging-consultation-rollback-acceptance.sql` | `0842e2b4e88cea8473c75294769aed1a1156f7f968387e0d2bf27dce122c18e5` |
| `staging-events-rollback-acceptance.sql` | `dba81b713ccf61b28c8a5184874b4709baf1d94ed1ec25a639378b786827e60d` |
| `staging-revive-draft-rollback-acceptance.sql` | `68276dc6b9554dddd54d924ae044ba4b9490241ec4549dc9f588ae27f9b78d99` |
| `staging-revive-rollback-acceptance.sql` | `0b33e5089daa50fc097bd0afd36ffa4b6a365c3ec57da351a01cb8b75a592a06` |
| `staging-rollback-acceptance.sql` | `dc951dca06926a9dab3f5893a27893b846dcd28fbbd7f55c6ca161c90a409605` |

Current Revive/shared packets have amended setup/strategy/audience fixtures. Historical hosted passes do not certify these hashes. Existing packets do not exhaustively cover new Signal, agency-opt-out, reservation or Gmail contracts; new hosted assertions need separately reviewed rollback-only fixtures and receipts. Local tests must not be relabeled hosted acceptance.

## Limits and recovery

No Worker deployment, Auth API fixture creation, credential retrieval, automation activation, external sends or production changes. `scripts/staging-http-acceptance.mjs` is a separate bounded Auth/PostgREST/Worker test with persistent synthetic creation/cleanup; it is not rollback-only SQL and requires dedicated staging secrets/runtime identity. Do not implicitly include it here.

Rollback protects fixtures, not applied DDL. Preserve source/history before any separately scoped environment reconstruction. No backup/restore, multi-connection race, provider delivery or operational release acceptance is established.

Current [Supabase migration documentation](https://supabase.com/docs/guides/deployment/database-migrations) was checked for history/single-deployer guidance. Changelog Markdown fetch failed (web content-type rejection, shell DNS unavailable). No implementation API was changed during this read-only inspection.

## Hosted execution receipt — 27 October 2026

The responsible integrator authorized exactly the nine-file sequence after candidate `d75d211cff3b3ddcfed966a9f8df07f2f0d62ced` was committed and independently checked. Re-read immediately before execution confirmed `ripepiper-staging` / `wgomywhuzyboxlckopca`, ACTIVE_HEALTHY PG17.11.0.003, 25 existing migrations, the seven empty aggregate baseline counts, and unchanged SHA-256 values for all nine source files. Migration and QA directories remained unchanged through final readback. An unrelated script working edit was outside this receipt.

All nine were applied sequentially with `apply_migration`, using exact LF source from that commit. Every name below has the `ripepiper_` prefix. Each stored history record contains one SQL statement whose MD5 matches the source; the SHA-256 identity is in the preflight table above. Full history readback contains 34 entries; the original 25 statement hashes are unchanged.

| Source stem after `ripepiper_` | Hosted version | Stored/source MD5 |
|---|---|---|
| `20261024161910_revive_client_setup` | `20261027185406` | `5e4f424fbfb1ef7766f72b9cf19b4710` |
| `20261024162439_revive_strategy_schedule` | `20261027185417` | `45b6f4521d27524e150b6fccb880c40a` |
| `20261024185356_signal_trigger_review` | `20261027185426` | `d256d262a840411caffbcd48620de4c7` |
| `20261026034704_signal_reviewed_execution` | `20261027185443` | `28cbc4c146939bb24807ed44df9df09f` |
| `20261026041450_revive_egm_execution_guards` | `20261027185452` | `db2ba4ef1f6ec35f6b299b304d9c0641` |
| `20261027000000_scope_sheet_outbox` | `20261027185912` | `2f6e0933e9b040b660dc0e83e69c0c87` |
| `20261027000001_atomic_consultation_reservation` | `20261027185920` | `fc1179f24c3b6e6026756bfdc486155d` |
| `20261027000002_agency_opt_out` | `20261027185931` | `c9781893d44e18bbbb4cdc263adeece5` |
| `20261027000003_gmail_pause_fence` | `20261027185940` | `d5aede4a06a386130495d4ed2c02a95e` |

One connector attempt for scope_sheet_outbox returned `Invalid or expired requestState`. Execution stopped for read-only investigation: history contained no entry for it, and both original sheet triggers remained unchanged. A single retry succeeded. Final readback confirms both lead and meeting sheet triggers have `WHEN (new.tenant_id IS NULL)`. No SQL migration error or partially applied migration was observed.

### Security metadata and advisor delta

`reserve_consultation`, `confirm_agency_newsletter`, `confirm_agency_opt_out`, `issue_agency_opt_out` and `request_agency_newsletter` are SECURITY DEFINER with fixed empty search paths, no anon/authenticated EXECUTE and service_role EXECUTE. `record_gmail_product_event`, `build_revive_strategy`, `save_revive_setup` and `revive_fit_current` have the same grants and search path with SECURITY INVOKER.

Both agency tables have RLS enabled, no anon/authenticated table access and service-role access. `revive_setups` has RLS enabled; its authenticated policy is SELECT-only `staff_read USING (is_admin())`. No anonymous access is granted.

Advisor readback at 19:00 UTC: **4 INFO and 3 WARN**. The two additional INFO findings are RLS-with-no-policy on intentionally service-only `agency_opt_out_requests` and `agency_suppression`. Existing no-policy build_budget/build_usage notices and authenticated SECURITY DEFINER warnings for is_admin/is_member/is_owner remain. No new warning was reported; no broad grants or policies were added to silence informational notices.

### Actual rollback acceptance

The six files with exact hashes in the table above were executed separately and sequentially, without editing or splitting their BEGIN/DO/ROLLBACK transactions. Each returned its explicit PASS result:

| Packet | Observed hosted result |
|---|---|
| Billing | PASS: service grants, attempt hold, exact terms, failure/paid/replay, atomic engagement/quote, held notifications |
| Consultation | PASS: role guard, unknown/rebook, staff CAS/replay/correction, draft, fenced claim, cancel/late acknowledgement/no resend |
| Events | PASS: grants/settings/intake/capacity/replay/approval/cancellation/retention |
| Revive draft | PASS: save/replay, no automatic approval, stale review/source/company/expiry/ACL and existing workflow |
| Revive | PASS: activation/roles/CAS/cohort/queue/fence/replay/attribution/backdated evidence/reviewer/resume |
| Shared | PASS: roles/RLS/FK/fence/replay/Response CAS/global budget |

Every packet rolled back. Final exact aggregate readback checked **all 36 public tables plus auth.users**. All 35 fixture-capable/non-baseline relations were empty. The only nonzero relations were the expected baseline `build_budget` singleton (1) and `fx_rates` (2). Budget aggregates confirmed zero enabled rows and zero rows with reconciled prior usage. No fixture data, activation, sheet work, outbound action or spend authority remains.

The empty relations checked were activity_log, ad_accounts, ad_metrics_daily, agency_opt_out_requests, agency_suppression, auth.users, build_usage, business_briefs, campaign_assets, campaigns, contact_rights, deals, fees, invites, lead_observations, lead_suppression, leads, meetings, memberships, newsletter_subscribers, outbound_actions, outbound_stops, outreach_weekly, payments, posts, profiles, proposals, quotes, revive_reviews, revive_setups, sheet_outbox, subject_requests, suppression, tenant_activation_reviews and tenants.

### Timeout readback and scope limits

Earlier read-only timeout inspection found authenticator statement_timeout=8s and lock_timeout=8s; service_role had no role/database override. Public functions had no timeout overrides at that inspection. Per [Supabase timeout inheritance](https://supabase.com/docs/guides/database/postgres/timeouts), the configured PostgREST service-role ceiling is 8s. The MCP postgres session instead reported statement_timeout=2min from configuration, lock_timeout=0 and idle-in-transaction=0. No setting was changed and no actual timed HTTP probe was performed.

This receipt establishes the named nine-migration staging upgrade, metadata/grant checks and six bounded SQL rollback contracts for candidate d75d211. It does not cover any later migration, exhaustively verify the new agency/reservation/Gmail or Signal behaviors, or establish Auth/PostgREST/Worker HTTP, multi-connection races, backup restoration, provider delivery or production acceptance. No production query/mutation, Worker deployment, external communication, secret retrieval or provider activation was performed.

## Additional audit packet — preparation and hosted receipt

`qa/staging-audit-rollback-acceptance.sql`, SHA-256 (UTF-8 LF) `56b43a22d3859ed7708dba95d3d8a7fdd4f2d43a679f8b50333ce5f7ae79624b`, adds a separate single BEGIN/DO/ROLLBACK packet for the four October 27 fixes. It checks agency-only lead/meeting outbox entries while retaining tenant proposal/payment entries; overlap rollback, correct reservation and one-use capability; agency preference confirmation/replay/expiry/sibling invalidation and no newsletter reconsent or tenant lifecycle writes; and Gmail exact replay, pause, stale reactivation version and expired connection fences. All six new RPCs have anon/authenticated denial and service grant assertions; actual authenticated calls to reservation, preference confirmation and Gmail persistence must raise insufficient_privilege.

The packet requires postgres and an empty auth/public operational baseline, permitting only the existing dormant build-budget row and FX baseline. All identifiers and evidence are synthetic. Direct tenant activation/reactivation is explicitly confined to rolled-back fixture setup. Identity sequences may advance despite rollback; no rows or usable authority persist.

Local rehearsal passed against all 34 migrations in isolated PGlite. The unchanged hosted database-name guard first rejected template1; a local-only replacement of that expected database name then passed every assertion. All public operational tables and auth.users were empty afterward. An initial rehearsal exposed an assertion reading newsletter_subscribers as service_role; the assertion now temporarily resets to the controlled QA session, preserving the application's service-only RPC access rather than broadening grants. This is local fixture validation only. The following hosted receipt supersedes the preparation-only status.

After reviewing the complete packet, the integrator authorized the exact LF SHA-256 above. At **2026-10-27 19:05 UTC**, fresh readback confirmed the staging project identity, ACTIVE_HEALTHY status, 34 migrations (latest `20261027185940`), dormant/unreconciled budget and empty operational baseline. The exact file was executed in one complete BEGIN/DO/ROLLBACK call. Actual hosted result:

> PASS: hosted audit sheet-scope/reservation-atomicity/preference-scope/Gmail-fence/role-denials; all synthetic fixtures rolled back

Fresh aggregate readback again checked all 36 public tables plus auth.users: 35 operational relations empty; only the baseline build_budget singleton and two FX rates remain. Budget enabled rows=0 and reconciled-prior rows=0. Migration count remains 34. This adds hosted SQL acceptance for the specific four-fix assertions in this packet; no further migration, provider request, Worker deployment or production action occurred.

## Persistent rollback rehearsal

`platform/ripe-piper-platform/test/staging-rollback.test.ts` now runs both the existing shared packet and the new audit packet via `it.each`, composing every repository migration first. It preserves the unchanged hosted database-name rejection, verifies that the local adapter changes only postgres to template1, and checks every operational public table plus auth.users for zero residue and the budget singleton for disabled/unreconciled state. Focused Vitest run: **2/2 passed** on 27 October 2026. This is a local regression guard, separate from the hosted receipts above.

## Forthcoming snapshot migration: hosted validation plan (not applied)

The snapshot migration remains in development and is outside the 34-migration receipt. Before any application, freeze the final file/commit and normalized SHA-256, review generated-column effects on existing row/digest projections, obtain integrator instruction, and recheck exact staging identity/history and empty operational baseline. Do not substitute a changing working file for the reviewed source.

Planned bounded checks after a separately authorized application:

1. **Schema receipt:** compare the stored migration statement with frozen source; inspect pg_attribute.attgenerated/pg_attrdef for four STORED byte-length columns, pg_indexes for tenant/ID lead and tenant/mode/ID observation covering indexes, partial admin-ID index and tenant/role/user membership index. Inspect `review_prospect_snapshot(uuid,uuid,boolean)` return type jsonb, STABLE volatility, SECURITY INVOKER, fixed empty search_path, denied PUBLIC/anon/authenticated EXECUTE and granted service_role EXECUTE. Verify any separate grants needed to read auth identity metadata remain narrowly scoped.
2. **Execution limits:** re-read authenticator/service_role/database timeout metadata and function overrides. Current expected API statement limit is 8s; the MCP postgres session is 2min. Preserve that distinction. A rollback fixture call may set transaction-local 8s statement and lock timeouts; do not persist settings, increase API limits, or infer cancellation behavior from the MCP session.
3. **Actual scalar SQL:** use a single reviewed BEGIN/DO/ROLLBACK packet with strict empty operational baseline and fixed synthetic IDs. Prepare two tenants, verified staff, owner/viewer/foreign-owner identities and synthetic facts. Call the actual service-role function; assert one jsonb scalar, complete scoped arrays/counts, owner deduplication and inclusion/exclusion, mode separation and all stop reasons. Return only aggregate statuses, sizes and counts, never contact payloads. Confirm browser-role EXECUTE denial and unauthorized/missing envelopes have no success arrays.
4. **Bounded capacity fixtures:** at most 101 contacts, 1000 observations and 101 raw owner/admin candidates per scenario. Assert complete at 100 contacts/999 observations when byte/owner bounds allow, and only capacity at 101/1000. Add one oversized compressible observation and one oversized owner label/email scenario using bounded fixture strings; prove no success arrays leak through capacity. Reuse controlled fixture rows inside the rolled-back transaction rather than fetching operational data. Independent local adversaries cover the broader matrix; hosted results must state which subset actually ran.
5. **Read-only EXPLAIN:** capture default-planner `EXPLAIN (FORMAT JSON, COSTS ON)` for the scalar call and each exact underlying metadata probe: tenant leads ORDER BY id LIMIT101; tenant/mode observations ORDER BY id LIMIT1000; latest brief ORDER BY version DESC LIMIT1; raw admin IDs ORDER BY id LIMIT101; tenant owner IDs ORDER BY user_id LIMIT101. A SQL function with a SET clause may remain opaque in the outer plan; report that and inspect the matching probes instead of claiming the Result node proves the inner plan. Record Limit/index/sort nodes and row estimates. On tiny empty/fixture tables a sequential scan can be rational; do not disable seqscan and present a forced plan as natural index use. Any full-tenant sort needed to detect a cap is a review finding. No EXPLAIN ANALYZE over operational data.
6. **Rollback/readback:** execute the entire fixture packet as one call, inspect actual errors before retry, then verify all operational public tables/auth users empty, baseline budget still disabled/unreconciled, expected migration count and no schema/advisor regressions. Persist exact source/packet hashes and actual plan excerpts.

These SQL checks do not demonstrate PostgREST response shape under a tiny configured row cap, HTTP byte/deadline handling, actual Auth/Worker integration or independent-connection races. No HTTP/config mutation or blocked Worker deployment is part of this plan. The final snapshot implementation must retain that acceptance limit until separately verified.

### Frozen snapshot candidate and prepared packet

Snapshot migration `20261027190653_safe_bounded_prospect_snapshot.sql` has Windows raw SHA-256 `6db60918deb44c78cfeb6f086b0f4c282c27489b7d3b3ef6ed2a07619973e380`; its canonical UTF-8 LF SHA-256 is `5c129cd80a540f3918fd95870db6a8cd0a8cdaa11f56759360c529506e2a7d84`. These differ solely by CRLF normalization. Hosted application must use the canonical LF bytes and await the integrator's final approval.

Prepared `qa/staging-snapshot-rollback-acceptance.sql`, LF SHA-256 `2aaf90fd93f519de7e63c4dbb91d5701ce0c231576e837529593f7da38f89719`, for review. It sets only transaction-local 8s timeouts and uses a complete BEGIN/DO/SELECT-receipt/ROLLBACK call. The connector's ability to return a SELECT receipt followed by ROLLBACK was verified in a separate read-only transaction. The packet checks scoped scalar results at 100 leads/999 same-mode observations, two deduplicated eligible owners, three stop types, opposite-mode exclusion, browser-role denials and exact unauthorized/missing/capacity envelopes. Capacity cases cover 101 leads, 1000 observations, 2MB compressible observation facts with only 999 selected observations, oversized owner email and 101 raw owner candidates before verification filtering.

Five default-planner metadata probes are captured compactly. An EXPLAIN ANALYZE of the exact stored function body with bound synthetic arguments checks at least four wide JSON aggregate nodes and zero Actual Loops on the byte-capacity path. No optimizer flags are forced. Analysis executes only the read-only query over bounded fixtures. Receipt output contains aggregate values and plan-node summaries without fixture contact content. At preparation time the packet has not been rehearsed locally because the integrator's full suite is running, and has not run hosted; the migration is still unapplied.

Integrator review corrected the owner-email fixture to enlarge only public.profiles.email (text), leaving auth.users.email unchanged. Actual hosted metadata confirms the Auth email column is varchar(255). The test therefore expects capacity before the mismatched identity can be silently filtered, without violating Auth's storage bound. Observation deletions remain limited to known synthetic IDs under postgres; metadata confirms DELETE privilege, and source review confirms these null-product-context observations are not append-only Revive outcomes. All evidence locks and invalidation triggers stay enabled. The packet's 8s timeout covers the entire DO block, including fixture setup and all assertions; default plans describe these small freshly inserted fixtures and do not establish large-tenant performance.

## Snapshot hosted receipt — 27 October 2026, 19:25 UTC

Following integrator approval, re-read confirmed `ripepiper-staging` / `wgomywhuzyboxlckopca`, ACTIVE_HEALTHY, exactly 34 existing migrations, empty operational tables/auth users, disabled unreconciled budget and both approved canonical source hashes. Only `20261027190653_safe_bounded_prospect_snapshot.sql` was applied. The accepted source is now published in commit `647193e7f3385f69c7a61ce8190dac4503bb4ebf`; its LF bytes match the approved candidate.

| Migration receipt | Actual value |
|---|---|
| Hosted name | `ripepiper_20261027190653_safe_bounded_prospect_snapshot` |
| Hosted version | `20261027192044` |
| History count | 35 |
| UTF-8 LF SHA-256 | `5c129cd80a540f3918fd95870db6a8cd0a8cdaa11f56759360c529506e2a7d84` |
| Source/stored-statement MD5 | `57e0d00bb7bb4aa3377bd76f50a85f5b` |
| Stored statement count | 1 |

Post-application metadata confirms four bigint STORED generated `prospect_review_bytes` columns on leads, lead_observations, business_briefs and profiles, with the reviewed projected-field octet-length expressions. All four reviewed indexes exist with exact columns: leads `(tenant_id,id) INCLUDE(prospect_review_bytes)`; observations `(tenant_id,synthetic,id) INCLUDE(prospect_review_bytes)`; profiles `(id) WHERE is_admin`; memberships `(tenant_id,role,user_id)`.

`review_prospect_snapshot(uuid,uuid,boolean)` returns jsonb, is STABLE and SECURITY INVOKER, and has fixed empty search_path. PUBLIC, anon and authenticated EXECUTE are false; service_role EXECUTE is true. No function timeout override was introduced. Authenticator remains statement_timeout=8s/lock_timeout=8s; service_role has no override and there is no database timeout override. No persistent timeout setting was changed.

### Exact rollback packet and observed scalar

The approved packet LF SHA-256 `2aaf90fd93f519de7e63c4dbb91d5701ce0c231576e837529593f7da38f89719` executed as one full BEGIN/DO/SELECT-receipt/ROLLBACK call. The first connector attempt returned `Invalid or expired requestState`, without a SQL result. Before retry, aggregate readback found no operational residue, and an aggregate pg_stat_activity check found zero other active snapshot fixture queries. A single unchanged retry returned **PASS** at 19:25 UTC.

| Actual receipt field | Value |
|---|---:|
| Complete contact count | 100 |
| Complete same-mode observation count | 999 |
| Deduplicated eligible owner count | 2 |
| Stopped contact count | 3 |
| Scalar JSON bytes (`octet_length(jsonb::text)`) | 413,286 |
| Measured scalar SQL call duration | 29.676 ms |
| Transaction-local statement timeout | 8s |
| Transaction-local lock timeout | 8s |
| Wide JSON aggregate nodes on capacity path | 4 |
| Executed wide JSON aggregate nodes | 0 |

Actual assertions passed for browser-role denial, unauthorized/missing envelopes, tenant/mode isolation, exact owner membership, all three stop reasons, and capacity-only envelopes at 101 contacts, 1000 observations, oversized compressible raw observation facts (with selected count held at 999), oversized profile-owner email, and 101 raw owner memberships including unverified identities. The oversized Auth email field was never written. Scalar duration is one synthetic fixture measurement, not a latency guarantee; the 8s statement limit covers the full DO block.

The no-wide-aggregation assertion used EXPLAIN ANALYZE on the exact persisted function body with bound synthetic parameters, after verifying actual RPC capacity rejection. It identified four Aggregate nodes whose outputs contain jsonb_agg, all with Actual Loops=0. Function SET prevents inlining, so this proves the body path for this fixture rather than claiming an opaque outer Result node reveals internal execution. No planner settings or database guards were changed.

### Actual default-planner probe results

| Probe | Observed nodes | Index | Estimated index rows |
|---|---|---|---:|
| Tenant contacts, LIMIT101 | Limit → Index Only Scan | `leads_prospect_snapshot` | 1 |
| Tenant/mode observations, LIMIT1000 | Limit → Index Only Scan | `observations_prospect_snapshot` | 1 |
| Latest brief, LIMIT1 | Limit → Index Scan | `business_briefs_pkey` | 4 |
| Raw admin IDs, LIMIT101 | Limit → Index Only Scan | `profiles_prospect_admins` | 325 |
| Tenant owner IDs, LIMIT101 | Limit → Index Only Scan | `memberships_prospect_owners` | 1 |

No Sort node appeared in these five actual default plans. These estimates come from small freshly inserted synthetic fixtures without refreshed planner statistics. Index use is observed here; large-tenant cardinality/performance and concurrent change behavior remain unproven.

### Final residue, advisors and limits

After rollback, exact aggregate readback across all 36 public tables and auth.users again found 35 operational relations empty. Only the baseline build_budget singleton (disabled; prior usage unknown) and two FX rows remain. History count is 35. Security advisors at 19:25 UTC remain **4 INFO and 3 WARN**, identical to the previous checkpoint: no snapshot-induced finding.

This adds actual hosted PostgreSQL scalar, bounded capacity, grant, generated-byte/index and synthetic query-plan evidence. It does not establish PostgREST tiny-row-cap behavior, HTTP response/deadline handling, authenticated Worker deployment, independent-connection races, backup restoration or real delivery. The earlier seven hosted packets retain their exact 34-migration checkpoint; this receipt does not relabel them as rerun on 35. Production, secrets, providers and Worker deployment were untouched.
