# Live-child crash admission

## Root integration verification — 2026-09-06 21:53 UTC

All three independent PR6 reviews settled against clean a6ea55c. Root
accepted the bounded-control-close leak, first-exit-code race and lost
unsupported diagnostics, then delegated corrections separately. Root read
the actual three-file change, formatted the JavaScript and independently
ran all26 fixture tests successfully. Existing21 assertions remain.

Root merged current main f9a1f87 (integration merge6546909), rebuilt locked
and offline, and ran379 Rust tests, strict all-target Clippy, rustfmt and
diff checks successfully. One marker test remains deliberately ignored in
ordinary enumeration and invoked by its owning test. The real macOS
acceptance again passed15 checks with a live child after service death,
kernel-observed eventual child exit, unforced observer/service cleanup and
zero open control sockets. Receipt:
`.preflight/acceptance/live-child-crash-1788731454646-44b40db2-9a86-428a-ac7f-1e88d0f31a2d.json`.

The two defensive failed-reap branches now also unref their exact owned
ChildProcess after disposing local pipes: pipe disposal alone does not
release the process handle from Node's event loop. This does not assert
the process exited; the result stays unverifiable/failed. An actual
unkillable-process test is not claimed.

CI workflow34060706206 already proved the pre-correction a6ea55c version
on both Linux pidfd and macOS kqueue:21 fixture tests and15 actual checks
on each. New-head CI after these corrections is required before merge.
Both observed child survival; neither proves the alternative child-exits-
at-crash branch. Historical Linux-pending statements below are superseded
only for those observed paths, not Windows or PTY reattachment.

## Root-triaged lifecycle corrections — 2026-09-06 (addendum)

Direct depth-1 leaf implementation under `task_207458e48fb1` /
`ctx_81a4fa7a992c`, scoped to root's PR6 triage
(`/tmp/drogon-pr6-triage.mdHiRQ/report.md`). Own files only:
`scripts/live-child-crash-fixture.mjs`,
`scripts/live-child-crash-fixture.test.mjs`,
`scripts/accept-live-child-crash.mjs` (unmodified — its existing
`evaluateCleanupProof`/report-status wiring already consumes an unclosed
`controlCloseProof` as FAILED-with-retained-fixture; no change was needed
there), this doc. No Git mutations, no dependency/global-config changes, no
real daemon run, no user-service or PID signaling. This addendum does not
alter or supersede the historical **21/21** / **15/15** counts above; it adds
5 new tests on top of the unchanged 21 (26/26).

**P1 — `startControlServer.close()` left owned sockets undisposed, hanging the caller.**
`close()` only *measured* whether tracked sockets closed within its bound; it
never disposed a straggler, so any socket that missed the bound kept the
Node event loop alive forever (`accept-live-child-crash.mjs` never calls
`process.exit()`, relying on natural exit).
- RED (real helper, no shell/PID wrapper): spawned a directly-owned Node
  subprocess (`runAcceptanceProcess`) that imports the real
  `startControlServer`, opens a dangling raw connection, and calls
  `control.close(300)`. Before the fix this subprocess never exited and
  `runAcceptanceProcess`'s bounded 4s timeout had to SIGTERM-kill it
  (`error.killed === true`), proving the hang.
- Fix: `close()` now destroys every still-tracked socket *after* the
  immutable `closeProof` is captured, so disposal can never flip
  `closed`/`openSockets` or stand in for fixture-child exit evidence.
- GREEN: same subprocess now exits on its own and prints
  `{"closed":false,"openSockets":1,...}` — proof unchanged, process no
  longer hangs. Permanent regression: `live-child-crash-fixture.test.mjs`
  → "close() disposes tracked sockets left open after the bound...".
