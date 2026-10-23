# Ripe Piper delivery record

Owner and release authority: Dipuraj Thapa. Mission: a managed, evidence-led B2B prospecting engine that understands each client business, identifies suitable accounts and contacts, and improves from verified sales outcomes, with Ripe Piper as first operational customer. This is an on-demand managed service, not self-service SaaS. Existing branding, UX, database, integrations and live deployment are preservation constraints.

Current production baseline after the owner's approved PR #3 merge: `main` at `7230e5f6e51d7903999991da8ab91984f983a3d5`, Cloudflare Pages deployment `d27fbc61-dac3-4383-a636-416b491b56a3`. Earlier audit/M01 baseline references describe the pre-merge state. The uploaded modular pack v1.3 is an instruction set, not implemented software. Its M02 baseline module reconciles with delivery M00/M01; its M03 shared contracts has fixture verification; its M04 foundation includes delivery M02 tenant/security. Its M05 campaigns/assets and M06–M09 products precede M10 integration and M11 release. See [pack M02 evidence](evidence/PACK_M02.md). Keep this tracker authoritative; no duplicate backlog.

## Authority

Allowed: read-only audit; local synthetic development and tests; feature branches; isolated nonproduction previews; reversible protection controls. On 2026-10-23 the owner authorized necessary product connections and a maximum total build spend of US$20. Use that delegated authority without repeated approval requests, subject to the budget and data boundaries below. Production data/schema writes, production merges/deployments and external prospect communications retain their existing separate approval requirement; connection authorization alone does not authorize them. No credentials or customer data in source, CI logs, fixtures or public previews. Passing CI never grants release authority.

## Current product instructions — owner clarification, 2026-10-23

This section refines the uploaded pack in place. It is the current direction for implementation, with the existing contracts, backlog and evidence files; do not create a second engine, workflow, backlog or replacement site. Implementation status is recorded below and in PACK_M04 evidence. Requirements without passing evidence remain SPECIFIED; no conversion uplift has been demonstrated.

### Business outcome and scope

Optimize for client-accepted, evidence-supported prospects that progress to qualified meetings and opportunities. Lead volume, model confidence and attractive copy are not success measures. Define each client's qualification criteria, disqualifiers, sales capacity and outcome window before scoring. A suitability score is not a conversion probability. Do not promise higher conversion until measured against a comparable baseline.

Reuse one flow across Revive, Signal, Response and Events: ingest permitted evidence; resolve identity; maintain the business brief; qualify and rank candidates; present reasons and uncertainty for operator review; hand off through existing approved actions; record outcomes and propose measured improvements. Product-specific sources and timing remain distinct. Keep the service staff-configured after consultation.

