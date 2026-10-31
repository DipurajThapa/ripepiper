# Development

Local setup, checks, CI, the safe preview and the staging deploy procedure. Platform internals (routes, env vars, migrations, cron, providers) are in [the platform README](../platform/ripe-piper-platform/README.md). Delivery status and blockers are in [DELIVERY.md](DELIVERY.md).

## Local setup

Use Node 24 (`engines: >=24 <25`) and the committed lockfile.

```sh
git config core.hooksPath .githooks
git config push.default nothing
cd platform/ripe-piper-platform
npm ci --ignore-scripts --no-audit --no-fund
```

No `.env` or `.dev.vars` files are supplied, and both are git-ignored. Do not put production secrets in a development checkout. Do not run the production `wrangler.toml` with remote or deploy commands.

## Checks

Run the same checks CI runs (`.github/workflows/ci.yml`, job `verify`):

```sh
# in platform/ripe-piper-platform
npm run typecheck
npm test                                  # vitest
# in the repo root
find site/assets -type f -name '*.js' -print0 | xargs -0 -r -n 1 node --check
node --test scripts/*.test.mjs            # Node safety and UI checks
node scripts/dependency-audit.mjs         # fails closed if the registry is unavailable
node scripts/preview.mjs build
node scripts/tenant-unsubscribe-browser-check.mjs
node scripts/product-browser-check.mjs
node scripts/signal-browser-check.mjs
```

The three browser checks need Chromium: `npx --no-install playwright install chromium` in `platform/ripe-piper-platform`, or set `PLAYWRIGHT_EXECUTABLE_PATH`. They intercept every request and use synthetic API fixtures only.

Test isolation:

- Database tests run against disposable in-memory PGlite.
- `test/network-guard.ts` replaces `fetch` before every test, so an unmocked network call throws. Provider tests use synthetic mocks.
- These controls stop accidental side effects. They are not a sandbox against malicious code.

## Safe preview

```sh
node scripts/preview.mjs serve    # http://127.0.0.1:4173
```

`preview.mjs` copies `site/` into `.preview/` with blank credentials and `live:false`, adds a sample-data banner and a restrictive CSP, refuses non-GET/HEAD requests and refuses `/api`, `/webhooks` and `/p` routes. It binds to loopback only. It is a UI preview, not a backend. `npm run dev` in the platform folder runs the same command. Delete `.preview/` to reset it.

The Cloudflare Pages build publishes `site/` directly, not `.preview/`, so Pages branch previews do not have the hardened CSP. Keep `site/assets/config.js` blank with `live:false` and commit synthetic content only.

## CI

`verify` runs on every pull request, on pushes to `main` and on manual dispatch. It has no deployment credentials and does not apply migrations.

## Staging deploy

The `staging` job runs only when all of these hold: the run is a `workflow_dispatch` with `deploy_staging: true`, the ref is a branch other than `main`, and `verify` passed. Only `main` exists, so create a fresh branch from `main` and dispatch from it:

```sh
git switch main && git pull
git switch -c staging/<purpose>
git push -u origin staging/<purpose>
gh workflow run ci.yml --ref staging/<purpose> -f deploy_staging=true
```

The job needs three GitHub Actions secrets: `RIPEPIPER_STAGING_CLOUDFLARE_API_TOKEN`, `RIPEPIPER_STAGING_SERVICE_ROLE_KEY` and `RIPEPIPER_STAGING_ANON_KEY`. It then:

1. validates the staging bindings (`scripts/staging-bindings.mjs`), which only accepts the approved staging Supabase URL;
2. builds an isolated site (`node scripts/preview.mjs staging`);
3. deploys the separately named staging Worker with `wrangler.staging.toml`;
4. binds only the staging database secrets;
5. probes the Worker identity (`scripts/runtime-probe.mjs`) and runs the bounded HTTP acceptance (`scripts/staging-http-acceptance.mjs --apply`).

The staging job does not apply database migrations. Staging is not a production release and does not authorize prospect communications.

## Production

Production deploys are blocked on purpose:

- `npm run deploy` runs `scripts/blocked-deploy.mjs` and fails.
- The `.githooks/pre-push` hook rejects pushes to `main` and `baseline/*` tags. It is a local backstop. GitHub branch protection is the real control, and the hook must be enabled on each checkout (see Local setup).
- `npm run preflight` lists missing production service variables and checks the public site config. It changes nothing.

A production release needs explicit owner approval naming the exact commit, environment, migrations and rollback. Rolling back the frontend does not reverse database writes; migrations need their own tested forward repair or restore plan.

## Contribution rules

- Branch from `main`. Do not commit to `main`, force push or delete history. Merge through a pull request with a passing `verify` check.
- Revert with a new reviewed commit. Never rewrite shared history.
- Keep private operational records, real customer data and secrets out of this public repository.
- Use the commit prefixes `feat:`, `fix:`, `docs:`, `test:` and `refactor:`.
