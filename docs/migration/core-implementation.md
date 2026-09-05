# `drogon-core` / `drogond` implementation notes

Implements `docs/migration/protocol-v1.md` (frozen). Scope: `crates/drogon-core/**` and
`crates/drogond/**` only. No Electron, no CLI (`drogon-cli` is a separate lane), no root
manifest/lockfile edits.

## Coordinator verification — 20:40 UTC

The initial worker's 32-test report below is historical. The coordinator subsequently fixed explicit-null/argv validation, lock symlink refusal, receipt-failure replay, child-exit observation independent of PTY EOF, and post-spawn/exit persistence failure handling. Core/service now pass **39 tests** independently, plus **10 harness-library tests**, with strict Clippy. A started child remains owned and discoverable when its durable state transition fails; stop does not claim durable success if saving the observed exit fails. Tests inject real SQLite failures and verify exact recovery without another spawn.

The current native CLI/service acceptance passes **19 checks** including installed-Pi startup (no inference), real 1.2 MB output and actual daemon SIGKILL/restart after children were stopped: `.preflight/acceptance/core-cli-1788640750491-cdcc64a4-3b11-4fd9-ac38-518cef05a03b.json`. This supersedes the earlier claim that over-capacity PTY output was only unit-tested. Live-child crash recovery and descendant cleanup remain unverified. See [foundation status](foundation-status.md) for subsequent changes and CI.

## Initial worker compile and test status — historical

`cargo check -p drogon-core -p drogond --offline` is clean (no warnings). `cargo test -p drogon-core
-p drogond --offline` passes all 32 tests (3 `ring` unit, 14 `drogon-core` integration, 8 `drogond`
unit, 7 `drogond` server integration) at `--test-threads=4` and again at `--test-threads=8`, exit
code 0 both times. Root `Cargo.toml`/`Cargo.lock` were not edited by this crate's work.

## What exists

- `crates/drogon-core`: `Engine::open(&Path) -> Result<Engine, RpcError>`, `Engine::dispatch(&self,
  Request) -> Response`. Modules: `db` (SQLite schema + crash-recovery sweep), `session` (PTY spawn
  via `portable-pty`, ring-buffered read, write, resize, stop with bounded verified-exit polling),
  `workspace` (register/list, no Git mutation), `requests` (per-requestId idempotency ledger),
  `error` (the frozen error-code set only).
- `crates/drogond`: `endpoint` (Unix-socket bind/link/probe/rename ownership, `cfg(unix)`-only),
  `auth` (per-start random token via `/dev/urandom`, 0600), `framing` (bounded newline-JSON), `server`
  (thread-per-connection, one dispatch per frame), `main` (`drogond --data-dir PATH`).

## Design decisions and how they map to the protocol's required behavior

**Session ownership is a retained Rust handle, never a re-probed PID.** `session::SessionHandle`
holds the actual `portable_pty::MasterPty`/`Child`/writer objects in `Engine.sessions:
Mutex<HashMap<String, Arc<SessionHandle>>>`, populated only at spawn time in this process. A restart
starts with an empty map; there is no code path that reconstructs a handle from a PID read out of
SQLite (`inventory-core.md` §1.3 explains why the prior implementation's PID-probing techniques are a
different, narrower problem and are not reused here for this purpose).

**Crash recovery never respawns.** `db::recover_from_prior_instance`, run once inside `Engine::open`
before any spawn, flips any `sessions` row left `pending`/`live` by a previous process to
`unverifiable`, and any `requests` row left `pending` to `done` with a persisted `unverifiable`
error. A request replayed with the same id after a crash gets that persisted error deterministically
— it is never silently retried into a second spawn.

**Duplicate admission, exactly one spawn.** `requests::RequestLedger::run` is the single choke point
for every mutating method (`workspace.register`, `session.start/write/resize/stop`). It holds a
process-local `Mutex<HashMap<requestId, InFlight>>` only long enough to decide "run it / wait for the
existing in-flight slot / return a persisted result / reject as conflicting" — the actual PTY spawn
or write runs with no engine-level lock held (`inventory-core.md` §1's Rust-boundary requirement:
"blocking operations must not hold global locks during child IO/wait"). Concurrent duplicate
`session.start` calls with the same `requestId` therefore share one spawn: the second blocks on a
per-request condvar and returns the first's exact result. A replay with a different params
fingerprint under the same `requestId` returns `request_conflict` without touching prior state.

