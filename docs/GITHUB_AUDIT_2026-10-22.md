# GitHub repository audit and cleanup — 2026-10-22

Scope: DipurajThapa/ripepiper, current branches, PRs, Actions runs, repository layout and readable protection rules. This is repository maintenance within M01, not acceptance of the application defects tracked for M02–M07.

## Findings and disposition

| Finding | Evidence | Resolution |
|---|---|---|
| Latest PR #3 check failed although tests passed | Run 39740372340, job 119695869355: npm audit waited five minutes then reported a registry network timeout. All 59 tests passed. Same commit's push run 39740367542 succeeded. | Add a bounded audit runner with up to three attempts for transient service failures. Invalid responses, persistent outages and high/critical findings remain blocking. Seven synthetic regression tests cover the gate. |
| Duplicate push and PR runs for each feature update | Actions run inventory contains both events for each reviewed commit. | Run on PRs and main pushes, plus manual dispatch. Feature work must have a draft PR; do not use paths filters that could leave required checks pending. |
| Deprecated Node 20 action runtime | Failed-run footer names checkout@v4 and setup-node@v4. | Use official checkout v7.0.1 and setup-node v7.1.0, pinned to verified full commit SHAs; both action manifests specify node24. Disable persisted checkout credentials. |
| Root README provides no operating guidance | README contained only repository name. | Add layout, safe commands, current-document links and branch/release authority. Describe managed on-demand services, not self-service SaaS. |
| Historical reports conflict with current evidence | Older reports say Supabase migrations and test execution are unverified; later audit and tests establish otherwise. | Keep historical content and add explicit links to superseding evidence. |
| Branch list appears duplicated in screenshot | GitHub displays the same two branches under Your branches and Active branches. API returns three unique branches total. | No duplicates to delete. Main is production; both review branches have unmerged work. PR #1 is already closed and its branch is absent. |
| Protection previously lacked complete readback | Earlier classic-protection API unavailable. | Ruleset 25620118 is now readable and active on refs/heads/main: PR, one approval, stale dismissal, resolved threads, strict verify from GitHub Actions, no deletion/non-fast-forward, no bypass actors; current user can never bypass. Full required control set verified through ruleset API. |

## Preserved boundaries

- Main stays at d6c1091360eacae7a001e5aa191c850a4df42ff6. No merge, force push, branch deletion, history rewrite, production configuration/data/schema change or prospect communication.
- Keep draft PR #2 as the dependency and draft PR #3 as the current maintenance candidate. Their stacked relationship is intentional, not duplicate work.
- No ordinary open issues were returned; the two open issue-list entries are PRs. Application defects remain in docs/DELIVERY.md, not falsely closed here.
- No generated output, node_modules or secret environment files are tracked in the current 97-file tree. This inventory is not a comprehensive historical secret scan.
- Secret-scanning/Dependabot alert inventories and organization-wide policy were not available in this audit. Do not claim all possible security issues are absent.
- Existing Cloudflare preview automation remains unchanged. Hardened preview testing is local/CI; live provider operations are outside this milestone.

## Verification and reversal

The new audit-gate tests exercise successful/low-severity results, high/critical rejection, transient recovery, timeouts, retry exhaustion and malformed reports without network calls. Existing application and preview suites remain required. CI must pass on the cleanup commit before M01 closure.

Revert the cleanup commit on the feature branch to reverse these changes. No database reversal is needed. Full application readiness is still NO-GO until the remaining milestone acceptance criteria are met.

Final result: cleanup candidate `e1318d6e4cfe9889fc5fee65979778b65d51285e` passed [GitHub CI](https://github.com/DipurajThapa/ripepiper/actions/runs/39741792158), including 66 tests and all remaining gates. Main protection is verified. M01 is complete for development; remaining application risks stay open in the backlog.
