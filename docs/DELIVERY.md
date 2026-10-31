# Ripe Piper delivery status

This is the single delivery tracker: current status, accepted capabilities, open backlog, release blockers and the actions only the owner can take. It is not a history log. Dated receipts, QA reports and CI links from earlier work are in git; for example `git show ff7a80c:docs/DELIVERY.md` shows the previous long record and `git show ff7a80c:docs/evidence/NAME` any retired evidence file.

Owner and release authority: Dipuraj Thapa. Ripe Piper is a managed, staff-configured B2B prospecting service (not self-service SaaS), with Ripe Piper as its first operational customer. Product behaviour is specified in [LEAD_LIFECYCLE_SPEC.md](LEAD_LIFECYCLE_SPEC.md); local setup, checks and the staging procedure are in [DEVELOPMENT.md](DEVELOPMENT.md); platform routes, flags and migrations are in the [platform README](../platform/ripe-piper-platform/README.md). Governance: [CTO_GOVERNANCE.md](CTO_GOVERNANCE.md), [harness/AGENTS.md](../harness/AGENTS.md).

## Current status (31 October 2026)

**Overall: development-complete for the bounded offline scope, not client-ready.** All four packages have tested source implementations against synthetic data. No live lead-to-outcome service exists yet.

- **Source:** `main` only; all earlier feature branches are merged and deleted. The latest merge is PR #12, which fixed about 33 audited defects (payment send-claim after Gmail 5xx, zero-value quotes, paid-return page, Turnstile visibility, calculator one-time breakdown honouring opt-outs, removal of `GET /api/slots`, admin UI fixes, AI retry/timeout, reminder day, blog link safety, staging blog via the ASSETS binding, Signal transfer, Revive fixes, Windows dependency audit).
- **Checks on current source:** typecheck clean; Vitest 84 files / 1,412 tests; `node --test scripts/*.test.mjs` 384 tests; dependency audit 0 vulnerabilities; the three rendered browser checks in CI (`tenant-unsubscribe-browser-check`, `product-browser-check`, `signal-browser-check`) pass locally.
- **Migrations:** 39 files in `platform/ripe-piper-platform/supabase/migrations`. Isolated staging (`wgomywhuzyboxlckopca`) has the first 35 applied and verified. The four newest are local only and not applied to any hosted database: `20261027194016_durable_google_authority.sql`, `20261027194035_tenant_contact_stops.sql`, `20261031000000_revive_draft_matched_need_only.sql`, `20261031000001_staff_member_role_change.sql`. Production Supabase was last observed with only its 3 original migrations.
- **Runtime:** no API Worker is deployed. The static site publishes to Cloudflare Pages from `main` with `live:false` configuration, so it shows sample data and does not reach an API.
- **Deployment hold:** production deploys are blocked on purpose (`npm run deploy` runs `scripts/blocked-deploy.mjs`, and the `.githooks/pre-push` hook blocks pushes to `main`). Commits that must not trigger a Pages build use the `[CF-Pages-Skip]` prefix.
- **Providers:** every provider flag is off unless set to exactly `"true"`, and neither Worker template sets one on (the flag list is in the [platform README](../platform/ripe-piper-platform/README.md#configuration)). Real secrets, OAuth consent and payment keys are not configured.
- **Harness:** `node harness/evaluate.mjs` reports **14 of 27** stages accepted: the four hosted-database preparation stages and ten offline implementation/QA stages. The 13 operational stages stay open until real deployment, Auth, provider, recovery and pilot evidence exists. Stage evidence lives in `harness/ledger.json`; dependencies in `harness/graph.json`.

## Owner decisions in force

- **Calculator:** emails its breakdown once. No follow-up sequence.
- **Roles:** staff admin, client owner, client viewer; only staff change roles and the last owner cannot be demoted. Details in the [root README](../README.md#roles).
- **Google Ads sync stays off.** It only feeds optional ad spend into the client cost report and no package needs it. Enabling it would also need the `adwords` OAuth scope.
- **Paused campaigns** resume by editing the messages and re-approving them; there is no separate resume switch.
- **Budget:** US$20 is the one total incremental build budget across all products, integrations, model usage and trials. Paid use stays disabled until prior usage is reconciled (RP-018). Discretionary calls stop at US$18 committed plus reserved.
- **Architecture:** extend the existing static site and Worker; no replacement site, second engine or separate backlog. Ripe Piper runs as an ordinary tenant; legacy `tenant_id IS NULL` data stays intact until a tested, approved migration.
- **Human gates stay:** business brief, contact qualification, exact message approval, live communication and outcome classification are human decisions. Automation never approves its own evidence, rights, spend or messages.

## Accepted capabilities by package

"Accepted" means implemented and independently verified against local PostgreSQL, synthetic fixtures and (where noted) the isolated staging database. None of it is proven against a deployed Worker or real providers.

### Shared foundation

- Tenant isolation with owner/viewer/admin authorization; foreign-tenant reads, writes and relations fail closed (RP-010, RP-011, RP-015).
- Versioned business brief per tenant with reviewed aliases, conservative evidence screening and separate qualification dimensions (fit, role, need, timing); contact permission is a separate gate. No headline probability score (RP-019).
- Bounded safe prospect review snapshot with capacity limits (frozen regression corpus: `platform/ripe-piper-platform/test/fixtures/prospect-quality-safe-review.json`).
- Outbound safety: suppression, rights, tenant and exact-version checks; explicitly reviewed campaign audience at enrolment, claim and completion; fenced claims with provider acknowledgement and held uncertain-send recovery, never automatic resend (RP-013).
- Tenant-specific contact stops and confirmation links (POST to confirm, token hash only), preserving lead/deal history.
- Durable, versioned Google **read** authority per tenant connection, with registration/revocation checks. Grants no send permission.
- Payments: immutable checkout/event binding, atomic monotonic settlement, replay and out-of-order safety; notification intent held for human review (RP-014).
- Consultation reminders: per-window claims, stamped only on strict Gmail acknowledgement; uncertainty goes to review. Attendance needs explicit staff review; missing evidence never implies no-show (RP-016).
- Atomic budget reservation/settlement; unknown price or prior usage refuses the call (RP-018).
- Staff role changes through the invite form with last-owner protection (migration `20261031000001`).

### Ripe Revive

Import with stable row errors and per-tenant dedupe; versioned setup and strategy on the existing campaign asset; reviewed audience of 1–25 same-tenant contacts; exact message approval; fenced synthetic sink dispatch; default-off bounded automation (`REVIVE_AUTOMATION_ENABLED`); SQL guards for current fit, revoked approver, forged receipts and rights withdrawal; reply holds reported conservatively; drafts only from a matched need (migration `20261031000000`); outcome provenance back to action and brief (RP-020).

### Ripe Signal

Approved-source JSON feed preview, review and import (server-side allowlists `SIGNAL_SOURCE_CONNECTIONS`, `SIGNAL_DISCOVERY_SOURCES`, `SIGNAL_DISCOVERY_FEED_HOSTS`); parameterised multi-source discovery; per-trigger review with freshness and expiry; exact-trigger outcome attribution; reviewed strategy and message persisted on existing campaign assets with exact content/evidence/recipient approval; synthetic-only execution (RP-030).

### RP-030 — Signal trigger review and safe handoff, 2026-10-25

`harness/ledger.json` cites this heading as the acceptance reference for the offline Signal stages. Accepted scope: Signal execution is held unless bound to a reviewed trigger-bound strategy (including already-queued actions); each trigger is reviewed by its observation ID; outcomes carry `context.signalId` and must reference a reviewed same-tenant trigger observed no later than the outcome; malformed or uncertain import acknowledgements cannot advance the workflow; public Signal copy makes no fixed delivery or meeting promises.

### Ripe Response

Manual enquiry/reply triage with per-thread missing questions and cross-product holds; selected-message read-only Gmail adapter and manual review import; staff owner routing; CAS-reviewed resolution that reopens on new inbound and never releases reply holds (RP-040).

### Ripe Events

Staff registration and attendance records with per-event history; default-off synthetic public registration (`EVENT_REGISTRATION_ENABLED`) with expiry-bound cancellation/recovery, reviewed versioned settings, capacity and replay controls (RP-050).

## Open backlog

Only items with remaining work are listed. Items with no remaining work (RP-001 to RP-005, RP-010, RP-011, RP-015) are in git history.

| ID | Priority | Remaining work | Milestone |
|---|---|---|---|
| RP-012 | P0 | Tenant client-calendar booking: expiring contact/action-bound capability, availability, timezone checks, one reservation per event, provider receipt and reconciliation. Public consultation booking exists but is not client-campaign booking. | M02 |
| RP-013 | P0 | Tenant sender identity and credential binding for real outbound (no founder-credential fallback); proof against a real provider. | M02 |
| RP-014 | P0 | Live payment settlement with real provider keys in the isolated environment. | M02 |
| RP-016 | P1 | Real provider delivery/read reconciliation for reminders; separate-connection proof. | M02 |
| RP-017 | P1 | Sheets duplicate-safe retry before `SHEETS_SYNC_ENABLED` is turned on. | M02 |
| RP-018 | P0 before paid use | Reconcile prior AI/provider usage against the US$20 budget, bound tariff/input cost, then explicit activation. | M02 |
| RP-019 | P1 | Semantic extraction, owner-labelled commercial evaluation and measured improvement against the deterministic baseline. | M02 |
| RP-020 | P1 | Revive on real Auth, runtime, provider and calendar; recovery; client-delivery acceptance. | M03 |
| RP-030 | P1 | Client-approved source ownership, durable acquisition scheduling, source health/recovery and verified egress; live execution; measured outcomes. | M04 |
| RP-040 | P1 | Live OAuth/push ingestion, configured MQL/SQL, measured real SLA, client-calendar booking. | M05 |
| RP-050 | P1 | Real identity verification, reminders and provider reconciliation; complete client lifecycle. | M06 |
| RP-060 | P0 before release | Deploy the existing Worker to isolated staging; verify routing, Auth, PostgREST/RLS, independent-connection races, backup/restore, monitoring and incident recovery. | M07 |

## Milestones

| ID | Outcome | State |
|---|---|---|
| M01 | Reversible workflow: protected `main`, CI verify, manual isolated staging job, blocked production deploy | Done |
| M02 | Tenant/security foundation | Implemented and verified on local and staging SQL; hosted Auth/PostgREST open |
| M03 | Shared core + Revive | Implemented offline; live journey open |
| M04 | Signal | Implemented offline; live source and execution open |
| M05 | Response | Implemented offline; live ingress/SLA/booking open |
| M06 | Events | Implemented offline; real identity/reminder/provider lifecycle open |
| M07 | Operational pilot and release | Blocked on the release blockers below |

## Release blockers

1. **No deployed Worker.** Staging needs its secrets and a manual dispatch (owner action 1), then the staging HTTP acceptance run and cleanup must pass.
2. **Four migrations unapplied.** Apply `20261027194016` through `20261031000001` to staging with their rollback packet (`qa/staging-authority-rollback-acceptance.sql` covers the authority/stop migrations) before testing the matching Worker. Do not apply to production without owner approval for the exact commit, migration set and rollback.
3. **No real provider proof.** Tenant mailbox identity, lawful contact rights, reply sync, calendar booking and payment settlement are fixture-tested only.
4. **Operations unproven.** Backup restore, monitoring, incident recovery and independent-session concurrency have no evidence (`security-and-operations` stage).
5. **Budget unreconciled** (RP-018); paid AI stays off.
6. **No first-customer pilot.** Synthetic results cannot establish conversion or uplift; a reviewed real cohort with observed meetings and opportunities is required (`first-customer-pilot` stage).

When a release is authorized: keep all provider jobs off; confirm staging identity, backup/restore and migration checks; apply the migrations, deploy the matching Worker, then test. To rotate Google credentials, revoke durable authority first, rotate, then re-register the same connection after fresh identity checks. Never re-enable the old Gmail RPC, and use forward fixes rather than dropping stop or authority data.

## Owner-only actions

Engineering, tests and documentation need no further approval. Only these need the owner:

1. **Staging secrets.** In GitHub **Settings → Secrets and variables → Actions**, set `RIPEPIPER_STAGING_CLOUDFLARE_API_TOKEN`, `RIPEPIPER_STAGING_SERVICE_ROLE_KEY` and `RIPEPIPER_STAGING_ANON_KEY` (staging keys only, never production; never paste them into chat).
2. **Staging dispatch** from a fresh branch off `main`, following [DEVELOPMENT.md](DEVELOPMENT.md#staging-deploy).

3. **Google OAuth consent** for the pilot mailbox/calendar, and sharing the chosen calendar with the pilot account, once the integration is ready.
4. **Payment provider keys** (test mode first) for settlement testing.
5. **Budget reconciliation** of prior usage before any paid call.
6. **Production release approval** for an exact commit, migration set and rollback, and the scope of any real communication.
7. **Pilot decisions:** client offer/segment, source entitlement, contact rights, message approvals and outcome classification.
