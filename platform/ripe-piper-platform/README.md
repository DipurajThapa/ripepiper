# Ripe Piper platform

The Cloudflare Worker API, Supabase schema and provider adapters behind Ripe Piper. The website, admin console (`/admin/`) and client portal (`/portal/`) live in [`../../site/`](../../site/). For what the product is, see the [root README](../../README.md). For setup, tests, CI and the staging deploy procedure, see [DEVELOPMENT](../../docs/DEVELOPMENT.md). For status and release blockers, see [DELIVERY](../../docs/DELIVERY.md).

## Layout

| Path | Contents |
|---|---|
| `src/index.ts` | Route table and the `scheduled` handler |
| `src/routes/` | Public, proposal/payment, admin and shared HTTP helpers |
| `src/foundation/` | Tenant, access (grants, mode), operating envelope, connections and OAuth, tenant send, offboarding, Revive, Signal, Response (conversation review), Events, campaign and prospecting workflows |
| `src/lib/` | Provider adapters (Google, Microsoft 365, payments, AI, ads, Sheets), OAuth (PKCE), credential vault (AES-GCM), tenant brand, pricing, DB client, blog rendering |
| `src/jobs.ts` | Cron jobs |
| `src/env.ts` | Every secret and setting the Worker reads |
| `supabase/migrations/` | Postgres schema, RLS and RPCs (46 files) |
| `test/` | Vitest suites on disposable PGlite with mocked providers; fixtures in `test/fixtures/` |
| `wrangler.toml` | Production config (custom routes and cron). Kept for reference; not deployed |
| `wrangler.staging.toml` | Isolated staging Worker: `workers.dev` only, no routes, no cron, site served through the `ASSETS` binding |

`npm run deploy` runs `scripts/blocked-deploy.mjs` and refuses on purpose. `npm run preflight` reports which required secrets and site settings are missing.

## Routes

All routes are in `src/index.ts`. Anything else returns 404 JSON. Routes under `/api/admin/tenants/:id/` call `requireTenant(req, env, id, capability)` (`read`, `operate` or `approve`), which asks `tenant_access` and so `can_operate`: the client admin, a client user for `read`, or an operator with a live grant. A denied caller gets the same `404 Not found.` as a missing client; `test/route-gates.test.ts` checks every tenant route. Platform routes (`requirePlatformAdmin`) cover creating, pausing and activating clients, billing, subject requests, ads sync and the overview. Grants, mode and invites accept the client admin or a platform admin (`requireOwnerOrPlatformAdmin`). The `/api/admin` prefix is historical: client admins call the same routes with their own token. SQL re-checks the actor in every RPC.