1. **Understand the business.** Extract offerings, customer problems, delivery geography, buyer roles, constraints, differentiation, evidence of results and exclusions from approved website pages, selected business emails, interview notes and owner corrections. Use existing meeting analysis as an input, not a second discovery system. Tag each statement as sourced fact, client assertion, hypothesis or unknown. Missing budget, authority or buying intent stays unknown. Resolve conflicting sources with the operator; never silently overwrite a verified decision.
2. **Maintain one versioned brief per tenant.** Record source reference, minimal excerpt, observation date, review status and applicable offer. Operator corrections invalidate affected rankings and drafts. Preserve the prior version for audit and rollback. Start with one Ripe Piper offer and one buyer segment; choose them from the approved brief, not assumptions.
3. **Use a small evidence graph.** Represent business, offer, target account, contact, source observation and outcome as tenant-scoped entities with typed links such as offers, works-at, supports and resulted-in. Reuse leads, observations, rights and activity records; add only demonstrated missing relationships in the existing database. Every material link needs provenance and time. Do not infer identity, employment, consent or buying intent from a weak association. Bound retrieval to the current tenant and relevant offer, initially at most two relationship hops. No dedicated graph database, GraphRAG platform or graph visualization framework without evidence that ordinary joins and retrieval cannot meet acceptance.
4. **Use a bounded execution graph.** Implement the above steps as explicit states in the existing Worker/job ledger, with idempotent inputs, validated outputs, one owner for failures and stop conditions. Deterministic code handles authorization, deduplication, exclusions, rights, budget and scoring arithmetic. A model may extract facts, summarize evidence and propose reasons. It cannot approve its own claims, permissions, spend or outbound messages. Treat website/email text as untrusted data; embedded instructions cannot change tools, tenant scope or policy. Prefer one model call per changed evidence batch, at most one repair attempt, then manual review. Reuse results by tenant, source hash and brief/prompt version.
5. **Qualify before generating outreach.** Apply hard exclusions first. Rank surviving accounts on separately visible business fit, role relevance, current need evidence and timing. Keep contactability/permission as a separate gate; a high fit score never grants permission. Each result must show supporting sources, freshness, reasons, missing information and a useful next action. Reject or review ambiguous identity and stale unsupported claims. Generate copy only after a prospect is accepted and only within the existing campaign controls.
6. **Make the evidence understandable.** Extend the existing operator interface with a compact business brief, ranked list and expandable evidence/relationship view. A simple table or small relationship diagram is enough. Let staff correct facts, reject prospects with reason codes and trace an outcome back to the brief and source versions. Do not build a generic workflow designer or separate analytics suite.
7. **Learn from observed outcomes.** Record accepted/rejected, reply, qualified meeting held, opportunity, won/lost and reason with timestamps and denominators. Keep pending/unobserved outcomes distinct from failure. Change one ranking or retrieval rule at a time, evaluate against a frozen labelled set, then record acceptance or rollback. Prevent evaluation leakage and cross-tenant learning from private data. Do not let the model rewrite production rules or train itself automatically. Report conversion by cohort and outcome window; sparse data cannot establish uplift or causation.

### Validation and next executable slice

Extend existing RP-011/013/020/030 work; do not create four independent pipelines. The versioned brief and cited shortlist slice is implemented. The next shared review slice fixes evidence assessment and adds staff import, separate four-product histories, reply stops and outcomes using synthetic fixtures and no sends. Full product automation and live end-to-end acceptance remain separate milestones. Foundation checks needed for this slice must pass; unrelated billing or publishing work stays in the backlog and is not a prerequisite for an offline shortlist. Full M04 and operational release acceptance remain open.

Use a frozen set containing suitable, unsuitable, ambiguous, stale and injected-source examples across two tenants. Check every emitted factual claim for source support, every hard exclusion for enforcement, and every tenant boundary for isolation. Missing evidence must yield unknown/review. Measure precision among the top 20 results (accepted suitable prospects / 20, or the actual reviewed count if fewer), coverage, operator correction rate, runtime and cost per accepted prospect. Compare the model-assisted variant with the same deterministic baseline and label set; retain it only for measured improvement in quality or reviewer effort without safety regression. Real conversion evidence requires a later authorized pilot; fixture results are not conversion results. Version the dataset, brief, rules and model configuration with the evidence.

### Connections and total build budget

Reuse existing GitHub, Supabase, Cloudflare and Google integrations before adding anything. Repository access is verified; runtime credentials, provider entitlements and scopes require separate verification. `src/env.ts` declares Google send/calendar/Sheets/Meet/Drive scopes, but does not establish a mailbox-read connection. Chat-connected email access is not a durable production connector. Start with selected client-owned material or manual import; add read-only mailbox access only for the relevant account and selected business threads when needed. Do not ingest the owner's whole inbox or unrelated client data. Record tenant, purpose, fields, scopes, retention, health and revocation for each connection. Keep credentials server-side; never copy chat tokens into the app. Only request user interaction if a provider requires account selection or OAuth consent.

US$20 is one total incremental build budget across all four products, integrations, model usage, trials and validation, not a monthly or per-engine allowance. Include taxes and other unavoidable charges. New spend incurred in this instruction-update task: US$0. Prior build/service usage is unverified. Reconciliation means checking attributable invoices/API usage and deducting those charges from the US$20 allowance before authorizing new paid use. This is a restriction on paid operations only: local coding, deterministic assessment and fixture testing continue at zero incremental service cost. Already-paid subscriptions are not new purchases; any additional usage charges still count. Reuse already-owned services without upgrades and use fixtures/manual import while costs are uncertain. Do not enable open-ended billing or auto-renewing trials. A budget alert is not a hard spending limit.

