# Independent QA: Revive client setup, strategy and scheduling

Current assessment: **local component acceptance passed** on the working candidate based on `a1ab30cb7504d073dbac48a7c155d2bad3023bc9`. The implementation and tests are awaiting immutable publication and CI linkage. This receipt does not certify hosted changes, a real authenticated client journey, provider delivery, independent-connection races, conversion improvement or production readiness.

## Requirement and environment

Extend the existing tenant, business brief, campaign asset and action ledger. Require reviewed, versioned client operating setup; bind campaign strategy to that setup, brief and reviewed audience; use one client-local working-calendar policy for planning, enrolment and execution. Preserve source receipts, contact rights, suppression, exact versions, human approval and uncertain-result handling.

Independent QA authored three new test files and maintained earlier `qa-*` fixtures. Development/root implemented fixes. Executions used disposable local PGlite and synthetic HTTP adapters; unknown endpoints throw. No hosted database writes, migrations, model/provider requests, messages, purchases or deployment were performed by QA.

The current schema has **27 migrations rehearsed locally**. **23 is the historical hosted SQL verification count**. Neither of the new setup/strategy migrations was applied to hosted Supabase in this task.

## Reproduced baseline defects

At exact base `a1ab30cb`, `qa-client-setup-receipts.test.ts` reproduced **10 intended failures**, with two corresponding positive cases passing:

- Four mismatched tenant preparation receipts, including active status, malformed UUID, another slug and missing status, returned HTTP 201.
- Six malformed or version-mismatched brief acknowledgements (`null`, object, boolean, numeric string, zero and an unexpected version) returned HTTP 200.

The same ten denial assertions pass after root's strict acknowledgement fixes. Three additional checks verify setup context readiness/scope, the positive current context and anonymous/viewer denial. Final file result: **15/15 passed**. These tests do not infer a committed write from a failed response and do not retry the operation.

## Independent functional verification

Executed from `platform/ripe-piper-platform`:

```sh
npm test -- --maxWorkers=1 test/qa-revive-setup-strategy.test.ts test/qa-client-setup-receipts.test.ts test/qa-revive-schedule-receipts.test.ts test/qa-revive-bindings.test.ts test/qa-revive-boundaries.test.ts test/qa-revive-automation-receipt.test.ts test/qa-revive-rollback.test.ts test/qa-revive-draft-rollback.test.ts test/staging-rollback.test.ts
```

Observed **64/64 passing across nine files**, including **34 new checks**:

| New file | Checks | Evidence |
| --- | ---: | --- |
| `qa-revive-setup-strategy.test.ts` | 14 | Actual SQL lifecycle, scheduling, private trigger metadata and actual Worker journey |
| `qa-client-setup-receipts.test.ts` | 15 | Strict acknowledgements, current setup context and staff boundary |
| `qa-revive-schedule-receipts.test.ts` | 5 | Impossible or UTC-inconsistent local time denial, valid conversion and response whitelist |

The new SQL/Worker checks establish:

- Incomplete or draft setup cannot activate Revive, despite a current brief. Reviewed setup appends under CAS; a same-body replay does not add a version. Invalid source inventory, owner, timezone, capacity or workdays cannot become reviewed setup.
- A changed brief makes old setup unready. A strategy must cite a declared source, reference the current setup and use a canonical need supported by every selected audience member.
- A strategy-only edit creates a new asset requiring new approval. A setup edit resets approved campaigns, cancels queued actions and moves claimed work to review; old claim completion fails.
- Local working-day checks include opening time and exclude closing time. UTC search handles a spring DST gap and the repeated hour in autumn without inventing local times.
- A Friday-after-close start rolls into Monday, then preserves at least 24 actual hours between adjusted follow-ups. Preview makes no reservation or action; queued due times match the preview. A retry preserves the original schedule and action IDs.
- Tenant-local daily capacity spans campaigns and counts uncertain review work. Capacity rejection leaves no partial action. Closed hours wait without consuming a claim; a missed local date blocks rather than reschedules or acknowledges the old action.
- A complete journey crosses the actual Worker entry point and actual local SQL functions: existing client setup get/save → explicit activation → source- and setup-bound proposal → operator-edited campaign strategy → approval → separate synthetic rights → schedule preview → enrolment → fenced test acknowledgement. One existing tenant ID and one setup version remain; the final ledger receipt is `test-sink:<action>` with one attempt, not provider delivery.

The schedule response tests use the current `approvalStatus` / `authorityStatus` distinction: draft previews are planning only; approved previews require current authority. Invalid calendar dates, impossible local times and UTC/local mismatches are rejected instead of displayed as verified schedules.

## Existing protections retained

