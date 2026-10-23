# Ripe Piper platform

This is the existing Cloudflare Worker API, Supabase schema and provider-adapter source used by the Ripe Piper managed B2B lead-generation service. The branded website, staff console and client portal live in [`../../site/`](../../site/). Preserve this architecture and its existing workflows.

## Current implementation and deployment status

As checked on 23 October 2026, all four products have bounded development verification. [The root README](../../README.md) summarizes product status; [DELIVERY](../../docs/DELIVERY.md) is the authoritative backlog and merge/deployment record. The last inspected production database has only its original three migrations. The isolated **ripepiper-staging** database has the reviewed **19-migration** composition; its source checksums and actual hosted append order are in the [migration manifest](../../docs/evidence/STAGING_MIGRATION_MANIFEST_2026-10-23.json).

The selected Cloudflare account's inspected runtime inventory had the existing static Pages project and no deployed API Worker. Source configuration is blank with `live:false`. Static Pages publication does not deploy this API, apply migrations, connect providers or make the four products operational. Hosted Auth/PostgREST/Worker execution, real provider/recovery evidence, separate-connection races, backup restoration and first-customer acceptance remain open. See [infrastructure readback](../../docs/evidence/INFRASTRUCTURE_READBACK_2026-10-23.md).

## Architecture and data ownership

| Component | Responsibility | Boundary |
|---|---|---|
| Existing `site/` | Public pages, `/admin/`, `/portal/` and reviewed product UI | Only public Supabase URL/anon key; no service credentials |
| Worker `src/` | `/api/*`, `/webhooks/*`, `/p/*`, `/blog*`, jobs and provider adapters | Server-side authorization, tenant scope, rights, approvals and receipt validation |
| Supabase Postgres + Auth | Source records, memberships, evidence, versions, execution/payment/reminder receipts and outcomes | RLS and scoped RPCs; production migrations require separate authorization |
| Google adapters | Calendar/Meet, mail, selected-thread reads and optional Sheets mirror | Explicit account/scope/purpose; chat-connected access is not application OAuth |
| Stripe / Razorpay adapters | AED / INR hosted checkout and verified payment events | Exact registered target/amount/currency; uncertain checkout requires review |
| Shared AI adapter | Draft extraction/notes/proposals under reviewed pricing and budget controls | Default off; unknown prior usage or pricing refuses paid calls |

Every client, including Ripe Piper's lead-generation dogfood journey, uses ordinary tenant membership. Existing founder consultation/sales records can retain `tenant_id = NULL` and remain staff-only. New product workflows do not use NULL as a tenant shortcut. Client owners and viewers have distinct scoped permissions; frontend visibility does not replace RLS.

The Google Sheet is an optional CRM mirror. Existing outbox/job code can synchronize configured records, but a five-minute operating SLA has not been verified. Supabase remains authoritative. Attribution and revenue reports reflect stored, reviewed records and the selected model; they are not proof of causal conversion improvement.

## Inquiry, consultation and payment contracts

These routes describe implemented source behavior and tested fixtures, not active live services:

| Stage | Implemented behavior |
|---|---|
| Inquiry / qualification | `/api/lead` validates, deduplicates and applies the existing qualification rules; public activation requires configured runtime and abuse controls |
| Booking | `/api/book` requires an eligible lead and expiring capability; availability fails closed, stable calendar identity supports read reconciliation, uncertain reservation is held |
| Reminder | Default-off consultation job claims one 24h/1h attempt for the exact booking; only a strict Gmail acknowledgement records the timestamp; uncertain outcomes stay held |
| Notes / attendance | Available evidence can support draft notes under the paid-AI guard; absent evidence stays `attendance_unknown`; held/no-show classification requires explicit staff evidence and version check |
| Proposal | Staff review draft text; code supplies published prices and computes the advance; AI never sets prices |
| Checkout | An explicit approval/payment POST reserves a ledger attempt and binds the provider reference; repeat requests read the recorded checkout rather than blindly creating another |
| Settlement | Verified events settle registered exact financial bindings atomically, with monotonic paid state and replay-safe tenant/invite/fee/activity effects |
| Onboarding / notification | Payment records a held human-review notification intent; there is no automatic payment email sender or promise that service has started |
| Quotes / portal | Existing owner authorization, totals, acceptance and payment checks apply; the portal displays recorded outcomes |

Published pricing is defined in `src/lib/pricing.ts` and must match the site. The default advance is 10%: Revive Sprint uses the sprint fee; a single event uses its event fee; the monthly engine uses setup plus the three-month minimum. Customisation quotes are separate. Commercial refund/advance terms still need business review before client rollout.

## Safe setup and verification

