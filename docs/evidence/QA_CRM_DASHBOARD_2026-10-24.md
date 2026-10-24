# Independent QA: existing admin CRM redesign

**Local acceptance: passed.** The candidate extends the existing admin shell on base `a0cbdcf4bcada6c30759d9a76624f4b51fefc9d7`; immutable publication and official CI are pending. It does not establish live authentication, hosted API operation, provider delivery or production readiness.

## Scope and isolation

The existing admin HTML, branding, data queries and product panels remain the application. The change adds an overview, admin navigation, inquiry search and grouped client workflow views. No replacement website, database migration or second workflow engine was introduced.

Independent QA owns `scripts/crm-browser-check.mjs` and this evidence. Development/root changed the application and CSS. The browser program loads the real whole admin HTML, styles, `app-common.js`, `admin.js` and product modules in their actual script order. It does not replace `window.RP` or bypass its authentication/UI code. Supabase SDK/session/query results and the allowed read APIs are explicitly synthetic; all requests are intercepted. Unexpected external requests fail acceptance, database writes throw, unapproved API actions are blocked, and sign-in/message/provider operations are never initiated.

## Executed rendered acceptance

The pinned Playwright package initially could not launch because its local Chromium executable was absent. Root installed an isolated temporary Chromium 153 runtime outside the repository and supplied an external launch preload. QA independently ran the unchanged browser program through that launcher after the final application changes:

```sh
node /tmp/ripepiper-crm-qa-render.mjs
```

**Result: passed**, with no page errors, unhandled rejections, database writes or unexpected external requests. This is actual local Chromium rendering. Official CI uses its separately installed pinned Chromium 151 and remains a separate pending receipt.

The program covers ten complete shell scenarios: sample, connected, empty, partial, database error, rejected read, non-admin, failed admin lookup, signed-out and delayed loading. It verifies:

- Overview is the default. The real admin navigation handles direct hashes, browser back/forward and keyboard activation. Exactly one top-level panel is visible.
- Sample records are labelled illustrative. Connected counts describe loaded records; no fabricated conversion percentage, uplift, delivery or revenue metric appears. Tenant-owned prospects are excluded from the public inquiry table and count.
- Name/email/company search and status filtering combine correctly and can be cleared. Keyboard selection opens the existing client record.
- Client workflow navigation groups the existing account, brief, setup, campaign, Signal and Events panels. Switching views, or visiting another top-level section and returning, preserves unsaved brief/setup inputs rather than rebuilding the workflow.
- The actual data loader requests exact counts for all five datasets. A 301-inquiry fixture yields an explicitly limited snapshot rather than an asserted database total.
- Empty connected data is distinct from loading or failed reads. Errors/rejections do not become successful zero-valued dashboards. Refresh failure suppresses current overview counts, labels retained tables as a previous snapshot, and a successful retry restores the dashboard without a mutation.
- Anonymous, non-admin and failed-profile states cannot expose data panels/navigation or fetch CRM datasets. A failed profile response containing `is_admin:true` still does not authorize the UI.
- All six top-level sections and all six client workflow views remain within the document width at 390px; desktop rendering is checked at 1280px. Each mobile navigation label must also fit inside its own link.

## Visual defect reproduced and fixed

Initial document-width checks passed, but independent inspection of the actual 390px screenshot found overlapping navigation icons/labels. Each flex link had shrunk below the width of its contents. QA added an assertion for each link's `scrollWidth <= clientWidth + 1` and reproduced the defect in Chromium using the captured pre-fix CSS, without editing implementation files.

All six links failed: their contents required **82–98px**, while their available widths were **50–56px**. The captured stylesheet SHA-256 was `cb54b6cda85a115ea229057b3919e7c165a8c609943f696f6fb19bae5e4dc069`.

Root fixed the existing mobile rule with `flex:0 0 auto; white-space:nowrap`, preserving the navigation container's own horizontal scrolling. **The same new assertion and entire browser suite then passed.** Independent desktop and mobile screenshot review confirmed readable, non-overlapping navigation, aligned cards/charts, usable form grouping and no clipping. Inline SVG navigation icons also remain visible when external fonts are unavailable.

The screenshots were generated from synthetic fixtures. They are not screenshots of a connected production account. Global document width alone is not treated as sufficient visual acceptance.

## Source and regression review

Independent review confirms atomic replacement of loaded data after validation of all five read results; explicit count/limit coverage; unavailable dashboard on failure; preserved old tables with a stale-data warning; strict `profiles.is_admin === true` with profile-error rejection; and initially hidden panels/navigation. Admin-only navigation leaves shared `RP.tabs` unchanged. Each existing product panel appears once, and view switching changes visibility rather than duplicating or replacing product logic.

QA independently ran:

```sh
node --test scripts/crm-dashboard.test.mjs
node --check scripts/crm-browser-check.mjs
```

**14 dashboard model/render checks passed**, covering UTC date boundaries, invalid/future dates, exact loaded KPI categories, unknown statuses, reviewed attendance distinctions, partial coverage, read-only model behaviour, escaped content and accessible textual chart equivalents. Syntax and whitespace checks passed.

Root's logs were read directly: **927 backend checks / 61 files**, **171 Node checks**, zero high/critical/total dependency findings, and successful combined existing product + new CRM browser programs plus the Signal browser program. The full regression commands were run by root; the whole CRM browser rerun and 14 model checks above were executed independently by QA. The local browser regressions use Chromium 153, not the official CI browser.

No backend, production configuration or `app-common.js` changes are present in this redesign diff. Existing server authorization, tenant boundaries, approval/rights gates, source/audience/strategy bindings and provider restrictions remain subject to their prior regression evidence. This frontend test does not replace actual Auth/API acceptance.

## Source hashes at local acceptance

| File | SHA-256 |
| --- | --- |
| `site/admin/index.html` | `cbfe5cc0cf4b535097c56a2936874da29d7ebf9493c5a1d2030a83c52138bbe6` |
| `site/assets/admin.css` | `a23ce3c5b0d4e1049eb2910727b08cf35ad1a44a3c3721ca3130a6ea4509cff1` |
| `site/assets/admin.js` | `3b9fe08c378378a554d9e6ce710a2d3441e2e5609dad0bf5b9d8eed6b106dd15` |
| `site/assets/crm-dashboard.js` | `342bcbcf6797fddbc9384f1827e59473a3dfa24d54686478374e2d766c236a48` |
| `scripts/crm-browser-check.mjs` | `4af21bf3747725db0d51ccdb0f5eff34b68597c870e5bcf0b9ef6a31556936d1` |
| `scripts/product-browser-check.mjs` | `b47ff189c874cdb091df0cc5565e5db865dda3ba1f84975ae0f7f6c71b9e9caf` |
| Unchanged `site/assets/app-common.js` | `7269031fd0c313c238fdcc92502b8a5f89fed9834efcb26447d4cd64cc503bca` |

The new CRM browser program is imported by the existing rendered product check, preserving the existing CI stage. No additional deployment workflow or operational approval is inferred. Published commit/tree linkage and official CI rendering will be recorded separately after publication.
