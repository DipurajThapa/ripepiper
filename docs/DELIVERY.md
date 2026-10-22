# Ripe Piper delivery record

Owner and release authority: Dipuraj Thapa. Mission: production-grade multi-tenant B2B lead generation, with Ripe Piper as first operational customer. Existing branding, UX, database, integrations and live deployment are preservation constraints.

Current production baseline after the owner's approved PR #3 merge: `main` at `7230e5f6e51d7903999991da8ab91984f983a3d5`, Cloudflare Pages deployment `d27fbc61-dac3-4383-a636-416b491b56a3`. Earlier audit/M01 baseline references describe the pre-merge state. The uploaded modular pack v1.3 is an instruction set, not implemented software. Its M02 baseline module reconciles with delivery M00/M01; its M03 shared contracts is next; its M04 foundation includes delivery M02 tenant/security. Its M05 campaigns/assets and M06–M09 products precede M10 integration and M11 release. See [pack M02 evidence](evidence/PACK_M02.md). Keep this tracker authoritative; no duplicate backlog.

## Authority

Allowed: read-only audit; local synthetic development and tests; feature branches; isolated nonproduction previews; reversible protection controls. Explicit owner approval required for production data/schema writes, production merges/deployments, paid costs and any external prospect communications. No credentials or customer data in source, CI logs, fixtures or public previews. Passing CI never grants release authority.

## Milestones and acceptance

| ID | Outcome | Acceptance and verification | State |
|---|---|---|---|
| M00 | Baseline audit | Existing source/review/deployment identified; findings and evidence gaps documented; production unchanged | Assessment recorded; see AUDIT_2026-10-22.md |
| M01 | Reversible workflow | Main requires PR/review/verify; production SHA preserved; feature branch; no deploy jobs; preview cannot reach production; tests repeatable; rollback documented | Implemented; VERIFIED in development; see evidence/M01.md |
| M02 | Tenant/security foundation | Ripe Piper synthetic tenant plus adversarial second tenant; anonymous/viewer/owner/admin authorization; cross-tenant reads/writes/relations denied; verified invite acceptance; no tenant-scoped NULL paths for new products | In progress on pack M04 branch; partial controls only |
| M03 | Shared operational core + Revive | Import report and stable row errors; case-normalized dedupe per tenant; permission/provenance and suppression; draft/version approval; zero actual sends; synthetic end-to-end outcomes | Queued, depends M02 |
| M04 | Signal | Dated cited signal records; freshness/duplicate rejection; explainable scoring; account/contact association and reviewed draft; tenant isolation | Queued, depends M03 |
| M05 | Response | Duplicate inbound event creates one lead/work item; deterministic qualification; SLA timestamps, assignment and escalation; sandbox reply queue within 60s; no automatic external delivery | Queued, depends M04 |
| M06 | Events | Event/contact provenance, import rejection/dedupe, follow-up due within 24h, same approval controls, event attribution and reporting | Queued, depends M05 |
| M07 | Operational pilot and release readiness | Approved real first-customer provisioning, separate integration sandbox, measured journeys, retries/concurrency/recovery, accessibility and monitoring; owner-approved release and communication scope | Blocked until separate explicit approval |

Each milestone needs implementation, relevant passing acceptance checks, linked evidence and rollback before dependent milestones start. SPECIFIED, IMPLEMENTED, VERIFIED, RELEASED and OPERATING remain distinct. No requirement for paid infrastructure is assumed.

## Prioritized implementation backlog

