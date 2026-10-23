# Independent QA — operational development cycle, 23 October 2026

## Baseline receipt

QA owner: separate verifier agent/session, not the implementation author. Candidate: PR #6 `e4d976892af5e9c7d9d262d20b77310ca552f291`; integration target: main `6b84b389610ca712c5e78284d8446141623ea2e5`. Tested in a separate git worktree, `ripepiper-qa`, with Node 24.19.0 and the existing lockfile-installed dependency set. This receipt accepts the source/backlog baseline for offline work admission. It does not accept any hosted database, production deployment or live product journey.

Before execution QA read the delivery/governance records, `harness/AGENTS.md`, package scripts, Vitest configuration, network guard, migration rehearsal and browser script. The tests stub unmocked `fetch` to throw; database checks instantiate disposable local PGlite and provider responses are synthetic. The browser fixture aborts external network routes. No dependency installation, real provider mutation, customer data access, paid call, migration against a hosted database or deploy command was run.

| Check | Result | Evidence / limit |
|---|---|---|
| `npm run typecheck` | PASS | TypeScript on exact baseline |
| `npm test` | PASS | 186 assertions/tests across 11 test files; includes fresh baseline-to-head PGlite upgrade, tenant/RLS and replay/stop checks |
| `node --test scripts/*.test.mjs` | PASS | 36 Node UI/safety/harness tests; zero skipped |
| Frontend JavaScript syntax | PASS | Every `site/assets/*.js` parsed with Node |
| `node scripts/preview.mjs build` | PASS | Isolated preview built locally |
| `node harness/evaluate.mjs` | PASS (truthful report) | 0 of 17 operational stages accepted, matching the then-empty ledger |
| `node harness/evaluate.mjs --require-ready` | EXPECTED NONZERO | Exit 1 is correct while required operational evidence is absent; not a product-ready pass |
| `node scripts/product-browser-check.mjs` | BLOCKED | Pinned Chromium executable absent locally. No browser pass is inferred. Exact final candidate CI must run this check. |
| Baseline GitHub CI 39931781916, job 120341604818 | PASS | QA read the exact-SHA run and all job steps: Chromium rendered workflows, dependency gate and all checks succeeded. [Run](https://github.com/DipurajThapa/ripepiper/actions/runs/39931781916). This closes the baseline browser evidence only; final combined candidate needs its own CI. |
| Hosted Supabase/Auth/backup restoration, Cloudflare deployment, live OAuth/email/calendar | NOT RUN | Outside this fixture baseline; need isolated runtime and authorized provider setup |

## PR #6 implementation review

The runtime diff from main changes only Response review deadlines: `later` retains its agreed time; `interested`, `human` and `uncertain` receive the review SLA; `not_interested`, `wrong_person` and `opt_out` have no overdue deadline. QA inspected the implementation and executed the new regression. Suppression still yields `contactAllowed:false`; no sending or qualification authority is added.

The migration rehearsal applies repository baseline files `0001`–`0003` and subsequent migrations to a new disposable PGlite instance, confirms required runtime tables and RLS, and leaves tenant count zero. This does not establish equivalence to the timestamped live migration history, real Supabase compatibility, hosted isolation, backup recovery or production approval.

## Findings / follow-up

- Local browser prerequisite is unavailable; final GitHub Chromium run remains required.
- `scripts/harness.test.mjs` assumes the checked-in project ledger must always have zero accepted stages. Once independently accepted baseline evidence is recorded, the test should construct an empty synthetic ledger to test fail-closed behavior, rather than prevent truthful progress. This is a test-fixture coupling issue; QA has not changed implementation.
- Development lane reviews will be added below only after exact candidate commits are supplied and independently inspected/tested. No future result is pre-certified.

## Offline paid-use control — independent component review

Source candidate: root commit `8336709b0abaa15a9281825049ba2bd068352668`. QA cherry-picked it into the separate verifier worktree and read the paid policy, Anthropic call boundary, SQL reservation/settlement functions and tests. The verification also combined the reliability candidate below; QA working commit `4871112` is the local cherry-pick composition, not a released artifact.

- PASS: targeted `build-budget.test.ts` and `build-budget-db.test.ts`, 7 tests; TypeScript.
- PASS: absent/expired/mismatched policy stops before any network; refused reservation prevents the provider request; successful mocked call requires reservation first and validated settlement afterward.
- PASS: provider timeout/non-OK body leaves reservation committed; no automatic provider retry; malformed or out-of-bound usage invokes a freeze rather than silently releasing the reservation.
- PASS: dormant budget refuses calls until prior usage and authority are recorded in the local fixture; one global locked row accounts for prior charge plus settled actual or outstanding reservation; concurrent test requests cannot both exceed the US$18 discretionary ceiling. Exact settlement replay succeeds and conflicting settlement is rejected. Over-bound settlement freezes new reservations. Anonymous/authenticated roles cannot arm, reserve or inspect the budget.

Acceptance is for offline controls only. No actual prior charges, provider tariff, production authorization, live database arming or paid request was verified/performed. The configured input bound remains conditional on operator verification of the selected model/tokenizer/tariff, as documented in the code. PGlite Promise.all proves serialization on that engine, not real multi-worker PostgreSQL concurrency. Root final integrated candidate and CI remain required.

## Offline fenced acknowledgement — independent component review

Source candidate: Development commit `67654827a4c4d893ccfc07ccddebbdadf6173e8c`. QA read the new forward migration, dispatch and receipt handlers, legacy completion protection, optional database timeout, campaign token redaction and UI receipt control, then independently executed the focused checks. Root route registration is a separate integration change that still needs final-candidate validation.

- PASS: 13 focused adapter/database tests and 5 campaign UI tests. Combined baseline + paid-use + reliability run: 206 backend tests across 14 files, TypeScript passing.
- PASS: token, tenant, approval version and asset version fencing; a second claim and old unfenced completion cannot acknowledge the fenced action.
- PASS: current tenant pause, suppression, reply hold, authority version and rights withdrawal prevent acknowledgement. A persisted same-token receipt replay returns the prior acknowledgement only, even after pause; it does not produce another sink operation.
- PASS: lost claim response preserves the caller-created fence identity; lost completion response is reconciled through the persisted receipt without repeat completion. Ambiguous results go to review and pause, never requeue.
- PASS: receipt inspection is read-only, tenant scoped, explicitly reports `delivery:not_sent`, and redacts the dispatch token. A late result from a previously selected tenant cannot populate the new tenant UI.

No real email/provider dispatch is implemented or proved by this receipt. `tested` and `synthetic_sink` mean the test sink acknowledged the action; they do not mean sent, delivered or live operating. Hosted multi-process concurrency and final rendered UI/Worker route evidence remain separate requirements.

## Integrated offline review and reproduced defect

QA checked root integrated candidate `2cdfe71a2eb37076c48c58c8f8871740a06a5514`, tree `dd0a61dd6eb22243f0e35bf757b1364313397f9c`, in the separate verifier worktree. Independent full run passed 216 backend tests in 15 files, TypeScript and 7 targeted campaign/Response UI tests. The source included cost `8336709`, reliability `67654827`, the receipt route integration, and Response source candidate `02fb122e758e87dcab10b91b13f71850ca3711b9`.

**Response acceptance (offline):** verified staff-only RPC and actual route boundaries; owners derive from current verified Auth/profile identity with either platform admin or same-tenant owner role; unrelated tenant owners/viewers are excluded. CAS version and exact inbound-ID set reject stale reviews; same request replay returns the original record and changed reuse is rejected. New or same-count-replaced inbound reopens review, including backdated imports. Removed/unverified owners become unavailable. Resolution does not release reply holds or suppression and cannot resume a sequence. Direct authenticated insertion of a forged review and direct RPC invocation are denied. All SQL functions were inspected for fixed search paths and service-only invocation; no public Auth grant was introduced.

QA added independent actual-Worker tests: anonymous 401 and client 403 for the receipt and conversation-review routes; staff tenant-scoped receipt lookup is read-only with no fence token in output; a foreign tenant returns 404; owner-list actor comes from the signed-in staff profile, not a body field. Both tests passed.

**QA finding Q-001 (P1 before paid use): FAILED on the candidate above.** The cost adapter trusted the TypeScript `rpc<boolean>` annotation and used truthiness. Synthetic RPC payloads `{}`, `"false"`, and `1` incorrectly allowed `reserveAI` to return a reservation and `settleAI` to report success. Unknown/malformed reservation evidence must fail closed. Six independently authored negative tests reproduce this failure (three reservation, three settlement). QA test-only commit: `c9517e52ed960507016d67d249f0f3ab4e5420ed`. Root Development owns the strict-boolean correction; cost QA remains blocked until rerun. No actual provider request or paid use was made by these tests. The earlier passing cost cases remain valid but are insufficient for acceptance until this finding is fixed.

**QA finding Q-002 (P1 correctness): FAILED on the same integrated candidate.** The fenced sink adapter also used a truthiness check on `complete_fenced_synthetic_action`. A malformed synthetic RPC payload `{}`, `"false"`, or `1` returned HTTP 200 / `state:tested` while the stored action remained claimed and had no receipt. Three independent negative tests reproduce this. Required behavior: reject a malformed receipt as uncertain, read the same action identity, and hold the same fence for review with HTTP 503 unless an actual persisted receipt exists; do not repeat completion. QA test-only commit `057886e6d469ccc16f95a566692736e6c620d09a`. Reliability Development owns the fix. Offline provider QA remains blocked until rerun. No sink/provider success is inferred from the original green suite alone.

### Q-001 / Q-002 correction verification

Both findings were fixed by Development/CTO, not QA. Cost correction: root `86e578b` requires an exact boolean `true` for reservation and settlement. Reliability correction: Development `c62d987d8926cf79438509972058d175c22b1345`, integrated as `a906f35`, distinguishes exact `false` (denied) from malformed completion (uncertain read/review).

QA independently reran at combined root `39256ee2a605b43440210e6f6c2cb2979305d499`: TypeScript PASS; 228 backend tests in 18 files PASS. All six malformed-budget and three malformed-fenced-receipt regressions now PASS. Q-001 and Q-002 are **CLOSED for this local candidate**; no failed requirement was waived. Existing valid boolean success/false denial, replay and uncertainty tests still pass.

QA also executed the actual public health route and confirmed it returns service identity, `database:not_probed`, `providers:not_probed`, `Cache-Control:no-store`, and performs zero Auth/database/provider calls. This independent test-only addition is commit `6a336f69b6c1228cda12e9a589053e9ef78b2405`, awaiting root integration; all 12 QA route/receipt tests passed together. The standalone runtime probe's three Node tests PASS for identity-vs-static fallback, malformed/oversized responses and unsafe input origins.

Local component evidence is complete for these controls, subject to final composition. Full offline stage promotion still requires PM acceptance and the final combined candidate's Chromium/CI result. Hosted database, release and operating stages remain open; the baseline's old Chromium run cannot verify new UI changes.

## Independent hosted PostgreSQL verification — isolated staging

Target was **only** staging `wgomywhuzyboxlckopca` (`ripepiper-staging`, PostgreSQL 17.11, ACTIVE_HEALTHY), independently read through the Supabase connector. Production `jtoafjjszqqrtwerxspw` was not a write/test target. QA independently listed all 15 ordered migration names, from the three baseline files through fenced acknowledgements, Response review and build-budget controls. Supabase generated application timestamps differ from repository filename prefixes; match ordered names and the root rollout manifest rather than treating the timestamp strings as equivalent.

QA checked actual function metadata: the eight new control RPCs inspected are SECURITY INVOKER with empty fixed search paths, deny EXECUTE to anon/authenticated and permit service_role. Security advisories at this point reported legacy mutable trigger search path, btree_gist in public, and legacy public SECURITY DEFINER entry points; these were routed to CTO for a separate forward hardening migration. No-policy notices for build_budget/build_usage are expected for private service-only tables with RLS and no public grants; they are not a request to create public access policies.

The independently authored rollback script `qa/staging-rollback-acceptance.sql` (QA test-only commit `9234f3a01ca572bd0c3e572872502c979c944ae6`) was executed against staging. It uses explicit BEGIN/ROLLBACK, only .invalid synthetic identities and no provider or Auth API operation.

**PASS:** actual hosted tenant-owner RLS exposes one own lead and neither foreign-tenant nor NULL-tenant pipeline; foreign tenant meeting/lead FK rejects the relation; authenticated role cannot reserve paid usage; fenced claim rejects duplicate/foreign/wrong-token/legacy completion and persists exactly one replayable test receipt; current verified owner list excludes unrelated ownership; Response review version/replay and stale CAS checks work; dormant build budget rejects usage until fixture-only authority is set, global discretionary cap rejects excess, and settlement replay/conflicting settlement behave correctly.

An initial QA fixture used the PGlite stub key `request.jwt.sub`, which is not the hosted Auth contract and produced zero visible leads. QA inspected actual `auth.uid()` and corrected the fixture to `request.jwt.claim.sub`; this is a test setup correction, not an application fix or waived RLS failure. The failed attempt's fixtures were confirmed rolled back before rerun.

The completed rerun returned `PASS: hosted SQL role/RLS/FK/fence/replay/response-CAS/global-budget assertions; all fixtures rolled back`. A fresh independent query afterward confirmed tenants=0, leads=0, profiles=0, auth.users=0, build_usage=0, budget_enabled=false and prior_micro=NULL. No registration, customer, authority or budget arming was left behind.

**Limits:** this establishes hosted SQL compatibility and selected rollback-only behavior. It does not prove backup restoration, authenticated HTTP/PostgREST sessions, Worker deployment, provider delivery, multi-connection concurrency or any product OPERATING. New hardening/Events migrations and final combined candidate require their own follow-up verification.

## Signal acquisition — independent review

Source component `1b335adc08c09287e13e1d5b43984f4d88a4513c`, integrated with route and hardening at root candidate `c8052d2961b148d01ff53068975c1eed0ee1359b`. QA read source binding validation, bounded JSON parser, selected-item digest, import flow, UI and actual PGlite composition; independently ran typecheck, all 41 Signal tests and 3 UI tests: PASS. A combined targeted run including hardening and Worker route tests passed 45 tests.

Accepted local paths include fixed operator URL rather than caller URL, lexical address guards, redirects denied, 15-second request bound, streamed byte cap, malformed UTF-8/type rejection, ≤20 items, unique IDs, stale/future/expired exclusions, exact tenant/mode, source rotation or tenant pause discarding reads, changed digest preventing writes, explicit review, strict import UUID/state and observation UUID acknowledgements, same-reference partial-import replay, and source text rendering as inert text. Parser → actual existing import/product RPC proves one contact/trigger and no contact permission grant. No real source was fetched by QA.

This is bounded acquisition from an operator-configured JSON feed; it is not web-wide prospect discovery, autonomous scraping, inferred buying intent or permission to contact. Lexical URL validation is not DNS/egress/rebinding proof. Live source rights/entitlements, hosted egress verification and the non-atomic final configuration-check/persistence window remain explicit release concerns. Final Chromium/combined CI still required.

## Hosted hardening follow-up

After root applied the separate baseline hardening migration to staging only, QA independently checked advisors and function definitions. Anonymous SECURITY DEFINER/direct-trigger execution, mutable-search-path and public-extension warnings are gone; btree_gist now resides in `extensions`. The only security warnings are the three authenticated `is_admin/is_member/is_owner` helpers. QA inspected their fixed, schema-qualified current-`auth.uid()` predicates; anonymous EXECUTE is false and authenticated access remains intentionally required by RLS. The private build-budget no-policy notices remain informational; no public policy/grant was added.

QA reran the same hosted rollback-only acceptance script after the extension move: PASS. Fresh independent read after completion: tenants=0, leads=0, profiles=0, auth.users=0, build_usage=0, budget_enabled=false, gist_schema=`extensions`. This verifies the selected host SQL/RLS/receipt/owner/budget behavior still works after hardening. No fixture or armed budget remains; no production schema was changed.

Hosted hardening receipt is now complete for the 16-file source manifest at `c8052d2961b148d01ff53068975c1eed0ee1359b`: three baseline migrations, twelve previously reviewed forward migrations and `20261023100353_baseline_function_hardening.sql`. QA independently re-listed the staging history after hardening and reran the rollback acceptance script successfully. See the complete hardening follow-up immediately above; it is completed evidence, not a pending promise. This is a bounded hosted SQL acceptance receipt for isolation/ordered upgrade/RLS/role checks and fixture rollback. It does not close backup restoration, actual Auth/PostgREST sessions or separate-connection concurrency.

## Events lifecycle and combined-candidate verification

QA independently reviewed integrated candidate `f2a11406875f48fc460b24469891354288595157` (Events component `3c8b4090225c8b284a5371769031eccc544ea26d`). TypeScript PASS; full 313 backend tests in 21 files PASS; 52 Node UI/safety tests PASS. Events-specific 30 tests cover service-only settings and intake, default-off synthetic endpoints, .invalid-only identities, capability hashing, strict correlated receipts, atomic single-engine capacity, replay/cancellation, reviewed schedule changes and no implicit attendance, permission or outreach. The actual Worker route is exercised through a synthetic PostgREST adapter into real PGlite RPCs. No real registration/provider call occurred.

**QA finding Q-003 (retention):** original registration replay and read-only receipt recovery bypassed the capability expiry enforced by cancellation/acknowledgement. QA independently authored a separate rollback SQL acceptance script and PGlite rehearsal. At `f2a1140` it failed with `Expired capability receipt accepted`, despite the existing green suite. Development corrected the shared state function in `9ba7dac7fe621040fef096dd74a3329da1b07f10`, integrated as `b0f265bcc4190168f9cb40e8199ea1352d68713c`. The identical independent rollback script plus all 30 Events tests passed (31 total). Q-003 is **CLOSED locally**. No retention failure was waived; historical observations remain while expired capability receipts/replays are denied.

The new rollback script verifies canonical sorted fresh application of all 17 migrations locally, authenticated RPC denial, reviewed settings, real-email rejection, receipt recovery, alternate capability withholding, capacity, unreviewed intake, zero rights/outbound actions, material-change approval invalidation, schedule-change display, draft-state cancellation, no resurrection, expired recovery/replay denial and fixture rollback. Hosted Events migration/rehearsal and final exact-candidate Chromium remain pending at this receipt; PGlite is not a hosted concurrency or AuthHTTP test.

QA also reviewed staging preparation at `f2a1140`: workflow requires manual default-false selection, a non-main branch and successful verify job; separately named Worker has no production routes or cron. The guard pins the observed account and isolated Supabase URL, rejects wrong key roles/project claims and passes secrets via stdin. JWT decoding checks claims only, not signatures or actual PostgREST authentication; opaque keys are intentionally unsupported. Five guard/config/probe checks passed. No staging workflow, secret binding or deployment was executed by QA. Workers.dev subdomain was independently observed by CTO in account settings, not guessed. Runtime health proves routing identity only and explicitly leaves database/providers unprobed.

### Hosted Events follow-up and final local composition

CTO applied Events to isolated staging only as history entry `20261023102058`, name `ripepiper_20261023095346_events_registration_lifecycle`; reported SQL SHA256 `4e29ab33bd849c439dcec4e1fffb3076d3f11f7931304fa6d629f4d07433dd08`. QA independently re-listed all 17 migration names and confirmed Events is a late-arriving append after hardening, whereas a fresh repository application sorts Events before hardening. Both the canonical fresh local rehearsal and hosted append-order rehearsal passed; the difference is explicit, not timestamp equivalence.

QA independently inspected all eight Events functions: SECURITY INVOKER, fixed empty search path, EXECUTE denied to anon/authenticated and permitted to service_role. The central expiry correction was present on the hosted database. CTO executed QA-authored `qa/staging-events-rollback-acceptance.sql` from test-only commit `90f911cf1f2bd675fb4941f33f603d88b7b299ea` and reported the exact hosted PASS sentinel for grants/settings/intake/capacity/replay/approval/cancellation/retention, with all fixtures rolled back. QA then made a fresh independent query: tenants/leads/profiles/auth.users/observations/outbound_actions/contact_rights/build_usage all **0**; budget_enabled=false; prior_micro=NULL. No synthetic authority, registration or data remained. This is selected hosted SQL evidence, not deployed HTTP/Auth/provider/backup/concurrency acceptance.

At integrated candidate `b8d6a1223345f6ba7dd551cafe4c724ec863fb44`, QA independently reran **314 backend tests in 22 files**, **52 Node UI/safety tests**, TypeScript, all frontend JavaScript syntax checks and isolated preview build: **PASS**. Q-001/Q-002/Q-003 regressions remain green. Final rendered Chromium/remote CI, actual Auth/PostgREST sessions and deployed runtime remain unverified here; the old baseline CI result cannot certify these new components.

## Independent qualification evaluation review

QA reviewed evaluation component `34bf913` integrated as `09e18f1`. The frozen corpus has 30 synthetic scenarios/two tenants; each tenant selects six candidates with one pending label and five reviewed suitable labels. Aggregate precision is therefore 10/10 reviewed selected candidates, with two pending cases visible. This is authored scenario regression precision, not customer acceptance or conversion evidence. SHA256 fingerprints, fixed clock, explicit zero calls and null commercial outcomes are appropriate. QA's initial exact-artifact test correctly failed after integration changed the fingerprinted shortlist module. CTO refreshed only that source checksum in `77b7910`; thresholds, labels and observed results were unchanged.

**QA finding Q-004 (independent qualification gate):** the scorer originally accepted four copies of a supported industry field as four supported dimensions, omitting market/role/need. A second mutation promoted the cited outside-brief retail case to candidate and changed its field states to match; precision 0.909091/state accuracy 0.964286 met aggregate thresholds while the independent safety counter remained zero. Both mutations incorrectly returned passed=true. Independent test-only commit `b70ed9e56f92429fa6c9b0afd88904d49fd39ed6` reproduces both failures. Development owns the correction to require the exact unique four dimensions and actual brief-target membership, with no threshold or label changes. This finding remains open until QA reruns the corrected exact candidate.

### Q-004 correction verification

Development corrected unique required dimensions and brief-target membership in `bf5ffcf`. QA's first two independent regressions then passed. Development also raised a related ambiguity concern; QA independently reproduced a candidate backed only by a source carrying explicit unresolved ambiguity, which still passed the scorer. Independent regression `f914eb946ea60c57e420856b7c3c31d44a3bce48` failed before Development correction `6ec58b74b9919f38110d640b2eb6ef12dd7f0a30`. The correction rejects candidate qualification with current ambiguous or conflicting source facts while preserving review-state citation traceability.

At final combined candidate `2dfb99f8ed2e12da446be8195be9cbf13539e662`, QA independently ran TypeScript and the full backend suite: **330 tests across 24 files PASS**, including all three independent Q-004 mutation regressions, thirteen evaluation checks and exact artifact equality. All four QA findings are **CLOSED for this local candidate**. No failed mutation, aggregate threshold or label was waived/changed. The deterministic report remains a small synthetic regression baseline with no measured commercial performance. Actual deployed Auth/HTTP checks and final exact-tree rendered CI remain separate and pending.
