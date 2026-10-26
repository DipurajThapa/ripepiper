# Independent QA: reviewed Signal persistence and synthetic execution

Date: 26 October 2026. Author: independent `strategy_qa` agent. Specification: LEAD_LIFECYCLE_SPEC.md §9.3 including the explicit reviewer-label clarification. Candidate base commit: `4669702ea69d4a672a6fa59d10b21780d98d0711`; runtime/test changes were uncommitted during these checks, so the content hashes below identify the checked candidate. This receipt does not certify a later commit unless its content matches.

## Executed evidence

- `cd platform/ripe-piper-platform && npm test -- --maxWorkers=1 test/qa-signal-reviewed-execution.test.ts`: **34/34 passed**, duration 28.63 seconds before the final SQL timestamp-precision correction. After that correction, a targeted three-file run passed **22/22 selected tests** (37 skipped), duration 7.10 seconds, including a new independent Worker prepare/save/approve check with six-digit PostgreSQL source timestamps and timestamp-looking excerpt text preserved exactly. The independent suite now contains 35 cases; a final whole-repository run is tracked by the parent owner. Independent test harness, Node 24.22.1 and local PGlite; all migrations loaded. Worker fetches are routed into actual local SQL through a serialized, restricted adapter; no provider requests are allowed.
- `node --test scripts/signal-campaign-ui.test.mjs scripts/signal-ui.test.mjs scripts/campaigns-ui.test.mjs scripts/qa-signal-ui.test.mjs scripts/qa-revive-campaign-ui.test.mjs`: **153/153 passed** after latest UI hardening, duration 390.40 ms. Includes explicit transfer/review, dirty-state approval denial, stored binding/approval receipt rejection, uncertain mutation identity retention and explicit reload.
- `node scripts/qa-signal-workflow-browser.mjs`: **not executed beyond launch**. Playwright could not find `/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`. The fixture was inspected: it exercises actual CRM DOM transfer, save/reload, dirty approval denial, version 2 review, rights, queue and synthetic receipt with intercepted APIs. Hosted Chromium execution remains required; this receipt does not claim browser acceptance.

## Behavior independently checked

Two fictional clients complete Worker preparation, save/reload of exact reviewed copy, approval, rights and queue against real local SQL, followed by fenced claim/completion. A separate test executes the actual Worker synthetic test endpoint twice and confirms one attempt and the same `test-sink:<action-id>` receipt. Tests cover immutable edited-copy versions and changed-evidence/unchanged-copy digest changes; manual Signal approval denial; inability to remove a binding; forged proposal, recipient, tenant, lead, mode, canonical fields, evidence, expiry and reviewer; missing semantic attestation; mismatched approval digest and incomplete review; approval beyond evidence expiry; missing/null trigger expiry; email, brief, setup, evidence and all-mode reply invalidation; suppression, pause and rights expiry; revoked source/strategy reviewer and distinct approval reviewer; claimed-to-review invalidation and preserved terminal receipts; uncertain action state and duplicate enrolment; ambiguous save acknowledgement reconciliation on the same campaign; foreign-lead raw action insertion; raw approval null timestamps; and raw SQL completion bypasses.

The raw SQL forgery suite includes a successful valid raw binding control, ensuring failures do not arise solely from an invalid common fixture. Reviewer revocation is assessed by current claim/completion denial, in accordance with the documented narrow exception for historic status labels.

## Legacy compatibility adjustments

At the parent owner's request, the older `qa-signal-workflow.test.ts` fixture now leaves generic manual Signal drafts unapproved and without contact-right mutations; only its explicitly named pre-migration fixture enables old generic approval before the guard migrations are loaded. Existing historical queued/claimed denial, attributed outcome, authorization and source-import assertions remain intact. `signal-trigger.test.ts` accepts the new precise binding/fence/live-delivery denial messages while retaining the no-queue/no-active-insert and permitted-cancellation assertions. These are contract updates, not waived failures. Both adapted suites passed their selected tests in the 22-case run.

## Defects reproduced and independently retested

1. A raw service-role update could promote an approved queued Signal action directly to `tested` with a fabricated receipt, without a fenced claim. Development added the fenced transition guard. The negative test now passes alongside valid fenced completion.
2. After a legitimate fenced claim, expiring contact rights still allowed a raw update to `tested`; the original new guard checked binding/fence but omitted inherited rights. Development added an AFTER action-policy trigger using the full existing predicate. The raw bypass now fails and valid Worker/SQL completion still passes.

No outstanding failure remains in the above independent runs. Broader regression results, hosted CI/Chromium, exact committed head, harness stage acceptance and PM acceptance must be recorded separately by the parent owner. These local checks are not proof of hosted overlapping-connection concurrency, real Auth/PostgREST, hosted RLS behavior, provider delivery, booking or commercial acceptance.

## Safety and rollback

No hosted migration, production write, paid provider or real recipient operation occurred. Fixtures use fictional clients and `.invalid` contacts; external requests are rejected by the adapter. Incremental provider cost: zero. Rollback is to revert feature code and restore the prior Signal execution denial before considering schema removal, as required by §9.3. No operational-release stage is promoted by this receipt.

## Checked content

| File | SHA-256 |
| --- | --- |
| `platform/ripe-piper-platform/supabase/migrations/20261026034704_signal_reviewed_execution.sql` | `1e225ee11e07aa967bfab07f9456eab72fd38ccf82c7a4c1b789fcefb641ae52` |
| `platform/ripe-piper-platform/src/foundation/signal-strategy.ts` | `f210ad1b3dc185bf7e617146aad246318989d599587f67ffd09139b2e290fe1a` |
| `platform/ripe-piper-platform/src/foundation/campaigns.ts` | `86465c94b9031cad46b5632bf1806b071f8f00976d2510b27119b7a4ff7b0509` |
| `site/assets/signal-admin.js` | `06e832a6f45dcda42f8f362b46659a69d58787de2eeaaf90d658457a892695a8` |
| `site/assets/campaigns-admin.js` | `852a1913bd59f1e6d8de064e2b31645e58bbf4516edec643051ff8df26707e5e` |
| `platform/ripe-piper-platform/test/qa-signal-reviewed-execution.test.ts` | `cf6fdea02c37670e25a1724fa8f8747f2410663059ab440792b3a67250df73a9` |
