# SaaS readiness, competitive audit and first-customer activation (31 October 2026)

Evidence base: `main` plus pull request #15 (hybrid operating model, checks green, not yet merged) and this branch. Every "confirmed" item below was checked against code, migrations or a test run in this session. Delivery status and owner actions stay in [DELIVERY.md](DELIVERY.md); this file is the audit and the plan.

## 1. Verdict

**Ripe Piper is a well-tested engine that has never run.** The four products share one tenant model, one record and one approval path, and about 2,050 automated tests pass against the real database migrations. But no API is deployed, eleven migrations are not applied to any hosted database, no provider app is registered, and no message has ever left the synthetic test sink. Readiness for a paying SaaS client: **not ready**. Readiness for a bounded Ripe Piper pilot: **blocked only by owner actions** (section 5), not by missing engineering.

Strengths, confirmed:
- Tenant isolation is enforced in the database (row-level security plus one access predicate), with operator access only under a client grant that expires and is audited.
- Safety on sending is unusually strict: suppression, contact rights, exact-version approval, fenced claims, and no automatic resend after an uncertain provider reply.
- "Approve once" exists: a client approves an operating envelope, and campaigns that fit it are approved by the database without another human step.
- AI spend is metered against a hard budget and refuses unknown prices.
- Mailbox connection uses OAuth with PKCE, encrypted refresh tokens, browser-bound state and minimum send/calendar scopes.

Critical gaps, confirmed:
- **No live path.** The tenant send adapter is built but not called from dispatch (RP-013); execution ends in the synthetic sink.
- **No prospect data source.** There is no licensed company or contact database, no email verification and no enrichment. Discovery depends on the client's own lists or approved JSON feeds.
- **No reply ingestion.** Replies are imported by hand; there is no inbox sync, so "a person answers within one hour" cannot be measured.
- **No external CRM sync** (HubSpot, Salesforce, Pipedrive).
- **Public site promises more than the product does** (section 3, item C1).

## 2. Competitive comparison

Sources are vendor pages and third-party reviews from 2026; prices conflict between sources and are indicative only.

| Capability | Apollo | Clay | HubSpot (Breeze) | Instantly / Smartlead / lemlist | Ripe Piper today |
|---|---|---|---|---|---|
| Prospect database | 210M+ contacts, 35M companies | Marketplace of 100+ providers | CRM records plus agent research | Instantly and lemlist sell lead data | **None.** Client lists and approved feeds only |
| Enrichment and verification | Built in, credit based | Waterfall across providers | Via partners | Built-in verification | **None** |
| Intent signals | Buying intent, job changes | Web intent, custom signals (paid tiers) | Agent watches CRM signals | Minimal | Reviewed signal feeds with expiry and per-signal attribution |
| Qualification | Generic score | AI research per row (costly) | Predictive score | None | Separate fit, role, need and timing checks against the client's own brief; no generic score |
| Outreach | Sequences, dialer | Pushes to sequencers | Agent drafts, approval then auto | Volume sending, inbox rotation, warm-up, unified inbox | Approved sequences from the client's own mailbox; no warm-up, no rotation |
| Approval model | Per sequence | n/a | Approve each draft, can switch to auto | Per campaign | Approve an envelope once; in-bounds campaigns run without another step |
| Compliance controls | Basic | User's job | Basic | Unsubscribe, bounce handling | Contact rights per contact, suppression, legal basis per market, audit trail |
| CRM, meetings, attribution | Light CRM, meetings | Syncs out | Full CRM | Light CRM in lemlist | Internal record, calendar booking built, outcome attribution to the exact message and signal |
| Managed plus self-service | Self-service | Self-service | Self-service | Self-service; Smartlead suits agencies | Both on one account with client-granted operator access |
| Entry price | about US$49 per user per month | about US$167 per month | Sales Hub Professional | about US$39 to US$69 per month | Fixed sprint and monthly engine (AED, INR) |

