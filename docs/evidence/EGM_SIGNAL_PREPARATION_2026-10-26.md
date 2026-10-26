# Independent QA: Signal preparation pilot

Author: fresh-context `goldfish_implementation_qa`; date: 26 October 2026.
Acceptance: `LEAD_LIFECYCLE_SPEC.md` §9.1 and `harness/AGENTS.md` only. Reviewed baseline: `3a5f822d18593c13759911fc5d168d064a5df274`, branch `feature/signal-strategy-egm`; final application/test/spec candidate: `43f5d2f546f41cc8dfec3866626c6839cf582a03`. Runtime hashes below were checked against that commit. These are local synthetic results, not deployment or operating acceptance.

## Executed evidence

| Check | Independent result |
|---|---|
| `npm test -- test/signal-strategy.test.ts test/anvukta-signal-pilot.test.ts` in platform package | 59 passed; actual Worker handler and local PGlite SQL rehearsal included |
| `node --test scripts/signal-ui.test.mjs scripts/qa-signal-ui.test.mjs` | 73 passed after correction |
| Additional in-memory UI tests using the existing VM fixture, without changing repository files | 63 passed: 60 current tests plus impossible calendar timestamp rejection, template delimiter rejection, and late private transport-error rejection after tenant change |
| Additional direct backend probes using TypeScript transpilation and the existing synthetic fixture | 5 passed: 30-day trigger cap, equality expiry, impossible calendar date, template delimiter rejection, missing setup returns 409 |
| `git diff --check` | Passed |
| `node scripts/qa-signal-workflow-browser.mjs` | NOT RUN: launch failed before checks because pinned Chromium headless shell is absent |

Node was v24.22.1. Missing browser executable: `/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`. Full Chrome executable was also absent. No download was attempted. DOM VM checks cannot establish actual browser layout, focus behavior or complete event integration.

The two-client SQL rehearsal produces distinct Anvukta/Northstar need, sender and evidence provenance for the shared synthetic email; denies cross-tenant lead/trigger and wrong mode; checks reply/suppression holds; and compares campaign, asset, action, right and meeting counts before/after preparation. Provider adapter tests in that suite use intercepted synthetic requests only. No live provider, production, paid service or real prospect communication was used.

## Findings and correction

Independent adversarial execution found two UI contract defects: `2026-02-30T00:00:00Z` was normalized by `Date.parse` and accepted as evidence; `Review ${secret}` was accepted as inserted offer text despite the backend's plain-text restrictions. Both expected-rejection cases failed before correction and passed against the corrected runtime. The engineer aligned calendar checks and copy delimiters and added regression cases. An additional late-error test confirmed prior-tenant private error text is ignored.

The root's broader regression run separately found the older receipt-test mock lacked `querySelectorAll`. The engineer adapted that mock; independent execution of all 13 original receipt tests now passes within the 73-test result. This fixture failure was not a browser pass or a production defect claim.

Source review confirms staff authentication precedes proposal handling; exact tenant/lead/mode checks; malformed dependency fail-closed behavior; raw Response reply/enquiry holds; current setup/brief validation; separate claim provenance; and snapshot rereads of identity, setup, observations and both suppression sets. The proposal path calls only database reads and the existing `stable`, staff-gated setup-context RPC, whose SQL was inspected. It has no save, approval, dispatch or provider operation. UI output uses inert text and invalidates requests on board/tenant changes and alternate preparation. Drift detection remains non-atomic, as explicitly permitted for this side-effect-free preview.

## Candidate identity and limits

Runtime SHA-256 values after corrections:

| File | SHA-256 |
|---|---|
| `platform/ripe-piper-platform/src/foundation/campaigns.ts` | `737fa6fb8c0efa7496185d2bac811cc0269ea22a7405e9493ce7b1fc1fe95ff8` |
| `platform/ripe-piper-platform/src/foundation/signal-strategy.ts` | `40d04ca20ec00fe945ecbc073d3a40ec4d86a18ef1d80cc6e7b003ad28421659` |
| `site/assets/signal-admin.js` | `aba852575a392f1d05d19b113d1a6d5c2912e917cac65bb62bf971303a958a3e` |

No remaining defect was reproduced within these local checks. Local preparation behavior is accepted within the executed scope; browser acceptance remains unavailable. The root separately reports 1,016 backend tests across 66 files, 242 Node tests, typecheck and preview build passing; these broader results were not independently rerun by this reviewer. No harness stage or operational milestone is promoted. Incremental monetary cost: zero external paid calls. Rollback: revert the feature commit; no database migration or rollback is required.
