# Independent Goldfish QA: bounded prospect snapshot

Date: 27 October 2026, 23:13 Asia/Dubai (19:13 UTC). Reviewer: fresh independent `snapshot_qa` agent, no production-code authorship. Contract read: `harness/AGENTS.md` and `docs/LEAD_LIFECYCLE_SPEC.md` §9.5. Base commit: `d75d211cff3b3ddcfed966a9f8df07f2f0d62ced`; implementation reviewed as uncommitted working-tree files identified below. Environment: Windows, Node v24.12.0, Vitest 5.0.5, local PGlite with Supabase Auth schema stub. No hosted mutation, commit, push, deployment, provider call or real outreach was performed by this reviewer. Incremental external-service cost: zero.

Result: the bounded local implementation passes independent acceptance. No unresolved implementation defect remains in this review. This receipt does not establish hosted-ready or operational-release status. Root/PM owns full-suite acceptance, staging receipts and any protected merge.

## Executed evidence

1. At 23:11:48, a frozen-source run passed **238/238 tests in 13 files**, exit 0, 39.50 seconds. Command from `platform/ripe-piper-platform`:

```text
node node_modules/vitest/vitest.mjs run test/qa-review-snapshot-sql.test.ts test/qa-review-snapshot-receipt.test.ts test/qa-review-snapshot-transport.test.ts test/prospect-snapshot.test.ts test/prospect-snapshot-db.test.ts test/prospecting.test.ts test/products.test.ts test/flow.test.ts test/anvukta-signal-pilot.test.ts test/qa-signal-workflow.test.ts test/signal-strategy.test.ts test/revive-egm-positive.test.ts test/qa-revive-egm.test.ts
```

2. Development subsequently added a final route catch for a demonstrated legacy product validator exception. After that final production change, at 23:12:58 the affected route, flow, receipt and transport run passed **97/97 tests in 4 files**, exit 0, 1.84 seconds:

```text
node node_modules/vitest/vitest.mjs run test/qa-review-snapshot-receipt.test.ts test/qa-review-snapshot-transport.test.ts test/prospect-snapshot.test.ts test/flow.test.ts
```

The SQL migration, snapshot validator and Db transport hashes were unchanged between those runs. Do not add 238 and 97 as unique test coverage. The final independently authored tests total **29**: 13 SQL, 10 receipt/route, 6 transport. The 13 SQL tests ran in the first receipt against the unchanged final migration; the 16 receipt/transport tests ran after the final route change.

Independent coverage includes:

- Full production migration chain with before/after unchanged-fixture comparison of `revive_input_snapshot`, `signal_strategy_context`, and `revive_review_context`.
- Exact 100/101 verified admin-owner and tenant-owner boundaries; raw unverified 101-candidate caps before eligibility filtering; admin/tenant-owner deduplication, viewer and foreign-owner exclusion, and oversized owner email capacity.
- Missing stored metadata for each of the four input tables, simulated only by rolling back isolated schema-corruption fixtures; generated values reject direct writes.
- A 2 MB highly compressible JSON fact produces only the capacity envelope. `EXPLAIN (ANALYZE, VERBOSE, FORMAT JSON)` of the actual scalar query body confirms all four wide success `jsonb_agg` nodes have **Actual Loops = 0** on that failed numeric gate.
- A 2 MB unrelated lead name is neither projected nor counted, while the selected fields remain intact. Email suppression, tenant/lead suppression and unsubscribed stops are complete; actor mismatch and anonymous/authenticated direct RPC calls are denied.
- Prototype status values, mixed-case receipt UUIDs, bounded-byte deeply nested JSON, unsubscribed/stop inconsistency, exact timestamp tolerance boundaries, and a two-contact case where a later malformed product must discard the earlier computed candidate.
- Actual Db transport, including split UTF-8, exact byte ceiling and ceiling+1, cancellation, malformed UTF-8/JSON, error-body ceiling, and eight-second stalled-header/stalled-body deadlines.

Developer-authored boundary tests were independently executed and inspected: 100/101 leads; 999/1000 observations; exact 8192/8193 lead, 65536/65537 observation, 262144/262145 brief, 4096/4097 profile, and 1048576/1048577 total raw byte boundaries; malformed/missing/foreign/duplicate receipts; actual 8 MiB response ceiling; no fallback reads. Existing prospect/product, route, Signal and Revive regressions also passed in the 238-test run.

## Findings and disposition

- Reproduced three inherited-property status failures (`__proto__`, `constructor`, `toString`) that threw invalid HTTP status errors. Explicit status comparisons repair them.
- Reproduced UUID case disagreement that silently dropped a conflicting observation and yielded a candidate, plus a scope exception. Canonical lowercase receipt IDs and canonical snapshot scope repair both without changing assessment policy.
- Reproduced a <65 KB deeply nested JSON receipt causing serializer stack overflow outside the acquisition catch. Snapshot validation now fails closed.
- Independently reproduced internal generated metadata leaking from `revive_review_context`. Before/after context equality now passes; Revive fingerprints and Signal context are also preserved.
- Source review identified raw-owner eligibility work preceding the intended candidate gate, and oversized owner emails being omitted. Raw probe gates now precede candidate projection; over-bound owner email returns capacity. Independent final owner tests pass.
- Reproduced an explicitly unsubscribed lead becoming a candidate when its stop ID was missing. The validator now rejects this contradictory receipt.
- Independently checked the developer-discovered legacy nested product exception after the final catch: a valid first contact followed by malformed second contact returns 503 with no partial result list.