Where Ripe Piper is stronger: client control (approve once with hard limits), compliance and audit, attribution of outcomes to the exact message and signal, and a managed service on the same platform the client can later run alone. No competitor in the table offers that combination for UAE and India.

Where it is weaker or incomplete: data (no database, enrichment or verification), deliverability tooling (no warm-up, domain checks or daily caps per mailbox yet), reply handling (manual), CRM sync (none).

Recommended to close, in order of customer value. Everything else in the competitor list is deliberately left out.
1. Live sending from the client's own mailbox with a per-mailbox daily cap and an SPF/DKIM/DMARC check before approval (RP-013). Without it nothing else matters.
2. Reply detection from the connected mailbox, so replies stop sequences and reach a person automatically.
3. One licensed data source with email verification, cached per its licence. Pick one provider, not a waterfall; the budget does not support credit-heavy enrichment.
4. HubSpot sync of contacts, meetings and outcomes; it is the CRM most likely among UAE and India SMB clients. Salesforce and Pipedrive later.
Not recommended now: inbox rotation and bulk warm-up networks (they serve volume senders and conflict with the low-volume, approved-message model), AI research per row (cost), LinkedIn automation (not permitted).

## 3. Prioritised corrections

### Critical
- **C1. Public claims ahead of the product (confirmed; owner chose to build, 31 Oct 2026).** Root causes and what can be built:
  - *Score 0 to 100.* Website enquiries already get one (`scoreLead` in `src/lib/validate.ts`). Prospects deliberately do not: RP-019 replaced a single number with four separate checks (fit, role, need, timing) because no real outcome data exists to calibrate a probability. Root cause: a product decision, not a technical limit. Buildable now: a published priority score from those four checks plus signal freshness, labelled as priority, not probability, and recalibrated from pilot outcomes.
  - *Warmed-up inboxes.* Root cause: there is no live sending yet (RP-013), so there is nothing to warm. Buildable: a gradual daily ramp on top of the existing per-client daily contact cap (`revive_daily_capacity_available`). Artificial warm-up networks are not recommended; they exchange fake mail and conflict with the rule never to work around provider rules.
  - *Verified addresses.* Root cause: proving a mailbox exists means talking to the recipient's mail server on port 25, and Cloudflare Workers block outbound port 25 (Cloudflare TCP sockets documentation). Many company servers also accept every address, so even a probe is partial. Buildable free: syntax plus domain mail-record check over DNS-over-HTTPS, and a hard-bounce stop. Mailbox-level checks need a paid provider (budget decision).
  - *A person replies within one hour.* Root cause: the platform cannot see replies. Gmail read access is a restricted Google scope; for client mailboxes Google requires a paid independent security assessment (CASA) before production, while an app in Testing may use it for its own test users. Buildable now for Ripe Piper's own pilot: poll the connected mailbox for replies, stop follow-ups and alert the owner. The one-hour part is a staffing promise software can only support.

- **C2. Nothing is deployed (confirmed).** No Worker; eleven migrations unapplied (DELIVERY.md release blockers 1 and 2).
- **C3. Live sending not wired (confirmed, RP-013).** Blocked on outreach authorisation.

### Must have before the first external client
- **M1. Reply detection** from the connected Google or Microsoft mailbox (needs a read scope; Gmail read scopes are restricted and need a security assessment, so start with Microsoft Graph or Gmail metadata only).
- **M2. Email verification** before enrolment, through one provider within budget.
- **M3. Per-mailbox daily cap and DNS check** before a campaign can be approved (RP-013 bundle).
- **M4. Merge pull request #15**, then update DELIVERY.md's hybrid section (heading, anchor and status lines), which describe it as an unmerged branch.
- **M5. Grant-expiry warning** for managed clients, so access does not lapse mid-campaign.

### Later
- HubSpot, then Salesforce and Pipedrive sync; outbound webhooks; Signal, Response and Events under the envelope; WhatsApp per tenant; semantic qualification measured against the current rules (RP-019).

