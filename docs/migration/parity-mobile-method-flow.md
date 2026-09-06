# Mobile nonliteral wire-call flow — 31 remaining candidates resolved

> Historical leaf report. Coordinator review after `b09e289` found twenty
> omitted methods and corrected the188-name calculation. Use
> [parity-mobile-method-review.md](parity-mobile-method-review.md) and its JSON
> for the accepted31-site attribution and209-name combined lower bound. This
> leaf JSON is retained unchanged for provenance, not current acceptance.

Companion machine record: `docs/migration/parity-mobile-method-flow.json`
(schema `drogon.parity-mobile-method-flow/1`, sha256
`ffc11cda4171d99836c1c54929c7aea2e10f661c2ec5f267299bb57e65f2e91d`).
Frozen source `c97906287bb7a390b25e2025b600d9fb3c25d9c3`, read-only; checkout
base `0204b8a`. Status **leaf-reported-pending-coordinator-review**; runtime
acceptance **unproven**. Source review only — no test, script, relay, or
mobile client was executed. Reuses accepted
`parity-relay-mobile-wire-contracts.json/.md` v3 (156 direct names + 7
ConditionalExpression names = 163 prior lower bound) and
`parity-wire-call-sites.json` (the 461-call-site/35-mobile-nonliteral
census) without re-scanning. G13/G19 relay framing and the agentWait trace
are not repeated here.

## Scope

`parity-wire-call-sites.json` lists 35 mobile nonliteral
`sendRequest`/`subscribe` candidates. 4 (all `ConditionalExpression`
arguments) were already source-reviewed in v3, adding `gitlab.addMRComment`,
`gitlab.addIssueComment`, `github.project.clearItemField`,
`github.project.updateItemField`, `github.project.updatePullRequestBySlug`,
`github.createIssue`, `gitlab.createIssue`. This document resolves the
remaining **31** — every `Identifier` or `MemberExpression` argument the
scanner could not read as a literal — each to exactly one disposition, with
receiver tracing (never assuming `.subscribe(x)` means network I/O without
confirming the receiver is an `RpcClient`).

## Disposition counts (31 call sites, computed from the JSON)

- **rpc-wrapper-traced: 19** — a genuine wrapper whose concrete method(s)
  were resolved through its actual caller(s) or a closed union type.
- **transport-forwarding: 8** — a pass-through terminus in the transport
  stack (`DirectRpcClient`, `mobile-relay-rpc-session`,
  `pairing-relay-candidate`, `StableLogicalRpcClient`) whose argument is not
  itself resolvable to one method; it forwards whatever its own caller
  supplied, and that caller is traced elsewhere in this document or the
  accepted 163-name set.
- **non-rpc-subscribe-lookalike: 4** — a `.subscribe(...)` call whose
  receiver is confirmed NOT an `RpcClient` (a local callback prop or a
  connection-path state observer), so it is explicitly excluded from the
  wire-method surface rather than assumed to be one.

## rpc-wrapper-traced: 19 sites, 25 newly established method names