The earlier source, audience, stale evidence, lease, suppression, cross-tenant and lost-acknowledgement assertions remain active. Positive fixtures now explicitly seed reviewed setup and strategy using the shared test helper. Claim-time tests use persisted due times because scheduling may shift the requested instant. Audience-boundary fixtures deliberately give both contacts the **same supported need**, so denial cannot pass merely because the new strategy rejects a different need.

Three old error-text expectations were extended to the specific new earlier guards; the underlying denial assertions remain and the stale-evidence check additionally asserts zero actions. The existing lost-acknowledgement fixture supplies the new correlated readiness receipt and still requires one claim, one committed completion and no expiry/repeated effect. All three updated rollback packets passed locally on the 27-migration schema; they do not constitute a new hosted receipt.

The actual Worker composition initially expected a `delivery` field on the unchanged legacy action-test response. QA corrected that test expectation to the existing `{ok,state,action_id}` contract and separately verifies the persisted synthetic receipt. This was a QA fixture correction, not a product defect or waiver.

## Authority-lock security review

QA identified that a setup owner or creator need not be a contact's cohort reviewer, so the earlier profile lock predicate alone did not cover every new authority dependency. Development extended the existing tenant-lock predicate to current setup owners/creators and current strategy reviewers. Auth confirmation changes/deletion use a narrowly scoped private trigger to obtain those same sorted tenant locks.

Independent source and catalog checks verify that `ripepiper_private.lock_revive_auth_authority` is SECURITY DEFINER, has an empty search path and a trigger-context guard, uses qualified tables, and exposes neither schema USAGE nor function EXECUTE to anon, authenticated or service roles. The `auth.users` trigger is installed and enabled locally. The profile trigger remains an invoker function. These checks establish the local structure and permissions; **an actual independent-connection revocation/dispatch race remains unproven**.

## UI and integration evidence

Executed from the repository root:

```sh
node --test scripts/campaigns-ui.test.mjs scripts/revive-setup-ui.test.mjs scripts/qa-revive-bindings-ui.test.mjs scripts/qa-revive-campaign-ui.test.mjs
```

Observed **52/52 passing**. Source and emitted-markup review confirm one setup panel in the existing Clients area, reuse of the existing offer/buyer brief, retained unknowns and all supported source rows, explicit review confirmations, stale tenant/brief/setup response fencing, separate strategy/audience confirmation, no automatic save/approval/send, and schedule preview without enrolment. PostgreSQL offset timestamp serialization is compared as an instant, not raw text. These are DOM/event logic checks; rendered browser acceptance awaits published CI.

Independent TypeScript checking and diff whitespace checking passed. Root's final regression log was inspected directly: `/tmp/revive-setup-frozen.log` records **927 backend checks / 61 files passed** at runner marker 19:38:54 (host UTC+03, 16:38:54 UTC). `/tmp/revive-node-regression.log` records **157 Node checks passed**. The audit log reports zero high, critical or total findings, and the Wrangler log ends successfully in dry-run mode. Root ran those full integration commands; QA ran the focused commands above independently.

## Frozen source hashes

| Artifact | SHA-256 |
| --- | --- |
| `20261024161910_revive_client_setup.sql` | `9095af247b7c4620c019e29ea5bb03f88820ec9b7a81fd00495ea0d775847e93` |
| `20261024162439_revive_strategy_schedule.sql` | `d22e08e86559550b1237b90f4fc413214b38c11e84c985c80bfba9c0339f5c52` |
| `src/foundation/campaigns.ts` | `519ec65a98e45141be531fec390f9426fbc631164e73d6c26b83483e7981beed` |
| `src/foundation/revive-setup.ts` | `1094185c2aa74d0a18e62c397ec76248af188c8ab4ac5f5a7ad24fde6a3f03c3` |
| `src/foundation/revive-automation.ts` | `9db70f94f8cc46d7bb5cdd4cc040d57d3f013f05eb9e2a21474ff98cd55a5c14` |
| `site/assets/revive-setup-admin.js` | `a60f097ba5167ba509c0c8ad52ab18ba844f0b9782e5fac520124e89e7c22886` |
| `site/assets/campaigns-admin.js` | `e18e01e862412ea74c2f7fd3bf2e4492d615bdefbcedc9d03ac69e34403b241a` |
| `qa-revive-setup-strategy.test.ts` | `24312d86e582932d5692399257597a86c7d774a17fe4ed38b70be5cc5929aadd` |
| `qa-client-setup-receipts.test.ts` | `55ac7d6662a451e0f7c8b09732b9e364ad61a4ce4217a46a835397cfd00b5a4a` |
| `qa-revive-schedule-receipts.test.ts` | `afd5ac4e93cce5609e1cb3941500ed86c0468782b397ac7cc3328135cadeb6a1` |

No production or operational promotion is implied by this local acceptance. Immutable published tree, final CI/rendered evidence, hosted migration rehearsal, real Auth/provider integration and owner-controlled live release remain separate, accurately scoped items.
