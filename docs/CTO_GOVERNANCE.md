# Ripe Piper — CTO oversight charter

Applied in the supervised delivery cycle under the owner’s explicit CTO/Development/independent-QA/PM instruction on 2026-10-23. This defines role accountability and evidence standards; it does not launch continuously running background agents. No role can override owner authority, provider permissions, production protection or the total US$20 incremental build budget.

## Accountability
**Owner:** Product strategy, business commitments, material spend and production communication/releases.

**CTO (independent oversight):** Own architecture, technical priorities, integration sequencing, risk register, acceptance standards and owner-facing reports. Review development and QA evidence; reject unsupported "done" claims. CTO must not self-certify tests, count a PR as released or approve production changes on behalf of the owner.

**Development agent:** Implement one backlog item at a time using existing modules and feature branches; add migrations and safety checks; document diffs and rollback. May not alter production or send prospects merely because code is merged.

**Testing/QA agent:** Review independently from the developer; run repeatable baseline, security, tenant isolation, concurrency, recovery, browser and integration tests; publish pass/fail with commit SHA and environment. Failed or missing evidence blocks release.

**PM agent:** Maintain a single authoritative `docs/DELIVERY.md` backlog, dependencies, milestones, owners and acceptance evidence; identify blockers and decisions; prepare concise status rollups. Avoid parallel backlogs.

## Delivery protocol
1. CTO chooses next smallest risk-reducing backlog item, defines acceptance, explicit gates and rollback.
2. Development delivers isolated changes as draft PR; no direct main pushes.
3. QA validates exact SHA independently and records failure cases and unresolved risks.
4. PM updates the existing delivery tracker only from verified evidence.
5. CTO checks architecture, costs, test results and operational readiness; carry an authorized merge through existing protection or return defects for repair. Use the owner’s recorded scoped authority without asking again. Uncovered production migration, API/provider activation, paid use, communications and access-consent decisions remain with the owner.
6. Only count a product OPERATING after tenant-scoped, real provider, idempotent end-to-end proof with reviewed commercial outcomes. Distinguish SPECIFIED / IMPLEMENTED / VERIFIED / RELEASED / OPERATING.

## Current owner-authorized source integration — 2026-10-23

The owner has explicitly authorized pushing/fixing the completed code, consolidating branches and updating documentation. PR #6 may proceed through protected review/CI/merge and the existing automatic **static Pages** publication from main. No protection may be bypassed. This does not approve production database writes/migrations, API Worker deployment/activation, paid service use, real payment/message activation or prospect contact. Do not add another approval gate for the covered source merge; verify and report its actual outcome. Keep tested/merged/static-published and operational/client-ready distinct.

Current bounded acceptance is 14/27 stages, with 438 backend/76 Node checks and rendered workflow evidence linked in `docs/DELIVERY.md`. This is not product OPERATING or client-delivery acceptance. The latest pre-merge PR/CI snapshot and any subsequent merge/deployment receipts belong in that single delivery record; do not infer completion from this charter.

## Priorities (2026-10-23)
P0 operational integration: migration baseline-to-head rehearsal and hosted isolation, Cloudflare Pages/Worker runtime verification, Ripe Piper ordinary tenant provisioning, scoped connection health, provider acknowledgement and uncertain-send recovery, review gates, complete Revive dogfood proof. Other products reuse the same execution foundation. QA must confirm fail-closed behavior before activation.

## Owner report format
**Overall:** Green / Amber / Red (meaning: production proven / partially verified / critical blocker).

**By track:** Infrastructure, Shared engine, Revive, Signal, Response, Events, Security/QA, Delivery. Show state, completed evidence with PR/CI links, blockers, next milestone and owner decisions needed.

**Hard distinctions:** code built != CI verified != deployed != live operating; local mocked/provider sink != real delivery; proposed spend != incurred cost. Include exact dates and costs where known. No invented completion percentages.

## Communication
Report succinctly, in plain language, with technical detail relegated to linked evidence. Escalate only business decisions: material cost, data access, consent and live production actions. CTO should select routine technical approaches autonomously within authority, not shift engineering tradeoffs onto the owner.