## 4. Connector architecture

Built on this branch: `GET /api/admin/tenants/{id}/onboarding` returns the client's setup steps computed from real records (brief, reviewed setup, activation, mailbox, calendar, envelope, first campaign), names the next step, and lists every connector with an honest status. The client portal shows it as "Getting started" with an "Integrations and connectors" table. The catalogue lives in one place (`src/foundation/onboarding.ts`) and reads the OAuth scopes from the same definition the connection flow uses, so the page cannot advertise a permission the code does not request.

| Connector | Status | Ripe Piper does once | Customer does | Permissions | Admin consent |
|---|---|---|---|---|---|
| Google Workspace (Gmail, Calendar) | Built, awaiting Google verification | Register one Google Cloud app, pass verification, hold encrypted tokens, refresh, revoke | Sign in with the sending mailbox | openid, email, gmail.send, calendar.events, calendar.freebusy | Only if the Workspace admin restricts third-party apps |
| Microsoft 365 (Outlook, Calendar) | Built, awaiting Entra app | Register one multi-tenant Entra app, publisher verification | Sign in with the sending mailbox | openid, email, offline_access, User.Read, Mail.Send, Calendars.ReadWrite | Only if the organisation blocks user consent |
| CSV import | Working | Row checks, per-client dedupe | Upload lists they may contact | none | no |
| Internal record (leads, deals, outcomes) | Working | Storage, isolation, export, deletion | nothing | none | no |
| Approved JSON signal feeds | Built, needs live source | Host allowlist, preview, expiry | Name entitled sources | none | no |
| WhatsApp Business | Planned per client; only Ripe Piper's own opted-in consultation reminders exist, off | Template use, opt-in records | Own the WABA and number, approve per-message cost | whatsapp_business_messaging | Meta Business owner |
| HubSpot, Salesforce, Pipedrive | Planned | Public app per CRM | Install or approve the app | per CRM | yes for Salesforce, HubSpot super admin |
| Data provider and verification | Planned | Choose a licensed source | nothing, or bring their own key | API key | no |
| Webhooks, SMS | Planned | Signing and retries; provider account | Receiving URL; sender registration | n/a | no |
| LinkedIn | Not offered | nothing | Manual use; Ripe Piper stores the profile link | none | n/a |

Credentials: refresh tokens are sealed with AES-GCM bound to tenant, connection and provider, and a connection is re-checked just before every send. Revocation deletes the sealed secret; offboarding also revokes the Google token, but a client's own disconnect does not yet revoke it at Google (the user can remove access in their Google account). The database can mark a connection in error, which turns the onboarding step back to "to do", but nothing calls that yet; it must be wired into token refresh when dispatch sends through the tenant adapter (RP-013). Customers never create developer projects or paste secrets.

## 5. Owner action checklist (in order)

1. **Merge pull request #15.** My merge was blocked by a safety rule on this machine; you can merge it on GitHub, or allow it and tell me to.
2. **Site copy (C1):** decided 31 October 2026: build the promises rather than soften them. Step-by-step owner setup for the pilot is in [PILOT_SETUP.md](PILOT_SETUP.md).
3. **Staging secrets** in GitHub Actions (`RIPEPIPER_STAGING_CLOUDFLARE_API_TOKEN`, `RIPEPIPER_STAGING_SERVICE_ROLE_KEY`, `RIPEPIPER_STAGING_ANON_KEY`), then approve applying the eleven migrations to staging and deploying the staging Worker.
4. **Generate and back up a connection key** (a random 32-byte key, base64, kept in a password manager), then set two staging Worker secrets yourself: `CONNECTION_KEYS` as `{"k1":"<the base64 key>"}` and `CONNECTION_KEY_CURRENT` as `k1`.
5. **Create the Google Cloud OAuth client** for Ripe Piper with the staging callback URL, add your own mailbox as a test user (no Google verification is needed for test users), and set the client id and secret as staging Worker secrets, plus `OAUTH_ENABLED` set to exactly `true`.
6. **Choose the pilot mailbox** (the Ripe Piper address you will send from) and confirm SPF, DKIM and DMARC on its domain.
7. **Reconcile prior spend against the US$20 budget** (RP-018). Nothing on this list needs paid services; Google OAuth test mode, Cloudflare Workers free tier and the existing Supabase project are enough.
8. **Pilot decisions:** the segment (section 6), where the contacts come from and your legal basis for contacting them, the exact messages, a cap (suggested: 25 contacts, 1 mailbox, 14 days), and written authorisation for that live send.
9. **Later, for other clients:** Google verification of the three scopes, a Microsoft Entra app, a licensed data source, legal wording for UAE PDPL and India DPDP.

