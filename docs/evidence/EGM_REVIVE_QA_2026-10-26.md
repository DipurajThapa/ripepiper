# Fresh-context Revive execution QA — 26 October 2026

Independent QA agent read `harness/AGENTS.md`, RP-020 in `docs/DELIVERY.md`, relevant runtime/migrations and exercised local PostgreSQL/WASM fixtures. Baseline HEAD: `426ca52fb4aeeba13fb843c62c25fa610c448241`. Runtime repair changes were concurrently owned by CTO/Development; QA authored only the independent regression and this evidence. All fixtures are synthetic, network is blocked by the test harness, and SQL workers were bounded to one. New service spend: US$0.

## Executed evidence

| Execution | Actual result | Scope |
|---|---|---|
| `npx vitest run revive --maxWorkers=1` before new QA file and P2 repairs | 359 passed / 20 files; 51.91 seconds | Existing Revive intake, draft provenance, audience, setup/strategy/scheduling, activation/automation, attribution/report and rollback coverage |
| `npx vitest run test/qa-revive-egm.test.ts --maxWorkers=1` | **4 failed, 6 passed / 10 tests**; latest run 21:14:28 UTC, 6.06 seconds | Full current migration composition; new adversarial SQL executions; denial assertions retained |
| `npx vitest run test/revive-report.test.ts --maxWorkers=1` | 28 passed; 227 ms | Independent rerun of report repair including six newly added developer tests |
| `node --test scripts/campaigns-ui.test.mjs` | 35 passed; 182.86 ms | Independent rerun including two out-of-order report refresh tests |

These are separate runs with overlapping coverage, not additive suite totals. Raw failing run: [EGM_REVIVE_SQL_RED_2026-10-26.log](EGM_REVIVE_SQL_RED_2026-10-26.log). Additional session logs: `/tmp/qa-revive-egm-existing.log`, `/tmp/qa-revive-egm-report.log`, `/tmp/qa-revive-egm-ui.log`.

## Reproduced SQL findings requiring CTO design

1. **Q-EGM-RV001 — current-fit SQL bypass.** Change the reviewed observation industry from `construction` to `retail`, keeping its excerpt truthful and need/market/role valid. Brief permits construction only. The actual Worker `assessRevive` returns `eligible:false`; direct service-role `review_revive_candidate` accepts the exact current snapshot. The existing real SQL save/approve/rights/queue/claim/complete chain then succeeds (`claimed:true`, `completed:true`). SQL validates history/brief and strategy need but does not enforce complete fit parity. This is an internal service/SQL boundary defect, not a demonstrated anonymous HTTP exploit.
2. **Q-EGM-RV002 — revoked independent message approver.** Keep the setup owner, strategy reviewer and cohort reviewer active. Approve the exact asset through the real approve RPC as a second currently authorized administrator. Queue, then revoke only that approver's administrator role. `claim_fenced_synthetic_action` still returns its claim token/version receipt. The message approver is checked only for non-null on the Revive path. This test does not substitute the approver with a fabricated asset update.
3. **Q-EGM-RV003 — fabricated direct receipt.** A valid queued Revive action can be updated as `service_role` directly to `tested` with a fresh fabricated dispatch token, `test-sink:<action>` provider reference and acknowledgement at due time, without a claim. `UPDATE ... RETURNING state,provider_ref` confirms persisted `tested` state. Existing Signal receipt guards do not cover Revive.
4. **Q-EGM-RV004 — direct completion after withdrawal.** Claim a valid Revive action through the real fenced RPC, withdraw its contact rights, then update the action as `service_role` directly to `tested` with the original receipt identity. SQL persists `tested` state. By comparison, the fenced completion RPC correctly refuses the same rights withdrawal.

The six passing fresh tests confirm that the fenced completion RPC denies changes to recipient, withdrawn rights, approval version, Response reply evidence, source-use evidence and tenant pause after a valid claim. They do not excuse direct-table bypasses. No failing expectation was removed or weakened.

## Independently verified P2 repairs

The report now uses the same conservative raw tenant/lead Response reply/enquiry predicate as SQL. Unreviewed, malformed, wrong-mode and future reply evidence can hold execution and are shown as operational holds. The reviewed outcome filter is unchanged; these records do not become qualified conversations, held meetings or opportunities. Duplicate evidence/contact actions do not inflate the unique-contact hold count. Foreign, missing and unenrolled contacts remain excluded. The added note explicitly distinguishes holds from verified human replies.

The UI now increments a report-request sequence and ignores success/error callbacks whose sequence is stale, while retaining tenant generation and selected-campaign guards. Both deferred success and deferred failure tests pass when the newest refresh resolves first. This was source and Node harness review, not a rendered browser acceptance claim.

Verified runtime SHA-256 values for these two repairs:

