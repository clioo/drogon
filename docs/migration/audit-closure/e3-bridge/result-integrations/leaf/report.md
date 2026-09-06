# E3 leaf: integration result contracts — github/gitlab/jira (exact 95)

Candidate leaf **result-contract** audit, **not** closure and **not** acceptance.
The parent independently reviews this evidence, traces its own remaining surface,
and owns aggregate `report.md` / `closure.json`. This leaf never ran tests,
invoked a provider, built, installed, started services, or changed credentials/
settings or product files.

- Task `task_bcfbb551f56a`, Dispatch `ctx_c0c5dec41f39`, leaf terminal
  `term_c469ce94-bf2b-4ba0-ba12-06cb450de4b5`, coordinator terminal
  `term_06b0aa79-c95c-4be8-826e-7fc44e92ad71`.
- **Live depth/invocation evidence:** preamble states "Audit-only depth2 leaf,
  no descendants"; provided task/dispatch/terminal/dispatch-capability fields.
  Process is the exact previously approved OpenCode
  `alibaba-token-plan/deepseek-v4-flash-0731 --auto` invocation (user
  authorized, per-launch, explicit denies enforced); the model string is
  preamble self-description, not a server-authenticated certificate. No child
  Run created; no delegation attempted.
- Source read-only: `/Users/carlos/Documents/Drogon-mentu-session` pinned
  `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. **Filesystem hashing only —
  no git command of any kind was executed** (including rev-parse/intent/status/
  hash-object). All hashes are SHA256 of current working bytes and inclusive
  read ranges, computed with a filesystem reader.
- Prior E5 reports frozen; this leaf writes ONLY
  `docs/migration/audit-closure/e3-bridge/result-integrations/leaf/report.md`
  and `contracts.json` (same directory).

## Scope — exact 95 methods

Input partition `docs/migration/e3-result-audit-partition.json` → assignments
`integrations` → the three fixed groups owned by this leaf:

| Group | Methods | Reconciled |
| --- | --- | --- |
| DR-GITHUB_METHODS | 50 | 50 |
| DR-GITLAB_METHODS | 21 | 21 |
| DR-JIRA_METHODS | 24 | 24 |
| **Total** | **95** | **95** |

No other group was resolved: repo/worktree/file/git/hosted-review/linear
contracts stay with the parent; `DR-MENTU_METHODS` remains explicitly
partition-excluded (already reused by the owner).

## Read-tier honesty (what was opened vs. what is only inherited)

**Full-body reads this leaf (all in `contracts.json` with inclusive anchors
and full/range SHA256):**

- 7 method modules: `github-repo-work-item-methods.ts` (117 lines),
  `github-issue-methods.ts` (61), `github-pull-request-methods.ts` (187),
  `github-pull-request-update-methods.ts` (177), `github-project-methods.ts`
  (210), `gitlab.ts` (318), `jira.ts` (281).
- 9 runtime command modules: `runtime-hosted-review-commands.ts`,
  `runtime-github-repository-query-commands.ts`,
  `runtime-github-issue-comment-commands.ts`,
  `runtime-github-review-query-commands.ts`,
  `runtime-github-review-mutation-commands.ts`,
  `runtime-github-project-commands.ts`, `runtime-gitlab-query-commands.ts`,
  `runtime-gitlab-mutation-commands.ts`, `runtime-jira-commands.ts`.
- 55 immediate client modules for the github/gitlab/jira services (the
  "immediate service implementation returns"), e.g. `github/issues.ts`,
  `issue-create/update/comment.ts`, `issue-field-options.ts`,
  `client/list·fetch·check·update·merge·create` modules, `project-view/*`
  (16 modules), `github/rate-limit.ts`, `github/work-item-details.ts`,
  `pull-request-file-contents.ts`, `gitlab/{gitlab-auth-and-rate-limit,
  merge-request-list,work-item-queries,issues,issue-update,
  project-label-and-member-lookup,work-item-details,pipeline-job-mutations,
  merge-request-state-mutations,merge-request-update,
  merge-request-review-mutations}`, `jira/{client,sites...}` and the jira
  issue search/read/mutations/comments/projects/create-metadata/transitions
  modules, plus the boundary helpers `gh-utils.ts`, `gitlab/gl-utils.ts`,
  `github/project-view/internals.ts` (`runGraphql`/`runRest`),
  `jira/authenticated-request.ts` (HTTP boundary + `JiraApiError`),
  `jira/site-credential-store.ts` (credential/file state).
- 3 direct method test files read **in full** as actual assertion bodies:
  `methods/github.test.ts` (869), `methods/gitlab.test.ts` (377),
  `methods/jira.test.ts` (223), plus the inherited
  `assertionEvidence/30` range in
  `src/main/ipc/runtime-environments-call-routing.test.ts` 543–632.

**Named seams stopped short of (source residuals, honest):** mapping/
formatter/annotation internals (`github/mappers`, `issue-work-item-details`,
`pull-request-file-data`, `work-item-participants`, `wark-item-field-coercion`,
`review-comment-response`, `branch-lookup-resolution`/`pr-branch-lookup`,
`github-pr-stack`, `pr-number-lookup`, `conflict-summary`,
`detectRepositoryMergeMetadata`; `gitlab/mappers`, `glab-api-response`,
`mr-discussion-notes`, `mr-file-diffs`, `mr-reviewers-and-approvals`,
`pipeline-job-graph`, `work-item-details` sub-reads; `jira/jira-issue-mapping`,
`adf-markdown`, `attachment-*`, `jira-issue-media`, `jira-record-pages`);
the shared gh/glab runner `src/main/git/runner` `ghExecFileAsync`/
`glabExecFileAsync` is the **named external subprocess boundary**; Jira's HTTP
boundary is `authenticated-request.ts` (Electron `net.fetch` internals in
`network/http-client` unread). These residuals are source-incomplete joins,
kept separate from the unrun fixtures below.

**Boundary (where each row stops):**
- GitHub: `ghExecFileAsync` (dots) subprocess spawn — `gh api ...`,
  `gh api graphql ...`, `gh pr ...`, `gh issue ...` (host pinned for GHES,
  `GH_PROMPT_DISABLED:1` on mutations); plus `git` runner for local remotes.
- GitLab: `glabExecFileAsync`/`glabApiWithHeaders` subprocess — `glab api ...`
  with `--hostname`/`--paginate`, `glab mr/issue ...`, 60s job-trace timeout.
- Jira: `jiraRequest`/`requestWithCredentials` → Electron `net.fetch` against
  `/rest/api/3` (cloud) or `/rest/api/2` (server/DC), non-browser UA (XSRF),
  Basic vs Bearer-PAT auth selection; credential files under `~/.orca/`.

## What the immediate service returns actually are (per-group highlights)

**GitHub:** list lineage returns structured envelopes that distinguish
empty-from-failure (`IssueListResult.error`, `ListWorkItemsResult.errors`),
while single-item lookups collapse to `null`; mutations return
`{ok,error}`/`boolean`/`GitHubCommentResult` with **mutation ordering and
partial-success state preserved** (createIssue oversized-body create-then-
patch with `bodySaveWarning`; updateIssue multi-leg error accumulation;
rerunPRChecks mid-loop "n already started"; mergePR stack/merge-queue
preflight; auto-merge refuses stacks and clean-status PRs). Rate limiting is a
per-host singleton/circuit-breaker that can *skip* a spawn and return `false`/
`0`/blocked guards; `noCache` controls `--cache` args. Host/version branches:
github.com vs GHES (host pinning), connection-backed requests fail closed when
the repo can't be resolved, WSL distro args.

**GitLab:** glab CLI, per-host `--hostname`, project ref from issue-source
preference; connection-backed calls **never fall back to cwd inference**
("No GitLab project found…" structured error). Pagination totals honor
`x-total`/`x-total-pages` with proxy-strip probes; `jobTrace` returns 404-missing
logs as `{ok,true,trace:""}` and the handler bounds excerpts pre-transport;
MR mutations treat "already closed/opened" as success; `workItemByPath`
records project recents on success.

**Jira:** HTTP REST, cloud `api/3` vs server `api/2` (createmeta path, user-
field ref `{accountId}` vs `{name}`, `username` vs `query` params, server
`/search` vs cloud `/search/jql`, server `/project` vs cloud `/project/search`);
`401` clears the stored site token and rethrows; read failures degrade to
`[]`/`null` (comment media falls back to un-inlined), single-vs-all site
failure surfacing rules; `lookupIssueSummary` throws typed
`JiraSummaryLookupError`; streaming methods chunk via `emitJiraPayload` and
throw over the transfer cap.

## Assertion bodies vs unrun pointers

- **Actual assertion bodies read (75 total `it`/`expect` blocks across the 3
  files + inherited `assertionEvidence/30`):** these are dispatcher-level
  projections (route/params/args, streaming chunk/end, rate-limit passthrough,
  listIssues normalization, job-trace excerpt bounding, summary site
  requirement). They mock the runtime and execute **no** client/provider body.
  `contracts.json` per-row `assertionBodyRefs` lists the exact
  method-relevant ranges; all are marked as route/projection evidence, not
  result proof (an annotation/formatter/admission/search hit is not a result).
- **Explicit unrun pointers:** the client-level suites referenced by the
  inherited allocation (e.g. `github/client-*`, `gitlab/client-mr-*`,
  `gitlab/work-item-details.test`, `jira/issues.test`,
  `jira/client.test`, `jira/jira-issue-mutations.test`,
  `jira/adf-markdown.test`, `jira/attachment-*.test`) were **not executed**
  and their bodies are not per-row audited here. They remain unrun fixtures,
  never as absence-proof: searches that miss do not prove a test doesn't exist;
  the prior no-test-pointers claim in the E5 leaf is explicitly not repeated.

## Reconciliation and gates

- Exact 95 = 50+21+24 per-method rows in `contracts.json`, each with
  `groupId`, `method`, `sourceEvidence` (handler definition + runtime command +
  client function, with inclusive start/end, range `sha256`, `fileSha256`),
  `resultContract`, `stateEffects`, `failureAndPartialSuccess`, `hostVersion`,
  `reusedContractRefs`, `originalTestAllocationRefs`, `assertionBodyRefs`,
  `remainingExecutionTests`, `sourceResiduals`.
- Inherited gates/allocation intact: `RPC-PARSE`, `RPC-ROUTE`, `RPC-HOST`,
  `RPC-RESULT`/`F-EXTERNAL` remain open in the parent ledger; source **defects**
  observed at the boundary (jira server wiki-markup comment media not rendered;
  `review-comment-response` id-`Date.now()` substitution guarded at call sites;
  `workItemByOwnerRepo` credential-safety restriction) are separated from
  intended corrections and are not counted as closed while local returns are
  unread.
- **No percentage advance:** rows add zero accepted groups; the root index
  stays frozen at **83.3% = 10/12 (unweighted), medium-low confidence**. No
  source/test/product parity acceptance is claimed by this leaf.

## Disposition

**candidate-for-parent-review.** Parent reconciles the leaf and independently
traces the remaining 169 method results while this entry stays a candidate.
No environment values, secrets, credentials or destinations were imported into
the artifacts; all byte evidence is the hashes in `contracts.json`.