## 6. Ripe Piper as the first tenant

Profile from the published site (to confirm at step 8): B2B lead generation for companies in the **UAE and India**, founder-led from Dubai. Offer: a 14-day **Revive sprint** on a company's old leads with a refund below two qualified meetings, then a monthly engine. Best-fit buyers per the pricing page: B2B companies with **300 or more past leads that were never followed up**; decision-makers are founders, managing directors and heads of sales. Revive is the first package to pilot because it uses data the client already holds; Signal needs an entitled source, and Response and Events are marked in development on the site.

### Pilot results (observed in this session)

| Journey step | Tested how | Result |
|---|---|---|
| Account and organisation setup | Real migrations in PGlite, real Worker handlers, tenant named Ripe Piper | Passed |
| Mailbox and calendar connection | OAuth with PKCE against stubbed Google endpoints | Passed; live Google not tested (no OAuth app) |
| Prospect discovery | Synthetic reviewed contacts | Passed synthetically; no permitted live source configured |
| Enrichment and verification | n/a | Not built |
| Signal detection | Existing Signal tests | Passed synthetically |
| Messaging and campaign preparation | Drafts from the reviewed setup | Passed |
| Envelope approval and in-bounds campaign approval | Worker routes | Passed |
| Controlled execution | Synthetic sink only | Passed; no live send (not authorised, not wired) |
| Replies, meetings, CRM, reporting | Existing suite | Passed synthetically; no live reply or calendar proof |
| Onboarding status through every step | New acceptance test 8 | Passed |

No real prospect was contacted and no provider was called.

## 7. Engineering completed on this branch

- `src/foundation/onboarding.ts`: connector catalogue and onboarding status route; `registryList` reused from the connection module instead of a second query path.
- `src/index.ts`: route `GET /api/admin/tenants/{id}/onboarding` (read access; strangers get 404).
- `site/assets/portal.js`: "Getting started" panel with steps and the connector table, for client admins in both modes.
- Tests: acceptance test 8 in `test/hybrid-acceptance.test.ts`; portal UI test updated for the new call.

Remaining engineering, all blocked on the owner items above or recommended next: RP-013 live send (including marking a connection in error on a failed token refresh), Google token revocation on a client disconnect, reply detection, verification provider, per-mailbox cap and DNS check, HubSpot sync, grant-expiry warning.

Sources: [Apollo pricing (Zeliq)](https://www.zeliq.com/blog/apolloio-pricing), [Apollo vs ZoomInfo](https://apollo.io/insights/apollo-vs-zoominfo), [Clay pricing (Crustdata)](https://crustdata.com/reviews/clay), [Clay pricing change (SyncGTM)](https://www.syncgtm.com/blog/clay-pricing-change), [Instantly vs Smartlead vs lemlist (Valley)](https://www.joinvalley.co/blog/instantly-vs-smartlead-vs-lemlist), [G2 comparison](https://www.g2.com/compare/instantly-vs-smartlead-vs-lemlist), [HubSpot Prospecting Agent](https://www.hubspot.com/products/sales/ai-prospecting-agent?m=1), [Breeze Prospecting Agent guide (Octave)](https://www.octavehq.com/post/hubspot-breeze-prospecting-agent-complete-guide).
