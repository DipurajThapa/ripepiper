# Response conversation ownership and human resolution — 23 October 2026

Development source: PR #6 base `e4d976892af5e9c7d9d262d20b77310ca552f291`. This evidence describes a local development candidate; independent QA and final CI must separately accept its exact commit. No deployed or operating status is claimed.

## Implemented acceptance

- The existing Clients review now assigns/reassigns a current verified platform administrator or a verified owner of the selected tenant to an existing contact/thread. Owner labels come from current profiles; arbitrary owner text is not accepted.
- Human assignment/resolution appends a `response_review` observation using a service-only invoker RPC. The existing evidence graph and response hold remain authoritative; no separate conversation queue/table or job engine is added.
- The RPC locks the tenant, checks active/onboarding state, exact tenant/contact/thread/evidence mode, expected review version and the exact sorted set of reviewed incoming observation UUIDs. Concurrent or stale edits conflict. A request UUID permits an identical retry and rejects changed request reuse.
- Resolution records a reason and current evidence snapshot. Any newly imported inbound ID, including an older-dated message, reopens human review. Same-count replacement/deletion also invalidates the snapshot. Other conversation threads do not affect its snapshot.
- Current owner removal, role withdrawal, unverified identity or profile/email mismatch removes the owner from available choices. Shortlist projection marks unavailable-owner work for human reassignment rather than retaining a closed status silently.
- Resolution cannot resume a campaign, remove suppression, grant contact rights, qualify a lead automatically, send a message or create a booking. The existing reply-trigger hold and suppression SQL are unchanged.
- Direct authenticated ownership assertions are blocked by a trigger, regardless of the source label. The generic product-event route rejects this kind; only the dedicated staff review path can write it.

## Verification and limits

Local TypeScript and frontend syntax checks pass. Tests cover actual PGlite baseline-to-head migrations, private/invoker function ACLs, authorized owner choices, foreign/viewer/unverified owners, tenant/contact/mode scope, stale/concurrent writes, request replay/conflict, older-dated inbound, same-count replacement, owner unavailability, direct authenticated write denial, preserved suppression and cancelled follow-ups. HTTP tests derive the actor from authenticated staff and test stale-result conflicts. UI tests cover exact tenant/thread/version/snapshot payload, stable retry identity and late cross-tenant owner responses. The existing rendered-browser script now exercises loading authorized owners, resolution and refreshed version; local Chromium is unavailable, so rendered verification remains a CI requirement.

Migration `20261023094132_response_conversation_review.sql` was created with the existing Supabase CLI (`supabase@2.121.0 migration new`) and placed in the existing migration directory. It adds no table, seed, provider grant or live data. Required auth identity-column reads are granted only to the existing server service role; no anonymous/authenticated access is widened. SQL functions remain `SECURITY INVOKER`, with empty search paths and explicit execution grants.

Local mocks and PGlite do not establish live Supabase/Auth/PostgREST, multi-instance runtime or production provider acceptance. Direct privileged service writes remain a trusted administration boundary. Review state must be reloaded after an uncertain result; queued is never delivered.

## Rollback and next dependency

Before rollout, revert this candidate and keep the existing reply hold. No migration has been applied to a live environment. A future deployed rollback must retain review observations for audit; do not erase evidence to roll back UI behavior. Live OAuth, hosted migration rehearsal, release authorization and provider communication approval remain separate operational prerequisites.

RPC boundary follow-up: the HTTP adapter validates owner UUID/label arrays and exact review receipt UUID/version/replay boolean at runtime, returning 503 uncertainty on malformed values. Responses whitelist expected fields. Added null/object/scalar/wrong-version/invalid-identity and private-field regressions; no raw truthy acknowledgement can claim review success.
