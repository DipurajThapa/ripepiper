# Staging parity preflight — 27 October 2026

Read-only preflight complete. No hosted migration or fixture executed by this preflight. Base HEAD: `d3075179d97d85405771f7582ca7c20456d1b371`; inspected working candidate includes four untracked 20261027 migrations, identified by hashes below. This is not a claim that all files exist in that commit. Target exclusively `ripepiper-staging`, `wgomywhuzyboxlckopca`; production `jtoafjjszqqrtwerxspw` was not queried or modified.

## Observed baseline

- Project ACTIVE_HEALTHY, PostgreSQL 17.11.0.003, ap-southeast-1.
- Hosted history has **25** entries, including source `20261024105646_revive_draft_source_receipts` at hosted version `20261026131138` and `20261024105757_revive_campaign_audience` at `20261026131144`. The older 23-entry documentation is historical.
- All 25 single stored-statement MD5 values match current repository SQL after CRLF-to-LF normalization. All 19 SHA-256 values in the initial migration manifest also match LF source. Preserve LF when applying from Windows.
- Metadata confirms existing Revive receipt/audience functions are security invoker with fixed empty search paths; later setup/Signal/agency objects are absent. History hashes are not a complete schema-drift proof.
- Aggregate-only counts: zero tenants, auth.users, leads, profiles, outbound_actions, sheet_outbox and build_usage. No private row contents or secrets retrieved.
- Security advisors: two informational no-policy notices on private build_budget/build_usage, and three warnings on authenticated current-user is_admin/is_member/is_owner helpers. This matches the documented baseline; it is not a clean-advisor claim.

## Exact append order

Apply sequentially after current-source regression acceptance. Paths are under `platform/ripe-piper-platform/supabase/migrations/`. SHA-256 values cover UTF-8 LF source. Preserve existing `ripepiper_` hosted name prefix and the full source stem, record returned hosted versions and compare stored-statement hashes. Do not replay the first 25 or repair history to force hosted timestamps to equal filenames.

| Order | File | SHA-256 |
|---|---|---|
| 26 | `20261024161910_revive_client_setup.sql` | `9095af247b7c4620c019e29ea5bb03f88820ec9b7a81fd00495ea0d775847e93` |
| 27 | `20261024162439_revive_strategy_schedule.sql` | `d22e08e86559550b1237b90f4fc413214b38c11e84c985c80bfba9c0339f5c52` |
| 28 | `20261024185356_signal_trigger_review.sql` | `70dc1668c2cdb004f0efb227b2da044dcd755d566afd995aec4ac7ca7060a518` |
| 29 | `20261026034704_signal_reviewed_execution.sql` | `1e225ee11e07aa967bfab07f9456eab72fd38ccf82c7a4c1b789fcefb641ae52` |
| 30 | `20261026041450_revive_egm_execution_guards.sql` | `eef81d1890d9a221b97017c775cf07d62c8675269e918d2556ef3428c1492e3c` |
| 31 | `20261027000000_scope_sheet_outbox.sql` | `cc0a7eb03e256c0398355a2363fa3057f90ee7a05a3f79604c64f6b8609231e6` |
| 32 | `20261027000001_atomic_consultation_reservation.sql` | `5c265c5c3ca609413c98b93327b21f2b16c33a23746dfda735108bb7ef81eb20` |
| 33 | `20261027000002_agency_opt_out.sql` | `906f1b8519c8a3b27386fbb2c0b3713e3d57e5055b5e4e1448866a1ab0475b0c` |
| 34 | `20261027000003_gmail_pause_fence.sql` | `e12e624c7a6683639856d66bffaf6fd88fc969ac27095a2e3fc3a36c4b2e3803` |

Setup/strategy replace shared guards; Signal precedes the Revive EGM function that calls Signal fact validation. Final four migrations narrow sheet triggers, add atomic reservation, add agency suppression/newsletter functions, and fence Gmail import. These SQL files do not call external providers. Consultation/agency SECURITY DEFINER functions have empty search paths and service-only EXECUTE; explicitly verify grants. Agency tables have RLS and revoked public/client access. Do not add broad policies merely to suppress informational notices.

## Verification sequence

1. Recheck project identity, history, empty baseline and source hashes immediately before execution. Single integrator only. Accept fresh local full-schema rehearsal (`test/migration-upgrade.test.ts`) and relevant Revive/Signal, sheet, consultation, agency and Gmail tests. This preflight did not run regressions.
2. Append the nine migrations in order. Stop on error, inspect confirmed history/state and correct forward. Never automatically reset/delete hosted schema.
3. Expect 34 history entries; compare stored hashes, inspect RLS and function grants/security/search_path, and explain advisor deltas.
4. Run each existing `qa/staging-*-rollback-acceptance.sql` separately and sequentially as one complete BEGIN/DO/ROLLBACK query. Never split into committed calls. Fixtures use synthetic identities; shared packet arms a synthetic budget inside its rolled-back transaction. After error verify rollback before continuing. Database/empty-state guards do not prove project identity: pin connector project_id to staging.
5. Recheck aggregate residue on every fixture table: auth/users/profiles, tenants/membership/activation, lead/source/observation/rights, campaign/assets/actions, Revive/setup/reviews, event receipts, meeting/reminders, billing/quote/invite/payment, activity, sheet_outbox, build_usage. Confirm budget remains disabled. Capture results and hashes without fixture payloads.

| Existing packet under `qa/` | SHA-256 (LF) |
|---|---|
| `staging-billing-rollback-acceptance.sql` | `098bd385ce2e0b959aca6443e3968cdbf7415d9ecbd9dba8fcf455defab9cd2f` |
| `staging-consultation-rollback-acceptance.sql` | `0842e2b4e88cea8473c75294769aed1a1156f7f968387e0d2bf27dce122c18e5` |
| `staging-events-rollback-acceptance.sql` | `dba81b713ccf61b28c8a5184874b4709baf1d94ed1ec25a639378b786827e60d` |
| `staging-revive-draft-rollback-acceptance.sql` | `68276dc6b9554dddd54d924ae044ba4b9490241ec4549dc9f588ae27f9b78d99` |
| `staging-revive-rollback-acceptance.sql` | `0b33e5089daa50fc097bd0afd36ffa4b6a365c3ec57da351a01cb8b75a592a06` |
| `staging-rollback-acceptance.sql` | `dc951dca06926a9dab3f5893a27893b846dcd28fbbd7f55c6ca161c90a409605` |

Current Revive/shared packets have amended setup/strategy/audience fixtures. Historical hosted passes do not certify these hashes. Existing packets do not exhaustively cover new Signal, agency-opt-out, reservation or Gmail contracts; new hosted assertions need separately reviewed rollback-only fixtures and receipts. Local tests must not be relabeled hosted acceptance.

## Limits and recovery

No Worker deployment, Auth API fixture creation, credential retrieval, automation activation, external sends or production changes. `scripts/staging-http-acceptance.mjs` is a separate bounded Auth/PostgREST/Worker test with persistent synthetic creation/cleanup; it is not rollback-only SQL and requires dedicated staging secrets/runtime identity. Do not implicitly include it here.

Rollback protects fixtures, not applied DDL. Preserve source/history before any separately scoped environment reconstruction. No backup/restore, multi-connection race, provider delivery or operational release acceptance is established.

Current [Supabase migration documentation](https://supabase.com/docs/guides/deployment/database-migrations) was checked for history/single-deployer guidance. Changelog Markdown fetch failed (web content-type rejection, shell DNS unavailable). No implementation API was changed during this read-only inspection.
