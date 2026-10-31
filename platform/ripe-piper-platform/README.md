# Ripe Piper platform

The Cloudflare Worker API, Supabase schema and provider adapters behind Ripe Piper. The website, staff console (`/admin/`) and client portal (`/portal/`) live in [`../../site/`](../../site/). For what the product is, see the [root README](../../README.md). For setup, tests, CI and the staging deploy procedure, see [DEVELOPMENT](../../docs/DEVELOPMENT.md). For status and release blockers, see [DELIVERY](../../docs/DELIVERY.md).

## Layout

| Path | Contents |
|---|---|
| `src/index.ts` | Route table and the `scheduled` handler |
| `src/routes/` | Public, proposal/payment, admin and shared HTTP helpers |
| `src/foundation/` | Tenant, Revive, Signal, Response (conversation review), Events, campaign and prospecting workflows |
| `src/lib/` | Provider adapters (Google, payments, AI, ads, Sheets), pricing, DB client, blog rendering |
| `src/jobs.ts` | Cron jobs |
| `src/env.ts` | Every secret and setting the Worker reads |
| `supabase/migrations/` | Postgres schema, RLS and RPCs (39 files) |
| `test/` | Vitest suites on disposable PGlite with mocked providers; fixtures in `test/fixtures/` |
| `wrangler.toml` | Production config (custom routes and cron). Kept for reference; not deployed |
| `wrangler.staging.toml` | Isolated staging Worker: `workers.dev` only, no routes, no cron, site served through the `ASSETS` binding |

`npm run deploy` runs `scripts/blocked-deploy.mjs` and refuses on purpose. `npm run preflight` reports which required secrets and site settings are missing.

## Routes

All routes are in `src/index.ts`. Anything else returns 404 JSON. Staff routes check `profiles.is_admin` server side; portal routes check tenant membership. RLS still applies underneath.

