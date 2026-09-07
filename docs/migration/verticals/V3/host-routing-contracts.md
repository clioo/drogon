# V3 remote/host-routing contracts

Vertical-03 (workspaces/remote) UI-side contract note. This file records the
rules the V3 renderer types in `apps/desktop/src/renderer/src/features/remote/`
already enforce, and what the future real-SSH implementation must satisfy
before it may consume them.

Normative sources (read-only reference, frozen):

- `docs/reference/ssh-execution-boundary.md` (reference copy in the
  migration source at `/Users/carlos/Documents/Drogon-mentu-session`) — the
  execution-boundary rules quoted below.
- `docs/migration/parity-remote-enoent-contract.md` — remote missing-path
  classification compatibility debt.
- `docs/migration/parity-cli-workspace-contracts.md` — CLI workspace
  contracts including the omitted-host-scope listing rule.

## Shipped V3 surface (pure TypeScript, renderer)

Location: `apps/desktop/src/renderer/src/features/remote/`
(`host-descriptor.ts`, `host-verdict.ts`, `remote-pane-state.ts`,
`remote-listing.ts`, `index.ts` barrel). Constraints already satisfied:

- No Node/Electron imports; all future backend contact goes through
  injected interfaces owned by the centrally-mounted preload bridge (V2).
- Fixed verdict vocabulary `live | unverifiable | exited`, taken verbatim
  from the incumbent `UnstoppedPtyVerdict`. No synonyms; `unverifiable`
  is never collapsed into a neighbour.
- `verdictFor(lossOfContact)` structurally cannot return `exited`; it
  always returns `unverifiable` and cites the boundary rule.
- `RemotePaneState` reducer (`idle | connecting | live | unverifiable |
  error | exited`, the last reachable only through positive host
  evidence): `transport-lost` always maps to `unverifiable` with the retry
  affordance kept available; only a `host-confirmed-exited` event whose
  `incarnation` matches the pane's current attachment can enter `exited`;
  stale/superseded-incarnation events are ignored by identity.
- `RemoteListing` + `annotateOmittedHostScope`: a listing names the hosts
  it covered and the hosts it omitted; any omission stamps the listing
  `unverifiable` even when rows are empty. Scope answers selectability,
  never liveness.

## Routing rules for the future implementation

1. **Per-target routing.** Every execution-affecting operation routes on
   the target's resolved `executionHostId` — never on a repo row's
   `connectionId` and never on the client's own cwd. `local` alone may
   resolve to in-process execution.
2. **No silent substitution.** An operation on a remote `repoPath` must
   never fall back to running on the client. A missing SSH provider is
   not permission to answer locally: a local run can answer for the wrong
   repository.
3. **Provider-unavailable error shape.** An `ssh:`/`wsl:`/`relay:` host
   with no registered provider fails with an explicit
   provider-unavailable error (service message surfaced verbatim, e.g.
   "no registered provider for <hostId>"); a `runtime:` host this process
   does not execute fails with a dispatchable-host error rather than
   being silently re-targeted. Errors are `Result` failures
   (`{ ok: false, error: { code, message, retryable } }`), never thrown
   renderer crashes and never re-routed to another host.
4. **Verdict evidence.** `exited` requires positive evidence from the
   owning host matching the current incarnation (and provider
   generation). Client-side bookkeeping (absence from a client set, a
   lookup that threw, socket close, timeout) is `unverifiable` by
   construction. Path-existence booleans (see the remote-ENOENT contract)
   are not liveness verdicts.
5. **Reconnect / version skew (pointer).** Relay installs are namespaced
   by bundle content hash; a daemon that refuses a mismatched bundle
   strands its PTYs as `unverifiable` — running, unreachable, never
   `exited` (ssh-execution-boundary.md, "Updating Orca strands
   relay-backed terminals"). The peer/headless-runtime model instead
   namespaces its endpoint by semantic protocol version and preserves
   daemons holding live sessions across version changes. Consumer rule:
   reconnect re-attaches and replays a bounded buffer; transcript
   truncation never implies exit. The Rust implementation must state
   which namespacing model each target uses before first ship.
6. **No cloud provisioning.** V3 ships no hosted/cloud relay, no
   credential brokerage, and no remote account creation. Hosts are
   registered locally by the user (`local`, `ssh:<target-id>`,
   `runtime:<environment-id>`, WSL, relay); the renderer never invents a
   host to make an operation succeed.
7. **Listing scope.** Any host-scoped listing annotates omitted hosts
   (`scope: unverifiable` + explicit omitted ids) exactly when a host
   could not be covered; a `complete` listing is only truthful when
   nothing was omitted. Empty answers without scope naming are rejected
   at the type level.

## Consumer-test list (owed by the real-SSH implementation)

The following tests must exist against the real transport (not the pure
reducers) before SSH features ship:

1. Remote operation with an unregistered SSH provider fails with the
   provider-unavailable `Result` error and does not execute locally
   (assert the local side effect count is zero).
2. Routing targets the resolved `executionHostId`: two worktrees on
   different hosts with colliding paths resolve independently.
3. Transport drop mid-session maps the pane to `unverifiable`, keeps the
   retry affordance, and never reports `exited` without host evidence.
4. A host-delivered exit for the current incarnation reaches `exited`;
   the same payload with a superseded incarnation changes nothing.
5. Reconnect after version skew: relay-bundle mismatch leaves sessions
   `unverifiable` (never `exited`) and the client cold-restores without
   claiming the old work died.
6. Host listing with one unreachable host annotates `scope: unverifiable`
   and names it; with all hosts covered it annotates `complete`.
7. Mixed-version host: an old host omitting the additive errno/origin
   fields still classifies remote ENOENT via the preserved phrase/numeric
   fallback (parity-remote-enoent-contract.md compatibility obligation).
8. Renderer bundle purity: the feature module graph imports no
   Node/Electron builtin; backend calls only through the injected bridge
   interface (enforced by a build-time lint or import test).

## Unverified / out of scope here

- No real SSH, relay, or Rust runtime code was executed in this vertical
  slice; items 1–7 above are unproven until implemented against the real
  transport.
- The `wsl` and `relay` kinds are modeled in `HostKind` but no
  WSL-specific or relay-specific behavior is claimed beyond the shared
  boundary rules.
- Error-code wire compatibility across transports remains governed by
  `parity-remote-enoent-contract.md`; this note adds no new wire format.