| Group | Routes |
|---|---|
| Health | `GET /api/health` (does not probe the database or providers) |
| Public forms | `POST /api/lead`, `/api/book`, `/api/calculator`, `/api/newsletter`, `/api/opt-out`, `/api/opt-out/confirm`; `GET`/`POST /api/newsletter/confirm`; `POST /api/tenant-unsubscribe/confirm` |
| Events (public) | `GET`/`POST /api/events/:id` |
| Proposals | `GET /p/:id` (`?paid` shows the return page), `POST /p/:id/approve` |
| Webhooks | `POST /webhooks/stripe`, `POST /webhooks/razorpay` |
| Portal | `POST /api/portal/quotes/:id/accept`, `POST /api/portal/accept-invites` |
| Agency: meetings | `POST /api/admin/meetings/:id/reconcile`, `/process`, `/draft-proposal`, `/attendance`; `GET /api/admin/meetings/:id/reminder-receipts` |
| Agency: sales | `POST /api/admin/proposals/:id/send`, `/api/admin/quotes`, `/api/admin/quotes/:id/send`, `/api/admin/payments/:id/receipt` |
| Tenants | `POST /api/admin/tenants`, `GET /api/admin/platform-overview` (counts only), and under `/api/admin/tenants/:id/`: `pause`, `activate`, `invite`, `operator-grants`, `mode`, `envelope`, `connections/:provider/authorize`, `offboard`, `GET export`, `brief`, `prospect-evidence`, `prospect-import`, `product-event`, `shortlist`, `campaigns`, `connection`, `conversation-review`, `events`, `signal-source`, `revive-setup`, `revive-review`, `revive-run`, `revive-report`, `actions/:actionId/receipt`, `leads/:leadId/unsubscribe` |
| OAuth | `GET /api/oauth/google/callback`, `GET /api/oauth/microsoft/callback` (tenant and actor come only from the consumed state, which works only in the browser that started it) |
| Other | `POST /api/admin/ads/sync`, `/api/admin/subject-requests`, `/api/admin/actions/:id/test` |
| Blog | `GET /blog`, `GET /blog/:slug` (rendered from `posts`, wrapped in the site's `blog-shell.html`) |

`POST /api/admin/tenants/:id/invite` also changes an existing member's role between owner and viewer through the `set_member_role` RPC (platform admin or the client admin); demoting the last owner returns 409. Role rules are in the [root README](../../README.md#roles).

## Configuration

Plain settings are `[vars]` in the wrangler files. Secrets are set with `npx wrangler secret put NAME` and never go in the repo, browser config or logs. The site only receives the public Supabase URL and anon key.

**Secrets**

| Area | Names |
|---|---|
| Supabase | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` |
| Google (founder account) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `CRM_SHEET_ID`, `ADMIN_ALERT_EMAIL` |
| Google (tenant read-only pilot) | `GOOGLE_TENANT_CONNECTIONS` (see below) |
| Tenant connections | `CONNECTION_KEYS` (JSON `{kid: base64 32-byte AES key}`; keep old kids while rows use them), `CONNECTION_KEY_CURRENT`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` (Google OAuth reuses `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`) |
| Offboarding | `SUPPRESSION_HMAC_KEY` (at least 32 characters; the purge refuses to run without it) |
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
| `OAUTH_ENABLED` | Google and Microsoft 365 connection consent (authorize and callback routes return 404 while off) |
| `TENANT_SEND_ENABLED` | Provider calls from the tenant send adapter (mail and invitations from the client's own connection). No route or cron calls the adapter yet |
| `OFFBOARD_PURGE_ENABLED` | Retention purge of ended clients on the daily cron. `dry_run` only counts |

Google Ads sync stays off. It only feeds optional ad spend into the client cost report, no package needs it, and enabling it would need the `adwords` scope on the founder refresh token.

## Cron jobs

Defined in `wrangler.toml` (staging has none) and dispatched by `runScheduled` in `src/jobs.ts`:

- `*/5 * * * *`: Revive automation, consultation reminders, meeting processing and Sheet sync, each only when its flag is on.
- `0 22 * * *` (02:00 Gulf time): ad spend sync when `ADS_SYNC_ENABLED` is on, and the retention purge when `OFFBOARD_PURGE_ENABLED` is set.

The Revive tick first approves draft campaigns that fit a client's effective operating envelope and pauses campaigns whose stop conditions trip, then enrols and runs actions through the synthetic sink.

## Migrations

`supabase/migrations/` holds 46 files: the original `0001`-`0003` plus timestamped migrations. The eleven newest, `20261027194016` to `20261101000006`, are not applied to any hosted database. `20261101000001` to `20261101000006` add hybrid access, the operating envelope, tenant brand, the connection registry, the shared reference store and offboarding; `20261101000001` rewrites every staff check in place through a counted manifest and fails if any check is missed. Apply the full ordered set to a new environment, never only `0001`-`0003`. Production migrations need separate owner authorization. Hosted migration timestamps can differ from the repository filenames.

## Provider adapters

| Adapter | File | Notes |
|---|---|---|
| Google | `src/lib/google.ts` | Calendar free/busy and events, Gmail send, Sheets, Meet transcripts, tenant read-only Gmail/Calendar reads and token revocation |
| Microsoft 365 | `src/lib/microsoft.ts` | Graph mail (one MIME sendMail call, `Mail.Send` only), calendar events and free/busy for tenant connections |
| Tenant send | `src/foundation/tenant-send.ts` | Client mail and invitations from the client's own connection: sender must equal the connected mailbox, postal footer and unsubscribe link required, connection rechecked before the provider call |
| Email | `src/lib/email.ts` | Transactional email text, sent through Gmail |
| Payments | `src/lib/payments.ts` | Stripe (AED) and Razorpay (INR) checkout for the advance, plus webhook signature checks |
| AI | `src/lib/ai.ts`, `src/lib/build-budget.ts` | Claude meeting notes and proposal drafts. Prices always come from `src/lib/pricing.ts`, never the model. Every call reserves budget first |
| Ads | `src/lib/ads.ts` | Read-only Google Ads, Meta and LinkedIn spend |
| Sheets | `src/lib/sheets.ts` | Outbox-driven CRM mirror |

Pricing in `src/lib/pricing.ts` must match the site. The default advance is 10% (`DEFAULT_ADVANCE_PCT`). Uncertain provider outcomes (lost acknowledgements, ambiguous checkout) are held for staff review rather than retried.

### Tenant connections

`tenant_connections` holds one row per client, provider and account (purposes, granted scopes, status, health, version). Refresh tokens are sealed with AES-GCM in the Worker (`src/lib/vault.ts`, additional data `tenant|connection|provider`) and stored in `ripepiper_private.tenant_connection_secrets`, which browser roles cannot read; nothing returns credential material. A client admin or an operator with `operate` starts consent at `POST /api/admin/tenants/:id/connections/google|microsoft/authorize`; the callback binds tenant and actor from a single-use hashed state with PKCE. Only the chosen purposes are requested: Google `gmail.send` and `calendar.events` with offline access; Microsoft `Mail.Send`, `Calendars.ReadWrite` and `offline_access`. `canSend` and `canBook` are derived from the scopes actually granted. Revoking bumps the version so in-flight snapshots stop; offboarding also revokes the Google token.

### Tenant read-only Google connection

`GOOGLE_TENANT_CONNECTIONS` is a JSON array of up to ten bindings, one per tenant, parsed in `src/foundation/connections.ts`. Each binding has `id` (UUID), `tenantId`, `mailbox`, `calendarId` (not `primary`), `purposeReference`, `expiresAt` (ISO timestamp), `enabled` (boolean), `clientId`, `clientSecret` and `refreshToken`. Mailboxes, calendars and tenants must be unique across bindings. Use a separate OAuth grant with `gmail.readonly` and `calendar.calendarlist.readonly`, never the founder send/calendar grant.

Staff use it from Clients, Business brief: check the connection, then preview and import plain-text replies from an already-imported contact. Import stores at most a 2,000-character excerpt with provenance, records a `human` reply and applies follow-up holds. It never sends, marks mail read or changes labels. Disabled, expired or paused-tenant bindings cannot read. To retire one, set `enabled:false` or remove it, redeploy the secret and revoke the grant in Google.

Gmail read-only is a Google restricted scope. Confirm verification requirements for the Google project before using it with live client data.
