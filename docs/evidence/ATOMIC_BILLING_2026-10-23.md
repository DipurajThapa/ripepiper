# RP-014 atomic payment consistency — 2026-10-23

Development base: `6aee9ca`. This increment repairs the existing proposal and quotation checkout/webhook workflow. It adds no billing platform, outbound job engine or automatic notification sender. All evidence below is local synthetic execution, not live settlement or production acceptance.

## Contract

- The existing `payments` ledger gains an explicit quote binding and settlement timestamp; quotes gain `paid_at` while retaining the existing accepted status. Existing RLS remains enabled. Three functions are security invoker, require the service role, use an empty search path and explicitly deny PUBLIC/anon/authenticated execution.
- `reserve_payment_checkout` locks proposal then quote and records one pending internal attempt before a provider request. An unknown creation/binding outcome remains held; later POSTs cannot create another checkout. An internal `attempt:<UUID>` is never accepted as a provider reference.
- `register_payment_checkout` uses the same lock order and an exact attempt fence to bind a provider reference once to target, tenant, purpose, minor amount and currency. Approval/quote acceptance commits with binding. A provider failure leaves the target sent plus its recoverable attempt record.
- `apply_payment_event` locks proposal, quote, payment and any lead before its effects. Only registered exact bindings can settle. A lead must be pre-client null scope or belong to the proposal tenant. Invalid currency, under/overpayment, wrong quote/tenant/proposal, unknown reference or closed target cannot provision an engagement or fee. Failed can advance to paid; paid never regresses on late failed callbacks.
- Advance settlement atomically records one tenant/owner invite when provisioning is needed, proposal/lead state, fee, activity and immutable ledger receipt. Quote settlement atomically records paid_at, one fee/activity and its receipt. Duplicates return that exact persisted receipt. A competing reference is rejected and a bounded human-review reason is retained on its known ledger row. Unrelated JSON keys in raw are preserved.
- Financial completion records deterministic **human_review_required** notification references in the same transaction. The webhook sends no email and offers no resend. This is recoverable manual disposition, not an implemented retryable notification delivery service.
- The existing proposal secret POST and authenticated quote-owner POST remain the authorization boundary. An accepted unpaid quote exposes Continue to payment; paid quotes have no checkout button. Repeat POST uses only provider GET retrieval for a bound reference, with strict target, amount, currency, reference, provider status and hosted-URL checks. URLs are never persisted in raw, receipts or logs. A malformed reservation/binding cannot reveal a checkout URL.
- Exact response validation rejects truthy malformed RPC bodies and invalid ISO timestamps. Lost acknowledgements return 503; replaying the verified provider event safely reads the persisted atomic result. Mismatched bindings return an explicit rejection, with no claimed success.

## Local verification

The new `payment-settlement.test.ts` applies all migrations to PGlite and exercises the real functions under the service role, including concurrent submissions on the single engine. It also executes actual signed Stripe/Razorpay handlers through mocked HTTP into those real functions. No provider or external email service is contacted.

Adverse coverage includes two providers, duplicate/out-of-order callbacks, competing references, unknown references, exact amount/currency and quote bindings, closed proposals/quotes, owner and direct RPC ACL denial, foreign-tenant leads, internal attempt rejection, uncertain checkout creation, lost committed acknowledgements, malformed RPC/provider replies, forged URL hosts, pending quote recovery and held notification inspection. Trigger fault injection covers seven advance transaction stages and four quote stages; every failure rolls back financial/provisioning effects and a later clean retry settles once. A separate portal renderer test checks sent/accepted/paid and owner/viewer behavior.

Reproduction:

```sh
npm --prefix platform/ripe-piper-platform test
npm --prefix platform/ripe-piper-platform run typecheck
node --test scripts/*.test.mjs
```

The legacy Worker flow test now checks the strict billing RPC contract; detailed financial effects are checked against actual local SQL rather than a handwritten table simulator. Developer verification passed: 372/372 backend tests (42 new billing tests), 62/62 Node UI/safety tests (2 new portal renderer tests), TypeScript typecheck, JavaScript syntax checks and git whitespace checks. Independent QA and final integrated CI remain separate acceptance evidence.

## Provider semantics checked

