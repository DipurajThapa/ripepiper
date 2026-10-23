# Independent Revive intake, draft and report QA — 23 October 2026

Current bounded result: **686 backend tests / 49 files PASS**, **121 Node checks PASS**, TypeScript and whitespace checks PASS; selected draft-save SQL controls passed on the **23-migration isolated staging database**, with every synthetic fixture rolled back. Two acknowledgement defects were independently reproduced and closed. This accepts the tested local and selected hosted SQL increment; its final published-tree Chromium CI is pending at this checkpoint. Actual deployed Auth/API/provider operation and client-delivery acceptance remain open.

## Candidate and isolation

The audit began at `b4bd458e0f6cbd80c80af3c3499c1309ee1088e7`. The accepted local candidate is that baseline plus the current intake, deterministic draft, campaign acknowledgement, read-only report, SQL wrapper and test working diff; a later commit/CI receipt must bind this exact implementation. Application source was frozen for the final full run. QA wrote tests, one rollback-only SQL packet and this report, without editing developer implementation.

Tests used Node 24, real module/Worker code, local PGlite migrations and synthetic `.invalid` fixtures. The test network guard rejects unmocked fetch. The only connected QA mutation was an explicitly authorized BEGIN/ROLLBACK SQL packet on `wgomywhuzyboxlckopca`. Production was not a test target. No provider, real prospect, Auth API invitation/email, paid model call or deployment was performed by QA.

## Independently reproduced defects

**Q-RI001 — untrusted batch import acknowledgement.** At the baseline, `importReviewLeads` spread the RPC result directly into a row receipt. Null, false, empty object, array, invalid identifiers, missing observation identity and unknown state all returned HTTP 200 / `ok:true` and continued later rows. A valid-looking receipt could replace the local row number with 999 and expose arbitrary private response fields. The independent actual Worker suite `test/qa-revive-import-ack.test.ts` failed **8/8** before the fix. CTO added exact known-state/two-UUID validation and a whitelist; malformed results stop the batch with HTTP 503 and an explicit uncertain row, retaining source references for reconciliation. The unchanged eight assertions now pass. **CLOSED locally.**

**Q-RI002 — contradictory new-campaign save receipt.** While strict acknowledgement handling was being added, an actual new-plan save (`version:0`) still accepted a receipt claiming `status:approved`. The independent actual Worker regression failed on that case; the other malformed cases were already rejected by the concurrent implementation fix. Development restricted a new-plan receipt to draft status while preserving the legitimate existing-approved exact-version replay. `test/qa-revive-save-ack.test.ts` now passes **7/7**, including malformed/foreign/noninteger results, the contradictory approval and the valid save-only path. No approval, rights or queue RPC is issued by these tests. **CLOSED locally.**

CTO separately discovered and corrected omitted report markup before a null handler binding. QA's subsequent strict emitted-markup checks return null for absent IDs and verify the actual draft/report controls exist; this report does not claim QA independently reproduced that earlier defect.

## Executed local acceptance

- `npm test` — **686 passed / 49 files**, including earlier product, security, billing, consultation, migration, qualification and Revive regressions. No skipped assertion is counted as acceptance.
- `node --test scripts/*.test.mjs` — **121 passed**. This includes the final four independent strict campaign-markup tests, which were added after CTO's earlier 117-check run.
- `npm run typecheck` and `git diff --check` — **PASS**.

Independent additions comprise twenty backend checks and nineteen Node checks across `qa-revive-import-ack`, `qa-revive-import-identity`, `qa-revive-save-ack`, `qa-revive-draft-rollback`, `qa-revive-intake-parser`, `qa-revive-intake-ui` and `qa-revive-campaign-ui` test files.

Actual local SQL proves stable source retry reuses the original lead/observation; case-normalized identity links a distinct source; a source reused for changed email/rights conflicts without an orphan lead; identical email/reference remains isolated between tenants; and reimport preserves unsubscribe, global suppression and existing company rather than activating an account, approving a cohort or granting contact rights.

Independent parser checks exercise UTF-8 BOM, reordered canonical headers, quoted commas, escaped quotes, multiline CRLF company values, TSV, disclosed blank lines, malformed quotes, duplicate/unknown/extra headers, row width, exact 50/51-row boundary, multibyte size limits, dates, evidence mode, controls, reused references and existing-identity notices. Extra CRM/history fields are rejected explicitly. This is a bounded five-column contact/source import, not an XLSX or arbitrary CRM mapper; relationship history remains separately reviewed.

