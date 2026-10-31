# Ripe Piper delivery status

This is the single delivery tracker: current status, accepted capabilities, open backlog, release blockers and the actions only the owner can take. It is not a history log. Dated receipts, QA reports and CI links from earlier work are in git; for example `git show ff7a80c:docs/DELIVERY.md` shows the previous long record and `git show ff7a80c:docs/evidence/NAME` any retired evidence file.

Owner and release authority: Dipuraj Thapa. Ripe Piper is a B2B prospecting service that runs each client either managed (Ripe Piper operators under a client grant) or self-service (the client admin), with Ripe Piper as its first operational customer. Product behaviour is specified in [LEAD_LIFECYCLE_SPEC.md](LEAD_LIFECYCLE_SPEC.md); local setup, checks and the staging procedure are in [DEVELOPMENT.md](DEVELOPMENT.md); platform routes, flags and migrations are in the [platform README](../platform/ripe-piper-platform/README.md). Governance: [CTO_GOVERNANCE.md](CTO_GOVERNANCE.md), [harness/AGENTS.md](../harness/AGENTS.md).

## Current status (31 October 2026)

**Overall: development-complete for the bounded offline scope, not client-ready.** All four packages have tested source implementations against synthetic data. No live lead-to-outcome service exists yet.

- **Source:** `main` (outcome engine merged in PR #14), plus the uncommitted hybrid operating model on `feat/hybrid-operating-model-2026-10-31` described under [Hybrid operating model](#hybrid-operating-model-branch-not-merged).
- **Checks (hybrid branch):** typecheck clean; targeted Vitest and Node runs per change, including `test/hybrid-acceptance.test.ts` (the seven owner acceptance tests). The full suite has not been run on this branch.
- **Migrations:** 46 files in `platform/ripe-piper-platform/supabase/migrations`. Isolated staging (`wgomywhuzyboxlckopca`) has the first 35 applied and verified. The eleven newest are not applied to any hosted database: `20261027194016` to `20261031000002` (on `main`) and `20261101000001` to `20261101000006` (hybrid branch). Production Supabase was last observed with only its 3 original migrations.
- **Runtime:** no API Worker is deployed. The static site publishes to Cloudflare Pages from `main` with `live:false` configuration, so it shows sample data and does not reach an API.
- **Deployment hold:** production deploys are blocked on purpose (`npm run deploy` runs `scripts/blocked-deploy.mjs`, and the `.githooks/pre-push` hook blocks pushes to `main`). Commits that must not trigger a Pages build use the `[CF-Pages-Skip]` prefix.
- **Providers:** every provider flag is off unless set to exactly `"true"`, and neither Worker template sets one on (the flag list is in the [platform README](../platform/ripe-piper-platform/README.md#configuration)). Real secrets, OAuth apps, connection keys and payment keys are not configured.
- **Harness:** `node harness/evaluate.mjs` reports **14 of 27** stages accepted: the four hosted-database preparation stages and ten offline implementation/QA stages. The 13 operational stages stay open until real deployment, Auth, provider, recovery and pilot evidence exists. Stage evidence lives in `harness/ledger.json`; dependencies in `harness/graph.json`.

## Owner decisions in force

- **Calculator:** emails its breakdown once. No follow-up sequence.
- **Roles and modes:** platform admin, operator (only under a client grant), client admin, client user. Managed and self-service are labels on the same account; access comes only from memberships and grants. A platform admin sees counts, not client content. Details in the [root README](../README.md#roles).
- **Google Ads sync stays off.** It only feeds optional ad spend into the client cost report and no package needs it. Enabling it would also need the `adwords` OAuth scope.
- **Paused campaigns** resume by saving a new version, which the client's operating envelope or a person then approves; there is no separate resume switch. Re-approval re-enrols contacts whose earlier actions were only cancelled by that pause or edit (`campaign_paused`, `message_version_changed`); delivered, tested, blocked and review history never restarts, and cancelled rows no longer use up `max_actions`.
- **WhatsApp stays off.** Reminders go out only with the guest's explicit opt-in, and only after the owner approves per-message spend and supplies the Meta account (owner-only action 8). Until the owner provides the real number, the public site shows no WhatsApp contact.
- **Budget:** US$20 is the one total incremental build budget across all products, integrations, model usage and trials. Paid use stays disabled until prior usage is reconciled (RP-018). Discretionary calls stop at US$18 committed plus reserved.
- **Architecture:** extend the existing static site and Worker; no replacement site, second engine or separate backlog. Ripe Piper runs as an ordinary tenant; legacy `tenant_id IS NULL` data stays intact until a tested, approved migration.
- **Approve once:** a client approves an operating envelope once (in managed mode the granted operator approves it too). Revive campaigns that fit it exactly are approved by SQL with no further human step; anything outside it escalates to a person with fixed reason codes. Envelope bounds: expiry 90 days or less, at most 300 actions on a first envelope, 5 active campaigns, 25 contacts and 30 days per campaign; Revive and email only.
- **Human gates stay:** business brief, contact qualification, the envelope itself, any campaign outside it, live communication and outcome classification are human decisions. Automation never approves its own evidence, rights, spend or envelope.

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
- Member role changes through the invite form by a platform admin or the client admin, with last-owner protection (migration `20261031000001`).
- Revive resume and scheduling (migration `20261031000002`), consultation rebook and cancel, AI cost safety, the counts-only client funnel and CSV download, on-demand Turnstile and default-off WhatsApp reminders (merged in PR #14).

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

## Hybrid operating model (branch, not merged)

Uncommitted on `feat/hybrid-operating-model-2026-10-31`; targeted tests only, not applied to staging. Migrations `20261101000001` to `20261101000006`.

- **Access** (`000001`, `src/foundation/access.ts`, `routes/http.ts`): `profiles.is_operator`; append-only `operator_grants` (capabilities `read`/`operate`/`approve`, authority `client_admin` or `contract` with a reference, at most 366 days, revoke once, client-visible activity rows); the single predicate `can_operate`, reached from the Worker through `tenant_access` and `requireTenant`; denied equals missing (404). Tenant-confidential RLS no longer lets a platform admin read without a grant; `platform_tenant_overview()` gives counts and health only. `set_tenant_ownership` switches the mode by compare-and-set and audits it. Existing staff were backfilled with a 30-day `pre-hybrid-backfill` contract grant.
- **Operating envelope** (`000002`, `envelope.ts`): append-only `operating_envelopes` bound to the brief and setup versions; `envelope_campaign_fit` returns fixed reason codes; `approve_campaign_within_envelope` approves through the existing campaign path. A Revive save is offered to the envelope, and the 5-minute cron approves remaining in-bounds drafts. Stop conditions (minimum sample 5, opt-out 10%, review actions, any reply) pause a campaign from the cron and never resume it. Revoking pauses envelope campaigns and cancels their queued steps; a newer approved version supersedes. A person approving an escalated campaign is recorded as an override.
- **Tenant brand** (`000003`, `lib/brand.ts`): optional `replyTo`, `signature`, `booking` and `legalFooter` in the reviewed Revive setup; one sign-off for Revive and Signal drafts. Agency mail stays Ripe Piper branded.
- **Connections** (`000004`, `connection-oauth.ts`, `lib/oauth.ts`, `lib/vault.ts`, `lib/microsoft.ts`): `tenant_connections` registry with AES-GCM sealed secrets (AAD tenant, connection, provider) in `ripepiper_private`; Google and Microsoft 365 OAuth with PKCE and single-use hashed state behind `OAUTH_ENABLED`; channel selection (WhatsApp, LinkedIn and SMS are interest only). The Google read pilot is mirrored into the registry.
- **Tenant send** (`tenant-send.ts`): the sender must equal the connected mailbox, a postal footer and an issued unsubscribe link are required, each send snapshots the connection version and is rechecked just before the provider; Microsoft uses draft-then-send. Behind `TENANT_SEND_ENABLED`, and not yet called by any route or the cron, so execution still ends in the synthetic sink.
- **Shared reference and learning** (`000005`): `reference_companies` keyed by domain with no tenant or person fields, written only by a platform admin RPC; `learning_outcomes_by_segment` returns a cell only with at least 5 clients and 50 contacts. Paid AI usage records the tenant (`build_usage.tenant_id`). The reference store stays empty until a licensed source is approved.
- **Offboarding** (`000006`, `offboarding.ts`): JSON export of an allowlisted table set (owner or `read` grantee, audited, no token, hash or secret fields); end of service sets `ended` and revokes every connection (Google token revoked, sealed secret deleted); `purge_ended_tenants` runs after 90 days, keeps payments, fees and an HMAC suppression record, and sits behind `OFFBOARD_PURGE_ENABLED` (off; `dry_run` only counts).
- **UI:** the portal gives client admins grants, mode, envelope, connections, export and end service; in self-service mode it loads the existing workflow panels fixed to their own client. Viewers keep the read-only dashboard.
- **Deferred:** external CRM sync, per-tenant WhatsApp and SMS, LinkedIn messaging, Gmail push and restricted read scopes, send-as aliases, Signal/Response/Events under an envelope, per-tenant budget metering, autonomous contact rights, AI message variation, reference sources, custom domains and themed dashboards.

## Open backlog

Only items with remaining work are listed. Items with no remaining work (RP-001 to RP-005, RP-010, RP-011, RP-015) are in git history.

| ID | Priority | Remaining work | Milestone |
|---|---|---|---|
| RP-012 | P0 | Tenant client-calendar booking: expiring contact/action-bound capability, availability, timezone checks, one reservation per event, provider receipt and reconciliation. Public consultation booking exists but is not client-campaign booking. | M02 |
| RP-013 | P0 | Live outreach go-live bundle, blocked until the owner authorises live sending: call the built tenant send adapter (From = connected mailbox, postal footer, unsubscribe link, connection preflight) from dispatch with a completion that writes `delivered`; contact rights under an envelope legal basis; Gmail reply check just before dispatch; DSN hard-bounce stop with its own suppression reason; List-Unsubscribe/One-Click on tenant campaign mail only; SPF/DKIM/DMARC check before approval; per-mailbox daily cap; proof against a real provider. | M02 |
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
2. **Eleven migrations unapplied.** Apply `20261027194016` through `20261101000006` to staging with their rollback packet (`qa/staging-authority-rollback-acceptance.sql` covers the authority/stop migrations) before testing the matching Worker. The hybrid access migration rewrites every staff check, so verify it against staging Auth before any client uses grants. Do not apply to production without owner approval for the exact commit, migration set and rollback.
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
8. **WhatsApp:** a real WhatsApp Business number, a Meta Business account/WABA and app (token, phone-number id, app secret, verify token), an approved utility template `consultation_reminder`, and approval to pay for each message (charged from 1 October 2026) before `WHATSAPP_ENABLED` is set to true. The real number also goes in `config.whatsappNumber` before any WhatsApp contact copy returns to the site.
9. **WhatsApp opt-in wording** and its notice reference signed off under UAE PDPL and India DPDP.
10. **Turnstile** production site key (`config.js` `turnstileSiteKey` is empty) and secret before the public forms go live.
11. **Live outreach (RP-013):** authorisation, plus each client's connected mailbox and sending-domain DNS (SPF/DKIM/DMARC), before any real campaign email.
12. **Production deploy** of the new migrations and matching Worker (production deploys are blocked today).
13. **OAuth apps:** Google verification for `gmail.send`, `calendar.events` and `calendar.freebusy` (until then only test users on the unverified app), and a multi-tenant Microsoft Entra app (redirect URI, secret, publisher verification).
14. **Keys:** generate, back up and own `CONNECTION_KEYS`, and `SUPPRESSION_HMAC_KEY` before any purge. Losing the connection keys forces every client to reconnect.
15. **Legal:** allowed legal-basis values per market for envelopes, whether a postal footer is required in every market, and counsel wording for UAE PDPL and India DPDP export, erasure, log retention and the post-offboarding suppression hold.
16. **Company data source:** a licensed or free source whose terms allow reuse across clients, before the shared reference store holds anything.
