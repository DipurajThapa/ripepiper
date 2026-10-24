# Independent QA — Ripe Signal review and attribution

**Bounded local acceptance: PASS.** The candidate extends merged baseline `d5a7988f32eb4fce6e0124c1b8eb9cd39d15f375`. Source hashes below identify the reviewed implementation. Full local regression passed as recorded below; publication and official CI remain separate receipts. This report does not establish live source provisioning, hosted Auth/API behaviour, outreach delivery or commercial lead quality.

## Requirement and environment

RP-030 reuses the approved-source adapter, existing CRM Clients workspace, business brief, qualification evidence, product-event records and campaign execution ledger. Each reviewed Signal is represented independently; a new outcome identifies the exact reviewed trigger. Legacy outcomes remain unattributed. Receipt validation must fail closed. Signal campaign execution is held until a trigger-bound reviewed strategy exists.

QA used the Software Factory Verifier and Supabase security guidance. All SQL ran in disposable in-memory PGlite databases. Auth/SDK/PostgREST transport and the approved feed were intercepted synthetic fixtures; no hosted database, provider, DNS discovery, paid service, real email or calendar operation was invoked. Application logic, Worker routing, SQL functions/triggers, HTML, styles and frontend modules were the actual candidate. QA did not implement the application changes.

## Reproduced defects and unchanged negative checks

| Baseline failure | Reproduction | Corrected result |
| --- | --- | --- |
| Incomplete contact receipt advanced ingestion | Four missing/null/boolean/invalid `observation_id` cases returned HTTP 200 and attempted the trigger write. | All four return 503 and stop after the uncertain contact write. A complete receipt still succeeds. |
| UI presented malformed import receipts as success | Seven receipts with invalid IDs, unknown state, contact permission, delivered status or truthy non-boolean `ok` displayed “Signal evidence imported”. | All seven are rejected. Five additional wrong tenant/source/item/digest/mode receipts are rejected; the complete correlated receipt succeeds. |
| Generic Signal campaigns bypassed Signal qualification | Under the actual 27-migration baseline, an approved campaign with contact rights but no Signal trigger or fit evidence could enqueue, claim and complete a synthetic action. Three negative assertions failed; the non-Signal control passed. | After migration 28, new queueing fails, a pre-migration queued action cannot be claimed, and a pre-migration in-flight claim cannot complete. The Events control still claims and completes. |

Baseline logs were inspected before repairs. No expected denial was removed. The dispatch reproduction is a synthetic test-sink qualification bypass, not evidence that real prospect messages were sent.

## Executed independent acceptance

```sh
# From platform/ripe-piper-platform
npx --no-install vitest run test/qa-signal-workflow.test.ts test/qa-signal-source-receipts.test.ts test/qa-revive-boundaries.test.ts test/qa-revive-setup-strategy.test.ts

# From the repository root
node --test scripts/qa-signal-ui.test.mjs
```

**41 backend checks across four files passed**, including 18 new independent Signal checks and 23 retained Revive checks. **13 independent Signal UI checks passed.** Syntax and whitespace checks passed.

The SQL checks verify:

- The real upgrade path from 27 migrations, including already queued and claimed Signal actions, to the 28th migration. Existing unsafe actions cannot advance; non-Signal execution remains available.
- Valid exact-trigger attribution and same-reference replay create one outcome. A different trigger cannot reuse the same outcome reference.
- Missing/malformed IDs, another tenant, another contact, a non-trigger observation and an outcome dated before its trigger are rejected.
- Referenced Signal evidence and linked outcomes cannot be silently rewritten.
- Anonymous and authenticated direct database callers cannot record outcomes or execute the shared eligibility predicate.
- The private Auth-authority trigger remains non-callable for anonymous, authenticated and service roles, despite the narrow schema usage needed by the shared eligibility wrapper.

