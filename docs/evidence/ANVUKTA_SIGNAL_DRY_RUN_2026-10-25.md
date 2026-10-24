# Anvukta — Ripe Signal dry run

Date: 25 October 2026 (Asia/Calcutta). Work item: existing RP-030 / M04. Target: local synthetic handoff, not live operation. Base: `e2cb80b13972e601dc54f8cc4780581479cc6cb7`; branch: `feature/anvukta-signal-dry-run`.

## What this exercise establishes

Use Anvukta's publicly described services to design a focused prospecting strategy, then exercise existing Ripe Piper code with fictional prospects and intercepted provider responses. No customer tenant is provisioned in hosted Supabase. No inbox is read, calendar changed, invitation sent or paid model invoked. The examples are not real leads or evidence of commercial demand.

The implementation has three distinct sections: Signal ingestion and qualification; a saved campaign draft whose execution remains held; and separate email/calendar adapter simulations. Passing those sections does **not** establish a continuous Signal-to-meeting production workflow.

## Business context and pilot strategy

Retrieved on 25 October 2026:

- [Anvukta services](https://www.anvukta.com/services): software/AI consulting, business operations, project recovery and Microsoft 365/Google Workspace migration. The current services page mentions UAE, United States, India and United Kingdom.
- [Business operations](https://www.anvukta.com/services/business-operations): workflow ownership, handoffs, reporting and vendor oversight. This page still describes UAE/India; the narrower wording is not treated as a definitive limit on all services.

The non-www homepage could not be retrieved by the research tool. The www service pages were readable. This is a retrieval limitation, not a diagnosed website outage. Website statements describe Anvukta's offer, not independently verified delivery results.

**Pilot decision:** begin with one offer and one market: business operations discovery for UAE construction businesses. This is a test hypothesis, not a confirmed most-profitable segment or a change to Anvukta's broader positioning.

| Element | Proposed pilot choice |
|---|---|
| Buyer | Owner, COO or operations leader who can sponsor a workflow review |
| Problem | Unclear handoff ownership, repeated follow-up or unreliable management reporting |
| Entry offer | A 15-minute fit conversation; agree a scoped operations diagnostic only if there is a substantiated problem |
| Useful first deliverable | One current workflow map, named decision owners and a short list of actionable control gaps |
| Trigger | Dated expansion/project announcement or operations hiring that warrants research; direct evidence of the problem is stronger |
| Qualification | Current evidence for industry, geography, buyer role and relevant need; missing facts remain unknown |
| Exclusions | Outside the chosen market/service, stale evidence, contradictory facts, suppressed contacts or no appropriate contact authority |
| Commercial unknowns | Budget, urgency, sponsorship, delivery capacity and purchase intent remain unknown until reviewed evidence or conversation establishes them |

Do not combine all four Anvukta services in one message. Route a documented migration need to a separate future campaign rather than stretching the operations offer to fit it.

## Discovery and prospecting method

1. Maintain the existing client business brief with its source and version. The test brief is explicitly synthetic and is not client approval.
2. Select a permitted company announcement, careers page or client-provided feed. Production access must be approved and bounded; a public page is not permission to email an individual.
3. Capture source URL/reference, date, exact supporting excerpt and expiry. Treat source instructions as untrusted text. Avoid guessing emails or extracting personal inbox content.
4. Preview the existing Signal feed, review an individual item and import using the exact digest. Re-import the same item to test duplicate handling.
5. Review the trigger separately from the contact's fit. A second fresh trigger must not refresh an older expired trigger.
6. Record supported industry, market, role and need through existing qualification. A new office without need evidence stays in research. Conflicting evidence stays in review.
7. Prepare a draft only for the relevant offer. Contact authority, current suppression, evidence freshness and client approval are separate requirements. Signal execution remains held in the current application.
8. Record review outcomes against the exact trigger. A positive reply, scheduled meeting, held meeting and opportunity are distinct events; none is inferred from a draft or provider test receipt.

Suggested searches for a future approved research session: `UAE construction company new project operations`, `site:<approved-company-domain> news expansion`, and `site:<approved-company-domain> careers operations`. These are discovery queries, not claims that matching companies have a problem. This dry run does not scrape or acquire real prospects.

### Discovery conversation

The first conversation should establish five things before a proposal: which handoff causes difficulty; one recent example and its business effect; who owns the process and can authorise change; the tools, vendors and information involved; and what improvement would count as useful. Ask about timing and budget after establishing the problem. Preserve the person's own answer and any uncertainty instead of filling missing answers with an AI inference.

### Fictional prospect examples

| Test case | Evidence supplied in the fixture | Correct treatment |
|---|---|---|
| Cedar Works (fictional) | Construction, AE, COO and workflow ownership need, separately reviewed | Candidate for operator review; buying intent and contact permission remain unknown |
| Dune Build (fictional) | Office-opening announcement without supported role/need | Research further; do not turn the announcement into qualification |
| Outside selected market | Same offer-relevant facts but a market outside AE | Exclude from this campaign, not from Anvukta's entire business |
| Contradictory or ambiguous evidence | Competing AE/GB market evidence or uncertain need wording | Hold for human review |
| Stale trigger | Expired or older-than-allowed signal | Refresh evidence; do not use another new trigger to revive it |
| Suppressed contact | Otherwise matching evidence plus suppression | Exclude from contact, irrespective of apparent fit |

These expected cases are an acceptance matrix. Only cases listed in the executed results below count as tested. Qualification points are a deterministic screening aid, not a conversion probability or proof that an asserted business need is true.

## Draft conversation strategy

All copy below is **proposed copy for fictional evidence, requiring human review**, not generated or delivered by the running product. Before any real use, replace fixture references with verified evidence, review contact authority and approve the exact sender and audience. No performance guarantee or invented case study is included.

**Initial email — proposed day 0**

Subject: Ownership across your new project handoffs

Hi [verified first name],

Your team's update mentions a new project and a review of handoff ownership. Anvukta helps teams clarify who owns each step and which decisions need attention.

Would a 15-minute conversation help you assess whether a focused workflow review would be useful? We can start with one handoff your team finds difficult.

Regards,  
Anvukta team

If this is not relevant, let me know and we will stop following up.

**Follow-up — proposed day 3, only if still permitted and no reply**

Subject: One workflow to start with

Hi [verified first name],

A practical starting point is to map one handoff, its owner and any decision that regularly waits. Would that be useful for the project mentioned in your update, or is another issue more pressing?

Regards,  
Anvukta team

If you prefer no further follow-up, please let me know.

**Close-out — proposed day 7, only if still permitted and no reply**

Subject: Closing the loop

Hi [verified first name],

I will close this follow-up for now. If workflow ownership becomes a priority, we can discuss the situation before recommending any work.

Regards,  
Anvukta team

These offsets fit the existing campaign draft structure. They are not scheduled sends. Stop on any reply, objection, opt-out, invalid address, expired authority or changed evidence. First validate relevance manually; do not claim an A/B winner from a tiny dummy sample.

## Email and calendar integration boundary

| Area | Dummy exercise | Requirement before real operation |
|---|---|---|
| Client identity | Fictional tenant and test mailbox | Exact Anvukta tenant binding and consented provider identity |
| Inbox/calendar check | Existing adapter calls with intercepted responses | Approved OAuth connection, matching mailbox/calendar and required access; ChatGPT login alone is not application consent |
| Outbound email | Separate adapter simulation with explicit fictional sender | Tenant-scoped sending authority, sender identity, suppression/reply checks, budget and uncertain-send recovery; current tenant connection is read-only |
| Availability | Simulated busy/free calendar response | Access to the selected calendar and current availability check |
| Meeting creation | Simulated provider event with exact ID, attendee, time and Meet acknowledgement | An approved tenant booking path, local reservation, concurrency/idempotency controls and provider reconciliation; the existing public consultation flow uses platform-level bookings, not tenant Signal scheduling |
| Branding | Proposed Anvukta email copy | Existing transactional booking templates are Ripe Piper-branded; they must not be presented as completed Anvukta templates |
| Attribution | Exact-trigger synthetic review outcome | Verified reply/meeting/opportunity evidence with reliable tenant, contact and trigger association |

A real sequence should offer a booking path after interest, recheck availability when a slot is selected, and issue a confirmation only after a verified provider event. A Meet URL must never be invented or advertised as booked while its receipt is uncertain. Calendar creation is not proof of attendance, qualification or an opportunity.

## Acceptance and results

Development executed `npx --no-install vitest run test/anvukta-signal-pilot.test.ts`: **20/20 passed** in 2.65 seconds. TypeScript passed. Independent QA separately executed **105/105 tests across seven files** in 5.68 seconds: the 20 new cases, 18 existing independent Signal safeguards and 67 existing Google/connection/consultation regressions. QA inspected the transport bridge, provider allowlists and business claims and found no blocking defect. Root's full `npm test` regression passed **977/977 tests across 65 files** in 59.95 seconds, with unchanged runner configuration and assertions. The harness remains 14/27; no operational stage is promoted. The new published CI receipt remains pending at commit time and will be recorded in the existing PR #9.

| Executed section | Observed result |
|---|---|
| Actual Worker → local PostgreSQL journey (1 test) | Two fictional contacts imported. Unreviewed and changed-source imports rejected. Replay returned the original lead/trigger. Unsupported qualification fact rejected. Cedar became a candidate only after four reviewed facts; Dune remained unknown. One manual first-message draft saved. Signal queue returned 409 before the SQL writer. Wrong-trigger outcome rejected; correct outcome replay produced one attributed record. Zero contact-rights, outbound-action and tenant-meeting rows. |
| Existing qualification/product rules (7 cases) | Matching, outside-market, ambiguous, conflicting, suppressed, stale-trigger and reply-hold cases returned the expected distinct states. All retained `contactAllowed:false`; stale evidence did not make a booking available. |
| Shared email/calendar adapters (12 cases) | Exact fictional sender/recipient/content and message receipt; malformed receipts rejected without retry; missing/revoked credentials and final suppression check blocked mutation; availability and exact meeting acknowledgement validated; uncertain insertion reconciled by reading the same event without reinviting; wrong identity, attendee, time, unsafe link and cancelled event rejected; definitive calendar denial not retried. |

Fixture file: [anvukta-signal-pilot.test.ts](../../platform/ripe-piper-platform/test/anvukta-signal-pilot.test.ts). SHA-256: `0f2cc6275d0a64f73b3c70b58ceda5994abf0832aa2ee66d109a0a4ac4ba123a`. The source is exercised through actual application functions and local PostgreSQL, with an allowlisted transport bridge rather than hosted Auth/PostgREST. All provider fetches are intercepted. The synthetic Google Meet URL is test data and must not be used as a real meeting link.

The API test saves one manual first-message draft, not the proposed three-email sequence above. Its queue rejection occurs while the campaign is a draft; the separately rerun independent Signal tests establish that generic approval and historical claims cannot bypass the execution hold. It does not implement autonomous strategy generation or scheduled discovery. No new application code, schema or frontend is introduced by this rehearsal. Live conversion rates, mailbox deliverability, real calendar access and tenant-specific sending/booking remain unverified.

Reproduce from `platform/ripe-piper-platform` with existing locked dependencies: `npx --no-install vitest run test/anvukta-signal-pilot.test.ts`, then `npm run typecheck`. The existing test setup blocks unmocked network calls. Do not repoint this test at hosted credentials. Rollback removes only the test/report/tracker additions; retain the underlying Signal execution guard.

## Next implementation priorities

1. Bind a reviewed Signal strategy, message and audience to the exact current brief and trigger through approval, enrolment, claim and completion. Retain the existing execution hold until this is implemented and independently verified.
2. Complete tenant-specific outbound sender and booking controls using the current adapters and ledger. Do not enable sending through the read-only connection configuration.
3. Add approved-source scheduling and health checks to the existing feed workflow. Establish source entitlement and network controls before live acquisition.
4. Run a small owner-reviewed live pilot only after the hosted runtime and authorised provider path are verified. Measure accepted candidates, reasons for rejection, reviewer effort, positive replies, meetings held and actual opportunities. Set a baseline before claiming improvement.

There is no owner action required to complete this dummy exercise. A later live integration needs account consent and the exact test calendar; credentials belong in scoped service secrets, not this document or chat. No additional budget has been consumed by provider calls in this exercise; prior account usage has not been reconciled and the US$20 total build limit remains in force.