- Same audit applied to `startExitObserver`'s `stop()` and
  `probeExitObserver`'s `cleanup()`: if SIGKILL does not produce a confirmed
  reap within their bounds, only the local pipe handles this process owns
  are now destroyed to release the event loop; `stopped`/`supported` still
  report `false`/"unverifiable" — disposal never claims the remote process
  exited. This specific branch (SIGKILL failing to reap at all) could not be
  reproduced deterministically without an artificially unkillable process,
  so it is hardened defensively without its own RED/GREEN pair.

**P2 — a raced control-socket error could override an already-selected exit code.**
`ctl.on("error")` unconditionally called `process.exit(controlLost)`, even
after `finish()` had already chosen and sent a different terminal code
(shutdown/deadline/sigterm/sigint) and was mid-flush.
- RED (real generated fixture source, isolated controlled seam, not a
  separate mock): added a test-only `raceControlErrorAfterFinishMs` param to
  `buildFixtureProgram` (`null`/unused in production) that races a forced
  control error into `finish()`'s 25ms flush window. Spawned the real
  generated program, sent `shutdown`, and observed exit code **93**
  (`controlLost`) instead of the selected **0** — confirmed against the
  unfixed source.
- Fix: `ctl.on("error")` now returns early if `settled` is already true.
- GREEN: same script now exits **0** as selected. Permanent regression:
  "a control-socket error racing an already-selected finish() must not
  override its exit code".

**P2 — unsupported-probe diagnostics were replaced by a generic nonzero-exit message.**
`probeExitObserver` treated any nonzero exit (including the documented
unsupported/register-error contract, code 2) as an opaque failure, discarding
`message.reason`.
- RED: pointed `probeExitObserver` at a real, minimal Python `--probe`
  script emitting `{"type":"unsupported","reason":"synthetic-test-reason"}`
  and exiting 2; got back `{"reason":"probe exited with code 2"}` — the
  structured reason was lost.
- Fix: when `message.type === "unsupported"` and `exit.code === 2`, the
  parsed `reason` is preserved as-is; any other combination (including a
  `"capable"` reply with a nonzero exit) still fails via the existing
  `cleanup()` path.
- GREEN: unsupported case now returns `{"reason":"synthetic-test-reason"}`;
  a synthetic `"capable"` reply exiting 1 still correctly returns
  `supported:false` with a code-based failure reason. Permanent
  regressions: "probeExitObserver preserves the structured unsupported
  reason..." and "...still fails a nonzero exit from a capable reply".

**Coverage (NIT, straightforward only).** Added "kernel exit observer
stop() while still watching a live owned child stops via SIGTERM, not
force" — the existing suite only exercised `stop()` after the observer had
already settled. Did not add a deterministic contradictory-channels
(kernel-exit-then-later-pong) test: constructing that race without touching
`classifyChildState`'s own timing would be speculative rather than
straightforward, so it is left as an open coverage gap, not implemented here.

Commands run (this worktree, `a6ea55c` base, no daemon):
`node --test scripts/live-child-crash-fixture.test.mjs` → 21/21 before any
edit (unchanged baseline), 26/26 after all four fixes and their regressions
were added. Isolated RED/GREEN checks for each item were run as standalone
`node` invocations against the real exported helpers before being folded
into the permanent suite, per item above.

## Root verification — 2026-09-06 21:16 UTC

After worker settlement, root reproduced an additional behavioral failure:
an unavailable `python3` emitted an unhandled asynchronous spawn error and
killed the caller (isolated regression exit 1). The probe now consumes that
error and returns unsupported; it also reports unverifiable cleanup when
the owned process exit cannot be observed. No parent environment was changed.
The child-only empty PATH regression now passes with the full **21/21**
fixture tests, no skips. This supersedes the historical 20-test count below.

Root fast-forwarded this worktree to main `7269184`, preserved all five draft
files, and rebuilt the Rust workspace locked/offline. The real macOS run
then passed **15/15** checks with its live child answering after daemon death,
kernel-observed eventual child exit, unforced observer/service exits and no
open control sockets. Receipt:
`.preflight/acceptance/live-child-crash-1788729349487-c8421a36-85c5-4928-a94a-9b756f8672c7.json`.
The private crash fixture was removed only after those observations.

