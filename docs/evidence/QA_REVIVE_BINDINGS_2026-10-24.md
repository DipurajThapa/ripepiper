# Independent QA: Revive source and campaign audience bindings

Current checkpoint: local component verification passes. This report does not certify hosted migration execution, browser rendering, real authentication, provider delivery, a pilot, or production readiness. Final source commit and CI linkage are pending at this checkpoint.

## Scope and environment

- Base: `eef85fdaaa0b398364de223fd5a44c00b96da19d`, PR #8 continuation.
- Candidate: the shared integration working diff on that base; final immutable commit will be recorded separately.
- Requirement: preserve the generated proposal's exact reviewed source and canonical need; bind each Revive campaign asset to an explicit, reviewed audience. Preserve existing approval, contact rights, suppression, caps and fenced synthetic execution.
- Independent QA owns only the `qa-*` tests and this receipt. Developers changed the implementation. Tests use disposable local PGlite, the actual Worker entry point and an intercepted Supabase HTTP adapter. Unexpected endpoints throw. No hosted writes, provider/model calls, real contacts or paid services were used.
- PGlite is a local PostgreSQL-compatible test engine. These results do not establish independent-connection hosted concurrency.

## Baseline failures reproduced

At exact base `eef85fda`, the first five independently authored tests in `platform/ripe-piper-platform/test/qa-revive-bindings.test.ts` failed for the intended reasons:

1. A proposal generated from a valid source could change only `draftContext.sourceId` to a fresh, reviewed, same-contact `staff_import` note with empty facts. The accepted input snapshot stayed equal. The actual Worker returned HTTP 200 when denial was required.
2. Bypassing Worker validation and calling the actual local `save_reviewed_revive_draft` SQL function accepted the same substitution and returned a new draft asset.
3. A globally accepted contact with scoped synthetic rights but outside the requested campaign audience could enrol through `manage_campaign_plan`.
4. An owner-maintained legacy/tampered action row changed to that outside contact could obtain a fenced claim.
5. The equivalent mutation after claim could complete with `true` and persist a synthetic test acknowledgement.

The maintenance mutations in scenarios 4–5 model historical or corrupted rows. They are not a claim that an unprivileged user can perform those mutations. The dispatch boundary must still reject them. The five denial assertions were retained for the fix verification.

## Local fix verification

Command from `platform/ripe-piper-platform`:

```sh
npm test -- --maxWorkers=1 test/qa-revive-bindings.test.ts test/qa-revive-boundaries.test.ts test/qa-revive-automation-receipt.test.ts
```

Observed: **27 tests passed across three files**, including **17 new binding tests**. The added tests verify:

- Worker and SQL reject ignored-source substitution with no campaign, asset, action or save-audit effect.
- A different source that validly supports the same canonical need still cannot replace the originally recorded source; a canonical-need change cannot borrow the proposal receipt.
- Edited copy can save as draft and replay without duplicate save audit, approval, rights or queued actions.
- Authenticated administrators cannot forge, rewrite, relabel or delete proposal receipts. A different administrator or account cannot reuse the original receipt. Anonymous/authenticated roles cannot execute the service-only receipt or audience builder RPCs.
- The actual Worker coordinator, backed by the local SQL ledger, enrols exactly the selected member of each of two campaigns; an immediate repeat creates no additional actions.
- A subsequent edit cannot drop a generated campaign asset's persisted provenance binding.
- Outside-audience contacts are rejected at enrolment, direct service insertion, claim and completion, despite current global acceptance and contact rights.
- Changing only the audience creates a new asset version, cancels old queued work and requires new approval. Historical audience membership remains unchanged and cannot be overwritten in place.
- Replacement of an accepted review does not revive an old audience or enrolment. Suppression introduced after claim prevents completion.
- Foreign, duplicate and unconfirmed audiences leave no partial campaign save. An audience-free manual Revive plan may remain a draft but cannot be approved.

The earlier independent boundary fixture now records acceptance before creating its explicit campaign audience; its original expiry, stale evidence, identity, permission and cross-tenant denial assertions remain. The lost-completion fixture supplies the exact versioned campaign audience and deliberately throws if the coordinator enumerates account-wide reviews. Its original one-claim/one-completion/no-expiry assertion remains.