**Incarnation fencing.** Every `session.start` mints a fresh random `incarnation`
(`uuid::Uuid::new_v4`). `read`/`write`/`resize`/`stop` all require the caller's incarnation to match
the session's exactly; a mismatch is `stale_incarnation`, checked before any PTY interaction. Unlike
the prior implementation's `Map<sessionId, generation>` (kept only while a PTY is live, see
`inventory-core.md` §1.4), here the DB row also carries the incarnation, so `stop` on a
handle-less-but-known session can still validate the caller's incarnation against the last known one
before reporting `unverifiable`, rather than a bare "not found."

**Stop verifies exit, never assumes.** `session::stop` calls `kill()` then polls `try_wait()`
non-blockingly up to a 2s bounded budget (`STOP_VERIFY_TIMEOUT`), only returning `exited` once an
actual exit status is reaped; on timeout it returns `unverifiable`, never a fabricated `exited`. PTY
EOF is a *separate* fact from process exit — a child can close its own end of the pty and keep
running, or a descendant can retain the PTY after the direct child exits. A separate observer
calls non-blocking `try_wait()` independently of the output reader, with no lock held across sleep.
Both paths share one `exit_code: Mutex<Option<i64>>` cache so the underlying `try_wait()` only ever
fires once, and neither can block the other waiting on the same lock. The confirmed-exited session
handle is kept (not dropped) so its ring buffer stays readable — see the fixes list below.

**Bounded output.** `ring::RingBuffer` keeps the newest `1024 * 1024` bytes per session (raw bytes,
not UTF-16 units — protocol-v1.md's number, not the prior implementation's relay-specific 100 KiB
figure). A cursor behind the retained window returns the actual retained start with `truncated:
true`; a cursor ahead of everything ever written is `invalid_argument`. Truncation never touches the
child process.

**Endpoint ownership** (`drogond::endpoint::establish`, Unix only): bind a private `.p<pid><nanos>`
scratch socket, `hard_link` it onto the canonical `runtime-v1.sock`; on `EEXIST`, connect to the
canonical path — `ConnectionRefused`/`NotFound` is `Dead`, anything else (including a successful
connect) is treated as live-or-unknown and refused. A `Dead` verdict is re-probed once more
immediately before `rename`, mirroring the prior implementation's "probe once more" step
(`inventory-core.md` §1.2). Never `unlink`-then-bind; the scratch name is only removed once the
canonical name safely exists.

**Windows is explicitly not implemented**, not stubbed-as-working. `drogond::serve` on non-Unix
returns `ServeError::UnsupportedPlatform` immediately; `endpoint.rs`/`server.rs`'s Unix-only items are
`cfg`-gated out entirely rather than compiled-but-untested. No named-pipe code exists to misjudge.

## Fixes applied from independent-acceptance review

### Round 1 (real Electron + daemon registration, native-probe harness)

- **Socket file mode.** `runtime-v1.sock` was left at the default `bind()` mode, not `0600`. Fixed by
  `chmod`-ing the private scratch name to `0600` before linking it onto the canonical path (both
  names share one inode, so one `chmod` covers both).
- **Non-socket/symlink incumbent.** `establish` now inspects the canonical path with
  `symlink_metadata` (never following it) and refuses outright if it is a symlink or not a socket,
  instead of only inferring "unknown" from a failed `connect`.
- **Endpoint race beyond two `connect`s.** Added `drogond::lock`: an OS `flock(LOCK_EX | LOCK_NB)` on
  `.drogond.lock`, acquired in `serve()` before endpoint establishment, token rotation, or
  `Engine::open`, held for the process's lifetime. Two `drogond` instances racing the same
  `--data-dir` now serialize on the lock, not on the socket-probe window.