Use Node 24 and the committed lockfile, with no production credentials:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm test
cd ../..
node --test scripts/*.test.mjs
node scripts/dependency-audit.mjs
node scripts/preview.mjs build
# Optional local browser prerequisite, from the platform directory:
# npx --no-install playwright install chromium
node scripts/product-browser-check.mjs
node scripts/signal-browser-check.mjs
node scripts/preview.mjs serve
```

The local preview is at http://127.0.0.1:4173, with sample data and external operations disabled. Backend suites use disposable PGlite and mocked providers. Current implementation evidence: **438 backend tests / 34 files**, **76 Node checks**, TypeScript, syntax, dependency audit and both Chromium workflow programs passed in [CI 39944568353](https://github.com/DipurajThapa/ripepiper/actions/runs/39944568353). Test counts are a dated receipt; run the suite for the current result. [Independent QA](../../docs/evidence/QA_OPERATIONAL_2026-10-23.md) records six corrected findings, four hosted rollback scripts, source identity and verification limits.

## Isolated integration and release

Reuse the existing Free staging project; do not create another database or upgrade a plan as a setup step. Do not seed production or run only the original three migrations for a new development environment. Use the reviewed manifest and the [hosted staging evidence](../../docs/evidence/HOSTED_STAGING_2026-10-23.md); hosted migration timestamps can differ from repository filenames.

[`wrangler.staging.toml`](wrangler.staging.toml) packages this same API and an isolated copy of the existing site with no custom production routes or cron. The existing CI workflow permits deployment only through explicit `deploy_staging:true` on a non-main branch after verification. Configure only these GitHub Actions secrets through secure settings:

- `RIPEPIPER_STAGING_CLOUDFLARE_API_TOKEN`
- `RIPEPIPER_STAGING_SERVICE_ROLE_KEY`
- `RIPEPIPER_STAGING_ANON_KEY`

Follow the [exact secure setup and dispatch guide](../../docs/evidence/INFRASTRUCTURE_READBACK_2026-10-23.md#secure-worker-setup-required-from-the-owner). The runner checks actual isolated Auth/PostgREST/Worker boundaries and exact fixture cleanup; it has not yet executed against the deployed service. Frontend output receives only the isolated public URL/anon key. Founder send/calendar, payment and AI secrets are excluded from this packet.

`npm run deploy` is intentionally blocked. The owner authorized the current protected PR #6 merge and existing static Pages publication; production database migrations, API Worker deployment/activation, paid calls and prospect communications remain separately scoped actions. Production `wrangler.toml` is preserved for comparison. Retain a non-main integration branch for the documented staging dispatch; all merged source can still be consolidated in main.

No new paid service call was made in this development cycle. The total incremental build budget is US$20; prior AI charges remain unreconciled and paid AI stays disabled. Do not use paid setup, verification purchases or trials as a workaround.

## Tenant read-only Google pilot (development candidate)

This separate path extends the existing Clients → Business brief and prospect review panel. It does not inherit the founder/public-booking credentials, send email, create calendar events, scrape the inbox, or provision OAuth through the UI. Start with Ripe Piper as one ordinary tenant. Do not activate on production as part of development checks.

Operator setup after mailbox selection and provider consent:

1. Confirm the tenant UUID, dedicated Google mailbox address, explicit calendar ID (not `primary`), permitted-use reference and connection expiry. Use a separate read-only OAuth grant with `https://www.googleapis.com/auth/gmail.readonly` and `https://www.googleapis.com/auth/calendar.calendarlist.readonly`. Keep these separate from the existing global send/calendar grant.
2. Set the **server secret** `GOOGLE_TENANT_CONNECTIONS` in the isolated Worker environment to an array of objects with fields: `id` (stable connection UUID), `tenantId`, `mailbox`, `calendarId`, `purposeReference`, `expiresAt` (timezone-aware ISO timestamp), `enabled` (boolean), `clientId`, `clientSecret`, `refreshToken`. No browser configuration, repository, logs or chat may contain the credentials. A new mailbox identity requires a new connection ID. At most ten bindings, one per tenant; shared mailbox/calendar bindings are rejected. No self-service connection manager or extra credential database is introduced.
3. With an active tenant selected, use **Check inbox and calendar connection**. This checks mailbox/calendar identity and calendar read role; it does not prove message-body scope or booking capability. Choose **Existing business contacts**, select one already-imported permitted contact, find up to ten incoming messages from the last 30 days, preview an excerpt and explicitly review its permitted use before importing.
4. Preview verifies envelope metadata before fetching the selected body. Import fetches again and requires the same reviewed digest. Only plain text is supported; attached/forwarded files, HTML-only messages, ambiguous recipients/senders, sent/draft/spam/trash messages, oversized messages and stale dates fail closed. Review unsupported mail in the mailbox and use the existing manual evidence form. Header matching is not sender authentication or evidence of buying intent.
5. Import records a `human` reply in existing observations and atomically applies existing follow-up holds. It does not mark Gmail read, change labels, infer qualification, resume sequences or send replies. Reimport uses the same source reference. Only a maximum 2,000-character excerpt plus provenance is persisted; truncation is shown. Metadata/preview bodies are transient. Stored excerpts follow the project's existing retention/subject-request controls; automated retention enforcement remains a release gap.
6. Disable a binding (`enabled:false`) or remove it, publish the secret change to the intended environment, and revoke its OAuth grant in Google when retiring it. Expired bindings and paused tenants cannot start reads. Results are discarded when the binding/tenant changes during a request. Secret changes are deployment/configuration operations, not instantaneous cross-instance revocation; already-running persistence must be included in release race testing.

Gmail read-only access is a **restricted scope**. Confirm the exact internal/testing/production verification and security-assessment applicability for the chosen Google project/account before live server-side Gmail data use. An internal-use exception is not assumed for external clients. Do not incur verification/assessment costs beyond the existing budget; manual reviewed evidence remains usable if rollout is blocked. See Google's [scope guidance](https://developers.google.com/workspace/gmail/api/auth/scopes) and [restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification). Calendar identity check uses the documented [CalendarList get](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/get) scope. No grant, live connection or production consent has been verified by fixture tests.

The owner has already identified the test recipient, test calendar and reviewer. Confirm those configured identities during secure setup; do not ask for them again or commit private addresses as fixtures. Google account/organisation eligibility and application OAuth consent still need verification. The owner completes consent when setup is ready; passwords/tokens are not requested in chat.

## Events lifecycle rehearsal (default off)

The existing Clients area has an **Events registration rehearsal** card. Use an existing Events campaign with its current reviewed brief and approved message version; configure title, UTC start/end, display timezone, event-only notice reference, capacity (1–100) and registration intent. Explicit staff review is required. A material settings change invalidates current message approval, cancels queued actions and holds claimed actions; re-review the message plan before reopening registration. Identical settings retries do not create a new event version.

The public metadata and registration handlers remain unavailable unless both `EVENT_REGISTRATION_ENABLED=true` and the existing `SYNTHETIC_SINK_ENABLED=true` are configured in an authorized isolated environment. They only accept `.invalid` contacts, enforce Turnstile outside localhost, and never send mail/calendar events or grant marketing rights. No live deployment setting is changed by committing this code.

A browser-generated random control code is needed for cancellation or acknowledgement of a changed schedule. Keep that code privately; only its SHA-256 digest is stored. Lost response retries use the same identity, event version and code; committed receipt recovery is read-only before repeating verification. A different code cannot recover/control an earlier registration for the same address. Capability changes expire seven days after the retained event end.

Intake remains identity-unverified and unreviewed. It is excluded from prospect qualification and the reviewed product timeline until staff records reviewed source evidence using the existing product history form. Registration is never attendance or a no-show. The event operator card lists the synthetic lifecycle without exposing control codes/digests. Reminder queuing/delivery, real attendee verification, public registration rollout, provider/calendar reconciliation and operational acceptance remain separate open milestones.

## Consultation reminders and attendance review

`CONSULTATION_REMINDERS_ENABLED` is absent/off by default; no configuration or cron is enabled by this change. A future owner-authorized provider release must validate the configured Gmail/Calendar identity and hosted Auth/PostgREST execution first. Uncertain reminder receipts remain held on the existing Meetings detail; this milestone deliberately provides no resend button or automatic retry. A provider may have accepted a message when a network acknowledgement is lost. Cancellation after provider dispatch begins cannot undo that external delivery; the original receipt is retained for review. Legacy reminder timestamps are preserved and labelled acknowledgement-unverified, rather than backfilled as successful receipts.

Ended consultations lacking verified attendance use `attendance_unknown`, which is neither held nor no-show and does not occupy the active-consultation booking index. Existing historical statuses are not backfilled. Notes alone do not advance a lead to meeting_held. Staff use the existing Meetings detail to classify an ended, current booking with a version check, an authoritative evidence reference and reason; no-show additionally requires explicit confirmation of a complete attendance record. Unknown remains a neutral review outcome. Booking identity changes invalidate reviewed attendance and retain prior evidence in the private activity log. Correcting held evidence retracts only its current lead-level meeting_held projection when no other reviewed held meeting supports it; later sales statuses remain intact.

Automated notes-ready email alerts and the legacy WhatsApp side-send are withheld here because they lack independently reconciled receipts. Notes remain visible in Meetings. The consultation migration and rollback checks were rehearsed in isolated staging. No real provider operation, production migration, customer data change or API deployment was performed for this increment.
