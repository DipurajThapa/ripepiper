# Ripe Piper

Ripe Piper provides managed B2B lead-generation services. Clients book an appointment, then Ripe Piper staff configure and run delivery for them. This repository supports that managed service; it is not a self-service SaaS product.

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
| `site/` | Static website, client portal (`site/portal/`) and staff admin UI (`site/admin/`), published by Cloudflare Pages |
| `platform/ripe-piper-platform/src/` | Cloudflare Worker API, scheduled jobs and provider adapters |
| `platform/ripe-piper-platform/supabase/` | Supabase (PostgreSQL) migrations and seed source |
| `platform/ripe-piper-platform/test/` | Vitest suites against a synthetic database and mocked providers |
| `scripts/` | Preview build, browser checks, dependency audit and safety checks |
| `qa/` | Rollback-only SQL acceptance scripts for staging |
| `harness/` | Delivery dependency graph, acceptance ledger and agent rules |

`site/assets/config.js` keeps `live: false` until the API, Supabase and security setup are configured. Platform routes, environment variables, flags, migrations and cron jobs are documented in [platform/ripe-piper-platform/README.md](platform/ripe-piper-platform/README.md).

## Roles

- **Ripe Piper staff** (`profiles.is_admin`): full control of every client.
- **Client owner**: the client's own admin. Accepts and pays quotations and updates deals.
- **Viewer**: read only.

Only staff change roles, using the existing invite form. The last owner of a client cannot be demoted.

## Status

All four packages run end to end in development with synthetic data, and the checks pass (typecheck, Vitest, Node script tests, dependency audit, rendered browser checks). The platform is not yet ready for client delivery:

- Production deploys are blocked on purpose (`npm run deploy` is blocked; the pre-push hook blocks pushes to `main`).
- Provider jobs default off. Real secrets, OAuth and payment keys are not configured.
- The newest migrations have not been applied to any hosted database.

Current status, backlog and release blockers are in [docs/DELIVERY.md](docs/DELIVERY.md). Historical audit and evidence reports were removed from the tree; they remain retrievable at commit `ff7a80c` (for example `git show ff7a80c:docs/evidence/M01.md`).

## Documentation

- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md): local setup, tests, CI, preview build and staging deploy
- [docs/DELIVERY.md](docs/DELIVERY.md): delivery status, backlog, blockers and owner actions
- [docs/LEAD_LIFECYCLE_SPEC.md](docs/LEAD_LIFECYCLE_SPEC.md): lead lifecycle product spec
- [platform/ripe-piper-platform/README.md](platform/ripe-piper-platform/README.md): platform internals
- [docs/CTO_GOVERNANCE.md](docs/CTO_GOVERNANCE.md), [harness/AGENTS.md](harness/AGENTS.md): delivery governance and agent rules