Independent actual UI-module checks prove preview makes no persistence call; explicit import retains exact source references; changed content/header/separator invalidates its preview; invalid UTF-8 is rejected without replacement; oversize files are rejected before reading; a delayed file cannot populate another tenant; malformed/uncertain import receipts do not claim success; and retry retains the unchanged batch. Imported contacts remain distinct from cohort acceptance, channel rights and delivery authority.

Strict campaign UI checks use only IDs emitted by actual markup. Preparing a proposal does not save/approve/queue anything. Explicit save retains exact draft provenance and operator edits; changed draft settings cannot silently drop provenance and save an old proposal; delayed reports cannot populate another account. The rerun developer suites also verify source/brief/review/snapshot/company expiry, prompt-like input and booking-copy guards, no selected-contact private content in reusable cohort copy, per-operation acknowledgement contracts, current SQL checks and actual Worker → PGlite draft save.

The read-only report implementation and its executed suite keep unique contact/category counts separate from action and evidence-record counts; separate synthetic acknowledgements from business provider acknowledgements; require exact linked reviewed outcome evidence for meeting/opportunity categories; expose conflicting outcomes and unattributed history; omit emails, source excerpts and claim tokens; and reject capped datasets rather than presenting a complete funnel. Provider acknowledgement is not recipient delivery. No conversion uplift, automatic attendance, causal attribution or A/B winner is inferred.

## Frozen qualification artifact integrity

QA independently compared `PROSPECT_QUALITY_REVIVE_2026-10-23.json` with `PROSPECT_QUALITY_REVIVE_INTAKE_2026-10-23.json`. The **only** changed JSON value is `provenance.rules.shortlistModuleSha256`, reflecting the reviewed import handler change (`711ee3…` to `e558a4…`). Dataset, assessor, evaluator, briefs, labels, thresholds, metrics and commercial-outcome limitations are unchanged. Historical artifacts remain preserved. The exact-artifact regression passed; no qualification standard was relaxed.

## Hosted draft-save acceptance — isolated 23 migrations

After CTO applied CLI-generated `20261023172149_revive_draft_provenance.sql` to isolated staging only, QA independently read a 23-entry migration count and an empty tenant/Auth baseline. `save_reviewed_revive_draft` is SECURITY INVOKER with fixed empty search_path, anon/authenticated direct EXECUTE denied and service-role EXECUTE retained. Source migration SHA-256: `c4eced874cdb28f77671ca58a420239e6029a8b3268b4aeaec64cbfbd011a319`.

QA first rehearsed the exact `qa/staging-revive-draft-rollback-acceptance.sql` locally through `test/qa-revive-draft-rollback.test.ts`. Packet SHA-256: `4554115f0075cbcb7ce303a3ece63370a5245fd1f0723a280def15445d297756`. It extends the existing synthetic Revive fixture, contains no DDL and refuses a nonempty staging baseline. QA then executed the exact packet on `wgomywhuzyboxlckopca` only. Actual PostgreSQL returned **PASS: hosted Revive draft save/replay/no-auto-approval/stale-review/source/company/expiry/ACL plus existing workflow; all synthetic fixtures rolled back**.

The packet proves new saves remain drafts with no approval/rights/outbound work; identical saves deduplicate the private audit; foreign/missing source, changed sender business name, expiry and a changed review version for an identical input snapshot reject; authenticated callers cannot invoke the wrapper; and existing activation/cohort/queue/fenced acknowledgement/attribution/stop controls remain compatible. The trusted Worker performs qualification and drafting; this SQL receipt does not claim to run TypeScript or real Auth HTTP.

Fresh independent post-rollback counts are **zero** for tenants, Auth users, profiles, leads, observations, campaigns, assets, outbound actions, Revive reviews, activation reviews, activity, sheet outbox, contact rights and outbound stops. No synthetic residue was retained. CTO owns migration deployment/checksum/advisor records; QA performed no DDL.

## Acceptance limits

No further blocking functional defect was found in this reviewed increment. Final commit/tree linkage and new rendered Chromium evidence still require their own observed published CI receipt. Local VM modules are not claimed as full browser rendering. Live Auth/PostgREST/Worker sessions, actual mailbox/recipient delivery, booking, prospect replies, continuous outcome collection, customer data ingestion, commercial improvement, backup restoration and independent-connection concurrency remain unverified. Earlier MCP concurrency probes did not overlap and establish no lock-race proof. These outstanding operational integrations do not invalidate the bounded checks above and are not relabeled complete by an automatic report or draft generator.
