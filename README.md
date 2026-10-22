# Ripe Piper

Ripe Piper provides on-demand B2B lead-generation services: **Ripe Revive**, **Ripe Signal**, **Ripe Response** and **Ripe Events**. Clients book an appointment, then the team configures delivery for them. This repository supports that managed service; it is not a self-service SaaS offering.

The existing static website, Cloudflare Worker API and Supabase migrations are maintained together. Product workflows are still under development; a passing build does not establish production readiness.

## Start here

- [Development and safe preview](docs/DEVELOPMENT.md)
- [Milestones, acceptance criteria and backlog](docs/DELIVERY.md)
- [Architecture, security and deployment audit](docs/AUDIT_2026-10-22.md)
- [GitHub cleanup audit](docs/GITHUB_AUDIT_2026-10-22.md)
- [M01 verification evidence](docs/evidence/M01.md)

## Repository layout

| Path | Purpose |
|---|---|
| `site/` | Existing branded website, portal and admin UI |
| `platform/ripe-piper-platform/src/` | Worker API and provider integrations |
| `platform/ripe-piper-platform/supabase/` | Versioned database migrations and seed source |
| `platform/ripe-piper-platform/test/` | Synthetic database and mocked integration tests |
| `scripts/` | Isolated preview and development safety checks |
| `docs/` | Current audit, delivery record and verification evidence |

## Local verification

Use Node 24. Never supply production credentials to these checks.

```sh
git config core.hooksPath .githooks
git config push.default nothing
cd platform/ripe-piper-platform
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm test
cd ../..
node --test scripts/*.test.mjs
node scripts/dependency-audit.mjs
node scripts/preview.mjs serve
```

The preview opens at http://127.0.0.1:4173 with sample data and external operations disabled. It does not run a live backend.

## Branches and release authority

`main` is the protected production baseline. PR #2 (`review/verify-uploaded-source`) contains existing review fixes. PR #3 (`feature/m01-safe-development`) builds on PR #2 and contains the development safeguards. Both branches contain unmerged work and must be retained until their changes are deliberately integrated.

CI runs on pull requests, main pushes and manual dispatch. Feature branches should have a draft PR for hosted verification. No deployment occurs in CI. Cloudflare separately creates static branch previews through its existing integration.

Production merges, production deployments, production data/schema changes, paid services and external prospect communications require explicit owner approval. Historical root audit reports are retained as history; use the linked current records for decisions.
