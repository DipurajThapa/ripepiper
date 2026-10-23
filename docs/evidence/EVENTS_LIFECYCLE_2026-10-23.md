# Events registration lifecycle rehearsal — 23 October 2026

Development base: ownership candidate `02fb122e758e87dcab10b91b13f71850ca3711b9`, itself based on PR #6 `e4d976892af5e9c7d9d262d20b77310ca552f291`. This is an offline/synthetic vertical slice, not live Events operating acceptance. Independent QA and final CI must bind their results to the final integrated candidate.

## Implemented

The existing Events campaign is the event identity. Staff configure a bounded title, UTC start/end, IANA timezone, event-only notice, capacity (1–100) and registration intent through versioned settings. Each material change appends a private before/after activity entry. Same-body retry is idempotent. Changes after initial configuration invalidate the campaign's previous message approval, cancel queued actions and hold claimed actions. Actual registration availability requires a current approved message version/brief, active tenant, unexpired campaign and future event. Stored open intent alone never makes an event available; reapproval is required after a change.

Default-off public metadata and registration routes require both `EVENT_REGISTRATION_ENABLED=true` and `SYNTHETIC_SINK_ENABLED=true`. Database functions independently restrict intake to `.invalid` contacts. Non-local registration requires Turnstile. Every registration is event-only, identity-unverified and attendance-unknown; it creates no contact right, marketing permission, reviewed qualification, message, reminder or calendar event.

Registration reuses tenant/email contact identity and stores unreviewed intake in existing lead observations. Raw intake is excluded from the existing reviewed product projection. Staff retain the existing product-history review gate for registration/attendance classification. No new event/contact table, queue or workflow engine is added.

A client-generated random control code is hashed with SHA-256 before the database boundary. Neither plaintext code nor digest is returned in operator listings. Same-code/email/name/original-version replay returns the existing receipt; a different code cannot manage an earlier registration for that address. Read-only committed-receipt recovery avoids replaying Turnstile after a lost response. Cancellation is idempotent, does not resurrect on registration replay, and frees the capacity slot. Rescheduled registrations remain `schedule_changed` until acknowledgement of the current version, after required message reapproval. Lifecycle changes and receipt recovery expire seven days after the retained event end. Independent QA identified an initially inconsistent recovery window; the shared receipt projection now enforces expiry for read-only recovery and original registration replay too, while preserving the underlying history. Tenant locks serialize registration capacity and lifecycle changes.

Runtime RPC receipts are validated and whitelisted: expected event ID, registration UUID, recognized state, appropriate version/acknowledgement version, identity-unverified status, unknown attendance, no marketing permission and no-send status. Null/scalar/malformed/wrong-event/wrong-version results produce uncertainty instead of success. Staff settings acknowledgements and public metadata are also validated. Direct authenticated raw-intake writes and RPC invocation are denied, including for signed-in platform administrators outside the service route.

## Verification

Local backend/PGlite/API suite: 226 tests pass (including 30 Events lifecycle tests); TypeScript passes. All 41 UI/development-safety tests pass, including three Events UI checks. Targeted coverage includes configuration CAS, private audit, malformed acknowledgements, replay/reference conflict, duplicate email with another code, atomic capacity, cancellation replay, rescheduling/current-version acknowledgement, message-approval invalidation, expired capability, paused/expired campaigns, wrong-event/wrong-token scope, fixed synthetic-only identity, Turnstile, unreviewed-intake exclusion and no contact-rights grant.

An integration test exercises actual Worker GET/POST routes through a synthetic PostgREST adapter into the real PGlite lifecycle RPCs: metadata, registration, replay and cancellation, with no outbound action created. The existing rendered-browser script now exercises event configuration, synthetic registration and cancellation alongside the four product workflows. Local Chromium remains unavailable, so rendered execution is a final CI requirement, not claimed passed here.

Migration `20261023095346_events_registration_lifecycle.sql` was generated with `supabase@2.121.0 migration new` in the existing migration directory. No live migration, binding change, deployment, paid call, provider grant or real prospect communication occurred.

## Remaining operational scope

Real attendee verification, real public registration rollout, registration/reminder delivery, provider calendar reconciliation, hosted Auth/PostgREST/concurrency evidence and owner-authorized release remain open. No conversion, attendance or lead quality uplift is inferred from registration. This milestone does not satisfy full Events operational acceptance.

Rollback before release is reverting the code candidate. No deployed data exists from these tests. A future deployed rollback must preserve lifecycle observations/private audit; do not erase registration evidence or capability hashes as an application rollback.
