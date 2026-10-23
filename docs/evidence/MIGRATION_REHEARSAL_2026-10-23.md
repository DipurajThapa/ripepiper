# Migration upgrade rehearsal and routing gate — 2026-10-23

## Baseline evidence
Connected Supabase project `jtoafjjszqqrtwerxspw` is healthy, but live history has only the three initial numbered migrations; tenant/lead/profile aggregate counts are zero. No live migration was applied.

## Automated rehearsal
`test/migration-upgrade.test.ts` adds a **disposable PGlite upgrade rehearsal**: apply the repository's three baseline SQL files first, assert empty tenant table, then apply every subsequent SQL file in sorted order. Assert expected runtime tables exist, remain RLS-enabled and no customer is provisioned. The test runs in the existing `npm test` GitHub Actions verify job. It does not claim PostgreSQL/Supabase live compatibility or prove a database backup. The original base files are `0001`–`0003` in Git, versus timestamps `20261019134626`, `20261019134629`, `20261019134633` recorded in Supabase; verify equivalence against actual live schema before production rollout.

## Environment decision
A separate hosted Supabase database branch was **not provisioned**. The provider quoted $0.01344/hour; it is usage-billed and requires explicit informed cost acceptance, within the owner's total capped build budget. A local disposable PGlite database is isolated from production and free, but is not a full hosted integration environment.

## Cloudflare
`wrangler.toml` defines routes on ripepiper.com, not the pages.dev domain. There is no connected Cloudflare deployment-management tool here. The open dashboard home confirms account access but not Worker existence or bindings. Deployed `ripepiper.pages.dev/api/*` routing cannot be established by the Worker route source alone. Treat live HTTP routing as unverified until independent GET/HEAD tests against the target and deployment inventory are recorded.

## Next blockers
1. Record Cloudflare Workers & Pages inventory and production deployment SHA; check Pages assets, assigned Worker routes, secret *presence only*, API GET health and correct 404/fail-closed behavior.
2. Validate baseline-to-current schema equivalence and production foreign-key preflight; obtain backup/restore evidence; rehearse on an independently hosted isolated database before any production DDL.
3. Obtain scoped OAuth consent and sandbox recipient/calendar; prove booking and delivery replay/uncertain handling.
4. Do not activate the first tenant or send prospect messages until these gates are satisfied.