| ID | Priority | Requirement / defect | Acceptance | Milestone |
|---|---|---|---|---|
| RP-001 | P0 | DEP-01 protect production | PR + current verify check + review enforced including admins; no force/deletion; baseline SHA unchanged | M01 |
| RP-002 | P0 | DEP-05 isolated previews | Explicit sample config, no production API/data, no credentials or sends; unsafe configuration rejected | M01 |
| RP-003 | P0 | FUN-01 repeatable evidence | Existing 50 tests pass; typecheck; JS syntax; workflow verifies feature changes through draft PRs; no deploy command | M01 |
| RP-004 | P1 | SEC-07 tooling | Pin corrected tooling; refresh lockfile; rerun tests and audit; document any residual findings | M01 |
| RP-005 | P0 | FUN-02 truthful preview | No form claims booking/email/subscription/suppression success without an actual permitted operation | M01 |
| RP-010 | P0 | SEC-01 tenant relationships | Adversarial foreign-tenant relation tests fail closed at DB/API | M02 |
| RP-011 | P0 | FUN-05 dogfooding | Ripe Piper uses ordinary memberships and tenant-scoped workflows in synthetic DB; no production seed | M02 |
| RP-012 | P0 | SEC-02 booking authorization | Expiring single-purpose capability; qualified eligible lead; abuse/rate tests; no UUID-only authorization | M02 |
| RP-013 | P0 | SEC-04 outbound safety | Suppression, channel permission, tenant membership and exact message-version approval checked at dispatch; blocked by default | M02 |
| RP-014 | P0 | SEC-03 payment consistency | Concurrent/replayed/out-of-order webhooks produce one consistent effect and retryable outbox; POST-only approval | M02 |
| RP-015 | P1 | SEC-05/06 grants/invites | Least privilege grants, stable search paths, verified-email invite acceptance including existing users | M02 |
| RP-016 | P1 | FUN-03 job reliability | Failed send not marked delivered; overlapping workers cannot duplicate; missing Calendar state fails closed | M02 |
| RP-017 | P1 | SEC-08 data safety | Sheets input cannot execute formulas; logs redact sensitive payloads; headers/rate/retention tests | M02 |
| RP-020 | P1 | Revive vertical slice | Defined in M03; synthetic Ripe Piper dataset, errors and audit trail | M03 |
| RP-030 | P1 | Signal vertical slice | Defined in M04; evidence fixtures, stale-source and duplicate tests | M04 |
| RP-040 | P1 | Response vertical slice | Defined in M05; retry, SLA and escalation tests | M05 |
| RP-050 | P1 | Events vertical slice | Defined in M06; mixed-tenant imports and deadline/attribution tests | M06 |
| RP-060 | P0 before release | Deployment/integration proof | Confirm API Worker, domains, environment routing, costs, backups and restoration in isolated environment | M07 |

## Decisions and unresolved evidence

- ADR-001: Extend the existing static frontend and Worker; no replacement site or framework rewrite.
- ADR-002: Branch M01 from PR #2's exact head, retaining its quote resilience and booking fixes. Neither existing branch is overwritten or merged.
- ADR-003: Synthetic in-memory PostgreSQL and offline provider mocks are the initial backend environment. No Supabase branch/project provisioned; this avoids unapproved cost/data changes.
- ADR-004: Use Ripe Piper as an ordinary tenant for product workflows. Legacy NULL-tenant data stays intact pending a tested, explicitly approved migration.
- ADR-005: Message generation/approval may be developed locally; sending stays disabled until explicit scoped approval. Automated response-time promises are not yet verified operational SLAs.
- Unknown: original source archive versions; separate deployed Worker and its bindings; production Auth settings; provider entitlements and permissions; backup/restore capability. Do not claim these are configured.

## Change history

- 2026-10-22 M00: Read-only baseline audit, 20-table RLS inventory, deployment identification, main/review tests and dependency assessment.
- 2026-10-22 M01: Local feature branch from 684e29a; baseline tag at d6c1091; safety controls, truthful previews, CI and evidence prepared. Final verification is recorded in docs/evidence/M01.md.

- 2026-10-22 M01 access recheck: main protected=true; verify required for everyone; main unchanged. Updated dependency audit reports zero vulnerabilities. Full protection readback is blocked by browser HTTP 401 / connector administration HTTP 403. M02 remains gated.

- 2026-10-22 M01 published: draft PR #3, code candidate fcdaa3c; PR CI run 39740153051 passed; Cloudflare automatic feature preview succeeded. No merge or production deployment.

- 2026-10-22 GitHub cleanup: active main ruleset fully verified; PR failure diagnosed as npm registry timeout, not failing application tests. Added bounded fail-closed audit retries, pinned Node 24 actions, removed duplicate feature push runs, documented repository usage and marked historical reports. See GITHUB_AUDIT_2026-10-22.md.