| Group | Routes |
|---|---|
| Health | `GET /api/health` (does not probe the database or providers) |
| Public forms | `POST /api/lead`, `/api/book`, `/api/calculator`, `/api/newsletter`, `/api/opt-out`, `/api/opt-out/confirm`; `GET`/`POST /api/newsletter/confirm`; `POST /api/tenant-unsubscribe/confirm` |
| Events (public) | `GET`/`POST /api/events/:id` |
| Proposals | `GET /p/:id` (`?paid` shows the return page), `POST /p/:id/approve` |
| Webhooks | `POST /webhooks/stripe`, `POST /webhooks/razorpay` |
| Portal | `POST /api/portal/quotes/:id/accept`, `POST /api/portal/accept-invites` |
| Staff: meetings | `POST /api/admin/meetings/:id/reconcile`, `/process`, `/draft-proposal`, `/attendance`; `GET /api/admin/meetings/:id/reminder-receipts` |
| Staff: sales | `POST /api/admin/proposals/:id/send`, `/api/admin/quotes`, `/api/admin/quotes/:id/send`, `/api/admin/payments/:id/receipt` |
| Staff: tenants | `POST /api/admin/tenants`, and under `/api/admin/tenants/:id/`: `pause`, `activate`, `invite`, `brief`, `prospect-evidence`, `prospect-import`, `product-event`, `shortlist`, `campaigns`, `connection`, `conversation-review`, `events`, `signal-source`, `revive-setup`, `revive-review`, `revive-run`, `revive-report`, `actions/:actionId/receipt`, `leads/:leadId/unsubscribe` |
| Staff: other | `POST /api/admin/ads/sync`, `/api/admin/subject-requests`, `/api/admin/actions/:id/test` |
| Blog | `GET /blog`, `GET /blog/:slug` (rendered from `posts`, wrapped in the site's `blog-shell.html`) |

`POST /api/admin/tenants/:id/invite` also changes an existing member's role between owner and viewer through the `set_member_role` RPC; demoting the last owner returns 409. Role rules are in the [root README](../../README.md#roles).

## Configuration

Plain settings are `[vars]` in the wrangler files. Secrets are set with `npx wrangler secret put NAME` and never go in the repo, browser config or logs. The site only receives the public Supabase URL and anon key.

**Secrets**

| Area | Names |
|---|---|
| Supabase | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` |
| Google (founder account) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `CRM_SHEET_ID`, `ADMIN_ALERT_EMAIL` |
| Google (tenant read-only) | `GOOGLE_TENANT_CONNECTIONS` (see below) |
| Signal | `SIGNAL_DISCOVERY_SOURCES`, `SIGNAL_DISCOVERY_FEED_HOSTS`, `SIGNAL_SOURCE_CONNECTIONS` (server-side JSON allowlists; callers cannot supply URLs) |
| AI | `ANTHROPIC_API_KEY`, `AI_COST_POLICY` |
| Payments | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (AED); `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (INR) |
| Ads | `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID`, `META_ACCESS_TOKEN`, `LINKEDIN_ACCESS_TOKEN` |
| Abuse control | `TURNSTILE_SECRET` (without it, Turnstile passes only when `SITE_URL` is localhost or 127.0.0.1) |

**Settings:** `SITE_URL`, `GOOGLE_CALENDAR_ID`, `MAIL_FROM`, `AI_MODEL`.

**Flags.** Each is off unless set to exactly `"true"`:

| Flag | Turns on |
|---|---|
| `PAID_AI_ENABLED` | Paid AI calls. Also needs a valid `AI_COST_POLICY`; otherwise every paid call is refused |
| `CONSULTATION_REMINDERS_ENABLED` | 24h/1h consultation reminder emails (cron) |
| `MEETING_TRANSCRIPTS_ENABLED` | Post-call Meet transcript processing and AI notes (cron) |
| `SHEETS_SYNC_ENABLED` | Google Sheet CRM mirror sync (cron). Supabase stays authoritative |
| `ADS_SYNC_ENABLED` | Daily ad spend import (cron and `/api/admin/ads/sync`) |
| `REVIVE_AUTOMATION_ENABLED` | Revive sequence runs on the 5-minute cron |
| `SYNTHETIC_SINK_ENABLED` | Development-only test action sink; never real delivery. On in staging |
| `EVENT_REGISTRATION_ENABLED` | Public event metadata and registration. Also needs `SYNTHETIC_SINK_ENABLED`; accepts only `.invalid` addresses |

Google Ads sync stays off. It only feeds optional ad spend into the client cost report, no package needs it, and enabling it would need the `adwords` scope on the founder refresh token.

## Cron jobs

Defined in `wrangler.toml` (staging has none) and dispatched by `runScheduled` in `src/jobs.ts`:

- `*/5 * * * *`: Revive automation, consultation reminders, meeting processing and Sheet sync, each only when its flag is on.
- `0 22 * * *` (02:00 Gulf time): ad spend sync, only when `ADS_SYNC_ENABLED` is on.

## Migrations

`supabase/migrations/` holds 39 files: the original `0001`-`0003` plus timestamped migrations. The two newest, `20261031000000_revive_draft_matched_need_only.sql` and `20261031000001_staff_member_role_change.sql`, are not applied to any hosted database. Apply the full ordered set to a new environment, never only `0001`-`0003`. Production migrations need separate owner authorization. Hosted migration timestamps can differ from the repository filenames.

## Provider adapters

| Adapter | File | Notes |
|---|---|---|
| Google | `src/lib/google.ts` | Calendar free/busy and events, Gmail send, Sheets, Meet transcripts, and tenant read-only Gmail/Calendar reads |
| Email | `src/lib/email.ts` | Transactional email text, sent through Gmail |
| Payments | `src/lib/payments.ts` | Stripe (AED) and Razorpay (INR) checkout for the advance, plus webhook signature checks |
| AI | `src/lib/ai.ts`, `src/lib/build-budget.ts` | Claude meeting notes and proposal drafts. Prices always come from `src/lib/pricing.ts`, never the model. Every call reserves budget first |
| Ads | `src/lib/ads.ts` | Read-only Google Ads, Meta and LinkedIn spend |
| Sheets | `src/lib/sheets.ts` | Outbox-driven CRM mirror |

Pricing in `src/lib/pricing.ts` must match the site. The default advance is 10% (`DEFAULT_ADVANCE_PCT`). Uncertain provider outcomes (lost acknowledgements, ambiguous checkout) are held for staff review rather than retried.

### Tenant read-only Google connection

`GOOGLE_TENANT_CONNECTIONS` is a JSON array of up to ten bindings, one per tenant, parsed in `src/foundation/connections.ts`. Each binding has `id` (UUID), `tenantId`, `mailbox`, `calendarId` (not `primary`), `purposeReference`, `expiresAt` (ISO timestamp), `enabled` (boolean), `clientId`, `clientSecret` and `refreshToken`. Mailboxes, calendars and tenants must be unique across bindings. Use a separate OAuth grant with `gmail.readonly` and `calendar.calendarlist.readonly`, never the founder send/calendar grant.

Staff use it from Clients, Business brief: check the connection, then preview and import plain-text replies from an already-imported contact. Import stores at most a 2,000-character excerpt with provenance, records a `human` reply and applies follow-up holds. It never sends, marks mail read or changes labels. Disabled, expired or paused-tenant bindings cannot read. To retire one, set `enabled:false` or remove it, redeploy the secret and revoke the grant in Google.

Gmail read-only is a Google restricted scope. Confirm verification requirements for the Google project before using it with live client data.