| Wrapper (file:line) | Caller(s) traced | New names |
| --- | --- | --- |
| `use-mobile-browser-request.ts:41` `sendBrowserRequest` | `use-mobile-browser-commands.ts:112,213,227,235`; `MobileBrowserPane.tsx:240,297,303,309` | `browser.mouseClick`, `browser.keyboardInsertText`, `browser.keypress`, `browser.dialogAccept`, `browser.dialogDismiss`, `browser.goto`, `browser.back`, `browser.forward`, `browser.reload` |
| `mobile-file-mutation-ownership.ts:74` `requestResult` | same file :39,46,58 | none (status.get/worktree.show/ssh.getState known) |
| `mobile-file-preview-request.ts:94,106,187,207` `request.method` | `createMobileFilePreviewRequest()` :61-79 | `files.readTerminalArtifact`, `files.readTerminalArtifactPreview` |
| `use-host-repo-metadata.ts:20` `requestResult` | same file :123-125 | `ssh.listTargetSummaries`, `host.platform` |
| `github-pr-mutations.ts:23,58` `sendRaw`/`sendGithubPrMutation` | same file, 12 call sites | `github.updatePRTitle`, `github.setPRAutoMerge`, `github.updatePRState`, `github.removePRReviewers` |
| `github-pr-rpc.ts:95` `sendGithubPrRead` | same file, 7 call sites | `hostedReview.forBranch`, `github.prForBranch`, `github.prCheckDetails` |
| `mobile-structured-agent-session-rpc.ts:41` `callAgentSession` | `use-mobile-structured-agent-state.ts:104,137-145` | `agentSession.hold`, `agentSession.release` |
| `use-mobile-diff-review-git-actions.ts:32` `runGitMutation` | closed union `GitMutationMethod` | none (git.stage/unstage/discard known) |
| `use-mobile-session-content-create-actions.ts:137` | closed union `'browser.back'\|'browser.forward'\|'browser.reload'` | none (found above) |
| `mobile-hosted-review-git-preparation.ts:36` `sendMobileHostedReviewGitMutation` | `mobile-hosted-review-create-intent.ts:111`; `mobile-hosted-review-remote-prerequisite.ts:21-46` | none (git.push/bulkStage known) |
| `use-mobile-git-requests.ts:25` `sendGitRequest` | same file :43,54,61,70,71,74 | none (all known) |
| `use-mobile-tasks-hosted-metadata-actions.tsx:130` inline ternary | direct | `gitlab.updateMR` (distinct from known `gitlab.updateMRState`) |
| `use-mobile-tasks-project-file-merge-actions.tsx:273` inline ternary | direct | none (github.updateIssue known, github.updatePRState found above) |
| `request-single-flight.ts:50,96` `sendSingleFlightRequest` | `mobile-home-host-requests.ts:41,59,76-78`; `home-host-worktree-fetch.ts:39` | `stats.summary`, `accounts.list` |

**New lower bound: 163 + 25 = 188** distinct mobile method names with exact
citations — still not a claim of complete client surface (see Remaining
gaps).

## transport-forwarding: 8 sites, no resolvable name of their own

`DirectRpcClient.sendRequest`/`.subscribe` (`direct-rpc-client.ts:137,146`)
and `mobile-relay-rpc-session.ts:109` are the two physical-session
implementations of `RpcClient`; both simply delegate `method`/`params` to
their own request/stream registries — they are the terminus of the LAN and
relay connection paths respectively, not a place a new method name
originates. `pairing-relay-candidate.ts:28,89,111`'s
`createRecoveringPairingRelayCandidate` wraps an inner
`PairingCandidateClient`, retrying through relay-director recovery; its only
literal check (`method !== 'status.get'`, already known) gates recovery
without minting a new method. `stable-logical-rpc-client.ts:95`'s
`sendRequest` and `:308`'s `attachSubscription` (`record.method`) delegate to
whichever physical session is currently active during a LAN/tailscale/relay
migration — `record.method` is set wherever the outer `logical.subscribe(...)`
was originally called by a caller already covered elsewhere.

## non-rpc-subscribe-lookalike: 4 sites — confirmed not network calls

- `use-mobile-native-chat-terminal-stream.ts:174,194,205` —
  `args.subscribe(handle)` calls the hook's own
  `subscribe: (handle: string) => void` parameter (declared at line 28), a
  plain callback prop bound by its caller
  (`use-mobile-session-terminal-stream-display.ts:37`) to
  `subscribeToTerminal` from `use-mobile-session-terminal-subscription.ts:43`.
  That function's body (read through its gating logic) contains no
  `client.subscribe` call in this file; the actual wire subscription is the
  already-census-known `terminal.subscribe` literal elsewhere in the
  subscription pipeline — not re-derived or re-claimed here.
- `stable-logical-rpc-client.ts:285` —
  `onConnectionPathChange: (listener) => connectionPath.subscribe(listener)`.
  `connectionPath` is a `LogicalClientConnectionPath` instance (local
  observer for the `lan`/`tailscale`/`relay` path plus pairing-rejected/
  recovery-attempt state), never an `RpcClient`. No network method name is
  involved.

## Bonus finding beyond the 31 (capability negotiation entrypoint)

