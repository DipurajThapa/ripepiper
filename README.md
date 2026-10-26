# Ripe Piper

Ripe Piper provides on-demand B2B lead-generation services: **Ripe Revive**, **Ripe Signal**, **Ripe Response** and **Ripe Events**. Clients book an appointment, then the team configures delivery for them. This repository supports that managed service; it is not a self-service SaaS offering.

The existing static website, Cloudflare Worker API and Supabase migrations are maintained together. All four products have verified development workflows. Hosted API/provider integration and first-customer operational acceptance remain open; the platform is not yet ready for client delivery.

## Development status — 26 October 2026

| Product | Implemented and checked | Still required for operation |
|---|---|---|
| Ripe Revive | Versioned client setup linked to the existing brief, reviewed campaign strategy/audience/copy, working-calendar preview and tenant daily contact cap, permitted import, cited qualification, fenced synthetic execution and outcome reports | Authenticated hosted runtime, real sender/inbox events, tenant calendar, durable A/B allocation, backup/race proof and client pilot |
| Ripe Signal | Reviewed feed intake with correlated receipts, per-trigger freshness/fit review, exact-trigger outcome attribution and guided qualification; multi-source discovery, persisted reviewed strategy/message, exact evidence-bound approval and fenced synthetic execution reuse the existing campaign ledger | Hosted migration/runtime verification, consented live sources, real contact authority and sender/reply/calendar integration. Only the explicit synthetic path is implemented; live execution remains held. |
| Ripe Response | Selected-thread evidence import, staff ownership, versioned resolution, reply holds and reopening on new inbound | Scoped OAuth, live ingress/SLA and calendar acceptance |
| Ripe Events | Default-off synthetic registration, capacity, cancellation, reschedule acknowledgement and reviewed outcomes | Real identity/attendance checks, provider reminders and operational rollout |

Shared payment settlement and consultation reminder/attendance safeguards also pass bounded development checks. Payment notifications remain held for manual review; uncertain sends cannot automatically retry. Paid AI and consultation reminders default off. A synthetic acknowledgement does not prove delivery or conversion.

