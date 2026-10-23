# Reversible development and release boundary

Use Node 24 and the committed lockfile. The historical M01 production baseline was main at d6c1091360eacae7a001e5aa191c850a4df42ff6, Cloudflare deployment 3e9cac07-7187-45fb-ad04-eee282a3c055. Do not move it without explicit owner approval. The M01 branch starts at existing PR #2 head 684e29a9a4730b6eb330cd2cc68b2a878c41f865.

Historical M01 baseline above was superseded by the owner's approved PR #3 merge. At that checkpoint production `main` was `7230e5f6e51d7903999991da8ab91984f983a3d5`; Pages deployment is `d27fbc61-dac3-4383-a636-416b491b56a3`. New feature branches start there or from a verified nonproduction integration candidate. The previous PR #2/#3 branches have been merged and removed remotely. Subsequent main merges/deployments still require an explicit scoped owner approval.

Pre-merge baseline (23 October 2026): protected main `6b84b389610ca712c5e78284d8446141623ea2e5`, Pages deployment `72d6c30d-1820-414e-9a62-e3e006c964b8`. The owner subsequently explicitly instructed engineering to push, merge the branches, fix issues and update documentation. This authorizes the protected PR #6 merge and its existing static Pages publication after checks. It does not authorize production database migrations, API Worker activation, paid operations or prospect communications. See DELIVERY.md for the actual merge/deployment receipt; CI alone does not supply release authority.

## Local setup and checks

```sh
git switch feature/live-integration-audit-20261023
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

Open http://127.0.0.1:4173. The preview is copied from the existing site, overwrites only generated config with blank credentials/live=false, displays a sample-data notice, blocks network connections and form actions through CSP, refuses non-GET/HEAD requests and refuses API/webhook/proposal routes. It binds only to loopback. This is a UI preview, not a working backend deployment. The database tests use disposable in-memory PGlite. Worker flow tests replace every provider with synthetic mocks; an unmocked fetch throws. These controls reduce accidental effects; they are not an OS security sandbox against malicious code.

No .env or .dev.vars files are supplied. Do not add production secrets to development. Do not run the production wrangler.toml with remote development or deployment commands. `npm run deploy` deliberately fails; the owner-approved release procedure must name the exact commit, environment, migration and rollback. The production routing file is preserved for comparison.

## Branch and review rules

- Create `feature/<milestone>-<purpose>` from the current verified integration candidate. Never commit directly to main, force push or delete a baseline. PRs #2–#5 are already integrated; do not recreate their obsolete branches.
- Local pre-push rejects main and baseline refs. It is defense in depth, not a replacement for GitHub protection; local config must be set on each checkout.
- Required GitHub main protection: PR, current `verify` from GitHub Actions, up-to-date branch, resolved conversations, no force push/deletion. Active ruleset 25620118 was read back through the GitHub API. The required reviewer count was set to zero under the owner's explicit approval during PR #3 consolidation; prior M01 evidence describing one required approval is historical. No review approval should be invented.
- CI runs on PR changes, main pushes and manual dispatch (open a draft PR for feature verification). Dependency audit retries transient registry failures at most three times and fails closed if unavailable. Automatic PR/main checks run verification without deployment credentials. A separate job in this same workflow requires explicit manual `deploy_staging:true`, a non-main branch and successful verification; it can publish only the separately named isolated Worker, bind only its three dedicated secrets and run the bounded staging HTTP fixture. See [staging setup](evidence/INFRASTRUCTURE_READBACK_2026-10-23.md) and [HTTP acceptance](evidence/STAGING_HTTP_ACCEPTANCE_2026-10-23.md). This reversible nonproduction path does not authorize production release or prospect communications.
- Cloudflare currently builds all non-main branches as public static previews. Keep site config blank/live=false and synthetic content only. The generated hardened preview is a separate CI build/local output; the existing Pages build uses `site`, not `.preview`. Do not confuse these environments or claim the Pages preview has the hardened CSP.
- Do not put private operational records into this public GitHub repository.

## Reversal

### Branch consolidation review — 23 October 2026

GitHub inventory before PR #6 merge contained only `main` and `feature/live-integration-audit-20261023`. Independent Development review of the 15 other local branches found their work already represented by ancestors, equivalent cherry-picks or reviewed integration amendments; no unique source, test or migration file was missing. Representative mappings: consultation `4b022e1` → `2867f15`, Events expiry `9ba7dac` → `b0f265b`, Response validation `3458bd1` → `17c7932`, and paid-record bindings `95941b9` → `fafb98a`. Shared files retain the later combined implementations and QA corrections.

Merge the current integration PR through protection; do not replay obsolete branch versions over the combined tree. Existing local worktrees/history are retained for recovery. The non-main integration branch can remain after merge for the existing manual staging dispatch; it contains no separate product backlog. Branch retention is distinct from unmerged work. GitHub PR #6 and the delivery record provide the actual consolidation receipt.

Local changes: switch to the recorded main commit in a separate worktree, or discard only explicitly identified new work. Existing source and historical commits remain available. Feature changes can be reverted through a subsequent reviewed feature commit; never rewrite shared history. Remove generated `.preview` to reset local preview state.

Production rollback remains an owner-approved action: select the recorded Cloudflare deployment, verify source/config and compatibility, then restore and smoke-test read-only routes. Database migrations require a separate tested forward repair/restore plan; never assume frontend rollback reverses database writes. No backup or restore operation has been performed.