While bounded-reading the capability-negotiation entrypoint (below),
`mobile-runtime-capability-negotiation.ts:19-22`'s
`settleMobileRuntimeCapabilities` calls
`sendRequest(MOBILE_RUNTIME_CLIENT_CAPABILITY_UPDATE_METHOD, ...)`, resolving
to **`runtime.clientCapabilities.update`**
(`mobile-runtime-client-capabilities.ts:12-13`). This was not one of the 35
tracked syntax candidates (it is a bare-identifier function call, not a
`client.sendRequest`/`.subscribe` member expression on a receiver the census
tracks), so it is listed separately rather than folded into the 25 above.

## Bounded read: DirectRpcClient / StableLogicalRpcClient entrypoints

Read enough to route ownership for future test ports, not to execute or
fully verify runtime behavior:

- **`direct-rpc-client.ts`** (LAN/direct-socket `RpcClient`): constructs and
  owns `RpcClientConnectionState`, `RpcClientReconnectSchedule`,
  `RpcClientRequestTracker`, `RpcClientStreamRegistry`,
  `RpcSessionLivenessWatchdog`, `RpcClientSocketFactory`,
  `RpcClientAuthenticationRetry`, `RpcClientSocketCloseController`.
  `sendRequest`/`subscribe` are pure delegation (transport-forwarding above).
- **`stable-logical-rpc-client.ts`**: migration-aware logical client
  wrapping whichever physical session (`DirectRpcClient` or a relay session)
  is active; owns `migrateTo`/`suspendActiveSession`/`getActivePath`/
  `getPendingPath`/`setRecoveryPath`/`setRecoveryAttempt`/
  `setPairingRejected`/`isPairingRejected` — this is the reconnect/pairing-
  state ownership surface across `MobileConnectionPath = 'lan'|'tailscale'|'relay'`.
- **`rpc-client-reconnect-schedule.ts`**: `DirectRpcClient`'s own backoff
  ladder (`RECONNECT_DELAYS`, `RPC_RECONNECT_ATTEMPT_LIMIT=12`, 90s trickle
  fallback) — distinct from the logical client's migration/cutover logic.
- **`migration-dial-state-forwarder.ts`**, **`logical-client-connection-path.ts`**:
  only export signatures read; the latter is exactly what candidate #30
  resolves to (a local observer, not a wire method).
- **`mobile-relay-pairing-journal.ts`**: only the schema/construction header
  (`journalId`/`installReqId`/`resumeConfirmReqId`, Zod metadata/secrets
  schemas) was read; persistence/resume body is an open follow-up.

Ownership routing: **WP-CAP-MOBILE** (client-side transport/session
ownership) and **WP-ENG-REMOTE** (relay/pairing wire ownership), per the
already-accepted G14 ownership in `parity-relay-mobile-wire-contracts.json`.
This bounded read does not reassign ownership.

## Remaining gaps (scoped, with owners)

- Only the 31 tracked syntax candidates plus the one capability-negotiation
  entrypoint were traced; a method reached only through a typed getter or
  method call (not a literal/`Identifier`/`ConditionalExpression` argument)
  is out of this pass's scope by construction — **WP-CAP-MOBILE**.
- `mobile-relay-pairing-journal.ts`'s persistence/resume body beyond its
  construction header was not read; pairing/revocation semantics remain a
  test-port obligation — **WP-ENG-REMOTE**.
- No cross-version (old/new host) execution was performed for any traced
  method or the capability-negotiation advisory — **WP-ENG-REMOTE**.
- `projectMobileRpcRequestParams(method, params)`
  (`stable-logical-rpc-client.ts:88`) rewrites params per method name; its
  own per-method branching was not opened and may itself reveal further
  method-name evidence — **WP-CAP-MOBILE**.

## Closure claim

None. This resolves the 31 assigned candidates with exact, receiver-traced
dispositions and 25 newly cited method names (188 new lower bound); it is
not full mobile RPC surface closure, not a capability-negotiation/pairing/
reconnect execution trace, and does not touch already-accepted G13/G19
relay/agentWait framing.