- [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests): a stable target/financial-terms key is supplied. Stripe may prune a key after at least 24 hours, so this is not treated as unlimited protection; the durable local reservation prevents blind creation retries.
- [Retrieve Stripe Checkout Session](https://docs.stripe.com/api/checkout/sessions/retrieve): only authorized POST recovery uses the documented GET by registered reference.
- [Razorpay maintained Payment Link documentation](https://github.com/razorpay/razorpay-php/blob/master/documents/paymentLink.md): unique reference_id uses the quote ID for quotes, proposal ID for advances; no unsupported idempotency header is invented. Link retrieval is read-only. Provider notification/reminder flags are disabled; the client explicitly receives the checkout redirect.
- Razorpay `payment.failed` contains a payment ID rather than the registered link ID and is explicitly ignored instead of guessing a relationship. Stripe quote identity is retained on asynchronous failures and success is also supported for asynchronous paid sessions.

## Deployment limits and recovery

Forward migration `20261023103854_atomic_payment_settlement.sql` was generated with Supabase CLI 2.121.0 and tested locally only. It has not been applied to a hosted or production project. Hosted security advisors, real multi-instance PostgreSQL lock contention, provider sandbox callbacks and browser visual acceptance remain unverified. The proposal payment page now says onboarding awaits team review rather than claiming an engine has started.

An operator resolves creating/unknown/expired or legacy checkout records by inspecting the recorded payment ID, proposal/quote and provider dashboard before any replacement. This increment deliberately provides no automatic replacement, resend, historic orphan repair or live reconciliation action. Existing legacy paid/partial records must be reconciled before rollout; a local test cannot prove their historical consistency.

Root integration must register POST `/api/admin/payments/:id/receipt` to `inspectPayment` from the existing proposals route module. The staff-only endpoint returns bounded phase/hold/notification references and cannot execute work. Production still runs its existing code until an explicitly approved release; this patch makes no production safety claim.

Rollback before release is a commit revert. After any approved schema application, preserve settlement evidence and roll forward with a reviewed corrective migration; do not drop receipt columns or reinstate the old non-atomic webhook implementation against paid records. No live rollback or migration was attempted.

## Operator UI follow-up

The existing proposal detail now includes a bounded Payment review section, without a new tab or workflow. Staff explicitly loads only the selected proposal’s latest 20 payment IDs/provider/status rows, then invokes the existing read-only receipt endpoint. It displays creating/bound/legacy state, rejected-event hold, exact payment/proposal/quote and notification references, plus instructions to check the provider before any replacement. It exposes no send, retry, replacement or resolve action. Sample mode makes no calls. Generation/proposal/payment checks discard late results; malformed/foreign replies disable inspection and render only a safe error. All dynamic review text uses textContent and escaped option labels. Seven isolated tests execute the actual proposal-detail function for scoped reads, late proposal/selection changes, malformed/error paths, held guidance and sample/no-execution behavior. Browser visual acceptance remains separate.

## Q006 service-owned ledger guard

Independent QA reproduced authenticated platform-admin forgery and deletion through the baseline broad table policy. The unapplied forward migration now guards payment INSERT/UPDATE/DELETE whenever either old or new state is a Stripe/Razorpay record, has settlement metadata, or contains a managed checkout/billing/review namespace. Removing markers or changing provider cannot bypass the old-row check. Proposal paid transitions/timestamps/paid tenant reassignment and quote paid timestamps/deletion are protected too. Canonical service RPCs and the database table owner retain their explicit maintenance authority; trigger function EXECUTE is revoked from PUBLIC/anon/authenticated. Actual authenticated-admin negative tests cover forgery, pending-attempt deletion, stripping, direct provider insertion and paid metadata, and positive tests preserve legacy bank CRUD, manual fees and draft content editing. No hosted migration or privilege change was made.

Q006 developer verification: 44/44 billing tests and full 374/374 backend tests passed, with typecheck and whitespace checks. The preceding 69/69 Node UI/safety result remains unchanged by this SQL/test-only correction. Independent QA reproduction tests remain separately owned.

Q006 paid-binding completion: authenticated-admin changes to paid proposal lead, recipient email, currency, fixed amount/advance percentage and tenant, or paid quote parent proposal, tenant, currency and total are rejected. `advance_amount` is GENERATED ALWAYS; its source inputs are protected and direct assignment is independently rejected by PostgreSQL. Harmless paid proposal Markdown updates remain allowed and preserve the exact canonical receipt on replay.

Paid-binding developer verification: 45/45 billing and full 375/375 backend tests passed; typecheck and whitespace checks passed. No hosted action was executed.
