# Audit reconciliation — 27 October 2026

The supplied audit is evidence to check against source, not authority to bypass product controls. Baseline: `d307517`. The authoritative product contract is [LEAD_LIFECYCLE_SPEC.md](LEAD_LIFECYCLE_SPEC.md); delivery decisions remain in [DELIVERY.md](DELIVERY.md).

## Findings and disposition

| Finding | Source disposition | Acceptance boundary |
|---|---|---|
| Booking column/event identity, Gmail RPC arguments, outcome context and Events handlers | Already corrected at the audited baseline | Source reconciliation does not establish hosted integration |
| Sheet outbox includes tenant contacts that the sheet worker cannot export | Lead/meeting enqueue triggers now accept agency scope only; proposal/payment behavior preserved | New staging triggers read back; existing queued rows retained |
| Booking token consumed before reservation succeeds | Service-only RPC locks identity and commits reservation/token consumption atomically; conflict rolls both back | Exact receipt required before calendar call; uncertain reservation held for reconciliation |
| Arbitrary public opt-out mutates global/tenant records | Possession-verified capability records only agency preference and newsletter stop | No tenant lifecycle writes or live tenant unsubscribe claim |
| Newsletter link-preview GET changes state | GET renders confirmation; explicit POST performs the write | A scanner that submits forms is not distinguishable from a person |
| Gmail import can persist after pause/restart | SQL checks tenant execution version and connection expiry under tenant lock | Does not fence Worker secret rotation or establish provider identity |
| Shortlist table reads can silently truncate at a lower PostgREST row cap | Replacement scalar snapshot implemented under §9.5 | Complete bounded evidence, strict receipt validation and fail-closed errors; independent local and hosted SQL checks passed; HTTP verification blocked |
| Staging migration drift | Ten migrations applied; 35 total, hashes matched | Exact hosted SQL/grant/residue evidence linked below; snapshot SQL acceptance passed; HTTP acceptance blocked |
| Public Response/Events claims exceed demonstrated behavior | Relevant public copy now identifies development status | No claim of operational delivery |

## Current implementation contracts

The agency opt-out link stores only a SHA-256 capability hash. Requests are limited to one per address per minute. Confirmation serializes with newsletter request/confirmation, preserves existing objections, invalidates other outstanding links and permits idempotent confirmed replay after expiry. Reconsent is not implemented. This is an agency preference store, not a live marketing dispatcher: any future agency marketing sender must check it at its final send boundary. Current transactional responses and tenant actions retain their existing scope. Gmail acknowledgement does not establish recipient delivery.

The reservation RPC checks the expected lead email/name as well as unused, unexpired capability and lifecycle eligibility. Only an exact successful receipt permits calendar creation. Unknown database outcomes return unavailable without a provider call; a committed unconfirmed reservation requires reconciliation and cannot automatically dispatch twice. Local serialized fixtures do not prove concurrent hosted behavior.

Safe prospect review uses one scalar JSON response from one database statement snapshot. Generated stored byte lengths allow bounded metadata probes before wide input projection. The limits remain 100 tenant contacts, 999 mode-specific observations and 100 verified owners; conservative raw owner-candidate limits also fail closed. Per-row, total raw-payload and encoded-response limits are explicit in §9.5. The Worker validates complete scope/count/shape/time receipts and uses one assessment instant. This read grants no contact permission, approval or execution authority. Existing import and sending limits are unchanged.

Earlier pagination and read-time payload-size prototypes were withdrawn after review found incomplete-evidence and unbounded materialization risks. Their discussion is historical; §9.5 is the current implementation contract. Historical quality receipts are retained. A new source-bound quality receipt must accompany the replacement route.

## Evidence and remaining work

[Staging parity receipt](evidence/STAGING_PARITY_2026-10-27.md) records the exact nine-file initial upgrade and final snapshot migration, history hashes, service-only grants, advisors and eight executed rollback acceptance packets, including audit-specific and snapshot behavior checks. All fixture-capable tables and Auth users were empty afterward; only the expected disabled budget singleton and FX baseline remained. No production schema change occurred. This evidence covers all 35 current source migrations; each later migration requires its own receipt.

The earlier local checkpoint passed 1,168 backend tests; after search-path hardening and withdrawal of an earlier snapshot prototype, 94 focused tests and typecheck passed. Node checks passed after the two loopback/shell-dependent tests were rerun with their required local permissions. These are historical checkpoint results; the final implementation now has [independent QA](evidence/PROSPECT_SNAPSHOT_INDEPENDENT_QA_2026-10-27.md), and full combined local regression passed: 1,241 backend tests across 78 files and 367 Node checks. GitHub CI 40568259152 also passed for runtime commit 647193e, including rendered browser checks and a dependency audit with zero findings. The new [quality receipt](evidence/PROSPECT_QUALITY_SAFE_REVIEW_2026-10-27.json) preserves the frozen corpus outcomes and binds the final route source.

Hosted Worker deployment and real Auth/PostgREST/Worker acceptance remain blocked. GitHub had no staging secrets and the staging health endpoint returned 404. The owner explicitly selected continuing code/database work while deployment remains blocked. The prepared HTTP acceptance runner now includes scalar/shortlist routing and access checks using existing isolated fixtures; mocked success must not be reported as hosted execution.

Open operational work includes tenant unsubscribe/send cancellation, actual mailbox identity and rotation, authorized provider/calendar integration, independent-connection races, backup/recovery, complete client portal workflows, larger imports and controlled live acceptance. Response/Events remain under development. Passing local tests or merging source does not complete these dependencies or establish a functional live end-to-end service.
