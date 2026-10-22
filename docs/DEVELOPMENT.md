# Reversible development and release boundary

Use Node 24 and the committed lockfile. The production baseline is main at d6c1091360eacae7a001e5aa191c850a4df42ff6, Cloudflare deployment 3e9cac07-7187-45fb-ad04-eee282a3c055. Do not move it without explicit owner approval. The M01 branch starts at existing PR #2 head 684e29a9a4730b6eb330cd2cc68b2a878c41f865.

## Local setup and checks

```sh
git switch feature/m01-safe-development
git config core.hooksPath .githooks
git config push.default nothing
cd platform/ripe-piper-platform
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm test
cd ../..
node --test scripts/safety.test.mjs
node scripts/preview.mjs serve
```

Open http://127.0.0.1:4173. The preview is copied from the existing site, overwrites only generated config with blank credentials/live=false, displays a sample-data notice, blocks network connections and form actions through CSP, refuses non-GET/HEAD requests and refuses API/webhook/proposal routes. It binds only to loopback. This is a UI preview, not a working backend deployment. The database tests use disposable in-memory PGlite. Worker flow tests replace every provider with synthetic mocks; an unmocked fetch throws. These controls reduce accidental effects; they are not an OS security sandbox against malicious code.

No .env or .dev.vars files are supplied. Do not add production secrets to development. Do not run the production wrangler.toml with remote development or deployment commands. `npm run deploy` deliberately fails; the owner-approved release procedure must name the exact commit, environment, migration and rollback. The production routing file is preserved for comparison.

## Branch and review rules

- Create `feature/<milestone>-<purpose>` from the current verified integration candidate. Never commit directly to main, overwrite PR #2, force push or delete a baseline.
- Local pre-push rejects main and baseline refs. It is defense in depth, not a replacement for GitHub protection; local config must be set on each checkout.
- Required GitHub main protection: PR, one approval, stale approval dismissal, current `verify` from GitHub Actions, up-to-date branch, resolved conversations, admin enforcement, no force push/deletion. After owner re-authentication, the GitHub branch API confirms main is protected and the verify check is enforced for everyone (GitHub Actions app 15368). Full rule readback remains pending: the connected browser returns HTTP 401 and the integration has no administration permission (HTTP 403). Do not treat the remaining settings as verified until read back. A sole owner cannot approve their own PR; use an independent reviewer for release rather than disabling protection.
- CI runs verification only, without deployment credentials or deployment steps. Passing checks do not authorize release or communications.
- Cloudflare currently builds all non-main branches as public static previews. Keep site config blank/live=false and synthetic content only. The generated hardened preview is a separate CI build/local output; the existing Pages build uses `site`, not `.preview`. Do not confuse these environments or claim the Pages preview has the hardened CSP.
- Do not put private operational records into this public GitHub repository.

## Reversal

Local changes: switch to the recorded main commit in a separate worktree, or discard only explicitly identified new work. Existing source and historical commits remain available. Feature changes can be reverted through a subsequent reviewed feature commit; never rewrite shared history. Remove generated `.preview` to reset local preview state.

Production rollback remains an owner-approved action: select the recorded Cloudflare deployment, verify source/config and compatibility, then restore and smoke-test read-only routes. Database migrations require a separate tested forward repair/restore plan; never assume frontend rollback reverses database writes. No backup or restore operation has been performed.