- 2026-10-22 M01 VERIFIED: cleanup code candidate e1318d6e4cfe9889fc5fee65979778b65d51285e passed GitHub PR CI run 39741792158 (one run). 66 tests, typecheck, dependency gate and safe preview build passed. Active main protection read back; production remains unchanged. M02 is next; no production release authorized.

- 2026-10-22 Approved PR #3 merge moved main to `7230e5f`; Cloudflare Pages static production deployment `d27fbc61-dac3-4383-a636-416b491b56a3` succeeded. Existing feature/review remote branches were removed after merge. This specific release does not authorize a later production merge, deployment, database write or prospect communication.

- 2026-10-22 Modular pack v1.3 M02 audit on `feature/pack-m02-baseline`: reconciled baseline, module ownership/first-release boundaries and privacy inventory in evidence/PACK_M02.md. Existing RP defects remain open; all pack product modules remain SPECIFIED. Checks and publication evidence to be recorded on the candidate commit.

- 2026-10-22 Pack M03 contract v1 on `feature/pack-m03-contracts`: typed shared boundary and ten fixture tests, 60 Worker tests passing; integrated locally into `integration/modular-pack`. Contract is SPECIFIED and fixture checks VERIFIED; durable runtime remains M04. Pack M04 step 1a on `feature/pack-m04-foundation`: local composite deal/lead and meeting/lead FKs with three adversarial PGlite checks; 63 tests passing. See evidence/PACK_M03.md and evidence/PACK_M04.md. No product module or release is marked implemented by this foundation slice.

- 2026-10-22 Published combined development candidate `e300c4b` to [draft PR #4](https://github.com/DipurajThapa/ripepiper/pull/4). [CI run 39747852530](https://github.com/DipurajThapa/ripepiper/actions/runs/39747852530) passed all verify steps. PR remains unmerged; no database migration applied. This CI result verifies the exact published candidate, not live operation.

- 2026-10-22 Pack M04 step 1b (RP-012) on the foundation feature branch: public consultation now requires a one-use expiring hashed booking capability and an eligible lead; frontend/API/PGlite/mock paths are exercised. See evidence/PACK_M04.md. This is still a nonproduction candidate; rate/ownership, provider failure recovery, and client campaign booking remain open.

- 2026-10-22 Pack M04 step 1c: synthetic Ripe Piper ordinary-tenant membership; local lead provenance/contact-rights/suppression/subject-request schema and admin case intake. Objection freezes existing rights and adds suppression without a send. Production schema remains unchanged. See evidence/PACK_M04.md; durable outbound execution and subject-request fulfilment remain next.

- 2026-10-22 Pack M04 step 1d: staff-only managed tenant preparation endpoint, always onboarding and without provider effects. 72 backend tests and 17 safety/UI tests passed locally with the new provenance/rights migration. Import and durable delivery remain blocked until explicit CTS/stop controls; no release implied.

- 2026-10-22 Pack M04 step 2a: local campaign/stop/action ledger with atomic synthetic-only claim, test-sink completion, current-rights recheck and uncertain-result pause. Staff API is disabled by default. 75 backend tests pass. No provider send or real campaign is enabled; M04 runtime acceptance remains open. See evidence/PACK_M04.md.

- 2026-10-22 Pack M04 step 1e: verified-email invite redemption for existing and new accounts; unverified user creation no longer grants membership in the forward migration. Draft PR #4 candidate `21c09f5` passed CI run 39753080276 (77 backend and 17 safety/UI tests). Existing memberships and email-change lifecycle need rollout review; production remains unchanged.

- 2026-10-22 Pack M04 step 1f: staff emergency pause atomically stops local campaign actions and ad connections, and scheduled ad reporting rechecks state. 80 backend and 17 safety/UI tests pass locally; provider revocation and other legacy jobs remain open. See evidence/PACK_M04.md. No production action was taken.

- 2026-10-22 Pack M04 step 1g: removed payment checkout and proposal mutation from GET; the approved proposal now continues through POST. RP-014 remains open for atomic webhook/side-effect consistency. See evidence/PACK_M04.md.