The HTTP-to-PGlite test adapter uses named SQL arguments to model PostgREST correctly; object property insertion order is not an RPC signature contract.

## UI logic verification

Command from the repository root:

```sh
node --test scripts/qa-revive-bindings-ui.test.mjs
```

Observed: **2 new tests passed** using emitted markup and JavaScript VM event handlers. Copy/scope edits and proposal replacement clear the exact-copy audience confirmation; the confirmation checkbox's own bubbling input does not clear itself. Draft preparation initiates no save, approval, rights or queue action. This is DOM/event logic verification, not a rendered browser or accessibility acceptance.

QA identified the stale confirmation issue by source review. The developer fixed it before the first independent executable UI run, so no pre-fix RED UI result is claimed.

## Candidate findings and limits

An early implementation run exposed ambiguous `profiles.id` references in the new PL/pgSQL audience helpers. Development qualified those references; all required positive and negative cases above then passed. No failure waiver was used.

Final immutable-commit linkage, published CI, rendered browser coverage and any isolated hosted migration rehearsal remain separate evidence items. No merge, deployment, paid usage or prospect communication is authorized by this QA receipt. The protected production baseline remains outside these test actions.


## Final local source checkpoint

The final 17-test binding artifact (SHA-256 `8f01a26c2b0f0c4ae409d4dd32f45ce2748ebf00bcc77d8c034775127fbcf7dd`) was also copied into an isolated worktree at exact `eef85fda` and run with the five baseline scenario names selected. All five failed with the original HTTP 200 / accepted SQL save / outside enrolment / successful claim / completion `true` outcomes; the other 12 tests were intentionally not selected for that baseline comparison. The same artifact passes all 17 checks on the candidate.

After the final audience-reviewer no-op correction, independent QA reran the 17 binding checks plus all 15 developer audience checks: **32/32 passed**. Source inspection confirms that a different reviewing administrator now participates in version-change detection; it cannot silently reuse the previous asset's reviewed-by identity. The two existing rollback packets also passed independently against the **local 25-migration schema**, **2/2**. This rehearses the updated packet fixtures locally; **23 remains the historically verified hosted migration count**.

Independent QA additionally ran the two new UI checks and four earlier draft/report UI checks together: **6/6 passed**, and TypeScript checking passed using the clean installed dependency candidate. Root-provided combined test logs were read directly: the final frozen run starting 11:07:36 UTC (14:07:36 in the runner’s UTC+03 log) passed **779 backend checks / 53 files**; the full Node run passed **130 checks**, with a successful Wrangler dry run. Those full-suite executions were run by root and independently inspected, distinct from the focused QA executions above. Published CI remains pending.

Source hashes for the frozen, locally tested candidate:

| File | SHA-256 |
| --- | --- |
| `20261024105646_revive_draft_source_receipts.sql` | `8bf94e0d5613b5436fc63466a7ae78f0b04cccb98b3d53670a9cc4e5331d3329` |
| `20261024105757_revive_campaign_audience.sql` | `13e99e79d5602b9bd130ee66dfd724656d90779b839ac31d6b5abca149e125d9` |
| `src/foundation/campaigns.ts` | `cb2f7d8cfad3b4a3cfee940adbdd9978b4f913f767cd32d314591f1c7095087b` |
| `src/foundation/revive-draft.ts` | `e15384fa7dcdc471d1797a57f3440d4be31983641d7e672a6d8df0673430a319` |
| `src/foundation/revive-automation.ts` | `d93a897445cbd2ee73a7f4c8c4a5b2cda3d1093bc32e3c90556fce17814c321e` |
| `site/assets/campaigns-admin.js` | `0400205ebfb58de8c6969ab1979fed4a095657c5a9f39e2fb4b9877f38541190` |
| Platform `package-lock.json` | `42a2e95ecc21c4c2a50f625de85636179ff47eb311b50caebb950818e9208cc1` |

A newly discovered high-severity Undici advisory in the development Miniflare dependency was routed to root. The reviewed package change scopes its override to Miniflare's Undici 7.30.1 and preserves Wrangler. Root's clean-install, audit and dry-run receipts are integration evidence; no vulnerability claim about the live site's runtime is inferred. Published CI and rendered Chromium remain pending for this candidate.