Implementation CI [39944568353](https://github.com/DipurajThapa/ripepiper/actions/runs/39944568353) passed **438 backend tests, 76 Node checks, TypeScript, frontend syntax, dependency audit and both Chromium workflow programs**. Independent QA verified six corrections. At that checkpoint, the isolated staging database had **19 source-checksummed migrations** and four passing rollback-only SQL acceptance scripts. Actual staging Auth/PostgREST/Worker HTTP acceptance is still pending. [QA evidence](docs/evidence/QA_OPERATIONAL_2026-10-23.md) records the exact tested source and limits.

### Admin CRM workspace — merged and CI verified

The merged PR #8 increment streamlines the existing admin UI with persistent navigation, an overview from loaded records, actionable KPI links, inquiry search/filtering and grouped client workflow panels that retain unsaved inputs. Charts show inquiry status and UTC submission trends, with explicit sample, loading, empty, failed, stale and partial-data states. They do not imply conversion uplift. [Independent QA](docs/evidence/QA_CRM_DASHBOARD_2026-10-24.md) passed ten whole-shell scenarios in local Chromium 153, 14 dashboard checks and desktop/mobile visual review, including a reproduced and corrected mobile navigation overlap. Full local regression passed **927 backend tests / 61 files, 171 Node checks**, zero dependency findings and all product/CRM/Signal rendered programs. Published head `7d431f5`, protected merge `d5a7988` and CI merge `f7351bb` share tree `4fcc07a`. [CI 40119542689](https://github.com/DipurajThapa/ripepiper/actions/runs/40119542689) passed the same 927/61 and 171 counts, audit and all product/CRM/Signal browser programs in Chromium 151; staging was skipped. This is source acceptance; a new live deployment is not verified. This frontend-only increment adds no schema, backend workflow, deployment or live activation.

### Revive Elephant-Goldfish implementation check — 26 October

The existing Revive flow has been checked through context-rich specification, fresh-context review, implementation and regression verification. Repairs align operational reply holds with execution policy, ignore stale dashboard responses, enforce current reviewed fit and actual approver eligibility in SQL, and prevent fabricated synthetic receipts or execution beyond claim/cap/lease limits. Reviewed three-step follow-up sequences and historical receipt replay remain supported. This extends the existing harness; it adds no production autonomous agent or duplicate campaign workflow.

Targeted final SQL checks passed **25/25**, with **347/347 Node checks**, typecheck, preview build and zero dependency findings. Full regression passed **1,155/1,155 backend tests across 71 files** (82.24 seconds). Current hosted browser verification is pending; evidence is recorded in [the Revive QA receipt](docs/evidence/EGM_REVIVE_QA_2026-10-26.md) and [DELIVERY](docs/DELIVERY.md). Migration `20261026041450_revive_egm_execution_guards.sql` is local only. Real sender/reply/calendar integration, hosted identity/concurrency and client operational acceptance remain open.

### Reviewed Signal execution — verified synthetic workflow

The existing campaign workspace now persists a reviewed Signal strategy and exact edited message, binds approval to its SHA-256 evidence/message digest and executes one `.invalid` recipient through the existing fenced synthetic sink. Changing the message creates a new asset version; changing material evidence, recipient, brief or setup invalidates approval and pending work. Current rights, suppression, replies, reviewer eligibility and source expiry are checked again at execution. Historical unbound Signal campaigns cannot approve or run.

Operator path: **Clients → Signal → Prepare strategy → Review in campaigns → review final copy/evidence → Save → reload saved version → approve exact message/evidence → record synthetic rights → queue → test → inspect receipt**. These are product review controls; they do not require additional owner approval for engineering work. Explicit reload reconciles uncertain results using the same campaign/action identity.

Final local regression passed **1,124 backend tests / 69 files and 345 Node checks**, plus typecheck, syntax, preview build and a zero-finding dependency audit. [Independent QA](docs/evidence/QA_SIGNAL_REVIEWED_EXECUTION_2026-10-26.md) reproduced and verified fixes for two direct SQL completion bypasses. Published source `9a4979c` passed [CI 40267077885](https://github.com/DipurajThapa/ripepiper/actions/runs/40267077885): the same 1,124 backend tests and 345 Node checks, zero dependency findings, Chromium installation and all four rendered workflow programs. The actual CRM Signal scenario covers transfer/save/reload/edit/reapproval/queue/test/receipt using intercepted synthetic APIs. The optional staging job was skipped. Chromium remains unavailable locally; hosted CI supplies the rendered evidence for this exact source. Migration `20261026034704_signal_reviewed_execution.sql` adds two columns to existing campaign assets and extends shared guards; it was tested only in local fixtures and has not been applied to a hosted database. See [the contract](docs/LEAD_LIFECYCLE_SPEC.md#93-reviewed-signal-strategy-persistence-and-synthetic-execution) for rollback and limits. Live sending, inbox synchronization, tenant calendar and hosted concurrency/identity acceptance remain open.

### Multi-source Signal discovery — 26 October

The existing Signal workspace now supports configurable industry, geography, keyword/exclusion, target-role and lookback filters. Registered Greenhouse and Lever board adapters collect job evidence; an allowlisted normalized business-feed adapter and reviewed JSON upload cover company posts, supplier requests/RFPs, expansion, product launches, operational problems, directories, event participation, first-party enquiries and referrals. These are company research candidates with unknown contacts and unverified intent, not fabricated warm/hot leads. Source dates, missing dates, deadlines, provenance, partial coverage and held sources remain visible. Posting counts describe only the supplied relevant sample. Downloads recheck expiry.

Source candidate `732ae88` passed **1,069 backend tests / 67 files, 302 Node checks, typecheck, syntax and isolated preview build**. [Independent QA](docs/evidence/QA_SIGNAL_DISCOVERY_2026-10-26.md) tested the Worker and UI logic and verified corrections. Local Chromium installation failed because the official CDN returned an unavailable HTML page; no local browser pass is claimed. Published [PR #9](https://github.com/DipurajThapa/ripepiper/pull/9) source `4d8f55a` passed [CI 40264459041](https://github.com/DipurajThapa/ripepiper/actions/runs/40264459041), including Chromium installation, dependency security and all four rendered product/CRM/Signal programs using intercepted synthetic APIs. The optional staging job was skipped. This verifies the source increment, not live provider operations; see DELIVERY for the exact tree and remaining limits.

Operator path: **Clients → Signal → company discovery → parameters and mode → approved sources or permitted business evidence JSON → review results → download research list**. Server configuration uses `SIGNAL_DISCOVERY_SOURCES` and explicit `SIGNAL_DISCOVERY_FEED_HOSTS`; no credential or arbitrary fetch URL is accepted from the browser. The [improved prompt, source contracts and Ripe Piper operating recipe](docs/LEAD_LIFECYCLE_SPEC.md#92-parameter-based-multi-source-business-discovery) define configuration and limits. The normalized feed is not a native integration with every directory, tender portal, social platform or RSS service. Global search, distributed polling/rate coordination, source licences and hosted egress validation remain separate integration work. No source is activated, campaign enrolled or message sent by this increment.

### Signal strategy preparation — local feature branch

The Elephant-Goldfish pilot separates context-rich design from fresh comprehension/readiness review and independent implementation QA. On branch `feature/signal-strategy-egm`, application commit `43f5d2f` adds **Clients → Signal → Prepare strategy** for eligible leads. Operators see one message proposal, exact recipient/sender, source evidence, hypothesis, versions and expiry. Preparation makes no writes, grants no contact authority and sends nothing. Current fit, reviewed setup, replies, suppression, evidence mode and data drift are checked before display.

Full local checks passed **1,016 backend tests / 66 files and 242 Node tests**, typecheck, syntax and isolated preview build. Independent QA found and verified corrections for two UI validation defects. At that local preparation checkpoint, rendered-browser execution was **NOT RUN** because the pinned Chromium executable was absent. Hosted CI 40264459041 subsequently passed the combined preparation/discovery source and rendered checks; exact publication evidence is recorded in DELIVERY. It is not operationally accepted. See the [design and boundaries](docs/LEAD_LIFECYCLE_SPEC.md#91-elephant-goldfish-pilot-signal-strategy-preparation), [independent QA receipt](docs/evidence/EGM_SIGNAL_PREPARATION_2026-10-26.md) and [delivery record](docs/DELIVERY.md). Persisted strategy approval and synthetic execution are now covered by the later reviewed-execution increment above; live sending/reply/calendar integration remains incomplete.

### Earlier Signal review increment — 25 October

The RP-030 audit found collapsed trigger histories, unscoped outcomes, incomplete receipt checks and a generic Signal execution path that lacked trigger qualification. The feature now presents each trigger separately, binds new outcomes to that trigger's tenant/contact/evidence mode/time, validates source/import identities and guides staff through existing qualification. Older unscoped or orphaned outcomes remain unattributed. API and SQL guards hold new, queued and claimed Signal execution until a complete trigger-bound strategy path is accepted.

[Independent QA](docs/evidence/QA_SIGNAL_REVIEW_2026-10-25.md) reproduced the baseline failures and passed actual Worker→local SQL import/replay/review/outcome, adverse-scope and whole-CRM browser checks. Full local regression passed **957 backend tests / 64 files and 193 Node checks**, typecheck, syntax, preview build, zero dependency findings and all product/CRM/Signal browser programs. The first published CI run, [40123876235](https://github.com/DipurajThapa/ripepiper/actions/runs/40123876235), passed 956 backend checks but hit a five-second timeout in the full-schema rollback fixture; later stages were skipped. PostgreSQL/WASM concurrency is now bounded to two workers, retaining every assertion and timeout; the corrected full local run passed all 957 checks across 64 files. The corrected published head `e2cb80b` subsequently passed [CI 40124223636](https://github.com/DipurajThapa/ripepiper/actions/runs/40124223636), including the 957 backend checks and four rendered programs, as recorded in DELIVERY. The 28th migration is local only; hosted staging remains at its historical 23-migration checkpoint. No live source, outreach or paid service was activated. Scope, rollback limits and remaining development order are in [DELIVERY.md](docs/DELIVERY.md#rp-030--signal-trigger-review-and-safe-handoff-2026-10-25).

### Revive development increment — PR #8

[PR #8](https://github.com/DipurajThapa/ripepiper/pull/8) is merged into `main` at `d5a7988`, extending the existing Clients workspace and execution ledger. The earlier workflow HTML describes the pre-increment source `65b10c5`. Current implementation and acceptance are tracked in [DELIVERY.md](docs/DELIVERY.md) and the [independent Revive QA receipt](docs/evidence/QA_REVIVE_2026-10-23.md).

The client setup and campaign strategy increment is verified locally. Staff save a draft or reviewed operational setup against the existing brief, then save strategy, audience and copy on the existing campaign asset; one approval covers them together. Working days, timezone, spacing, expiry and the tenant-wide daily distinct-contact cap apply at planning, enrolment and execution. [Independent QA](docs/evidence/QA_REVIVE_SETUP_STRATEGY_2026-10-24.md) verified the actual Worker→local SQL journey, strict receipts, invalidation, calendar/capacity boundaries and UI logic. The frozen full regression passed **927 backend tests / 61 files, 157 Node checks**, type/syntax/build/dry-run and a zero-finding audit. All 27 migrations were rehearsed locally; hosted staging remains at its historical 23-migration checkpoint. Published `a0cbdcf` / tree `fd0396d` passed [CI 40112884540](https://github.com/DipurajThapa/ripepiper/actions/runs/40112884540): the same 927 backend tests / 61 files, 157 Node checks, zero dependency findings and both Chromium programs. The optional staging job was skipped.

Operator path: **Clients → existing business brief → Revive setup draft/review → strategy + audience + copy save → draft schedule preview → existing approval + synthetic test rights → approved preview/enrol**. Draft preview is planning with pending authority and reserves nothing. Use the existing account activation action when needed after setup is ready. Website, claims, sender identity/domain and booking URL remain supplied information; no crawl, provider consent or calendar verification is implied. English-only deterministic proposals require current setup; other languages retain manual preparation. Weekly meeting capacity and goal/outcome window are declared planning configuration; the report remains cumulative.

Earlier safety checkpoint, 24 October: generated proposals now record a private server receipt and retain immutable per-asset provenance; each Revive asset has an explicitly reviewed audience that is rechecked through enrolment, claim and completion. Proposal preparation creates that private receipt without approving a campaign or granting rights/sends. [Independent QA](docs/evidence/QA_REVIVE_BINDINGS_2026-10-24.md) reproduced five baseline failures and passed the corrected boundaries, UI logic and amended local rollback packets. The frozen full regression passed **779 backend tests / 53 files, 130 Node checks**, clean installation, type/syntax/build/dry-run and a zero-finding dependency audit. Local schema composition has 25 migrations; hosted staging remains at the historical 23-migration checkpoint. That safety increment subsequently passed CI 40089001810 at `a1ab30c` / tree `b9ee0d6`; new setup/strategy changes are not covered by that receipt. Baseline `eef85fd` / tree `55795cf` and [CI 39997711665](https://github.com/DipurajThapa/ripepiper/actions/runs/39997711665) 686/122 are historical evidence. Production and provider activation remain outside this milestone.

After current setup, staff activate the account when required, review cited fit/history, accept the evidence snapshot and approve the exact strategy, audience, messages and scoped contact rights. When explicitly enabled in an isolated environment, the existing scheduled Worker can enrol accepted contacts and execute due synthetic steps without repeated button clicks. Changed evidence, identity, brief, review version, suppression, reply holds or expired authority prevent execution. Uncertain results require receipt inspection and cannot automatically resend. Outcomes can reference the exact acknowledged action; synthetic rehearsals remain separate from commercial results.

Both `REVIVE_AUTOMATION_ENABLED` configurations remain `false`. This coordinator has bounded batches, per-request timeouts and a work-scheduling deadline; it does not establish an execution SLA. The earlier three-migration Revive checkpoint brought isolated staging to 22 migrations ([retained manifest](docs/evidence/REVIVE_STAGING_MIGRATIONS_2026-10-23.json)); the draft-provenance continuation now brings it to **23**. The new [draft manifest](docs/evidence/REVIVE_DRAFT_STAGING_2026-10-23.json) links exact source/stored-statement hashes and independent rollback-only checks. Production schema and public configuration were not changed. The public [admin Clients page](https://ripepiper.pages.dev/admin/#clients) still shows sample data; live sign-in requires the separately verified application Auth/API setup. No real outbound email sender, automatic inbox ingestion or tenant meeting-booking bridge is activated by this increment.

Earlier contact/draft/report checkpoint, 23 October: the continuation added bounded **CSV/TSV file preview and reviewed import** (50 contacts / 64 KiB), **deterministic evidence-linked cohort drafts** with an optional reviewed HTTPS booking link, and a **read-only campaign outcome report** separating unique contacts, actions, synthetic/business records and unattributed outcomes. Drafts retain existing save/version/approval controls; a supplied link does not verify calendar availability. The service-only provenance wrapper atomically rechecks accepted review, brief, source, expiry and business identity before saving through the existing campaign function. [Independent QA](docs/evidence/QA_REVIVE_INTAKE_2026-10-23.md) passed **686 backend tests / 49 files, 121 Node checks and TypeScript**, plus selected real PostgreSQL draft controls and rollback/zero-residue checks on staging's 23-migration schema. Published `0310fa6` / tree `6445139` passed [CI 39996753214](https://github.com/DipurajThapa/ripepiper/actions/runs/39996753214), including both rendered programs; the separate staging job was skipped. Review also found Q-RI003: the prepared HTTP fixture runner inserted active accounts directly, conflicting with reviewed activation. It now uses onboarding fixtures and explicitly excludes activation/outbound/provider acceptance. Independent red-to-green verification passed 11 focused checks and all 122 Node checks; backend source remains unchanged at 686 tests. That correction subsequently passed CI 39997711665 at `eef85fd`; the later safety increment passed CI 40089001810; the later setup/strategy increment passed CI 40112884540 as recorded above. Client setup and strategy/policy were completed in the later local increment above. Real delivery/event collection, tenant booking and durable A/B allocation remain tracked work in [RP-020](docs/DELIVERY.md#rp-020-execution-brief-and-necessary-capability-coverage).

## Start here

- [Development and safe preview](docs/DEVELOPMENT.md)
- [Milestones, acceptance criteria and backlog](docs/DELIVERY.md)
- [Architecture, security and deployment audit](docs/AUDIT_2026-10-22.md)
- [GitHub cleanup audit](docs/GITHUB_AUDIT_2026-10-22.md)
- [M01 verification evidence](docs/evidence/M01.md)
- [Current infrastructure and secure staging setup](docs/evidence/INFRASTRUCTURE_READBACK_2026-10-23.md)
- [Platform architecture and integration contracts](platform/ripe-piper-platform/README.md)

## Repository layout

| Path | Purpose |
|---|---|
| `site/` | Existing branded website, portal and admin UI |
| `platform/ripe-piper-platform/src/` | Worker API and provider integrations |
| `platform/ripe-piper-platform/supabase/` | Versioned database migrations and seed source |
| `platform/ripe-piper-platform/test/` | Synthetic database and mocked integration tests |
| `scripts/` | Isolated preview and development safety checks |
| `docs/` | Current audit, delivery record and verification evidence |
| `harness/` | Existing dependency graph, acceptance ledger and role instructions |

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
node scripts/preview.mjs build
# Requires Chromium installed for the committed Playwright version:
# cd platform/ripe-piper-platform && npx --no-install playwright install chromium && cd ../..
node scripts/product-browser-check.mjs
node scripts/signal-browser-check.mjs
node scripts/preview.mjs serve
```

The preview opens at http://127.0.0.1:4173 with sample data and external operations disabled. It does not run a live backend.

## Branches and release authority

[PR #6](https://github.com/DipurajThapa/ripepiper/pull/6) consolidated the verified product changes and documentation into `main` as `1d3bc7c` on 23 October 2026. Its final PR [CI 39965598770](https://github.com/DipurajThapa/ripepiper/actions/runs/39965598770) passed, and Cloudflare reported successful static publication `cacf77b0-93de-48b5-a2a5-6ba9d67dbf23`. The public homepage, staff Clients screen and client portal rendered with the existing branding and sample-data boundary. [Post-merge CI 39965914220](https://github.com/DipurajThapa/ripepiper/actions/runs/39965914220) passed on attempt 2 after an Ubuntu package-download timeout; no checks or source were changed for that retry. Backend activation and client-delivery acceptance remain open.

`main` is protected. PRs #2–#5 were already integrated; their old remote-tracking refs may remain in older checkouts. The earlier 23 October consolidation inventory contained `main` and `feature/live-integration-audit-20261023`. Revive development now uses `feature/revive-autonomous-workflow` / PR #8. See [delivery history](docs/DELIVERY.md) for actual merge/deployment receipts rather than treating this historical inventory as a live branch list.

CI verifies pull requests, main pushes and manual dispatch. Automatic PR/main jobs do not deploy the API or apply migrations. The same workflow has an optional, explicit `deploy_staging:true` job restricted to a non-main branch and the three dedicated staging secrets. Cloudflare's existing Pages integration separately publishes static branch previews and automatically publishes `main` to [ripepiper.pages.dev](https://ripepiper.pages.dev).

The owner explicitly authorized the completed protected PR #6 merge and its existing static Pages publication. This authorization does not apply production database migrations, deploy/activate the API Worker, enable paid services or permit prospect communications. Keep `site/assets/config.js` blank with `live:false` until the relevant runtime/security acceptance and activation are authorized. The last inspected production database had only its three original migrations; the separate `ripepiper-staging` project now contains 23 applied migrations, including draft provenance. This does not activate an application or sender.

The next integration action is the [secure staging setup](docs/evidence/INFRASTRUCTURE_READBACK_2026-10-23.md#secure-worker-setup-required-from-the-owner): three dedicated GitHub Actions secrets, then an explicit non-main workflow dispatch. A Cloudflare dashboard login alone does not provide deployment credentials. New incremental service spend recorded for this development cycle is **US$0**; prior AI-provider usage remains unreconciled against the **US$20 total** budget, so paid AI stays disabled. Historical audit reports are retained as dated evidence.
