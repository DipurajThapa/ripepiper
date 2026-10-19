# Ripe Piper production-readiness audit

Decision: NO-GO. Source review is not equivalent to deployment validation.

## Confirmed
- Public forms are simulated outside the ripepiper.com hostname unless explicitly configured.
- Supabase public configuration is empty; portal and admin use sample mode.
- Database migrations and RLS policies exist but have not been applied or tested against a live Supabase instance.
- Payment, Google Workspace, AI, advertising and email integrations require real secrets and provider-side configuration.
- Turnstile verification is bypassed if its secret is unset.
- Test execution was blocked by incomplete npm dependencies (`vitest` missing; Cloudflare types missing).

## Changes in this audited copy
- Added a `live` frontend configuration setting, preserving the existing domain behavior by default.
- Loaded config before site.js on pages that previously did not load it, allowing staging to exercise real endpoints when explicitly configured.
- No design, content, pricing, or business logic changes.

## Release checklist
1. Provision Supabase; apply migrations in order; audit RLS and seed safely.
2. Configure site `assets/config.js` URL/anon key and `live=true` on staging and production.
3. Provision Worker routes, required secrets, cron triggers, and same-origin routing.
4. Configure Google OAuth, Calendar, Meet, Gmail and CRM Sheet access.
5. Configure Stripe/Razorpay and validate signed webhooks and replay handling.
6. Configure AI provider, model availability, permissions, data retention and review gates.
7. Enable Turnstile and Cloudflare WAF/rate limiting; check security headers and CSP.
8. Run npm ci, typecheck, tests, and real end-to-end flows in staging.
9. Test role isolation, concurrent bookings, payment failures, retries, backup restore, and monitoring.
10. Only promote after all critical tests pass; do not infer live readiness from source alone.
