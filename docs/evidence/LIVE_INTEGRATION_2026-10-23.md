# Live operational integration audit — 23 October 2026

This is a read-only verification of connected services. No production data or schema was changed; no real prospect communication, paid call, or backend deployment was made.

## Verified
- GitHub `main` SHA `6b84b389610ca712c5e78284d8446141623ea2e5`; CI run 39895643022 succeeded. The two old feature branches were fully merged. After the initial check, a fresh branch listing returned only `main`.
- Supabase `jtoafjjszqqrtwerxspw` is ACTIVE_HEALTHY (PostgreSQL 17, Singapore region).
- Database migration versions present: `20261019134626`, `20261019134629`, `20261019134633`. Product/tenant migration files in GitHub have not been applied to this database.
- Read-only counts: 0 public.tenants, 0 public.leads, 0 public.profiles.
- Committed `site/assets/config.js` has empty Supabase URL/key, `live:false` and empty Turnstile key. This is **source configuration**, not proof of the deployed response.
- Worker routes exist in `wrangler.toml`, but runtime deployment/bindings have not been verified. The external reader could not retrieve `ripepiper.pages.dev`, which is not proof the site is down.

## P0 — Largest remaining gap: Operational integration
The four products have synthetic/local foundations and partial human-review stages, but these are not connected into a verified tenant-scoped production lead-to-outcome service. CI proves code checks, not provider or release readiness. **No verified live end-to-end journey exists.**

## First workflow: Ripe Revive dogfooding, with explicit human gates
1. **Environment:** Verify Pages and Worker API routing, secure runtime bindings, backups, migration compatibility and staging isolation. Owner release decision before any production change.
2. **Tenant:** Deploy reviewed migrations to isolated integration environment, test RLS and tenant separation, then seek explicit production migration approval. Provision Ripe Piper through ordinary membership. **Gate:** staff confirms identity, owner roles, offer and qualification brief.
3. **Lead:** Import a small authorized cohort of dormant leads with source, timestamps, dedupe, suppression and channel rights. **Gate:** staff accepts/rejects each lead and documents why. Unknown permission means no outreach.
4. **Message:** Draft exact-version email from approved brief and evidence. **Gate:** staff reviews content, contact, channel, and permitted window; editing invalidates approval.
5. **Dispatch:** Prove sink-mode idempotency, retries, provider acknowledgement, ambiguous result reconciliation, late opt-out and emergency tenant pause. **Gate:** explicit separate authorization for any real sends. Queued never equals delivered.
6. **Outcome:** Attribute response, verified qualified meeting and opportunity to source message/lead with times and staff confirmation. **Gate:** staff approves classification and proposed improvements.
7. **Acceptance:** Same inputs rerun without duplicate sends; test timeout, retry, pause, opt-out, permission revocation, cross-tenant isolation, rollback and audit evidence. Only then attempt approved live pilot.

## Still pending
Cloudflare deploy/route verification; migration backup/preflight/rollout; tenant activation; scoped OAuth/provider consent; delivery acknowledgement and uncertain-send resolution; outcome and conversion validation; monitoring; payment webhook consistency; atomic build-budget reservations before paid calls.

**Decision: NO-GO for external production outreach until these release gates are verified.**
