# Ripe Piper — delivery governance

How the owner, CTO, Development, independent QA and PM roles divide accountability, accept work and report status. Agent sessions also follow [harness/AGENTS.md](../harness/AGENTS.md), which defines the stage gate. Current status, backlog and blockers live only in [DELIVERY.md](DELIVERY.md).

These are roles applied in supervised sessions. No file here launches background agents, and no role can override owner authority, provider permissions, production protection or the total build budget recorded in DELIVERY.md.

## Accountability

**Owner:** product strategy, business commitments, spend, production releases and any communication to real prospects or clients.

**CTO:** architecture, technical priorities, integration order, risk, acceptance criteria and owner-facing reports. Reviews Development and QA evidence and rejects unsupported "done" claims. Chooses routine technical approaches without escalating them. Cannot self-certify tests, treat a merged PR as released, or approve production changes for the owner.

**Development:** implements one assigned item at a time on a feature branch, reusing existing modules. Adds migrations, tests and safety checks; records the diff and rollback. Merged code does not authorise production changes or sends.

**Independent QA:** tests separately from the developer, against the exact commit: baseline, security, tenant isolation, concurrency, recovery, browser and integration paths. Records pass/fail with commit SHA, environment and failure cases. Missing or failed evidence blocks acceptance. QA does not certify its own implementation changes.

**PM:** accountable for delivery through formal owner closure. Keeps `docs/DELIVERY.md` as the single backlog (no parallel trackers), records stage status in `harness/ledger.json`, tracks owners, dependencies, blockers and decisions, and reports status. Cannot infer missing acceptance or certify engineering results.

## Delivery protocol

1. CTO picks the next smallest risk-reducing item and defines acceptance, gates and rollback.
2. Development delivers it as a PR from a branch. No direct pushes to main (`.githooks/pre-push` blocks them).
3. QA validates the exact SHA independently and records failures and open risks.
4. PM updates DELIVERY.md and the ledger only from verified evidence, then runs `node harness/evaluate.mjs`.
5. CTO checks architecture, cost, test results and readiness, then merges through existing branch protection or returns defects. Uses the owner's recorded authority without asking again; production migrations, Worker deployment, provider or payment activation, paid usage and real outreach stay with the owner.
6. Failed or regressed stages are reopened and their downstream stages blocked until re-verified.
7. The project closes only when each product is accepted against its written criteria, monitoring and recovery are proved, handover is complete and the owner signs off.

## Status meanings

- **NOT STARTED**: no accepted evidence.
- **IN PROGRESS**: implementation active, unverified.
- **BLOCKED**: missing dependency, authority, environment or a failed check.
- **VERIFIED**: passing evidence, independent QA and PM acceptance in the recorded environment.
- **RELEASED**: owner-approved and deployed.
- **OPERATING**: a real, tenant-scoped, idempotent end-to-end journey with observed provider outcomes and reviewed commercial results.

The ledger gate only knows `not_started`, `in_progress`, `blocked` and `verified`. RELEASED and OPERATING are recorded in DELIVERY.md after separate review.

## Unblocking and escalation

A missing external dependency must not stop safe work. For each blocked stage:

1. Confirm the exact blocker and find work that can proceed with local fixtures, test sinks, mock adapters, read-only checks or prepared PRs.
2. Split work into offline implementation, integration verification and owner-gated production action. A blocked live connection does not block tests or code.
3. CTO chooses between safe technical alternatives; nothing may weaken access rights, tenant isolation, budget, QA or release safety.
4. Escalate only actions only the owner can take: name the account or service, the reason, exact steps, expected cost, the consequence, and what engineering continues meanwhile. Record each question in DELIVERY.md and do not ask it twice.

Never treat a simulated provider success as a delivered message, and never silently incur hourly service costs.

## Owner report format

- **Overall:** Green (production proven), Amber (partially verified) or Red (critical blocker).
- **By track:** Infrastructure, Shared engine, Revive, Signal, Response, Events, Security/QA, Delivery. For each: state, evidence with PR/CI links, blockers, next milestone and owner decisions needed.
- **Keep distinct:** code built, CI verified, deployed and live operating; local mock or provider sink versus real delivery; proposed versus incurred cost. Give exact dates and costs where known. No invented completion percentages.

Report briefly in plain language with technical detail linked. Escalate only business decisions: material cost, data access, consent and live production actions.
