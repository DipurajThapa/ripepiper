# Fenced synthetic acknowledgement — development evidence, 23 October 2026

## Requirement and boundary

RP-013/016/020 and `shared-provider-reliability`: extend the existing outbound ledger with claim fencing, explicit acknowledgement and safe ambiguous-result handling. This is the offline synthetic slice. No external provider is activated; `tested` means only that the local test sink acknowledged an action. It is never `delivered`, inbox placement or real prospect communication.

Base: PR #6 `e4d976892af5e9c7d9d262d20b77310ca552f291`. Development branch: `feature/provider-reliability`. The implementation commit is identified by the PR/QA handoff; this file does not claim independent QA signoff.

## Implemented

- Existing `outbound_actions` gains `dispatch_token` and `acknowledged_at` in one forward migration, generated with the official Supabase CLI 2.121.0 `migration new`. No earlier migration is edited and no SQL is run against a live database.
- A server-generated token is sent with the tenant/action claim. A lost claim response can therefore be fenced using the same token, without cancelling a different claimant.
- New claim/completion/expiry RPCs require service role and explicit tenant/action scope. Completion requires exact token, approval version, asset version and unexpired lease; it reuses the current shared eligibility predicate for tenant pause, suppression, reply hold, rights and approval freshness.
- The sink receipt and `tested` state commit in one transaction. Same-token replay returns the persisted receipt only, including after a later pause; it creates no new effect. Wrong tenant/token/version fails closed. Legacy completion explicitly rejects fenced claims.
- Ambiguous completion first reads the same stored action. A committed receipt is returned rather than replaying acknowledgement. Without a receipt, same-token expiry moves the action to `review`, pauses the campaign and never requeues. Each ledger HTTP request uses a 15-second AbortSignal timeout. Identity/authentication checks retain their existing implementation.
- Read-only staff inspection returns a sanitized synthetic receipt, `delivery:not_sent`, and `canRetry:false`. It never sends, changes campaign state, removes suppression or resumes work. Tokens are omitted from inspection and existing campaign list responses.
- The existing Clients campaign panel has a **Check test acknowledgement** control for claimed/tested/review actions. It displays the receipt or review guidance without starting another test and discards stale tenant/campaign results.

## Developer verification

Local execution identity: existing Codex workspace; disposable in-memory PGlite with synthetic `.invalid` contacts, stubbed Supabase Auth and default network guard. No cloud database credentials, production URLs, provider calls or paid services are used. Dependencies reuse the existing installed lockfile environment via an untracked worktree-local symlink; no dependency or lockfile change.

- `npm run typecheck`: PASS.
- `npm test`: PASS — **199 tests**, including **13 new** ledger/adapter checks.
- `node --test scripts/*.test.mjs`: PASS — **38 tests**, including two new receipt UI checks.
- `node --check site/assets/campaigns-admin.js`: PASS.
- `git diff --check`: PASS.

New checks exercise exact-claim replay, simultaneous claim serialization, old completion refusal, foreign tenant/token/version rejection, pause/suppression/rights/reply/approval changes before acknowledgement, lease expiry, review/no requeue, non-service RPC denial, lost claim and completion responses, timeout recovery, read-only inspection and token redaction. The migration-upgrade test discovers and rehearses the new SQL automatically. The two existing action endpoint fixtures now expect the fenced RPC contract.

## Integration handoff

Root must register this read-only handler on the existing router:

```ts
import { inspectActionReceipt } from "./foundation/action-reliability";
["POST", /^\/api\/admin\/tenants\/([0-9a-f-]{36})\/actions\/([0-9a-f-]{36})\/receipt$/, (r,e,_c,p)=>inspectActionReceipt(r,e,p[0],p[1])],
```

POST matches the existing `RP.api` client convention; the handler performs only SELECTs. The old `/api/admin/actions/:id/test` path is preserved through the `actions.ts` export. Root/QA must verify the integrated router, rendered UI and combined candidate.

## Limits and rollback

This is not real-provider acknowledgement, hosted Supabase/Auth/PostgREST proof, real multi-worker PostgreSQL concurrency proof, delivery acknowledgement for legacy reminders, or a live pilot. Those remain blocked operational acceptance, with provider scope/budget/release authority separate. If the database cannot be reached after an ambiguous result, the API cannot guarantee the review transition committed; it returns an explicit uncertainty error and never retries. The token prevents a later stale response from acknowledging a different claim. Legacy unfenced claims retain their old behavior; they cannot complete a new fenced claim.

Rollback in development: revert the implementation commit and recreate the disposable database. For any later approved hosted rollout, disable the sink and preserve uncertain rows/receipts; do not drop evidence or roll back a committed acknowledgement to queued. Schema rollback and backup restoration require a separately reviewed deployment plan.

Independent QA follow-up: a malformed truthy RPC response could otherwise be mistaken for acknowledgement. Completion now requires exact JSON boolean true; any other non-false value enters read-before-expiry uncertainty handling. Added malformed-response regression; focused reliability checks now 14 passing.
