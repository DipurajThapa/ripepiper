# Infrastructure readback — 23 October 2026

Read-only CTO inspection through the connected Cloudflare browser and Supabase connector. No deployment, DNS, binding, secret, schema, customer row or permission was changed. This updates the uncertainty in the earlier live audit without rewriting its historical evidence.

## Cloudflare facts observed

- Workers & Pages account inventory reports **Showing 1–1 of 1**: the `ripepiper` Pages project only. No API Worker is present in this selected account. This is not a claim about other accounts.
- Pages production source is `main` at `6b84b389610ca712c5e78284d8446141623ea2e5`, deployment `72d6c30d-1820-414e-9a62-e3e006c964b8`. Automatic production deployments are enabled. Development PR updates create previews; they do not authorize main publication.
- Build configuration is `exit 0`, output `site`, root `/`. Production Variables and Secrets table is empty; no resource bindings are listed.
- Custom domains shows the setup prompt and no configured domain. The project hostname is `ripepiper.pages.dev`. Consequently, the repository's `ripepiper.com` Worker route declarations do not prove routing on this Pages project.
- The actual public Pages home rendered successfully in the connected browser, preserving the existing branding. A separate command-line GET reader returned 403 for home, `/api/slots` and `/assets/config.js`; those reader failures are not evidence of a site outage or API response type.
- Account usage panel shows 0 Worker requests, CPU and build minutes for the displayed period. This is not an invoice reconciliation and does not establish the total attributable build charges across providers.

## Supabase facts observed

Project `jtoafjjszqqrtwerxspw` is ACTIVE_HEALTHY, PostgreSQL 17.6.1.166. Migration list remains only `20261019134626`, `20261019134629`, `20261019134633`. The repository's newer tenant/product/security migrations are unapplied there.

Current security advisor warns about a mutable `touch_updated_at` search path, `btree_gist` in public, and baseline SECURITY DEFINER functions executable by anonymous/authenticated roles. Existing forward migrations address part of the baseline hardening; the combined upgrade and grants need isolated hosted verification before any production application. No live repair was attempted. Advisor remediation references:

- https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable
- https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public
- https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
- https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable

## Required integration action

Prepare an isolated backend environment first, bind it to an isolated database, apply/rehearse the reviewed migration manifest there, and deploy the existing Worker to a nonproduction endpoint with minimal secrets. Verify auth, routing, tenant isolation, provider scopes, rollback and read-only health before requesting any production rollout. No replacement site, new CRM or paid service is required by this finding. The exact hosted environment/cost choice remains unresolved; no hourly branch was started.

Until that environment exists, offline provider sinks, local PostgreSQL-compatible rehearsals, browser fixtures, deterministic acquisition/qualification and independent QA can proceed. No product is RELEASED or OPERATING on this evidence alone.

## Billing and backup readback (same read-only session)

Cloudflare Billing → Subscriptions lists Workers Free as Active, with no payment method on file. Invoices and documents reports "No invoices". No attributable Cloudflare charge was found in that account's visible invoice history. This is partial reconciliation only, not a claim about other providers or accounts.

Supabase organization details report plan `free` / `tier_free`; the project dashboard shows nano compute, "No branches", "No backups" and no connected GitHub repository. The UI's generic advisor summary says no issues, while the dedicated live security-advisor connector returns the specific warnings above; those warnings remain the authoritative findings. Neither a free-plan label nor an empty backup summary proves a restorable backup. Prior Anthropic/API or other provider usage remains unreconciled, so paid AI stays disabled. No additional service charges were initiated.

Supabase Billing → Past Invoices lists one US$0.00 paid invoice (13 October 2026), and Free-plan spend cap is enabled. No extra usage charges are enabled in the observed organization. This narrows the known billing record but does not reconcile the separate AI provider history.

## Prepared isolated release packet (not executed)

`platform/ripe-piper-platform/wrangler.staging.toml` prepares the existing Worker code with a distinct staging name, empty custom routes and cron list, placeholder isolated site/calendar, paid AI/WhatsApp off and the synthetic sink enabled. Its configuration acceptance test prevents production-route or credential literals. No production config is edited. The standard npm deploy command remains blocked.

After an isolated Supabase project has been explicitly selected and its cost confirmed, engineering can bind only its database credentials through secure setup, apply the reviewed migration manifest, then use the separately approved nonproduction Worker publication. Never copy production keys or global Gmail send/calendar/payment/AI secrets into this packet. Select tenant-specific read-only grants only after consent. Probe the resulting origin with `node scripts/runtime-probe.mjs https://approved-staging-origin`; a routing pass still reports database/providers as not probed. Independent Auth/PostgREST/RLS and recovery checks must follow before claiming integration acceptance.

Rollback is to stop the staging Worker and remove only its bindings after preserving synthetic test evidence; production routes, project, data and configuration are untouched. No command in this packet was used to deploy.

### Secure Worker setup required from the owner

The existing review workflow now has a default-false, manually dispatched `deploy_staging` input. Its staging job runs only after all verify checks pass, only on a non-main branch, and uses the distinct staging config. PR/push CI never deploys. It matches the exact isolated database URL and embedded legacy JWT role/project claims before publishing; this does not authenticate the keys, then sends secrets to Wrangler through child stdin without printing values. The routing probe is not a database/provider health claim. A subsequent explicit staging-only HTTP fixture checks Auth/PostgREST/Worker boundaries and exact cleanup; see `STAGING_HTTP_ACCEPTANCE_2026-10-23.md`. It is absent from automatic PR execution. This workflow has not been dispatched.

To make this concrete packet executable, the owner completes these credential/access steps (no passwords/tokens in chat):

1. In Cloudflare, create a dedicated API token for the selected account with Workers Scripts Edit only; do not add production DNS/route, billing or unrelated account permissions. Use the narrowest account/resource scope the provider permits and an expiry for testing.
2. In GitHub repository Settings → Secrets and variables → Actions → New repository secret, save that token as `RIPEPIPER_STAGING_CLOUDFLARE_API_TOKEN`.
3. In the **ripepiper-staging** Supabase project, Settings → API keys → Legacy API keys, retrieve that staging project's service_role and anon keys. Store them as GitHub secrets `RIPEPIPER_STAGING_SERVICE_ROLE_KEY` and `RIPEPIPER_STAGING_ANON_KEY`. The validation rejects keys for the production project; never copy production keys. These existing credentials are supplied securely by the owner, not extracted through chat or committed.
4. Once those three secrets are configured, dispatch the existing workflow against the PR development branch from your signed-in GitHub CLI: `gh workflow run ci.yml --repo DipurajThapa/ripepiper --ref feature/live-integration-audit-20261023 -F deploy_staging=true`. The default branch may not yet display the new input in its Actions form. The connected repository tool currently supports inspection/reruns but does not expose first-time workflow dispatch; the local CLI has no GitHub credential. Do not paste a token into chat. Engineering can verify the resulting job and isolated API checks. This publishes only the separately named staging Worker; it does not merge main or change the live Pages deployment.

If the provider requires broader permission than this dedicated staging target, stop and reassess the permission requirement rather than broadening the token silently. OAuth mail/calendar consent remains a later separate user interaction; it is not a prerequisite for the database/API tests.

Final read-only preservation check before PR publication: protected GitHub main remains `6b84b389610ca712c5e78284d8446141623ea2e5`; production Supabase still lists exactly its original three migration versions (`20261019134626`, `20261019134629`, `20261019134633`). All new schema verification targeted the isolated project.
