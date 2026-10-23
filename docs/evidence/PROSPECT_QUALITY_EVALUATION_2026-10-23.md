# Deterministic prospect quality baseline — 2026-10-23

Scope: RP019/RP030 offline regression evaluation using the existing `assessProspect` rules and current candidate-first shortlist order. Development base: `1b335adc08c09287e13e1d5b43984f4d88a4513c`. No production configuration, data, providers, model calls or outreach changed.

## Acceptance and observed results

The frozen version `2026-10-23.v1` contains 30 synthetic scenarios across two distinct tenant briefs: supported fit, nonfit, exclusions, suppression, ambiguity, conflicts, stale/future/unreviewed evidence, source injection and foreign scope. Labels are authored scenario expectations, not independent customer acceptance or measured commercial outcomes.

| Measure | Observed denominator and result |
| --- | --- |
| Independent tenant top-20 lists | Actual 6 candidates per tenant; 1 pending label excluded per tenant; 5/5 labelled suitable per tenant |
| Aggregate synthetic label precision | 10/10 labelled selected candidates; 2 pending labels excluded |
| Suitable candidate coverage | 10/10 suitable-labelled cases surfaced |
| Decision coverage | 18/26 nonpending, in-scope labelled cases reached candidate/excluded; ambiguity remains review/unknown |
| Expected state regression | 28/28 nonpending scenarios, including 2 rejected foreign-scope attempts |
| Hard exclusions | 0 false passes across 4 hard-excluded scenarios |
| Source traceability | 98/98 lexical citation checks; 0 unsupported claims; 0 unsafe candidate passes |
| Isolation and permission | 0 tenant/lead leaks; 0 contact permission grants |
| Provider costs | 0 external calls, 0 model calls, US$0 incremental provider charges |

Dataset, assessor, shortlist module, evaluator and both briefs have SHA-256 fingerprints in `PROSPECT_QUALITY_BASELINE_2026-10-23.json`. The artifact uses a fixed assessment clock and is deterministic; measured local evaluation runtime was approximately 18 ms, which is not a hosted latency benchmark.

The evaluation fails on insufficient or empty coverage, incorrect/contradictory labels, missing scenarios, duplicate identities, incomplete results, unsupported candidate qualification, exclusion bypasses, forged citations, foreign identity/citations or permission grants. Pending fit labels are excluded from precision failures, while their count remains visible. Minimum reviewed counts prevent an empty shortlist from passing.

## Reproduction

```sh
node scripts/prospect-quality-evaluation.mjs --output docs/evidence/PROSPECT_QUALITY_BASELINE_2026-10-23.json
npm --prefix platform/ripe-piper-platform test -- --run test/prospect-quality-evaluation.test.ts
npm --prefix platform/ripe-piper-platform run typecheck
npm --prefix platform/ripe-piper-platform test
node --test scripts/*.test.mjs
```

The committed artifact is checked by the Vitest regression suite. If any fingerprinted source changes during integration, rerun the evaluator and review the result before refreshing the artifact. Developer checks: 253/253 backend tests, 41/41 Node UI/safety tests, TypeScript typecheck and whitespace checks passed. The 13 new evaluation tests include adverse-result mutation checks. Independent QA and final integration verification are separate from this developer evidence.

## Limits and rollback

These results establish deterministic regression behavior on a small synthetic fixture. They do not establish real prospect precision, buying intent, improved conversion, operator correction rate or a model comparison. Lexical citation support verifies traceability, not source truth. Customer-reviewed live cohorts and downstream outcomes remain necessary before any business-performance claim.

This increment adds only an offline evaluator, fixture, tests and evidence. Revert its commit to roll back; no database, route, frontend or live infrastructure changes are involved.

Integration refresh: at `09e18f1`, the pinned artifact correctly failed because the combined shortlist module includes Response review projection changes absent from the Signal branch. The evaluator reran against the combined source; comparison verified that only `shortlistModuleSha256` changed (`9671dbb8…` → `5b6bcfec…`). All cases, selections, denominators, safeguards and other fingerprints were identical. The artifact now binds that integrated module; no label or quality threshold changed.
Independent QA defect Q004: duplicate copies of one supported dimension could satisfy the original four-field count. The corrected guard requires exactly one industry, market, role and need field and independently confirms each value belongs to its tenant brief target. Two adverse mutation regressions confirm duplicate industry citations and forged match states for outside-brief values cannot pass qualification. Baseline metrics remain unchanged after artifact regeneration.

Q004 follow-up: candidate-only checks reuse the existing excerpt ambiguity and fact-validation helpers and audit all current field evidence for conflicting canonical values. An adverse regression confirms forged candidate promotion of ambiguous or conflicting sources fails while review-state citation traceability remains valid.