`prospecting.ts` and `products.ts` have no diff from the base commit. The route uses one post-acquisition evaluation instant for all assessors and returns both timestamps. A successful read still confers no mutation authority. Source review confirms one SQL STABLE statement, SECURITY INVOKER, empty search_path, service-only grant/revocations, materialized bounded probes, indexed tenant/UUID and tenant/mode/UUID orders, stored bigint UTF-8 payload lengths, numeric gates before success projection, and bounded owner candidate unions.

## Exact SHA-256 receipts

Paths are relative to the repository root. Hashes identify raw file bytes at final review, not a future commit with possible line-ending normalization.

| File | SHA-256 |
| --- | --- |
| `docs/LEAD_LIFECYCLE_SPEC.md` | `923a2a296e4dba57798d751474df7f9c6760b580e1cf1946038c9c43cf1461c7` |
| `platform/ripe-piper-platform/supabase/migrations/20261027190653_safe_bounded_prospect_snapshot.sql` | `6db60918deb44c78cfeb6f086b0f4c282c27489b7d3b3ef6ed2a07619973e380` |
| `platform/ripe-piper-platform/src/foundation/prospect-snapshot.ts` | `7b24288285409e9529d162052610a9e827fcace7749f8b0a4fa1685e45832b22` |
| `platform/ripe-piper-platform/src/foundation/prospecting-routes.ts` | `bde64d496b1eccdee607e8182500afcc0f51445c386b96e4b21d50f29cd0b9a8` |
| `platform/ripe-piper-platform/src/lib/db.ts` | `7e35af0f7cf6dcb60a3d633695c0b102d686efe85918ccb9e5e1d67d8d625ea8` |
| `platform/ripe-piper-platform/src/foundation/prospecting.ts` | `0eec9bdcd1410e6b26803ce2cdd843b50e32084fc58c97282ce15e2f9777afea` |
| `platform/ripe-piper-platform/src/foundation/products.ts` | `c07133e8f0effd1a06fc9a1f76acb351126ab0d666514e3e1177ebca3a9c0358` |
| `platform/ripe-piper-platform/test/qa-review-snapshot-sql.test.ts` | `535d56f1cc4e8cac66d59246eabb63fce2681e8e2a3824b81782127921928e29` |
| `platform/ripe-piper-platform/test/qa-review-snapshot-receipt.test.ts` | `95a4c0e3517742a2a3025e9b35dd1c0cce638c0b85fb6e6c68e1d4a627ef33c5` |
| `platform/ripe-piper-platform/test/qa-review-snapshot-transport.test.ts` | `56427ed3f73114e871dcc65493c31af69bd8782a35db39cc8ab9ddeca326f390` |

## Acceptance limits and rollback

PGlite is not hosted PostgREST, does not prove independent concurrent connections, and does not establish that an eight-second client deadline cancels PostgreSQL work. This reviewer did not verify the hosted authenticator timeout, actual hosted scalar HTTP serialization under a tiny PostgREST cap, or representative hosted query plans showing cap detection without sorting a whole large tenant. The migration has explicit 8-second lock and 30-second statement timeouts and an explicit transaction, but production rewrite/lock cost still requires its own environment-specific rehearsal. Local EXPLAIN evidence proves the oversized branch is not projected in the tested plan; it is not a hosted resource guarantee.

The new migration's three replacement context/fingerprint functions only omit internal metadata, and unchanged-fixture equality proves that local compatibility case. No general concurrency/operating guarantee is inferred from it. Root/PM should retain the known hosted HTTP/deployment and multi-connection acceptance limits even if the later staging SQL rehearsal succeeds.

For local rollback, revert the bounded snapshot source/test changes before use. A failed migration transaction should roll back atomically; this reviewer did not perform an operational rollback against hosted data. Do not remove generated columns while a deployed Worker depends on the new RPC. Hosted rollback, if needed, requires a separately scoped plan after assessing deployment state.

## Integrator line-ending reconciliation

Root independently matched every raw hash above, then calculated the LF-normalized hashes used by Git text normalization and hosted SQL submission. These are byte-format mappings of the same reviewed contents; no behavioral edit is inferred. Files absent from this table already have the same raw and LF hash.

| File | LF SHA-256 |
| --- | --- |
| `docs/LEAD_LIFECYCLE_SPEC.md` | `e6484ed495643d66c0db3f7a28ab8d6d358d02ccbad65afd33830ccbfecc23e9` |
| `platform/ripe-piper-platform/supabase/migrations/20261027190653_safe_bounded_prospect_snapshot.sql` | `5c129cd80a540f3918fd95870db6a8cd0a8cdaa11f56759360c529506e2a7d84` |
| `platform/ripe-piper-platform/src/foundation/prospect-snapshot.ts` | `9544cb4ee93c9c6dc57cab4ad84d6a260754809635c433cc0f54f1f9950a876f` |
| `platform/ripe-piper-platform/src/lib/db.ts` | `e26b7ccfc3ffab2b44064821a91fe741c20b6c700f69911a1d7b979db859f50e` |
| `platform/ripe-piper-platform/src/foundation/products.ts` | `0cda2308fe40eb932375e5943e9d86fe99b694f93d0caa07c045ed347ba9f795` |
| `platform/ripe-piper-platform/test/qa-review-snapshot-sql.test.ts` | `c68debf247d5363959e41d75b4f80173a301dd207605172e6dc67205dfd34607` |
| `platform/ripe-piper-platform/test/qa-review-snapshot-receipt.test.ts` | `30f8b83fe478363972a251e3cd5d3d93a9c30765da06d891365de14e45a1ca53` |
| `platform/ripe-piper-platform/test/qa-review-snapshot-transport.test.ts` | `2389afde4ec6b028296ca4e773c99ccd6bd0027569112944134f8d44b547176e` |
