# Mobile call-flow review: corrected lower bound

Coordinator review after `b09e289`, pinned read-only source
`c97906287bb7a390b25e2025b600d9fb3c25d9c3`.
Machine evidence: [review map](parity-mobile-method-review.json).

All31 remaining nonliteral member-call candidates now have a bounded
receiver/caller attribution. This closes that source-attribution slice, **not**
the whole mobile inventory, original suite, rewrite or audit gate.
Forty source files were checked against checkout and pinned Git;
full/partial read tiers and intervals are explicit in the machine record.
Previously accepted single-flight/capability evidence is reused from `b09e289`.

## Corrected accounting

| Evidence set | Distinct names |
| --- | ---: |
| Original direct-literal set | 156 |
| Previously reviewed conditional additions | 7 |
| Names added by tracing the remaining wrappers | 45 |
| Member-call-flow lower bound | 208 |
| Separately traced bare capability advisory | 1 |
| Combined known mobile lower bound | 209 |

The31 sites still comprise19 wrapper calls,8 transport-forwarding calls and4
non-RPC callback calls. Site counts are not distinct method counts. Seventy-two
names are attributable to the reviewed wrappers;27 already occur in the prior
163-name set. The remaining45 include all25 reported by the leaf **plus20 it
missed**. This supersedes the leaf's188-name calculation, not its raw evidence.

## Omissions found by independent review

1. `useMobileGitRequests` returns `sendGitRequest`. The state hook passes it to
   workflow runners, which pass it to commit/action-sheet runners and expose
   `runGitAction` to file rows and confirmation dialogs. Sequence builders pass
   concrete `step.method` values. The leaf stopped at the six local callers and
   incorrectly marked several names as already known. Thirteen Git names were
   actually absent from the original163:
   `git.abortMerge`, `git.abortRebase`, `git.bulkStage`, `git.bulkUnstage`,
   `git.checkout`, `git.discard`, `git.fastForward`, `git.fetch`,
   `git.localBranches`, `git.pull`, `git.rebaseFromBase`, `git.unstage`,
   `git.upstreamStatus`.
2. `callAgentSession` is reached through `requestStructuredAgentSessionMutation`
   as well as direct reads and hold/release. Seven more agent-session methods
   were missed: `agentSession.history`, `agentSession.options`,
   `agentSession.setOption`, `agentSession.send`, `agentSession.cancel`,
   `agentSession.respondToApproval`, `agentSession.respondToQuestion`.
   Approval/question fingerprint labels use `respondTo:approval` and
   `respondTo:question`; those labels are **not RPC method names**.

These are real source call paths, not names inferred from server schemas or
comments. The JSON maps each candidate to concrete source pointers. Closed
TypeScript method unions constrain the source call graph; they are not runtime
validation or proof that a host accepts every request.

## Other checked boundaries

- Browser request ownership reaches the page-specific request hook through
  `MobileBrowserPane → useMobileBrowserStream` and the interactions/commands
  hooks. The nine names in the leaf are preserved. Click fallback, keyboard
  restoration, page URL navigation and dialog actions remain separate behaviors
  to test; a name match does not prove their implementation.
- File ownership capture calls status, worktree and conditional SSH state.
  Preview construction yields four concrete read methods; grant/base-content
  handling must be preserved. Parameter projection for `worktree.ps` was
  independently accepted in `parity-mobile-request-contracts.md`.
- PR read/mutation wrappers preserve method-asymmetric fork/GHES `prRepo` and
  check-head parameters. Title/thread mutations require explicit boolean true;
  the generic mutation wrapper accepts a transport success with no structured
  result status. Do not collapse those outcome contracts during the port.
- GitLab metadata selects `gitlab.updateIssue` versus `gitlab.updateMR`, with
  different number/iid and update fields. GitHub status updates select issue
  versus PR methods and refuse the merged-state action locally. This is not
  permission to replace generic provider support with GitHub-only behavior.
- The three native-chat `args.subscribe(handle)` calls are local callbacks,
  not dynamic RPC method names. Their bound callback eventually calls the
  already-counted literal `terminal.subscribe`; excluding those syntax
  lookalikes does **not** mean they have no downstream network effect.
- `connectionPath.subscribe(listener)` is a local Set-backed observer. Logical
  RPC subscription records retain the actual method and forward it to the
  current physical session. Direct and relay registries are separate owners.
- Pairing recovery forwards the same request and only retries failed
  `status.get` through the director path. This read is not proof of durable
  journal behavior, authentication, cancellation races or live relay recovery.

## Execution and next owners

No original product test, model, network session or UI action was executed in
this review. New metadata regression checks validate the31-site map, name-set
arithmetic and provenance structure only. The ten original unit cases from
`b09e289` remain separate execution evidence, including their documented gaps.

Validation: Node24.19.0 `node --test scripts/parity-mobile-method-review.test.mjs`
passed5/5, zero skipped/failed. These five checks are new audit-tool tests, not
five more original product cases. No original source assertions were changed.

WP-CAP-MOBILE owns test ports, source UI contracts and computed call paths beyond
this census. WP-ENG-REMOTE owns actual host schemas, pairing/reconnect and
mixed-version verification. Coordinator next reviews remaining relay composition
and distribution contracts; all unrelated audit gates remain open. No hierarchy
change, product edit, upstream PR or preview installation occurred here.

Mentu capability gaps discovered during implementation still take the minimal,
justified English PR route with regression evidence and a pinned local build;
do not silently reduce requirements or wait for upstream merge to test.