The composed test exercises **actual Worker source preview → approved-source import → existing PostgreSQL import/product RPCs → repeat import → actual shortlist calculation → invalid-link rejection → exact-trigger outcome recording → recomputed shortlist**. The shortlist exposes the imported trigger separately with unknown qualification, then attributes the outcome to that trigger. Contact rights do not increase, no outbound action is created, and no provider endpoint is called. The fake PostgREST transport translates bounded filters and named RPC arguments into real local SQL; it does not fabricate database results. Its boolean filter conversion reflects PostgREST parameter parsing rather than changing application behaviour.

## Rendered workflow and visual inspection

`node scripts/qa-signal-workflow-browser.mjs` is the independent rendered acceptance program, called by the existing Signal browser stage. Local execution used an external temporary launcher with Chromium 153 because the pinned local browser download was unavailable. The launcher and screenshots are temporary QA material; project dependencies were not changed. Official CI's Chromium 151 is a separate pending verification.

The actual admin shell and script order passed:

1. Select an existing client, preview an approved source, inspect inert source text and explicitly review/import it.
2. Refresh the existing client review and show two distinct triggers for the same contact plus unattributed legacy outcomes. Fresh and stale records remain separate.
3. Open the existing qualification evidence form with the right contact selected, without creating a second evidence workflow.
4. Open the existing outcome form with the exact trigger selected. The dropdown contains only the two real trigger IDs, plus its empty prompt; legacy history is not an attribution target.
5. Submit `context.signalId` and show the resulting outcome only under that trigger.
6. At 390px, verify the review board and existing outcome form remain within document width. Desktop 1280px and mobile screenshots were inspected for readable cards, fields and buttons.
7. A failed review removes stale actionable review cards; a successful refresh restores them.

No page errors, unhandled rejections, direct SDK writes or unexpected external requests occurred. The script-like source excerpt remained visible text, with no image element or execution. Screenshot fixtures are not live client data.

## Existing-test changes justified by the new contract

- The older Revive boundary test used Signal as its unrestricted “other product” control. It now explicitly asserts Signal is held and uses Events for the positive control. The original Revive denial remains.
- The Auth-trigger metadata test now expects service-role schema usage for the private shared eligibility wrapper, while keeping all three roles' Auth-trigger EXECUTE privileges false and adding actual denied calls.
- The existing Worker-to-SQL Revive fixture now permits the actual campaign read newly required by the queue guard. It still executes real SQL and retains every lifecycle assertion.

These are contract/setup corrections, not waived acceptance failures.

## Final integrated local regression receipt

Root's final integrated run passed **957 tests across 64 backend files** in 36.16 seconds (`/tmp/ripepiper-signal-backend-bounded.log`), independently inspected by QA. The earlier unrestricted concurrent run hit the existing five-second timeout in the historical consultation rollback fixture. QA inspected the sole Vitest configuration change: `maxWorkers: 4`, bounding concurrent PostgreSQL/WASM fixtures. No assertion, test timeout, isolation or network guard was removed or relaxed.

QA also inspected the final root logs: **193/193 Node checks**, the existing four-product/whole-CRM rendered workflows, the combined Signal/source-to-outcome rendered workflow, and dependency audit **zero vulnerabilities**. These results complement the independently executed 41 backend and 13 UI checks above. Chromium 153 was used locally; official pinned-browser CI and hosted verification remain separate requirements. No production mutation or delivery claim follows from these local results.

## Published CI resource correction

PR #9 first published head `98f0702c6bf3a7c91e197cc9369f801525cd7460`, local tested commit `82a7341f28b3426e51e7b799544436741de2619e` and GitHub test merge `d786849ff631c0f32509c07ad9ad4d1d746d85b4` all have tree `1e23c284b776c0f2146715b9abb4863de69c55c8`. QA independently checked the remote merge metadata and CI checkout log.

