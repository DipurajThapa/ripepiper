# Consultation receipts and conservative attendance — 23 October 2026

Development base `6aee9ca`. Scope: existing consultation job and Meetings UI, using the existing meetings table. This is offline verification, not provider release or hosted operational acceptance. No production migration/data write, deployment, provider call, email, paid AI call or cost occurred.

## Behaviour and authority

`CONSULTATION_REMINDERS_ENABLED` is default off and returns before database/provider access. No binding or cron was enabled. Existing NULL-tenant consultations never enter tenant campaign actions. WhatsApp side-sends and notes-ready email alerts are withheld because they lack reconciled receipts; notes remain visible in Meetings.

One bounded receipt per 24h/1h window stores the claim UUID, booking snapshot and lease. Service-only invoker RPCs claim once, authorize once and recheck the current booking after OAuth refresh immediately before Gmail mutation. Only a strict Gmail message identifier permits the canonical reminder timestamp. Gmail acceptance does not prove recipient delivery. Lost claim acknowledgement, malformed receipt, expired lease, provider timeout or uncertain database acknowledgement never authorizes automatic resend. Uncertainty in an earlier window also blocks later windows. Legacy timestamps are preserved without fabricating provider acknowledgement.

Cancellation/rebooking/recipient changes invalidate pending claims. Cancellation after the provider request starts cannot undo it; the original provider message identity/snapshot remains for review, and a changed-booking acknowledgement does not create a canonical reminder timestamp. The existing detail shows receipt state, original recipient/time/event and recovery reason, with no resend button. Provider read reconciliation and separately authorized recovery remain open.

Transcripts, absent records, provider errors, partial rosters and participant counts never prove attendance/absence. Scheduled and manual processing share one draft-saving helper. Notes cannot set held/no_show or advance the lead. Unsupported ended meetings become neutral `attendance_unknown` plus needs_review, releasing the existing active-consultation uniqueness constraint. Bookings remain reserved during the initial waiting period. Historical statuses/timestamps receive no backfill.

Explicit review requires current verified staff identity, exact booking snapshot, version CAS, stable request UUID, evidence reference and reason. Held requires confirmed intended-attendee evidence; no-show additionally requires a complete authoritative attendance record. Unknown is neutral. Decisions record actor/date/history; direct authenticated metadata/timestamp/held/no_show assertions are guarded. Booking changes invalidate attendance/version and archive prior evidence privately. Held corrections retract only a still-derived meeting_held lead projection when no other reviewed held meeting supports it, preserving later sales states. Legacy unverified attribution is not silently rewritten.

## Verification

TypeScript and all 380 local backend tests across 27 files pass. Fifty new focused tests cover PGlite migration/RPCs, staff/scope, fencing, overlap, lost responses, strict Gmail/RPC acknowledgements, ISO/future leases, cancellation during OAuth refresh, replay, direct authenticated bypass, CAS/evidence, source absence, preservation of explicit review, booking invalidation, attribution correction and historical unknown/current rebooking.

An actual Worker attendance-route test reaches the real versioned PGlite RPC through a synthetic PostgREST adapter and verifies stored neutral attendance. All 64 Node UI/safety tests pass, including four attendance/recovery UI tests. Existing rendered browser acceptance now covers staff attendance and held receipt display alongside meeting reconciliation. Local Chromium is unavailable; rendered execution remains a CI requirement, not a claimed local pass.

Migration `20261023103840_consultation_reminder_receipts.sql` was generated with the pinned Supabase CLI. Invoker RPCs have empty search paths and explicit service-only grants. Hosted application, Auth/PostgREST sessions, separate-connection concurrency, mailbox identity and owner-authorized provider release remain pending independent acceptance.

## Rollback

Before release, revert the candidate. Never reactivate the old claim-before-send job as recovery. After any future deployment, disable the reminder flag first and preserve receipts, attendance evidence and additive status values. Do not restore an older CHECK while attendance_unknown rows exist; physical downgrade/data correction requires a separate reviewed plan. No duplicate queue, scheduler or workflow engine was added.
