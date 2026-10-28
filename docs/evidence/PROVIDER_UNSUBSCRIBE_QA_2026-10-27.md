# Independent QA — provider authority, tenant stops and operating controls

Date: 27 October 2026 (Asia/Dubai)  
Author: independent Goldfish actual-code QA agent  
Contract: LEAD_LIFECYCLE_SPEC.md §9.6, including the reviewed interface resolutions, historical Response outcome exception and legacy reminder clarification.  
Result: no unresolved implementation blocker found within the inspected scope. This is local source/fixture acceptance only. The root agent must bind this receipt to the final commit and record final regression/CI evidence separately.

## Independently executed evidence

Final consolidated run started at 23:51:42 local time and completed in 10.40 seconds: **8 files, 179 tests passed**. This includes the final tenant-stop migration/Response opt-out test and agency-only manual transcript correction.

Run from `platform/ripe-piper-platform`:

```powershell
node node_modules/vitest/vitest.mjs run test/qa-continuation-capability-boundaries.test.ts test/qa-continuation-authority-bypass.test.ts test/operating-controls.test.ts test/reminder-receipts.test.ts test/gmail-pause-fence.test.ts test/tenant-unsubscribe-db.test.ts test/connections.test.ts test/google.test.ts --maxWorkers=1
```

The two new QA files contain **44 adversarial cases**. The remaining cases are independently executed developer tests, not developer assertions copied into this result. PGlite tests apply the complete local migration chain; Google/provider interactions are intercepted synthetic fixtures. The repository network guard rejects unmocked fetches. Heavy PGlite runs were serialized with other agents.

Covered behavior:

- Private table/RPC browser denial, all nine Google authority/legacy/core function ACLs, verified staff checks, partial-null core bypass attempts, CAS/version/immutable namespace rules, revocation, pause/resume and credential rotation fences.
- Reserved Gmail source/thread handling, old RPC rejection, exact replay, historical Response outcomes after revocation, fabricated/foreign threads, and Worker-to-SQL registration/import/revocation.
- Tenant/address isolation, scoped Response opt-outs, historical global suppression preservation, stop/link locking, rate/cap/expiry/replay rules, queued/claimed action stops and terminal receipt preservation.
- Fixed lowercase capability format; independently computed UTF-8 hexadecimal-string digest; GET/HEAD nonmutation; hostile Host/Origin isolation; configured-origin validation; hash-only persistence; exact minimal confirmation receipts; malformed/foreign acknowledgements and redacted errors.
- Default-off exported/scheduled/manual operating controls, auth-before-disabled responses, redacted ads errors, agency-only manual transcript/lead queries, reminder receipt privacy, legacy-history uncertainty and no retry/delivery claims.

## Findings resolved or excluded

The interim monotonic-authority trigger conflicted with registration's INSERT ON CONFLICT path: BEFORE INSERT rejected higher versions before the update arm. Development replaced it with explicit insert/update under the tenant lock. The final consolidated run passed re-registration/rotation tests.

The possible direct authenticated Gmail evidence bypass was tested with a verified administrator and `is_admin() = true`. Its exact rejection is SQLSTATE `42501`, `permission denied for table outbound_actions`, now asserted in the QA test. The existing security-invoker Response `product_reply_stop` trigger attempts action mutations that browser roles cannot perform. This is an actual privilege boundary, not an unrelated foreign-key or shape failure; it is not described as a new Gmail-specific trigger.

The final manual `processMeeting` correction was reviewed and executed: meeting selection includes `tenant_id=is.null`, an explicit non-null/unknown scope fails 404 before transcript/provider/AI work, and associated lead lookup is agency-scoped.

## Scope, ownership and limits

This reviewer inspected implementation, SQL, route wiring and public/staff UI source, and modified only the two QA test files and this receipt. No implementation or pinned quality artifact was changed by QA. Removing those three added files reverses QA's changes without touching application behavior.

Rendered local browser checks belong to the root/development browser lane; this reviewer did not independently execute a browser renderer. Browser/viewport fixtures, final whole-repository regression, protected CI and the final commit binding must be recorded by root/PM. Earlier full-suite failures and their repairs are not converted into a final full-suite pass by this receipt.

No hosted migration, deployment, OAuth consent, real provider read/send, paid call or prospect communication occurred in these QA commands. Incremental external provider cost for these fixtures: none. Agent execution cost is not measured here.

Independent-connection concurrency, actual provider identity/delivery, Sheets append recovery, backup restore and hosted operational readiness remain unverified. Local PGlite and intercepted provider receipts do not establish those properties. Deployment and live-operation gates remain blocked pending their separate evidence and authorization.


## PM commit binding — 28 October 2026

Root/PM binds the independently inspected runtime and fixture source to commit d966be5d04d4c2401909967880fec8803e30478f. Final broad local regression passed1,397 backend tests across84 files and378 Node checks. CI run40626640581 / verify122613018044 passed that runtime SHA, including pinned-browser checks. The final documentation-only PR head must pass the normal protected checks before merge. See DELIVERY.md and PR #11 for publication and the static-preview exception; these PM facts do not expand this reviewer’s independently executed scope.
