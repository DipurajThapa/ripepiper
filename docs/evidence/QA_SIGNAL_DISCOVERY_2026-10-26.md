# Independent QA: bounded Signal discovery

Reviewer: independent `discovery_qa` agent, 26 October 2026. Acceptance basis: `harness/AGENTS.md` and `docs/LEAD_LIFECYCLE_SPEC.md` §9.2. Development fixes were made by the development agents, not this reviewer.

## Frozen source and disposition

Source commit: `732ae88a0ecbc380a49d1a7838f15ffdcc1625c0`.
Source tree: `d33d0e824a78670f976c6676167954218b837da1`.
The only pending tracked modification when freeze was checked was PM-owned `docs/DELIVERY.md`. This receipt is a subsequent evidence-only addition.

**Local Worker and UI-logic acceptance: PASS for the bounded increment. Rendered-browser acceptance: BLOCKED. Operational release: NOT ACCEPTED.** No remaining reproduced defect in the tested bounded behavior. This is not a claim of native RSS/Atom, social-profile retrieval, proprietary search, complete directory coverage, all live portals, source ownership verification, or hosted operation.

## Independently executed checks

Commands ran from the repository root unless otherwise stated. All providers and database requests in the Worker tests were intercepted. No real provider requests, paid calls, new accounts, production actions or external messages were used. Incremental paid cost: US$0; prior costs remain unreconciled under the existing cap.

| Check | Executed result |
|---|---|
| From `platform/ripe-piper-platform`: `npm test -- --run test/signal-discovery.test.ts test/signal-sources.test.ts test/signal-strategy.test.ts test/qa-signal-workflow.test.ts test/qa-signal-source-receipts.test.ts` | Final frozen-source rerun: 150/150, 5 files, 2.36s |
| `node --test scripts/signal-discovery-ui.test.mjs scripts/signal-ui.test.mjs scripts/qa-signal-ui.test.mjs` | Final frozen-source rerun: 133/133, no skips, 409.60ms |
| Discovery-only verbose Vitest run | 53/53 passed |
| From platform directory: `npm run typecheck` | Exit 0 |
| `git diff --check` | Exit 0 |
| Direct `chromium.launch({headless:true})` using installed Playwright | Failed: missing `/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell` |

The browser executable reported by `chromium.executablePath()` was `/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`; a browser was not launched. Prior installation attempts reported by the parent are not substituted for execution. DOM rendering, real browser downloads and interactive layout remain unverified here. VM-based DOM/event tests are explicitly UI logic evidence, not browser evidence.

The parent separately reported full regression of 1069/1069 backend tests across 67 files and 302/302 Node tests plus preview checks. Those are parent evidence, not independently rerun full-suite claims in this receipt.

## Acceptance coverage

| Boundary | Executed evidence |
|---|---|
| Authentication, tenant and mode | Real Worker entrypoint denies absent staff authentication and inactive/foreign tenant receipts before source access; status and collection isolate two tenants and synthetic/live registries; UI rejects foreign tenant and mode envelopes |
| Read-only authority | Worker mock rejects database writes, unexpected paths, non-GET provider calls and unregistered destinations; safety envelopes deny contact authority, sending and persistence; legacy status/preview/import review guard and strategy tests remain passing |
| Source configuration | Malformed/duplicate/private/unallowlisted/over-limit registry failures; expiry eligibility; empty eligible source set remains incomplete; registry, host allowlist, tenant and approval-expiry drift during collection discard results |
| Provider failures and bounds | 403, 429 and Retry-After; redirects, malformed JSON, MIME/charset/UTF-8, declared/streamed oversized bodies, 101 rows and transport failures held visibly; stalled stream cancels at 15s using controlled clock; full Lever, Greenhouse totals and output cap mark incomplete |
| Business evidence | Both job adapters plus all nine declared business indicators; multi-company feed uses member company/domain, never publisher attribution; expired supplier request excluded; supplier deadline retained and rechecked after collection; null-date directory retained with unknown age |
| Dates and provenance | Invalid/future/old evidence handling, Greenhouse updated label, Lever unknown age; no fabricated emails or buying intent; source IDs, URL provenance, declared industry, neutral job label and desired future buyers preserved |
| Filtering and duplicates | Literal Unicode-boundary phrase behavior, geography and industry filtering, dominant exclusions, misleading role/location cases; repeated records deduplicated, conflicting IDs hold source; company-post activity excludes other indicator families and exact reposts |
| Client state | Duplicate collection serialized; late success/error discarded on tenant, parameters, mode and file changes; stale upload discarded; response identity/schema/count validation; unsafe or fabricated rows cannot render/export; markup remains inert text |
| Existing workflows | Existing Signal import review/receipt checks and strategy preparation eligibility, malformed evidence, stale response and expiry regression tests passed |