The same unit and real-process commands are now required in both native CI
jobs. Linux results remain pending that run; Windows runtime, PTY reattachment
and pending-at-crash receipt recovery remain open. No product behavior or
source oracle was changed to manufacture this acceptance.

Direct depth-1 leaf work in worktree `codex-native-crash-recovery` (branch
`codex/native-crash-recovery`, base `main` `b63719b`). Slices: initial
evidence under task `task_fb39b6b985e0` / dispatch `ctx_ea759a9403ba`;
root-review corrections under `task_f3e8c2ab5aed` / dispatch `ctx_76b10826a144`;
final robustness corrections under `task_6189c7cb11d9` / dispatch
`ctx_0c6cf5311397`. Host: macOS arm64 (Darwin), Node v26.8.1, Python 3.9.6,
rustc/cargo 1.98.0. All cargo commands ran `--locked --offline` with
`CARGO_BUILD_JOBS=2` and the worktree-local target directory. No Rust sources
were touched — the current contract passed without product edits, which is
new acceptance coverage, not a manufactured RED.

## The gap being closed

- `scripts/accept-core-cli.mjs` stops **every** session before SIGKILLing the
  daemon, so it proves only dead-service persistence (records, completed
  receipts, identity) — nothing about a child that is still alive.
- `crates/drogon-core/tests/engine.rs` recovery tests model handle loss by
  opening a **second Engine** over the same data — a process-shaped
  simulation, not a process death.
- This fixture is the first real live-child run: an owned daemon process is
  SIGKILLed through its exact `ChildProcess` handle while its PTY child is
  independently observable to be alive.

No PTY reattachment is claimed anywhere here. Survival of the child after
daemon death is host behavior that this fixture **observes**; the drogon
assertions hold for every observed outcome.

## Owned files

- `scripts/live-child-crash-fixture.mjs` — harness-only fixture: the PTY child
  program source, the parent-side private control server, the kernel
  exit-observer Node wrapper, and the combined child-state classifier. No
  drogon imports; daemon-free unit tested.
- `scripts/live-child-exit-observer.py` — Python standard-library kernel exit
  observer (`--probe` capability mode; macOS kqueue `EVFILT_PROC`/`NOTE_EXIT`,
  Linux `os.pidfd_open` + `poll`). No installed dependencies.
- `scripts/accept-live-child-crash.mjs` — the acceptance runner.
- `scripts/live-child-crash-fixture.test.mjs` — `node --test` teeth for the
  harness itself (no daemon needed).
- This document. Reused, unmodified: `scripts/acceptance-process.mjs`
  (`startAcceptanceProcess`/`runAcceptanceProcess`), `drogon-cli` for all
  RPC, `.preflight/acceptance/` report convention. `accept-core-cli.mjs`,
  `package.json`, all Rust sources and CI wiring are untouched (root-owned).

## Evidence model (corrected after root review)

Layered liveness/exit evidence, never fabricated:

1. **Control channel (nonce handshake)** proves liveness via pong, delivers
   acked stdin bytes and SIGHUP/SIGWINCH events, and carries the orderly
   shutdown command. Its socket close is **control loss only** — a child can
   drop its socket and keep running, so a close is never treated as exit
   evidence, and a missing record is never mislabeled.
2. **Kernel exit observer** is the exit authority. It is spawned as a
   directly owned `ChildProcess` (Python stdlib) **after** the child proved
   itself alive on the authenticated channel, and a fresh pong **after**
   registration pins the observed identity to that exact process.
   Registration itself pins the *process* (kqueue attach / pidfd), so a
   `NOTE_EXIT`/pidfd event cannot be spoofed by pid reuse that happens after
   registration. The child's pid is **never signaled**: the removed
   `process.kill(record.pid)` fallback is gone (a live socket does not close
   the pid-reuse race).