[CI 40123876235](https://github.com/DipurajThapa/ripepiper/actions/runs/40123876235), verify job `120961035180`, failed with **956/957 tests passing**. The sole failure was the historical `staging-rollback.test.ts` whole-database rehearsal exceeding its existing five-second test timeout (5.322 seconds). Later Node, build, audit and browser stages were skipped; staging was skipped. This failed receipt is retained, not treated as CI acceptance.

Development reduced `maxWorkers` from four to two for the smaller CI runner. QA inspected the exact configuration diff and verified that the five-second timeout, isolation, network guard and test assertions remain unchanged. QA independently reran `npx --no-install vitest run test/staging-rollback.test.ts` with that configuration: **1/1 passed**, 2.56 seconds total. The test still applies all migrations, rejects the wrong hosted database identity, executes the real rollback acceptance SQL with only the local database name adapted, and checks that all fixture tables remain empty. QA inspected the subsequent complete two-worker run (`/tmp/ripepiper-signal-backend-two-workers.log`): **957/957 tests across 64 files passed**, 62.45 seconds. New published CI remains pending; the product-source hashes below are unchanged.

## Limits and rollback

The local application/schema boundary passes. Hosted migration rollout, real Auth/PostgREST, public-source/DNS verification, provider delivery, trigger-bound approved outreach, automated monitoring, independent database-connection races and measured precision/meeting results remain open. A recorded business change is not buying intent; a linked outcome is not proof of causality. Evidence-based qualification remains a separate reviewed activity.

The additive migration was not applied to a hosted project. Rollback of UI/source code must retain the Signal execution and attribution safety guard; simply removing that guard would reopen the demonstrated bypass. Retention/deletion paths are unchanged and orphaned historical outcomes remain unattributed. No new production or operational acceptance is inferred.

## Source hashes at bounded local acceptance

| File | SHA-256 |
| --- | --- |
| `platform/ripe-piper-platform/src/foundation/products.ts` | `0cda2308fe40eb932375e5943e9d86fe99b694f93d0caa07c045ed347ba9f795` |
| `platform/ripe-piper-platform/src/foundation/prospecting-routes.ts` | `6617f682b2313ed6ea722db7d983ce45e8c72ce85911ac9d20b0ba3f5fe0b586` |
| `platform/ripe-piper-platform/src/foundation/signal-sources.ts` | `eec2fd9fb5b8aca86e73da163d354f3f6a73eafad7ad305fbac047dffa1fcede` |
| `platform/ripe-piper-platform/src/foundation/campaigns.ts` | `3c557df8e832de973a9a62c18a3125f8d906746df56dde187056d91d79016d81` |
| `platform/ripe-piper-platform/supabase/migrations/20261024185356_signal_trigger_review.sql` | `70dc1668c2cdb004f0efb227b2da044dcd755d566afd995aec4ac7ca7060a518` |
| `site/assets/signal-admin.js` | `e92e3fdf6a771b5d122df54e9483493aee0b52cf2600b73885191641d0600946` |
| `site/assets/prospecting-admin.js` | `fff58079edacb3dfa15e5323953d2458317a7e7fd9a1d54fe12e508f8e871a0a` |
| `site/assets/campaigns-admin.js` | `36d1cfa7dd0a67bc49f55523b1b90123f11cfccd453c6df4822e39dc3cb45942` |
| `scripts/qa-signal-workflow-browser.mjs` | `a8fd19bb305332a3b57e093ba18fd286b321d8fd133397f23114dba4900dbb9b` |
| `scripts/qa-signal-ui.test.mjs` | `c0fcce473b69e0852866fdddc2edfcd445dfd209a78cf6a8adf78e87e6d495d4` |
| `platform/ripe-piper-platform/test/qa-signal-source-receipts.test.ts` | `00a110bd0a9d2bb77fd321a436e0117a169f34d9a12b58e19c342ded3554a930` |
| `platform/ripe-piper-platform/test/qa-signal-workflow.test.ts` | `3c2f9414c466a5460bae28bf19d98fd2f54c3c4dd8961d0756039c91a8f097a8` |
