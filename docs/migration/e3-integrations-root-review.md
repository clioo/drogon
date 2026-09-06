# Integrations root review — source fidelity correction required

**Not accepted as complete integrations source closure.** Structural verification passed264 method identities across10 groups,1253 range records/781 pinned source files,95 leaf methods/285 anchors,17 reused contracts,10 inherited contracts and three concurrent runtime snapshots. The unchanged9037-file/46-package allocation remains. Matching hashes do not demonstrate that an anchor covers the correct function body.

Root independently sampled repository settings, creation deduplication, folder teardown, upload publication/cleanup, generation account preparation, GitHub asynchronous merge, GitLab update, Jira ordered writes and Linear concurrency. Two consequential evidence failures require correction:

- `gitlab.updateMR` cites only the owning function signature, not its callback and validation/request/error/finally body.
- `jira.updateIssue` cites lines19–73 of `jira-issue-mutations.ts`, which belong to other functions. Its actual update body is86–137. Several Jira client operations repeat the same31–73 anchor; they need distinct actual caller-to-body reconciliation.

The95 inherited GitHub/GitLab/Jira methods receive a finite corrective review, not a new repository inventory or another account audit. Frozen reports remain unchanged for provenance. The root verifier also reconciles two named null method-range hashes against their independently verified global ledger values, and explicitly verifies relocated receiver references rather than treating their omission from copied group objects as coverage loss.

## Verified Linear correction and tests

`listTeams` **does await `acquire()`**. It then returns `fetchAllTeamsForWorkspace(...)` without awaiting it inside `try`; `finally` releases the permit early and a later rejection bypasses that local catch. The throwing and agent routes await the fetch. This overrides the frozen summary's incorrect claim that acquiring the permit was not awaited.

The complete unchanged original teams suite passed10/10. Four separate supplemental cases passed against unchanged original teams/page code and the real four-permit limiter: both routes block before admission; only the throwing route holds its permit through the unresolved provider promise; only that route runs local auth cleanup after asynchronous rejection. Client/token effects are mocked, and no provider, credentials or inference were used. These are source-characterization tests, not candidate parity or intended-fix GREEN. Both result files, six staged source files and each LICENSE were independently rechecked after execution. Exact hashes, commands and evidence boundaries are in the companion JSON.

## Coordination and remaining gate

Both final account/runtime-guard audit Tasks delivered and were officially released before acknowledging their delivery. Their reports await root acceptance. A fresh Task `task_acb9d86696bd` / Dispatch `ctx_72a82ca34450` reuses the exact live Astra integrations terminal solely for the95-method correction, writing `source-fidelity-corrections.md/json`; start receipt confirmed ready/input_accepted without setup, new model process or residual resources. It has no children. Prior audit processes have not been relabeled as Sol.

Audit remains10/12=83.3%, delta0, medium-low confidence. Next: final account/runtime reviews, corrected provider-body evidence and whole E3/E5 reconciliation. The flexible24-hour fidelity target remains high risk without an ETA. Product edits, installs and Sol implementation remain outside this source-review checkpoint.