- **Token file symlink-follow.** `auth::ensure_token` used `fs::write`, which follows whatever is at
  the destination. Fixed: write to a `create_new`-only scratch file, then `rename` it over the
  destination (`rename` replaces a directory entry, including a symlink, without dereferencing it).
- **Data directory symlink.** `serve()` refuses a symlinked `--data-dir` via `symlink_metadata`.
- **Unbounded connection threads.** `server::accept_loop` caps concurrent connections and drops any
  beyond the cap immediately.

### Round 2 (reproducible correctness defects, this pass)

- **`blocking_reap` held a lock across a blocking `wait()`.** PTY EOF is not process exit — a child
  can close its own pty fds and keep running — so the reader thread's post-EOF reap used to call
  `child.wait()` (blocking, arbitrarily long) while holding the same `exit_code` lock `read`/`write`/
  `stop` need, hanging every other request against that session for as long as the child lived.
  Fixed: the reader thread now polls `try_wait()` non-blockingly in a loop, sleeping between
  attempts with no lock held across the sleep. Regression:
  `stop_and_read_do_not_block_when_child_closes_pty_before_exiting`.
- **`RequestLedger` gave the leader and in-flight waiters different answers** on a `finish()`
  persistence failure (leader: `unverifiable`; waiters: the real, unpersisted result). Fixed: both
  now complete from one shared `outcome`. A replay after such a failure also used to surface a raw
  primary-key-conflict storage error (the row is stuck `pending`); `insert_pending` now recognizes
  that specific conflict and returns the same `unverifiable` instead — and never re-runs `work()`.
  Regression (SQLite `RAISE(ABORT)` trigger as fault injection):
  `a_request_ledger_persistence_failure_gives_leader_and_replay_the_same_unverifiable_answer`.
- **`session.resize` reported a hardcoded `"live"` verdict** regardless of actual state, and could
  act on an already-exited session. Fixed: refuses with `unverifiable` if the session already
  exited, and otherwise reports the session's real current verdict. **`session.stop` dropped the
  handle (and its ring buffer) the instant exit was confirmed**, making previously-retained output
  permanently unreadable. Fixed: the handle stays in `Engine.sessions`; only its cached exit state
  changes. Regressions: `stop_preserves_the_session_handle_and_its_retained_output` (also covers the
  resize-after-exit refusal).
- **`cursor`, `limitBytes`, `workspaceId` silently fell back to a default/unfiltered read when
  present but the wrong JSON type**, instead of erroring — a caller with a `workspaceId` type bug
  would silently get *every* workspace's sessions instead of an error. Fixed: `optional_u64`/
  `optional_str` treat "absent" and "present but wrong type" differently; the latter is always
  `invalid_argument`. Regression: `present_but_invalid_optional_fields_are_rejected_not_defaulted`.
- **`server::accept_loop`'s connection cap had no idle timeout**, so 64 clients that connect and
  send nothing permanently exclude every other client. Fixed: `set_read_timeout`/
  `set_write_timeout` on every accepted connection (parametrized so tests use milliseconds instead
  of the 600s production default). Regression: `a_connection_cap_alone_does_not_permanently_exclude_clients`.
- **`spawn_pty` acquired the pty master's reader/writer *after* spawning the child**, so a failure
  in `try_clone_reader`/`take_writer` would drop an already-running, unreachable child without
  killing or reaping it. Fixed by reordering: both come from the master side and never needed the
  child to exist first, so acquiring them before `spawn_command` means that failure path no longer
  exists (nothing to clean up, because nothing was spawned yet). Not independently fault-tested —
  `portable-pty` gives no way to force `try_clone_reader`/`take_writer` to fail on demand; verified
  by inspection and by every normal-spawn test still passing against the reordered code.