3. **Ambiguity degrades honestly.** Contradictory channels, an unsupported
   observer, or a silent window classify `unverifiable`: the fixture
   directory is retained and the run fails — never a fabricated `exited`.

The classifier (`classifyChildState`) combines both channels in a bounded
window: kernel exit (definitive) > pong (live) > `unverifiable`.
Silence from the observer does not prove that a disconnected child is live.

Fixture properties (unchanged): 120 s self-shutdown deadline, SIGHUP/PTY-EIO
handled explicitly, no descendant tree, no shell, no PID search, nonce never
logged (argv-embedded; the daemon strips `DROGON_*`/`ORCA_*` from session
env, and the fixture reports a count proving zero leaked control-plane vars
in the real grandchild).

## Root-review corrections in this slice

- Control socket close is no longer treated as authoritative exit; the
  classifier + cleanup require the kernel observation (or degrade to
  unverifiable + retained fixture).
- `process.kill(record.pid)` fallback removed entirely; no stale-PID signal
  path exists anywhere in the harness.
- Kernel exit handle acquired pre-crash with post-registration identity pin.
- `server.close` proof fixed: every socket (authenticated or not) is tracked;
  `close()` reports the actual `{closed, openSockets, childHandshakes,
  rejectedHandshakes}` after the bound instead of assuming success.
- Ping tokens are unique per request (`randomUUID`); waiter timers are
  cleared on every resolve path; missing-record waits resolve `known:false`.
- Replay proof is `assert.deepEqual(replay, session)` over the **whole**
  historic response, not three sampled fields.
- No-respawn proof is separated by authority: product-side (deterministic)
  daemon session rows stay at 1 across the replay; fixture-side (bounded 500 ms
  settle, explicitly labeled in the report) corroborates that no second
  nonce handshake ever arrived.
- Negative tests: a child that drops its control socket without affirmative
  evidence is classified `unverifiable`, never exited, and is never signaled.

## Final robustness corrections (third slice)

- **`startExitObserver` startup hang (root-reproduced RED).** With an
  observer that exits before printing `ready` (repro:
  `startExitObserver(process.pid, {scriptPath: "/dev/null", deadlineMs:100})`),
  the exit wake cleared the startup timer and repolled forever. The startup
  loop now settles on first report, spawn error, early exit, or ready timeout
  (`readyTimeoutMs`, default 8 s), and every rejection reaps the exact owned
  child (SIGKILL if alive, bounded exit wait — a failed spawn has no process
  and resolves immediately) before throwing. GREEN: the root repro now
  settles in ~30 ms with `exited before ready (code 0, signal null)`, covered
  by deterministic bounded tests for no-ready exit, no-ready stall (silent
  30 s sleeper reaped at the 400 ms ready timeout), and an unavailable
  executable (async ENOENT), via a minimal injectable
  `executable`/`args`/`readyTimeoutMs` seam with unchanged defaults.
- **`probeExitObserver` hygiene.** The line-wait timer is gone (bounded
  polling loop); a `capable` verdict now additionally requires the probe
  process itself to exit cleanly with code 0, and every failure path kills
  and reaps the owned probe process.
- **Timed-out waiters self-remove.** Observer waiters are a Set of entries
  that delete themselves on their own timeout as well as on wake — no stale
  accumulation between wakes.
- **Classification vocabulary is exactly `live` / `unverifiable` / `exited`.**
  A merely silent (unsettled) observer is not affirmative current liveness —
  it can stall — so control loss without a fresh pong or a kernel event now
  classifies `unverifiable` (`control-lost-without-pong-or-kernel-exit`); the
  former `live-control-lost` verdict is gone. Only a real pong proves live,
  only a kernel event proves exited. Regression test: a child that drops its
  control socket while alive, watched by a real silent observer, classifies
  `unverifiable`, is never classified exited, and is never signaled.
