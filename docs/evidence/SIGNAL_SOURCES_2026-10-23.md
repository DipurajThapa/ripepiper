# Approved Signal source acquisition — development evidence, 23 October 2026

## Scope and acceptance

RP-030 offline acquisition slice: fetch one explicitly configured client-approved JSON source, present recent business-change claims for review, and import a selected reviewed contact/trigger through existing provenance RPCs. This is bounded on-demand acquisition, **not** web-wide discovery, a crawler, automatic intent detection, an external enrichment provider, a permission grant, or autonomous outreach.

Acceptance covers tenant scope, stable source identity, no unreviewed write, current preview digest, source freshness and expiry, duplicate/partial-import replay, inert untrusted content, bounded requests/body/item count, pause/configuration changes and no real provider send. Existing business-brief and qualification review remains responsible for deciding whether a source claim is relevant and supported.

Development base: `67654827a4c4d893ccfc07ccddebbdadf6173e8c` on the PR #6 lineage. The implementation commit is identified in the PR/independent QA handoff. No independent QA or live operation is asserted by developer checks.

## Existing components reused

- `import_review_lead`: case-normalized contact identity and stable contact-source reference.
- `record_product_event`: immutable Signal trigger evidence with reviewed purpose reference.
- Existing `leads`, `lead_observations`, product review/shortlist and Clients panel.
- Optional `Db` 15-second timeout and existing staff authentication.

No table, migration, dependency, job engine, framework, paid API or automatic source polling is added. A partial two-RPC result can leave a contact/provenance record before a trigger is recorded; retry uses the exact same item references, so it links that contact rather than creating a duplicate. A malformed acknowledgement never reports successful import.

## Secure operator configuration (not configured live)

In the **isolated** Worker's server configuration, set `SIGNAL_SOURCE_CONNECTIONS` to a JSON array. Maximum ten bindings, one per tenant, unique stable source UUID and URL. Each binding requires:

```json
{
  "id": "22222222-2222-4222-8222-222222222222",
  "tenantId": "11111111-1111-4111-8111-111111111111",
  "url": "https://approved-source.example.com/signals.json",
  "purposeReference": "approved-business-source-and-permitted-use-record",
  "expiresAt": "2026-11-01T00:00:00Z",
  "enabled": false,
  "synthetic": true
}
```

The example is a disabled synthetic binding, not a ready source. Keep production source data/configuration out of fixtures and public GitHub. Enable only after the operator verifies the exact source, applicable data rights, free/bounded usage, and public DNS/egress behavior for the intended environment. No paid endpoint, trial or subscription is assumed. The adapter never accepts a caller-provided URL. It forbids userinfo, query/hash, non-HTTPS/non-default-port, literal IP, local/internal-style names, controls, backslashes and ambiguous trailing-dot forms; redirects are refused.

These lexical URL checks **do not prove DNS resolution or prevent DNS rebinding**. Exact server-owned source approval is the present boundary; live public-source/egress verification remains required. No approved live source exists in this change. Manual reviewed Signal evidence remains usable while source selection is pending.

The configured endpoint must return `application/json` (or a JSON subtype), with at most 20 items and 256 KiB total bytes:

```json
{
  "items": [{
    "id": "provider-stable-change-id",
    "company": "Synthetic business",
    "email": "fixture@example.invalid",
    "sourceUrl": "https://company.example.com/news/change",
    "observedAt": "2026-10-22T00:00:00Z",
    "expiresAt": "2026-11-15T00:00:00Z",
    "summary": "Dated source claim, not independently established intent.",
    "relevance": "Why staff should review whether the change relates to the offer."
  }]
}
```

Stable IDs are limited to 80 letters/digits/underscores/hyphens. IDs must be unique within the feed. New material evidence or corrected identity needs a new source item ID; immutable stored evidence is not silently overwritten. Contacts must match the explicit synthetic mode (`.invalid` for synthetic, business evidence otherwise). Sources older than 30 days, future observations, expired triggers, invalid identities and malformed items are excluded; duplicate IDs, oversized/malformed payloads and unavailable sources fail closed. The source's terms/data-use authorization must be established before enabling the binding; a valid email address is not contact permission.

## Operator workflow

In the existing Clients area, **Approved Signal source** shows connection status without fetching the source. **Preview approved source** fetches one snapshot; source text is displayed using `textContent`. Select an item, review company/contact identity, source claims and permitted use, then confirm the review checkbox. **Import reviewed Signal** re-fetches and checks the content digest before writing. It does not grant contact rights, infer intent or send a message. **Refresh client review** reloads the existing business/Signal history for assessment. Source read and import results are discarded after tenant/configuration changes in the request; the final config/tenant check and database insert are not one distributed transaction, so cross-instance secret propagation and final-write races remain integration acceptance concerns.

Each import reference is deterministic: `signal:<connection UUID>:<item ID>:contact` and `:trigger`. A source change invalidates a stale preview. The two existing RPCs retain their independent idempotency and scope constraints. Success requires the expected contact state and UUIDs from both database acknowledgements.

## Developer verification

- `npm run typecheck`: PASS.
- Full `npm test` on the stated development base: PASS, **240 tests**, including **41 new Signal checks**.
- `node --test scripts/*.test.mjs`: PASS, **41 tests**, including three Signal UI checks.
- `node --check site/assets/signal-admin.js` and `scripts/signal-browser-check.mjs`: PASS.
- `git diff --check`: PASS.
- Standalone rendered browser script: **BLOCKED locally** because pinned Chromium executable is absent. It must run in existing CI/QA Chromium environment; this developer report does not claim it passed.

Coverage includes encoded/private IP forms, unsafe URLs, no caller URL access, tenant/configuration expiry/rotation/disable, read-only status/preview, duplicate IDs, item/body caps, malformed UTF-8/content type, source freshness, stale digest, pause during fetch/after first write, staff denial, malformed database receipts and partial-import replay. A composed test feeds the parsed result through the actual PGlite import/product RPCs, proves one stored trigger on replay, no contact-rights row, and continued qualification review rather than automatic acceptance. Provider and identity APIs in route checks are synthetic. No live source was fetched and no cost was incurred by these checks.

## Router and CI integration handoff

Root registers the existing Worker router:

```ts
import { signalSource } from "./foundation/signal-sources";
["POST", /^\/api\/admin\/tenants\/([0-9a-f-]{36})\/signal-source$/, (r,e,_c,p)=>signalSource(r,e,p[0])],
```

Root/QA runs `node scripts/signal-browser-check.mjs` after the existing rendered product checks. The script uses real admin markup/styles/card logic, a synthetic API, no external network and desktop/mobile assertions. Independent QA must verify the exact integrated source and final router, not only this branch's developer evidence.

Rollback before any approved rollout: revert this commit; no schema rollback is needed. Disabling/removing/expiring a binding stops new acquisition, but does not erase previously reviewed provenance. Existing retention/subject-request handling still applies. Live source provisioning, operational feed monitoring, true network/DNS isolation, production release and measured lead quality remain open.