- **`Engine::open` ignored a `chmod` failure on the data directory and never checked for a symlinked
  data directory** (the equivalent `drogond::serve`-level checks protect only that one entry path,
  not `Engine::open` itself, which is the crate's own documented entry point). Fixed: the data-dir
  `chmod` error now propagates, and `Engine::open` checks `symlink_metadata` directly. The same fix
  was applied to `db::harden_permissions` (the sqlite file/WAL/SHM `chmod`), which now propagates
  genuine failures while still tolerating a WAL/SHM sibling that does not exist yet. Regression:
  `engine_open_refuses_a_symlinked_data_dir`.

## Tests (Measured — all pass, see compile/test status above)

`crates/drogon-core/tests/engine.rs` (Unix-only, real `/bin/sh` children via real `portable-pty`):
workspace register idempotency by path; full session lifecycle (spawn, resize, write, read via
polling cursor, normal exit with real exit code); two concurrent sessions, killing one leaves the
other's list entry `live` and independently controllable; stale incarnation rejected on
read/write/resize/stop; duplicate `requestId` session.start returns the identical cached result and
never spawns a second session; conflicting `requestId` reuse with different params is
`request_conflict`; a cursor past all written data is `invalid_argument`; a same-process "crash"
simulation (drop the `Engine`, leaving the long-lived child's reader thread running, then
`Engine::open` a fresh instance on the same data dir) shows the prior session as `unverifiable` and
confirms `read` refuses to act on it and `stop` reports the state without fabricating a spawn or a
result; invalid input (empty command, out-of-range cols, unknown workspace, unknown method) is
rejected before any process is spawned. `crates/drogon-core/src/ring.rs` has unit tests for the
future-cursor and truncated-tail cases directly.

`crates/drogond/tests/server.rs` (real Unix-socket client/server): authenticated status round trip;
missing/wrong token is `unauthorized`; a dropped connection followed by a fresh connection still
works (server state is per-Engine, not per-connection); one connection serving several sequential
requests; a garbled (non-JSON but well-framed) request gets a synthesized `invalid_argument` error
and the connection stays open and usable; an oversized frame (a framing-level failure) closes only
that one connection without affecting the server's ability to accept new ones; a connection cap
with an idle timeout reclaims slots from clients that never send anything, so the cap alone cannot
permanently exclude every other client. `crates/drogond/src/endpoint.rs` has unit tests for
first-owner-wins, live-incumbent-refuses, dead-incumbent-reclaimed; `crates/drogond/src/lock.rs` and
`src/auth.rs` have unit tests for lock mutual exclusion and fresh-token-per-start.

## Known gaps, not claimed as done

- **Windows/named pipes**: not implemented, not stubbed to look implemented; `ServeError::UnsupportedPlatform`.
- **Over-capacity ring-buffer truncation** now has real 1.2 MB PTY acceptance and pagination evidence; it is no longer a unit-only coverage gap.
- **Process-group/descendant cleanup** is out of scope for this slice: `stop` only kills/waits the
  direct spawned child, matching `protocol-v1.md`'s "do not claim broad descendant cleanup based on
  killing one PID." A shell that backgrounds a grandchild can leave it running.
- **`session.write`/`resize` idempotency for byte-identical replays relies on the caller minting a
  new `requestId` per distinct keystroke/resize**, per protocol-v1.md's own text; not re-derived or
  enforced beyond what the ledger already does.
- **The endpoint-reclaim probe is still two syscalls** (probe, then `rename`); `drogond::lock`
  removes the race *between two `drogond` processes* (both serialize on the lock first), but does
  not make probe-then-rename atomic against some other actor renaming the path in that exact window.
- **`Engine.sessions` now grows for the process's lifetime**, since `stop` no longer evicts a
  confirmed-exited handle (needed to keep its ring buffer readable — see the fixes list). Each ring
  can retain 1 MiB and PTY resources are retained, so aggregate memory/descriptors need a retirement policy;
  not addressed here.
- **No file-descriptor-exhaustion or `EBADF`-mid-read fault injection test** exists; "process death
  vs. host/handle unreachable" is exercised via the crash-simulation and closed-pty-but-alive tests,
  not via a deliberately corrupted PTY master fd.
- **`spawn_pty`'s reordering fix is not independently fault-injected** (see the fixes list) — no
  harness exists to force `try_clone_reader`/`take_writer` to fail on demand.
- **The idle-timeout value (600s production default) is a judgment call, not a measurement** — long
  enough that a real interactive client sitting idle between keystrokes is never disconnected, short
  enough to eventually reclaim a truly abandoned connection; not load-tested.