- `platform/ripe-piper-platform/src/foundation/revive-report.ts`: `83082698add1b6230a7ed494a78cb9b112a173666f9331ab6815ff715f9e6129`
- `site/assets/campaigns-admin.js`: `e79a6af6c6baa97ca70a99d199551a3a2946e5980ad445d2d6ff92d14b7044b0`
- Independent regression `platform/ripe-piper-platform/test/qa-revive-egm.test.ts`: `90d7b725f866cf90e90297adcf428d2b5d6f76fe399e6b700e8571e247e94786`

## Limits and rollback

The four SQL defects remain open at this receipt. Source QA is not overall Revive acceptance. This run proves local single-connection PostgreSQL/WASM behavior only, not hosted Auth/PostgREST, independent-connection concurrency, real delivery/reply/calendar outcomes, browser execution, backup recovery or operational readiness. No hosted/production migration, deployment, paid provider/model call, live contact or owner release approval occurred. Rollback of QA artifacts removes this regression/evidence only; it must not remove existing runtime safeguards. CTO owns any subsequent repair design and independent QA rerun.

## Repair verification — subsequent execution

The initial red receipt above is retained as historical evidence. Development added local migration `20261026041450_revive_egm_execution_guards.sql`; CTO independently reran the expanded QA and developer SQL files against the repaired composition: **25/25 passed across two files**, 16.60 seconds (`/tmp/revive-egm-independent-final.log`). The QA file now contains 18 cases and the developer file seven. This closes the four reproduced SQL findings within the tested local scope. The mismatched-fit test now asserts rejection at review acceptance; a previously accepted review cannot be refreshed or executed after fit changes. No denial assertion was removed.

Fresh source review also identified raw padded fact-length parity, campaign-cap enforcement on direct claims, and an unbounded lease. Corrections ignore oversized observations consistently with Worker assessment, enforce campaign capacity at state transitions and require finite leases bounded to three minutes relative to the execution reference (the existing two-minute RPC lease plus one minute of synthetic-clock tolerance). The cap test uses a null token, confirms the below-cap transition succeeds inside a rolled-back transaction, then checks the policy-specific rejection after reducing capacity; it cannot pass merely because the token is invalid. Three-step queue/ordered completion, explicit aliases, stale evidence handling and historical receipt replay after withdrawal remain covered.

Migration SHA-256: `eef81d1890d9a221b97017c775cf07d62c8675269e918d2556ef3428c1492e3c`. This final execution was performed by CTO independently of the implementation author; it is not attributed to the original QA agent. Node regression passed **347/347**; typecheck, preview build and dependency audit passed (zero findings). Full-suite and hosted browser results are recorded separately when completed.

## Full local composition — final pass

Frozen runtime composition passed **1,155/1,155 backend tests across 71 files**, 82.24 seconds (`/tmp/revive-egm-full-final.log`). The earlier broad run had 15 fixture failures: modern attribution tests fabricated tested receipts and one historical-row test inserted old data under new guards. Modern fixtures now earn receipts through queue → fenced claim → completion; invalid historical fixtures are explicitly inserted before migration30, which is then applied before the unchanged denial assertions. Focused attribution15/15 and historical-boundary9/9 passed, followed by the complete regression. No production safeguard was relaxed and no test failure was waived.

The fresh reviewer inspected the final migration, corrected cap test and historical fixtures and reported no further substantive issue within this scope. Harness evaluation remains14/27. Current hosted browser CI is pending publication; earlier browser receipts do not certify this increment. No production migration, deployment, merge, paid provider call or real communication occurred.

## Revive EGM published verification — 26 October 2026

CTO and PM independently inspected [CI 40269335927](https://github.com/DipurajThapa/ripepiper/actions/runs/40269335927), verify job121398544675: **SUCCESS** for PR #9 source `6e98ae2ace21dc7c6d72f7ed0d589271aad7932b`. It shares tree `502c0a67498188166536bb070e2da122088383cc` with local `e57c4b7e3eb67cf91b5c137aa2e6c5b5e47761ea`. Logs confirm **1,155 backend tests / 71 files**, **347 Node checks**, typecheck, syntax, preview build and zero dependency findings. Chromium installed successfully and all four rendered product/CRM/Signal programs passed. The Revive browser fixture covers setup, strategy, reviewed audience, scheduling, cohort, test-cycle reporting, attribution, import/report, dirty approval and mobile behavior through intercepted synthetic APIs. It does not prove live delivery or hosted database behavior. Optional staging job121399290851 was skipped.

This closes the current published-browser verification gap for the bounded repairs; earlier pending notes are retained as checkpoints. Documentation-only updates do not claim a new runtime test. The four SQL findings and two reporting defects are closed in the tested source; operational acceptance remains14/27. Migration30 has not been applied to a hosted database. No production migration/deployment, merge, paid provider call or real prospect communication occurred.