Before any paid call, implement a shared atomic budget reservation using a verified conservative maximum cost, including retries and concurrent jobs; settle actual usage afterward and retain uncertain charges as reserved until reconciled. Stop new discretionary calls at US$18 committed plus reserved cost, preserving US$2 for settlement/variance; never authorize total charges above US$20. If price, prior usage or a charge ceiling cannot be verified, use a free/manual path. Apply this to the existing AI client too: its output-token cap is not a total-cost control. Choose any model/provider only after a small representative extraction/ranking evaluation and current price verification. No paid prospect database, advertising, autonomous agent swarm or fine-tuning is in the initial slice. This budget funds a bounded build/proof, not unlimited future hosting, enrichment or outreach operations.

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

Each milestone needs implementation, relevant passing acceptance checks, linked evidence and rollback before dependent milestones start. For the offline prospect shortlist, use the narrower dependency boundary in the current product instructions; this does not mark the full foundation or operational integration complete. SPECIFIED, IMPLEMENTED, VERIFIED, RELEASED and OPERATING remain distinct. No requirement for paid infrastructure is assumed.

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
| RP-018 | P0 before paid use | Shared total-build budget control | Reconciled usage; atomic worst-case reservation and settlement; concurrent/retry tests; US$18 stop and US$20 absolute cap; unknown price fails closed | M02 |
| RP-019 | P1 | Versioned business brief and evidence relationships | Brief, reviewed aliases, conservative evidence screening and separate qualification dimensions implemented; no headline probability score. See PACK_M04 steps 1h–1i. Semantic extraction, correction resolution and measured quality improvement remain open. | M02 |
| RP-020 | P1 | Revive vertical slice | Shared import/dormant-history review implemented in step 1i. Versioned message approval and capped synthetic sequences implemented in step 1j; real delivery/failure recovery and complete reactivation outcomes remain open. | M03 |
| RP-030 | P1 | Signal vertical slice | Cited fit review and expiring trigger records implemented. Automated discovery, acquisition/capture, top-20 labelled comparison remain open. | M04 |
| RP-040 | P1 | Response vertical slice | Manual enquiry/reply triage, per-thread missing questions and cross-product hold implemented. Inbox adapter, configured MQL/SQL, owner routing and client-calendar booking remain open. | M05 |
| RP-050 | P1 | Events vertical slice | Staff registration/attendance records, per-event history and no-show guard implemented. Public registration, campaign reminders, cancellation/rescheduling and provider reconciliation remain open. | M06 |
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

- 2026-10-23 Owner direction reconciled in place: managed prospecting outcome, one shared evidence and execution flow, relational graph scope, measurable ranking/feedback acceptance and US$20 total build cap. New connection authority recorded; no connection, spend, deployment or prospect communication executed by this specification update. Next: business-brief/shortlist slice using the existing foundation; operational release gaps remain open.

- 2026-10-23 Pack M04 step 1h / RP-019: implemented versioned staff-reviewed brief, evidence intake on existing leads and bounded deterministic shortlist in the existing Clients panel. Foundation offline slice proceeds without billing integration; no external sends or paid model calls. See evidence/PACK_M04.md for exact verification and gaps.

- 2026-10-23 Pack M04 step 1i / RP-019/020/030/040/050 shared review increment: audited pack M05 through M09 one file at a time. Reproduced negation and alias defects, removed misleading headline score, added reviewed aliases, bounded staff import, persistent product histories and outcomes, per-thread questions, per-event attendance review, atomic reply stops and opt-out propagation. Uses existing leads/observations/briefs/actions and Clients panel. Browser execution is blocked by unavailable Chromium and invalid download; all four full operational product milestones remain open. See evidence/PACK_M04.md.

- 2026-10-23 Step 1j: shared versioned plain-text message plans, current-brief approval, bounded synthetic sequence enrolment, ordered test execution and edit/pause invalidation implemented on the existing campaign ledger. Pinned Playwright and added required rendered-browser CI checks to address the prior local Chromium blocker. See PACK_M04 step 1j; production and real providers unchanged.