- **Cleanup verdict aggregation.** New pure routine `evaluateCleanupProof`
  (consumed by the runner, unit-tested directly): a forced observer stop, a
  forced final daemon cleanup, any unverifiable proof, or untracked open
  sockets set the run **FAILED** — never PASSED with merely a retained
  fixture.

## What the run proves (owned daemon + isolated temp data + folder workspace)

Exact commands:

```
CARGO_BUILD_JOBS=2 cargo build --workspace --locked --offline   # exit 0
node --test scripts/live-child-crash-fixture.test.mjs           # 20 pass, 0 fail
node scripts/accept-live-child-crash.mjs                        # PASSED (3x)
```

Result: **PASSED, 15/15 checks** across three consecutive runs, cleanup fully
proven on both channels (control closed by orderly shutdown; fixture child
exit **kernel-observed**; crashed daemon observed exiting with SIGKILL;
restarted daemon exited on SIGTERM; observer stopped cleanly without
forcing; control close proof `closed: true, openSockets: 0`; fixture
directory removed). Root independently reproduced the healthy run
(`live-child-crash-1788728140624-…json`: live pong after SIGKILL, later
kernel exit, owned clean cleanup) and that positive evidence is preserved by
the corrected fixture. Reports (binary SHA-256 of both binaries recorded
inside):

- `.preflight/acceptance/live-child-crash-1788728618201-90017508-ee0d-4605-aafc-cccabb0c7edb.json`
- `.preflight/acceptance/live-child-crash-1788727853361-738ff3ef-9962-4e21-8402-05ad006c5ef3.json`
- `.preflight/acceptance/live-child-crash-1788727936410-beabd8b2-7c6e-48d4-b32b-85e0e6741fa2.json`

Checks, in order:

1. `exit-observer-capability-probed (kqueue-proc)` — Python3 stdlib
   capability probe before any daemon work.
2. `daemon-start-and-cli-status` — owned daemon #1, CLI `status` healthy.
3. `folder-workspace-registration` — non-git folder workspace.
4. `fixture-nonce-handshake-and-env-strip` — child hello on the private
   channel; `envLeaked === 0` in the real grandchild.
5. `kernel-exit-handle-acquired-pre-crash` — observer registered on the
   handshake-authenticated pid, then a fresh pong pins the identity.
6. `fixture-live-evidence-on-both-channels` — `READY` via `session.read`
   (daemon path) and pong via control, before any crash.
7. `pre-crash-write-resize-and-incarnation-discipline` — `session.write`
   bytes acked by the child over the control channel; `session.resize`
   observed child-side as SIGWINCH 100x32; wrong incarnation refused with
   `stale_incarnation`; row still `live`.
8. `daemon-death-authoritative-exit-observation` — pong immediately before;
   `kill("SIGKILL")` on the exact owned handle; the `exit` event (not a
   timer) observed the death.
9. `post-death-child-state-kernel-and-control` — on this macOS host: child
   **survived** (`live`, pong with a silent kernel watch) and the kernel
   **did deliver SIGHUP** (`sighupDelivered: true`), recorded and survived.
   Either outcome passes; the observation is recorded in the report.
10. `restart-stable-host-renewed-instance-and-auth` — same `hostId`, new
    `serviceInstanceId`, rotated `auth.token`.
11. `prior-live-row-unverifiable-never-exited` — the row of a session whose
    child was provably still running reads `verdict: "unverifiable",
    exitCode: null` — the honest label, never an invented `exited`.
12. `recovered-session-correct-and-incorrect-incarnation` — read/write/resize
    with the correct incarnation → `unverifiable`; wrong incarnation →
    `stale_incarnation`; unknown id → `not_found`; `session.stop` with the
    correct incarnation returns the `unverifiable` row without touching the
    (survived, non-owned) child.
