# Ripe Piper remediation report — 2026-10-19

> Historical report retained for traceability. Some findings are superseded. See [current audit](docs/AUDIT_2026-10-22.md), [delivery status](docs/DELIVERY.md) and [verification evidence](docs/evidence/M01.md) before acting on deployment instructions.
## Changed in this revision
- Frontend defaults to simulation/disabled-live unless explicitly enabled, avoiding accidental collection against an incomplete production backend.
- Added Cloudflare Turnstile challenge execution to public form requests for lead, calculator, newsletter, and opt-out, and API base URL support. Live forms require a configured public site key.
- Backend Turnstile enforcement fails closed except when SITE_URL is explicitly local development; newsletter and opt-out now also require verification.
- JSON request bodies are limited after reading, not only from client-supplied Content-Length; JSON must be an object.
- Paid proposal processing now checks currency and valid proposal state; paid quotations validate currency and amount against the quotation.
- Google-calendar bookings are not cancelled solely because the confirmation email fails; email-delivery failures are logged.
- Proposal status is not marked approved before successful payment session creation.
- Added `npm run preflight` to identify required missing service configuration.

## Release blockers still outstanding
- Supabase instance and environment keys must be provisioned, migrations applied, RLS tested, and a backup/restore drill completed.
- Worker and Cloudflare Pages must be deployed with same-origin routing verified; frontend public configuration must be filled in and `live` explicitly enabled.
- Turnstile site key + Worker secret must be deployed and bot protections tested.
- Google OAuth permissions, Calendar, Gmail, CRM Sheet, AI model/key, Stripe and Razorpay webhook configuration must be supplied and verified.
- Service credentials and external test infrastructure are not provided, so real external requests cannot be validated here.
- `npm ci` could not complete in this execution environment. TypeScript check reports missing Cloudflare types and Vitest is not installed; integration tests were therefore not executed.
- Payment webhook duplicate/concurrent processing and multiple side effects should be moved into an atomic Postgres RPC or durable queue before processing real payments. Existing code cannot guarantee exactly-once completion on concurrent deliveries.
- User-reported email opt-out should ideally use an authenticated signed-link flow; bot verification is not proof of email ownership.
- Perform a full SAST/dependency scan, browser E2E, security review, monitoring/alerts, disaster recovery and accessibility testing before release.

## Verdict
NO-GO. Code-level issues fixed where locally feasible. Production operation not verified.

## Configure safely
Do not commit credentials. Use Wrangler secrets / secure provider configuration, and set public site config only after verifying routes, migrations and third-party connections. Execute `npm ci && npm run typecheck && npm test && npm run preflight` in a network-enabled CI environment. Never use a Supabase service role key in browser assets.
