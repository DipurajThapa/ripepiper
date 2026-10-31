# Ripe Piper

Ripe Piper provides B2B lead-generation services in two operating modes on one codebase. **Managed:** Ripe Piper operators run delivery for a client under access the client (or a signed contract) grants. **Self-service:** the client's own admin runs the same workflows from the portal. The mode is a label on the client account (`tenants.ownership`: `managed` or `client_owned`, shown as Self-service); it never decides access, and switching moves no data.

## Packages

| Package | What it does |
|---|---|
| Ripe Revive | Re-engages a client's existing contacts: reviewed setup, strategy, audience and copy, cited qualification, scheduled execution and outcome reports |
| Ripe Signal | Finds companies showing buying signals from approved sources, reviews each trigger, then prepares and executes a reviewed message |
| Ripe Response | Imports selected inbound threads, assigns staff ownership and tracks resolution |
| Ripe Events | Event registration, capacity, cancellation, rescheduling and reviewed outcomes |

The product behaviour of the full lead lifecycle is specified in [docs/LEAD_LIFECYCLE_SPEC.md](docs/LEAD_LIFECYCLE_SPEC.md).

## Architecture

| Path | Purpose |
|---|---|
| `site/` | Static website, client portal (`site/portal/`) and admin UI (`site/admin/`), published by Cloudflare Pages. Client admins in self-service mode get the same workflow panels in the portal, fixed to their own client |
| `platform/ripe-piper-platform/src/` | Cloudflare Worker API, scheduled jobs and provider adapters |
| `platform/ripe-piper-platform/supabase/` | Supabase (PostgreSQL) migrations and seed source |
| `platform/ripe-piper-platform/test/` | Vitest suites against a synthetic database and mocked providers |
| `scripts/` | Preview build, browser checks, dependency audit and safety checks |
| `qa/` | Rollback-only SQL acceptance scripts for staging |
| `harness/` | Delivery dependency graph, acceptance ledger and agent rules |

`site/assets/config.js` keeps `live: false` until the API, Supabase and security setup are configured. Platform routes, environment variables, flags, migrations and cron jobs are documented in [platform/ripe-piper-platform/README.md](platform/ripe-piper-platform/README.md).

## Roles

| Role | Stored as | Can do |
|---|---|---|
| Platform admin | `profiles.is_admin` | Platform work only: create, pause and activate clients, billing, subject requests, global stops, the counts-only client overview. No access to a client's contacts, campaigns, messages or credentials without a grant. |
| Operator | `profiles.is_operator` plus an active row in `operator_grants` | Whatever the grant lists (`read`, `operate`, `approve`) for that one client, until it expires (at most 366 days) or is revoked. `is_operator` alone grants nothing. |
| Client admin | `memberships.role = 'owner'` | Everything in their own client: brief, setup and brand, connections, envelope, campaigns, grants to operators, mode switch, member roles, export and ending the service. |
| Client user | `memberships.role = 'viewer'` | Read only, own client. |

One SQL predicate, `ripepiper_private.can_operate(tenant, actor, capability)`, decides tenant access for every RPC and, through `requireTenant` in the Worker, every tenant route. A denied request gets the same `404 Not found.` as a missing client. A grant comes from the client admin (`client_admin`) or from a platform admin with a contract reference (`contract`); no one can grant themselves. Grants are append-only, and each grant and revoke appears in the client's activity log. The last owner of a client cannot be demoted.

## Status

All four packages and the hybrid operating model (grants, operating envelope, tenant brand, connection registry, shared reference store, offboarding) run end to end in development with synthetic data. `test/hybrid-acceptance.test.ts` proves the seven owner acceptance tests against the real migrations and Worker handlers with the network stubbed. The platform is not yet ready for client delivery:

- Production deploys are blocked on purpose (`npm run deploy` is blocked; the pre-push hook blocks pushes to `main`).
- Provider jobs and the new flags (`OAUTH_ENABLED`, `TENANT_SEND_ENABLED`, `OFFBOARD_PURGE_ENABLED`) default off. Real secrets, OAuth apps, connection keys and payment keys are not configured.
- No client mail is sent: execution ends in the synthetic sink, and the tenant send adapter is not yet called by any route or cron.
- The eleven newest migrations have not been applied to any hosted database.

Current status, backlog and release blockers are in [docs/DELIVERY.md](docs/DELIVERY.md). Historical audit and evidence reports were removed from the tree; they remain retrievable at commit `ff7a80c` (for example `git show ff7a80c:docs/evidence/M01.md`).

## Documentation

- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md): local setup, tests, CI, preview build and staging deploy
- [docs/DELIVERY.md](docs/DELIVERY.md): delivery status, backlog, blockers and owner actions
- [docs/LEAD_LIFECYCLE_SPEC.md](docs/LEAD_LIFECYCLE_SPEC.md): lead lifecycle product spec
- [platform/ripe-piper-platform/README.md](platform/ripe-piper-platform/README.md): platform internals
- [docs/CTO_GOVERNANCE.md](docs/CTO_GOVERNANCE.md), [harness/AGENTS.md](harness/AGENTS.md): delivery governance and agent rules