Additional independent probes were executed without writing a test file: actual modules were transpiled in memory with TypeScript and provider/DB boundaries stubbed. Assertions passed for uppercase explicit default port, `.corp`, `.localdomain`, hexadecimal IPv4 and IPv6 rejection; `%NAME%` parameter rejection; exactly five sequential provider GETs (maximum concurrent requests 1); exactly two tenant reads; HTTP-date 429 Retry-After between 39 and 40 seconds; no retry, no candidate and incomplete result. The production date validator was loaded from its source for these probes. These supplement the real Worker tests; they do not replace them.

## Defects found and independently verified corrections

1. UI accepted `HTTPS://company.co.uk:443/a` while rejecting its lowercase equivalent. Independent VM reproduction returned `accepted true`. Development made the explicit-port check case-insensitive. Reproduction now returns `accepted false` for both forms; a regression test passed.
2. A supplier request with a near-future deadline remained downloadable after expiry. Independent VM reproduction waited 160ms and produced one blob. Development revalidates the accepted response against current time at download. Reproduction now produces zero blobs and disables download; a regression test passed. The specification explicitly records this requirement.
3. Source review found backend `.corp`/`.localdomain` and percent-template acceptance inconsistent with the UI and contract. Development aligned validation. Independent in-memory boundary assertions and the revised Worker suite passed.

## Limits and rollback

Acceptance covers operator-reviewed configured Greenhouse/Lever boards and allowlisted normalized feeds/exports, including the nine common business indicator families. Source approval references and expiry are deployment/operator declarations. There is no independently verified approval ownership, native portal integration or unrestricted web search. Search suggestions are not executed. No outreach authority or live campaign handoff is granted.

Hosted DNS/egress protections, source-purpose/rights approval, actual configured-source access and durable rate coordination require separate evidence. Rendered browser testing must be rerun when a supported executable is available. This receipt does not advance an operational stage; PM must reconcile the harness ledger and owner authorization separately.

Rollback: revert the feature source commit on the feature branch through normal review. This increment introduces no table, migration, persisted research record or sending action requiring data rollback.

## SHA-256 of reviewed files

```text
2b230b5ebfdaf6ea3200a42c2abf6090a9a380fe0917b3dac5e9e75d0fc5b423  platform/ripe-piper-platform/src/foundation/signal-discovery.ts
7f40ac78d9cae75539cc0bd27d2739d3a448fff26a096478f5b31d2e961036ac  platform/ripe-piper-platform/src/foundation/signal-sources.ts
76094fc1566b53bdb1dc0efc509de3aba5feb39c7a9a37192cc87918a94b4231  platform/ripe-piper-platform/test/signal-discovery.test.ts
69efc4cce501921cd42d4e8fefeb99570e5144715fb7fe72df13648b17914d10  site/assets/signal-discovery-admin.js
a30e877009296f5396afe91fd15c7c995f6bf6817d782fe31670ead21e502701  scripts/signal-discovery-ui.test.mjs
76caacbcf259daa996154b6a2d6b0b29159e014f716b9c70ffbafa9503869b8c  docs/LEAD_LIFECYCLE_SPEC.md
```


## Hosted CI verification follow-up — 2026-10-26

CTO directly inspected GitHub Actions run [40264459041](https://github.com/DipurajThapa/ripepiper/actions/runs/40264459041), verify job 121383661900: SUCCESS for published PR #9 source `4d8f55a9b795dad7a548f42a2333f1b96ffa205f`, tree `91c0ef7f8c658030e6fc53e4afa42c20e767113d`, matching local `9962528`. Typecheck, full regression, dependency security, preview build, Chromium installation and rendered workflow checks all passed. Chromium 151 and its headless shell installed successfully on the hosted runner. Logs contain four PASS receipts for product forms, the complete CRM shell, approved Signal source review/import and the actual CRM Signal workflow. These browser programs use intercepted synthetic APIs; they do not establish live provider or hosted backend acceptance. The optional staging job was skipped.

This resolves the rendered-check gap using hosted CI; the earlier failed local installation remains accurately recorded. No runtime source changed after this verified tree. This documentation follow-up does not claim its own future CI result. No merge, deployment, production data change, real prospect communication or operational stage promotion occurred.
