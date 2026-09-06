# Core Inventory: Terminal Daemon, PTY Persistence, CLI RPC

Read-only investigation of `/Users/carlos/Documents/Drogon-mentu-session` (authorized read-only
reference, not edited). Evidence is marked **Measured** (grep/read of a specific file) or
**Proposed** (this document's recommendation, not observed anywhere) — do not conflate the two.
Absence claims below are scoped to the specific paths grepped/read in this pass, not the whole
tree (364 files exist under `src/main/daemon/` alone; most were not opened).

## 1. Measured: what exists in the source today

### 1.1 Process/PTY layer
- PTY spawning uses the native Node addon `node-pty ^1.1.0` (`package.json`), not any Rust crate.
  Call sites: `src/main/providers/local-pty-*.ts`, `src/main/pty/node-pty-pts-name.ts`.
- `mintPtySessionId` (`src/main/daemon/pty-session-id.ts:21-25`) mints
  `${worktreeId}@@${shortUuid}`; `DaemonPtyAdapter.reconcileOnStartup` splits on `@@` to recover the
  owning worktree (`:11-19`). A durable session ID string alone, **not** an incarnation fence.
- `isSafePtySessionId` (`:57-76`) treats the session id as a filesystem key and enforces path
  containment under `userData` — session ids are attacker-influenced and used to build paths.

### 1.2 Daemon reconnect / retirement / endpoint ownership
- `src/main/daemon/AGENTS.md`: bind a private scratch name, exclusive `link` onto the canonical
  socket path, on `EEXIST` prove the incumbent dead by connecting, re-verify, then `rename` in one
  syscall (`daemon-endpoint-ownership.ts`). Liveness is 3-state — `connected` (occupied),
  `refused`/`missing` (dead), anything else (`unknown`, must decline). Never `unlink`-then-`link`.
  Never identify by `birthtimeMs`. No sweeper; only a publishing daemon replaces a name it proved
  dead. The doc records 23 defects across 7 review rounds from violating these.
- Socket namespaced by semantic protocol version, not build hash: `daemon-v<N>.sock`
  (`daemon-spawner.ts`, `daemon-protocol-version.ts`). A daemon holding live sessions is preserved
  across a compatible version bump — `shouldPreserveDaemonWithLiveSessions`
  (`daemon-replacement-preflight.ts:98,247`). This is the documented fix for the SSH-relay's
  build-hash namespacing failure (`docs/reference/ssh-execution-boundary.md:44-51`: the relay
  strands live PTYs on every app update because its socket dir is a content hash of the bundle).
- `daemon-replacement-preflight.ts` gates replacement on health, macOS resolver/TCC health, bundle
  staleness, live-session count, and launch-identity (entry-path) match before `killStaleDaemon`.
  `WEDGED_DAEMON_GRACE_RETRIES = 11` guards a socket that accepts-then-resets the hello handshake.

### 1.3 PID probing is an external-observer technique, not how ownership works
Two distinct mechanisms exist in the source; the rewrite must not merge them:
- **Retained OS child handle** (the actual ownership model): whichever process spawned the PTY
  holds a live handle (fd/child object) in memory. This handle, not any persisted PID, is what
  "the process is mine" means. Nothing here needs PID probing as long as the handle is held.
- **External PID-identity probing** (`daemon-pid-identity.ts`, `daemon-incarnation-evidence.ts`):
  used only when *a different process* (e.g. a newly-launched daemon, or a CLI checking whether an
  old daemon it does not hold a handle to is still running) must decide, from the outside, whether
  a recorded PID is the same process it was before. `DaemonProcessIdentity = 'match' | 'mismatch' |
  'unknown'` (3-state, never boolean): `process.kill(pid, 0)` distinguishes ESRCH (`mismatch`) from
  any other error such as EPERM (`unknown` — process exists, ownership unproven; comment at
  `daemon-pid-identity.ts:56-58` warns reading `unknown` as absence deletes a live daemon). Even
  when the PID exists, identity requires matching **command line** (daemon-entry + socket + token
  path substrings) **and** process start time within a platform tolerance. Linux additionally checks
  `/proc/<pid>/stat` start-ticks plus boot-id to survive PID-space reuse across reboots
  (`daemon-incarnation-evidence.ts:83-118`); macOS/Windows have no boot-id equivalent in this file.
  All paths return `present | gone | unknown`, never coercing `unknown` into a neighbor.
- **Why this distinction matters for the rewrite**: `docs/migration/protocol-v1.md` (frozen)
  establishes session ownership from retained process handles, not from a PID re-read out of
  SQLite. External PID-probing is source prior art for the *narrower, still-needed* problem of one
  process externally judging another process's identity (e.g. endpoint-ownership takeover in
  §1.2) — it is not a technique for reconstructing PTY ownership after a crash. After a service
  crash, a Rust rewrite has no retained handle for prior sessions and must not re-derive one by
  probing a stored PID; those sessions become `unverifiable` (protocol-v1.md's required behavior).

### 1.4 Session/agent generation fencing for reattach/cancel identity
- `terminal-host-agent-session-generations.ts` (22 lines, read in full): a `Map<ptyId, generation>`
  where `isCurrent(owner, isPtyLive)` requires both `isPtyLive` and a matching remembered
  generation (`:6-8`); `remember`/`forget` only mutate the map while the PTY is live. A dead PTY's
  generation is never trusted — the closest existing analog to an incarnation fence.
- `DaemonPtySessionControl.attach` (`daemon-pty-session-control.ts:19-45`) proves liveness via
  geometry before attaching: reads the session's applied size first; a null size means "cannot
  prove the session" and throws `SessionNotFoundError` rather than risk a silent duplicate spawn.
  Explicitly distinguishes a transport failure from an answered "absent" (comment `:25-30`).
- Kill/shutdown records a tombstone (`killedSessionTombstones`, capped at `MAX_TOMBSTONES = 1000`,
  oldest-evicted, `daemon-pty-session-control.ts:16,278-288`); a tombstoned id refuses reattach
  after explicit user kill, while the sleep path (`keepHistory`) skips the tombstone because wake
  legitimately reattaches. Three distinct code paths currently encode "killed by user" vs. "sleep"
  vs. "disconnect" — not one shared concept.
- `daemon-session-owner-resolution.ts` (10.4 KB) not read this pass; flagged, not claimed absent.

### 1.5 `live` / `unverifiable` / `exited` — the frozen vocabulary
- `src/main/runtime/unstopped-pty-verification.ts:12-16,29-57` is the reference 3-state verdict.
  Verification runs on its **own** budget separate from the sweep that failed
  (`WORKTREE_TEARDOWN_VERIFY_GRACE_MS = 2_000`; comment explains a prior bug where verification
  inherited an already-spent deadline and always read `unverifiable`).
- `docs/reference/ssh-execution-boundary.md:60-89` is the decision procedure for `unverifiable` vs
  `exited`. It separately documents `forceKillPosixPtyProcessGroups`
  (`src/main/pty/posix-pty-process-groups.ts`), the one place a liveness observation authorizes a
  destructive `killpg`, with two documented residual gaps: a job-control-off child never gets its
  own pgid, and a double-forked/`TIOCNOTTY`-detached grandchild keeps the pgid but is invisible to
  a ppid walk — both are still killed, i.e. the measured blast radius exceeds the measured evidence.
  This is a real, unresolved gap in the source, not something to port as a solved reference.

### 1.6 Bounded terminal output
- `REPLAY_BUFFER_MAX = 100 * 1024` (100 KiB of UTF-16 code units, `src/relay/pty-handler.ts:335`)
  bounds the **SSH-relay** replay buffer, not the local daemon. `docs/reference/
  ssh-execution-boundary.md:42`: output beyond the bound is lost to the client, the process itself
  stays `live` — truncation of transcript is never truncation of work. The local daemon's own
  scrollback/checkpoint bound (`daemon-pty-checkpoint-scheduler.ts`, `daemon-pty-buffer-snapshots.ts`,
  `terminal-history-restorable-retention.ts`) was not read this pass; its numeric bound is unverified.

### 1.7 CLI / RPC transport
- Two Unix-socket connections per client (control + stream), NDJSON framing (`ndjson.ts`), token
  read fresh per connect (`client.ts:117-126` — a missing token file is "no token," not "connect
  failure," so it never masks whether the endpoint itself is gone).
- `DaemonClient` (`client.ts`, 353 lines, read in full): a `connectionGeneration` counter discards
  stale post-reconnect socket-close events (`:48-52`); a `connectingPromise` lock dedupes concurrent
  connect attempts from simultaneous pane mounts (`:53-56`). RPC methods are bare strings
  (`'attach'`, `'kill'`, `'getSize'`, ...) with no versioned schema; compatibility is handled by
  triggering a specific method and catching an unknown-method error at runtime
  (`getSizeUnsupported` pattern, `daemon-pty-session-control.ts:53-70`), not by capability
  negotiation at handshake.
- `src/cli/` (30+ files) exists and is large; not inventoried — genuinely out of scope this pass,
  not claimed empty or mapped.

### 1.8 SQLite usage — scoped absence claim
`grep -rli sqlite src/main/` (this pass's grep, not exhaustive) finds SQLite backing the
**orchestration DB** (`src/main/runtime/orchestration/db/orchestration-db.ts:22-30`: WAL mode,
`synchronous = NORMAL`, `busy_timeout = 5000`, hardened file permissions — a real, reusable config
precedent) and read-only scanners for other tools' databases. PTY/daemon session persistence in the
files this grep covered instead uses pid files, a JSON checkpoint file, and a history-log format.
No SQLite-backed PTY/daemon state file was found by this grep; a fuller scan of the 364-file daemon
directory could still surface one and would supersede this line if it did.

## 2. Keep / Reuse / Rewrite / Defer (for the frozen protocol in protocol-v1.md)

| Concern | Verdict | Rationale |
|---|---|---|
| Endpoint bind/link/rename protocol (§1.2) | Reuse design, rewrite code | Platform-portable invariant with a documented defect history; re-implement link→verify-dead→rename→verify-kept using OS-native atomicity (Unix `link`/`rename`; Windows named pipes need their own mechanism, not assumed parity). |
| Protocol-version-namespaced endpoint (§1.2) | Keep as architecture | Matches `protocol-v1.md`'s semantic-version endpoint naming; carries the relay-strand fix forward. |
| External PID-identity probing (§1.3) | Reuse principle only where still needed | Needed only for endpoint-takeover judgment (§1.2), never for reconstructing PTY ownership post-crash — see §1.3's distinction. Do not port as a session-recovery mechanism. |
| Session-generation fencing (§1.4) | Keep as architecture | Direct precedent for `protocol-v1.md`'s incarnation token; reimplement as the fencing primitive, not the exact `Map` code. |
| Geometry-proof-before-attach (§1.4) | Keep principle, adapt mechanism | Keep "cheap positive proof before attach, never treat transport failure as absent"; the specific size-read RPC is TUI-specific. |
| Kill tombstones (§1.4) | Keep as architecture | Directly implements "user-killed" vs. other death; make it a durable SQLite table with the same bounded-eviction semantics instead of an in-memory map that a restart erases. |
| `live`/`unverifiable`/`exited` vocabulary (§1.5) | Keep verbatim | Frozen by `protocol-v1.md`; no synonyms. |
| `killpg` process-group teardown (§1.5) | Rewrite, do not port as-is | Two documented blast-radius gaps are unresolved in the source; treat as an open problem for the rewrite, not a spec. |
| Bounded output / replay buffer (§1.6) | Reuse invariant, rewrite the bound | Keep "truncated transcript, still-live process"; `protocol-v1.md` already fixes the number (1 MiB bytes) independent of the relay's 100 KiB UTF-16 figure. |
| Two-socket NDJSON, string-typed RPC (§1.7) | Rewrite | `protocol-v1.md` already specifies a versioned JSON envelope over one connection with typed error codes; source's runtime-error capability probing is superseded. |
| Reconnect race guards (`connectionGeneration`, connect-attempt lock) (§1.7) | Keep as architecture | Transport-agnostic; a Rust client should reuse the same pattern. |
| SQLite as persistence engine (§1.8) | New work, reuse config | No PTY/daemon precedent to keep; reuse the orchestration DB's WAL/`busy_timeout`/permission pattern. |
| `node-pty` | Rewrite via `portable-pty` | No Rust prior art in this codebase for the PTY layer; implemented directly in `crates/drogon-core`, see `core-implementation.md`. |
| `src/cli/`, `daemon-session-owner-resolution.ts`, history/checkpoint internals | Defer | Not read this pass; flagged, not claimed absent or mapped. |

## 3. Status

The architecture proposal, `portable-pty` spike plan, vertical slice, and protocol shape formerly
drafted here have been superseded by the coordinator-frozen `docs/migration/protocol-v1.md` and are
no longer duplicated in this file. Implementation notes, measured (not proposed) test results, and
known gaps for the actual `crates/drogon-core` / `crates/drogond` code are in
`docs/migration/core-implementation.md`.
