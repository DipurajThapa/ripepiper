# Modular pack M03 — shared contracts v1

Owner: Ripe Piper engineering. Candidate branch `feature/pack-m03-contracts`, based on the verified pack M02 branch `0ce271f`. Source contract: `platform/ripe-piper-platform/src/contracts/v1.ts`; synthetic checks: `test/contracts.test.ts`. Scope: definitions and compatibility checks only. They do not create tables, deploy the Worker, authorize communications or implement durable locks. This record extends `docs/DELIVERY.md` and owns the shared interface until M04 foundation consumes it.

## Existing schema mapping and decision

`tenants`, `memberships`, `leads`, `meetings`, `suppression`, `activity_log`, `posts`, `sheet_outbox`, `ad_accounts` and `ad_metrics_daily` provide partial infrastructure. Current `leads.tenant_id` and `meetings.tenant_id` allow NULL for Ripe Piper's legacy sales pipeline; that is **not** the accepted shape for new client workflows. Current lead email uniqueness is tenant scoped, but no ambiguity resolution or cross-channel match contract exists. Current `meetings.kind` covers discovery and other legacy states, while contract v1 uses `consultation` and `client_handoff`; an adapter/migration is required. Campaign, contact rights, asset approval/version, interaction, qualification, data request, retention, action delivery ledger and job reservation have no equivalent fully enforced record. No new migration is applied in M03.

ADR-006: keep one shared tenant/lead/contact identity and action safety service in the existing Worker/Supabase stack. Add product-private state only where a product requires it. Contract v1 is additive and transport independent; M04 will supply persistence, RLS/composite tenant references, atomic reservation, shared suppression and a server API. Breaking changes require v2 plus tests for both sides. Reversal: remove the unused v1 package and its tests; existing deployed code remains unaffected.

## Operations and failure contract

| Operation / owner | Input → output | Authorization, validation, failure and recovery |
|---|---|---|
| Staff setup / foundation | Verified staff identity, tenant brief, selected capability → tenant-scoped configuration | Operator/owner only; no public sign-up; cannot activate without CTS profile, client authority and selected channel. No implicit cross-tenant data transfer. |
| Identity resolution / foundation | Tenant, normalized email/phone and all source touches → one contact ID or review item | Tenant mismatch rejects; >1 distinct candidate is `ambiguous_identity`, never auto-merge. Preserve provenance; initial import is prohibited without market/source rights. |
| Handoff intake / foundation | `Handoff` v1 + authenticated actor → accepted action ID or `invalid`, `forbidden`, `tenant_mismatch`, `duplicate`, `out_of_order` | UUID IDs, bounded correlation key, dated evidence, operator/owner; durable unique `(tenant_id, correlation_key)` required at implementation. Retry with same key returns prior result; older events do not reverse newer state. Fixture checker alone is not a durable guarantee. |
| Contact eligibility / foundation | Tenant/contact/campaign, purpose/channel/market, fresh `ContactRights` and `CampaignApproval`, version/time/stops → allow or block | Current rows required immediately before dispatch, including retries; absence/unknown/objection/withdrawal/suppression/expired rights, asset version drift, new market/purpose/channel or any stop blocks. Handoff payload cannot grant approval. Negative result queues operator resolution, not a send. |
| Reserve/dispatch / foundation | Action ID + current eligibility → claimed ledger entry → channel adapter → delivered/failed | Unique atomic claim; at-least-once job execution, at-most-once provider effect through stable idempotency or reconciliation. Claim/ledger and provider result must survive crashes. Bounded retries; terminal failure pauses with operator ownership. `nextActionState` is only a transition guard; DB concurrency is M04 work. |
| Campaign/asset review / campaign-assets | Brief, source claims, versioned draft → approval ref/version or rejection | Client approval or documented delegation plus Ripe Piper owner authority for external actions; changed copy/offer/audience invalidates earlier version. Export/publication adapter stays disabled until separately authorized. |
| Qualification/handoff / product owner | Product-specific evidence → `Qualification` and optional v1 `Handoff` | Fit, engagement, MQL and SQL are independent yes/no/unknown values; no unsupported answer becomes “yes.” Operator override needs reason. Handoff does not mark appointment confirmed or attended. |
| Appointment / Response or public intake | Eligible lead, staff/client sales owner, UTC time and timezone → reserved, confirmed, cancelled, attended or no-show record | Atomic slot claim, separate `kind` and tenant owner; failed Calendar state is not free. Duplicate requests must return or reconcile the same booking. Public consultation is Ripe Piper intake; client handoff belongs to that client tenant. |
| Data request/retention / foundation | Verified request or due rule → case, freeze, export/deletion receipts and audit | Objection freezes queued sends immediately across all products; inspect jobs, tables, files and providers. Retain minimum suppression reference where needed; legal hold/processor duty can pause deletion with reason. Export only verified subject/controller-scoped records. Deletion/backup restoration requires an auditable operator process. |

Every operation returns a stable error and correlation reference to the operator without disclosing another tenant's existence. All stored times are UTC instants; campaign/appointment timezones are explicit IANA identifiers in future persistence validation. Viewer has reporting access only. Service-role routes must independently authorize membership. RLS and composite tenant references will enforce the same boundary when M04 creates the schema. Production clients cannot use fixture validators as an authorization service.

## Standalone product interfaces

| Product | Input | Own output without another product | Optional v1 handoff |
|---|---|---|---|
| Revive | Approved dormant lead import with provenance and rights | Dedupe/rejection report, reviewed reactivation sequence and attributed outcome | Candidate/reply → Response or operator. |
| Signal | Permitted dated source observations | Cited account/prospect candidate with freshness and review outcome | Candidate → operator or Response after separate contact-rights check. |
| Response | Client-owned, authenticated inbound event | One conversation, qualification/owner/SLA, safe reply or escalation and booked handoff | Appointment/escalation → operator; no dependency on Revive/Signal. |
| Events | Permitted event attendance/registration import | Dedupe/rejection, timely reviewed follow-up and attribution | Inbound/appointment → Response or operator; registration ≠ attendance. |

Ripe Piper public `/api/lead` → `/api/book` remains a separate intake flow. Its legacy NULL-tenant records require a tested, explicitly approved migration before treating Ripe Piper as an ordinary tenant. Client appointments cannot borrow the public lead UUID as authorization. No public tenant provisioning endpoint is in scope.

## Acceptance

| Pack check | Status | Evidence / limit |
|---|---|---|
| M03-A | SPECIFIED | Types and operation/error matrix; owner and schema mapping above. |
| M03-B | PASSED at fixture/contract level | Ten synthetic tests cover missing fields, foreign tenant, viewer, duplicate/reordered action, ambiguous identity and stale permission; durable DB enforcement remains M04. |
| M03-C | SPECIFIED | Independent product input/output and optional handoff mapping above. |
| M03-D | SPECIFIED | Distinct public consultation/client appointment contract; legacy mapping explicitly deferred to safe foundation migration. |
| M03-E | SPECIFIED; fixture checks PASSED | Contact-rights types, objection and market/purpose/channel change tests pass. Subject requests/retention are types and operator obligations; functional tests remain M04/M10. |

Node 24 typecheck and 60 Worker tests passed on this candidate (50 existing, 10 new); no schema write or provider call. Full integration against durable M04 services is pending. CTS-01–08 are not satisfied by a contract. Real provider, legal, data request, retention and release evidence remain blocked. Next: integrate on a nonproduction branch, then read M04 foundation one file at a time.