13. `historic-receipt-replay-whole-response` — replaying the original
    `session.start` (same requestId, byte-equivalent params) returns the
    whole historic response, `deepEqual` to the admission-time result
    (`verdict: "live"` then), while the current row is `unverifiable` —
    both labeled accurately in the report.
14. `no-respawn-rows-and-single-fixture-child` — product-side session rows
    stay at 1 across the replay (deterministic); fixture-side exactly one
    nonce handshake ever arrived (bounded 500 ms settle, labeled).
15. `restarted-daemon-owns-directory` — a new session on daemon #2 is
    observed exiting with its real exit code 7 and persists it.

Harness teeth (daemon-free, `node --test`, **20/20**): respawn detector
counts two handshakes as two children; a silent connection never yields a
control close and only a real close does; a missing record resolves
`known: false`; the self-deadline bounds an unresponsive child with voluntary
exit code 92; wrong nonces are rejected and never registered; SIGHUP is
reported without killing the child; simultaneous pings all resolve (unique
tokens); the close proof reports a dangling unauthenticated socket instead of
claiming success; the observer probe/report/stop paths are exercised against
real short-lived and long-lived processes; a register-error for an
already-gone pid is never mislabeled exit; observer startup settles on
early exit, stall, and spawn failure while reaping the owned child; the
classifier honors kernel exit over control loss, never classifies a
dropped-but-alive child as exited (a silent observer is not liveness), and
degrades to unverifiable without an observer; and the pure cleanup verdict
fails the run on forced observer/daemon cleanup, unverifiable proofs, or
untracked sockets.

## RED history (fixture-side, not product)

- First slice: initial full run FAILED at the SIGWINCH check — Node can run
  the JS SIGWINCH handler before refreshing tty winsize (observed stale
  80x24); fixed by deferring the size read one `setImmediate`. Report
  `live-child-crash-1788726169994-…json`; its retained fixture directory was
  removed after diagnosis (every process had already been proven exited).
- Correction slice: the first `node --test` run of the new observer tests
  hung — `startExitObserver` awaited the observer's first stdout line before
  writing the config line, but the observer only prints after reading config
  (stdin). Deadlock caught by the suite timeout; fixed by writing config
  immediately after spawn.
- Final slice: root reproduced the startup hang variant with an observer that
  exits before `ready` (`/dev/null` as the script — the exit wake cleared the
  startup timer and repolled forever); RED confirmed locally (unsettled
  top-level await), GREEN after the startup loop was made to settle on early
  exit/timeout/error with owned-child reaping, covered by the three new
  bounded startup tests. No product behavior was implicated in any RED; no
  product code changed at any point.

## Honest limits

- **Linux: unexecuted here.** The observer's pidfd path and the fixture's
  Node primitives are written and pidfd is capability-gated, but macOS is
  not Linux proof — root CI should run it there (including the alternative
  child-exited outcome, which the assertions accept).
- **Windows: explicitly not accepted.** `drogond` itself is unsupported
  there; the script refuses with exit 2 rather than fabricating a
  cross-platform PASS.
- **Pending receipt recovery: not closed.** No allowed fault seam can leave
  a request row `pending` at kill time deterministically (the window is one
  dispatch's insert→finish; timing a SIGKILL into it would be a flake, and
  writing journals directly would fabricate state). The sweep itself is unit
  covered in `drogon-core`; end-to-end pending-at-crash recovery stays open
  and is labeled `not-closed-no-fault-seam` in every report.
- **PTY reattachment: out of scope** — no claim is made that anything
  reconnects to the survived child's PTY; the new daemon correctly reports
  it cannot act on the session.
- Exit *status* is not claimed for the survived-then-cleaned-up child: the
  kernel observer proves exit, not the exit code (the child's own `bye`
  reports its intended code; `waitpid` on a non-owned process is
  unavailable).
- The child-survives observation (and SIGHUP delivery) is this host's
  behavior; the drogon-side assertions were verified against it and are
  written to hold for the exited outcome as well, but that branch is
  unexecuted until a Linux run.
