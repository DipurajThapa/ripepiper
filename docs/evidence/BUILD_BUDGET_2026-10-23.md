# Shared build-budget guard — development evidence

RP-018; candidate source commit `8336709b0abaa15a9281825049ba2bd068352668` before subsequent integration. No paid call or live migration was made.

The existing Claude adapter now defaults to paid use disabled. Before a request it needs an explicit server setting, a reviewed model-specific price policy/reference with expiry, and an atomically reserved operation from the global build budget. The policy uses integer micro-US dollars per million input/output tokens. Policy/model/tariff/token-bound validity must be verified for the actual provider before activation; synthetic rates are not current price claims.

The dormant migration creates a single total build-budget row and operation ledger, RLS-enabled and unavailable to anonymous/authenticated clients. It does not seed prior usage, authority, pricing or an enabled flag. A staff/service-only authorization function requires prior-charge reconciliation, an authority reference, pricing reference and expiry (at most 30 days). Prior charges cannot be silently reduced. This is preparation for authorized paid use, not authorization to incur it.

Reservation locks the global budget row, counts settled actual charges plus every unsettled worst-case reservation and reconciled prior charges, and refuses new requests above US$18. The remaining US$2 is settlement/variance headroom within the existing US$20 total. The same operation ID cannot dispatch twice. Unknown/timeout/provider-error charges stay reserved without automatic retry; missing/invalid or out-of-bound usage freezes discretionary AI until reviewed. Settlement replay must match the recorded amount. This covers the existing meeting-analysis and pre-proposal calls; other billable provider services still need their own verified bounds before use.

Local checks: TypeScript and all 193 tests passed after this increment (seven new budget checks plus the 186-test PR6 baseline). Checks cover default-off/no network, exact reserve→one-provider-call→settle order, refusal, private provider-error redaction, no retry, unknown usage hold, concurrent global reservations, replay settlement and denied anonymous/client access. Independent QA receipt is tracked separately. PGlite is not hosted concurrency or real billing proof.

Operator activation, only after a scoped paid-use decision and secure isolated environment:
1. Reconcile attributable invoices/usage across providers and record the prior total; absent records mean remain disabled.
2. Verify actual model availability, tokenizer/input framing bound and complete price tariff (including any taxes or other mandatory charges); set a conservative all-in rate policy with dated source reference/expiry. Cache/tool/batch billing is unsupported; do not enable those modes.
3. Record the reviewed authority and prior charges using `authorize_build_budget` in the intended isolated environment; configure `AI_COST_POLICY` server-side and `PAID_AI_ENABLED` only for the approved target. Never put credentials in chat/GitHub.
4. Rehearse refusal/reconciliation using synthetic providers before authorized actual usage. Inspect unsettled operations after uncertain results; never zero, expire or recreate them to obtain more allowance.

Rollback: leave or set `PAID_AI_ENABLED` absent/false and disable the budget row. Keep operation history and pending reservations. Do not drop the ledger to reset the cap. No production configuration was altered by this implementation.
