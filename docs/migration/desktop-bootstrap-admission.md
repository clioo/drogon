# Desktop native bootstrap + response-identity admission

Scope: `apps/desktop/electron.vite.config.ts`, `apps/desktop/src/main/{index.ts,
native-client.ts,native-client.test.ts,build-info.ts,build-info.test.ts,
daemon-path.ts,daemon-path.test.ts,native-runtime-bootstrap.ts,
native-runtime-bootstrap.test.ts}`, additive `buildInfo` in
`src/preload/index.ts` and `src/shared/{bridge-validation.ts,
session-contract.ts}`. Source: preserved draft/base capsule staged by root at
`.preflight/desktop-bootstrap-transfer/{draft,base}` (recorded in
`docs/migration/worktree-desktop-bootstrap-transfer.json`, all 14 hashes
re-verified against the staged files before use — full 64-character sha256
digest compared, not a prefix). The historical report at
`.preflight/desktop-bootstrap-transfer/draft/docs/migration/
desktop-installation-implementation.md` was read as provenance only, not as
proof of current behavior.

## Base-vs-current check (before touching anything)

All 7 files with `hasCommittedBase: true` were byte-identical
(`cmp`-verified) between the staged `base/` snapshot and this worktree's
current production files — i.e. no later PR1 fixes had landed on top of
`0f915cf` for this slice in this checkout. This meant the draft's diff
against `base/` could be applied directly with no reconciliation conflicts;
nothing here overwrote unrelated production changes because none existed.

## What was reused as-is from the draft

- `apps/desktop/src/main/build-info.ts` + test — packaged `build-info.json`
  reader, absent/malformed both read as `null`, never invented.
- `apps/desktop/src/main/daemon-path.ts` + test — `PATH` fallback list for a
  GUI-launched packaged app; no shell spawned, no profile files read.
- `apps/desktop/src/main/native-client.ts` + test — `identityMismatch`
  extended to check `session.read/resize/stop` (sessionId+incarnation),
  `session.list` (per-entry workspace/host), and `harness.list` (host only),
  not just `session.start`/`harness.start` as before.
- `apps/desktop/src/preload/index.ts`, `shared/bridge-validation.ts`,
  `shared/session-contract.ts` — additive `buildInfo` bridge method only
  (`z.undefined()` input, non-secret `{revision, builtAt, version} | null`
  return); no new renderer surface.
- `apps/desktop/electron.vite.config.ts` — `zod` excluded from
  `externalizeDepsPlugin` for main/preload so the packaged `out/` tree needs
  no `node_modules`. Verified: `require("zod")` count in built
  `out/main/index.js`/`out/preload/index.js` is 0; `electron` itself is
  still externalized.

## Flaw found and corrected: async spawn-error handling

Root's observation was reproduced: the draft's `index.ts` called
`child_process.spawn(...).unref()` inline with no `"error"` listener at
all, and relied on `spawnDaemon(): void` with only a synchronous
`try/catch` in `bootstrapNativeRuntime`. A real nonexistent-binary or
permission-denied spawn reports failure via the child's async `error`
event, not a synchronous throw — the `try/catch` could never see it.
**Correction to an earlier version of this report:** an emitted `"error"`
event with zero listeners is not silently dropped — Node's `EventEmitter`
throws for an unhandled `"error"`, which is an uncaught exception on the
next tick and can crash the whole Electron main process; the original
draft's real risk was that crash, not silent loss.

Fix: `BootstrapDeps.spawnDaemon` is now `(): Promise<void>`, and
`native-runtime-bootstrap.ts` exports a real launch adapter,
`spawnDetachedDaemon(binaryPath, args, env)`, which wraps `spawn`,
registers `"error"`/`"spawn"` listeners synchronously, and calls
`unref()` immediately afterward (unref does not affect whether those
events are later delivered — it only stops the child's handle from
keeping the event loop alive). The returned promise resolves or rejects
whenever those events actually fire. `index.ts` wires this adapter
directly (no more inline spawn construction) and `await`s it inside the
existing `try/catch`, so an async rejection is now the `spawn-failed`
outcome — reported, not swallowed, retried, or left pending.

Behavioral RED reproduced then fixed: `native-runtime-bootstrap.test.ts`
adds a "real launch adapter" suite that calls `spawnDetachedDaemon` against a
genuinely nonexistent path (`/tmp/drogon-native-runtime-bootstrap-test-does-
not-exist-<pid>/drogond`) — a real `child_process.spawn` ENOENT, not a mock —
and asserts the promise rejects rather than hanging or throwing
synchronously, and that `bootstrapNativeRuntime` reports it as
`spawn-failed`. The prior synchronous-throw test is kept (still a valid,
distinct case) alongside a new async-rejection unit test using an injected
`Promise`-based `spawnDaemon`, matching the real adapter's shape.

The readiness-wait loop's timer handling was itself found flawed on
re-review — see the next section — so "left unchanged" above no longer
applies to it as of this round.

## Round 2 (root correction): `unverifiable` is not positive absence, and one hang-prone deadline was two independent ones

Root correctly rejected the first admission: it treated *any* `unverifiable`
status code as "the service is absent, spawn one." But `callNative` returns
`unverifiable` for every one of: a missing/unreadable `auth.token`, a
`realpath` failure on the data directory, a connect error, an idle timeout,
and a disconnect — several of which can happen against a perfectly live,
already-owned daemon (e.g. the token file is briefly unreadable, or this
process just hasn't picked up a token another instance wrote). Spawning on
any of those would risk a second daemon racing the first.

Fix — a narrow, local-only, non-authenticated classification, used *only*
to gate the spawn decision:

- `native-client.ts` gains `LocalEndpointObservation` (`"absent" | "present"
  | "ambiguous"`, reason-carrying) and `observeLocalEndpoint(directory,
  platform, timeoutMs, signal?)`: connects (sending nothing — no auth token
  needed) and classifies `ENOENT`/`ECONNREFUSED` as `"absent"`; a successful
  connect as `"present"`; everything else (permission denied, an unknown
  connect error, this probe's own timeout) as `"ambiguous"`. This is not new
  wire vocabulary — it never talks to the protocol, only to the transport.
  `resolveEndpointPath` (the socket/pipe path construction) was extracted
  out of `callNative` so both share it and can never diverge.
- `bootstrapNativeRuntime` now calls `observeLocalEndpoint` after an
  `unverifiable` initial status and *only* spawns on `"absent"`; `"present"`
  returns `endpoint-present-not-spawning` and `"ambiguous"` returns
  `endpoint-ambiguous-not-spawning` — neither ever spawns. `win32` is still
  rejected before this probe is even reached (verified: the probe mock is
  asserted not-called in that case).
- `callNative` also grew an optional trailing `signal?: AbortSignal` used
  only by the bootstrap path (see below); every existing caller that omits
  it sees byte-identical behavior (`signal?.aborted` guards are no-ops when
  `signal` is `undefined`), preserving the ordinary `callNative` Result
  contract for the rest of the app.

Second, independent flaw: the readiness loop bounded itself with
`readinessTimeoutMs` (`Date.now() < deadline`), but neither the *initial*
`checkStatus()` call nor each poll's `checkStatus()` call was itself bounded
by that deadline — each has its own internal ~15s request timeout inside
`callNative`, while bootstrap claimed a 10s budget. A single stuck initial
call, or one stuck poll, could run for its own ~15s regardless of what
bootstrap had promised, delaying window creation past the stated bound.

Fix: `BootstrapDeps.deadlineMs` now bounds the *entire* bootstrap — initial
observation, the local endpoint probe, and every readiness poll all draw
from one `deadlineAt = Date.now() + deadlineMs`, computed once. A new
`withDeadline()` helper races each `checkStatus`/`observeLocalEndpoint` call
against the *remaining* budget (not a fresh per-call timer) using an
`AbortController`: on timeout it aborts (letting the real socket-based
adapters destroy their socket instead of leaking it) and resolves
immediately: the abandoned call's eventual settlement is never awaited
again, so a late "ok" arriving after bootstrap has already returned
`observation-timed-out` or `spawned-then-timed-out` can never retroactively
trigger a spawn or flip an already-reported outcome.

New/renamed outcome kinds: `observation-timed-out` (replaces silent hanging
on a stuck initial/poll call), `endpoint-present-not-spawning`,
`endpoint-ambiguous-not-spawning; reason`. `readinessTimeoutMs` was renamed
to `deadlineMs` to make its now-broader scope explicit; `index.ts`'s wiring
was updated to match (still a 10s budget).

Also corrected in this round — a false statement in the round-1 admission:
it claimed the fixed adapter "resolves/rejects on the real `spawn`/`error`
events *before* calling `unref()`," implying `unref()` happens after
resolution. It does not: `spawnDetachedDaemon` registers the listeners and
calls `unref()` synchronously, immediately, in the same tick as `spawn()`;
`unref()` only stops the child's handle from keeping the event loop alive,
it does not delay or suppress the later `spawn`/`error` events. It also
mischaracterized the original draft's actual risk as the failure being
"silently dropped ... no unhandled crash" — an emitted `"error"` event with
zero listeners is exactly the case Node's `EventEmitter` throws for (an
uncaught exception, not silence); that crash risk, not silent loss, was the
original draft's real exposure. Both corrected in the "Flaw found and
corrected" section above and in the code's own comments.

New tests (`native-runtime-bootstrap.test.ts`), all using `mkdtemp` +
`os.tmpdir()` for owned fixtures with `afterEach` cleanup, no hardcoded
`/tmp` paths:

- Genuinely failing-before, now passing: a `checkStatus` that never settles
  (`neverSettles`, ignores its signal) — bootstrap still returns
  `observation-timed-out` within its budget (asserted `< 2s` wall time),
  not hung. Same shape for a stalled *post-spawn* poll →
  `spawned-then-timed-out`, still bounded.
- An injected `"ambiguous"` observation never spawns.
- An injected `"absent"` observation (fresh install) spawns exactly once
  and reaches `spawned-then-healthy`.
- A **real** fixture: a real `node:net` server listening on the exact
  socket path `resolveEndpointPath` would compute, with `checkStatus`
  simulating a missing/unreadable-token `unverifiable` (the ambiguity this
  whole fix targets) — the real `observeLocalEndpoint` (not a mock)
  classifies it `"present"`, and bootstrap does not spawn.
- A real fixture with no socket file at all — the real `observeLocalEndpoint`
  classifies it `"absent"`.
- The round-1 real-`spawnDetachedDaemon`-against-ENOENT test is retained,
  now using an `mkdtemp`-owned scratch directory instead of a hardcoded
  `/tmp/...-<pid>` path.

## Other preserved guarantees (unchanged from draft, verified in tests)

- Packaged-only: `bootstrapNativeRuntime` returns `not-packaged` whenever
  `isPackaged` is false, before any status check result is inspected —
  dev never spawns.
- Any status code other than `unverifiable` (`unauthorized`,
  `internal_error`, etc. — meaning something did answer) never spawns and
  never even reaches the local endpoint probe.
- `win32` never spawns (`drogond` has no named-pipe implementation there)
  and never reaches the probe either; bounded, not silently advertised as
  supported.
- Missing bundled binary is reported, not attempted.
- Single-instance lock (`app.requestSingleInstanceLock()`) is bypassed only
  under `DROGON_ELECTRON_PROFILE` (isolated acceptance profiles), which does
  not touch real per-user services.
- `shell: false`, `windowsHide: true`, `PATH` built additively from
  `process.env.PATH` plus a fixed fallback list — no shell profile reads, no
  global `process.env` mutation (the merged `PATH` is passed only in the
  spawned child's own `env`).
- The daemon's own endpoint/socket lock remains the sole final ownership
  arbiter; nothing here unlinks a socket, kills, or replaces an incumbent —
  `"present"`/`"ambiguous"` both simply decline to compete.

## Verification (this worktree, offline, no installs run)

- `pnpm --filter @drogon/desktop typecheck` — clean, before and after both
  rounds.
- `pnpm --filter @drogon/desktop test` — round-1 baseline **44/44** (8
  files); round-1 result **68/68** (11 files); **this round: 74/74** (11
  files — `native-runtime-bootstrap.test.ts` grew from 11 to 18 cases,
  `native-client.test.ts` unchanged this round at 10 cases). Only these
  desktop unit suites and the root contract suite below were run; no wider
  "whole package" claim is made.
- `pnpm run test:renderer-contracts` (root contract suite) — **72/72**,
  unaffected before and after both rounds.
- `pnpm --filter @drogon/desktop build` — succeeds; confirmed `zod` bundled
  (0 external `require("zod")` in `out/main`/`out/preload`), `electron` still
  externalized. No Electron app was launched and no services were started.

## Round 3 (root correction): abort-during-async-prep, a sync-throw escape hatch, and unbounded spawn/sleep

Root found three more concrete gaps on re-review, all fixed in this round,
scope narrowed to exactly `native-client.ts`, `native-client.test.ts`,
`native-runtime-bootstrap.ts`, `native-runtime-bootstrap.test.ts` (no other
backend files touched).

**1. `callNative` only checked `signal.aborted` once, at the very top.**
If the signal aborted *during* `await realpath(...)` or `await readFile(...)`,
the code fell through into opening a socket and registering an `"abort"`
listener on a signal whose `"abort"` event had *already fired* — that event
never replays, so the listener would never run and the socket would open
regardless. Fixed by rechecking `signal?.aborted` immediately after each
await (and once more right before `createConnection`), using `readFile`'s
own `signal` option (`realpath` has no such option, hence the manual
recheck), and having the catch block distinguish "aborted" from "a genuine
fs error" so an abort always throws rather than resolving `unverifiable`.
Also added: the `"abort"` listener is now removed on every settle path (not
just left registered), and the socket `"data"` handler now checks `settled`
first so a response racing in after an abort/finish can never mutate the
module-level `lastKnownHostId`.

**2. `withDeadline`'s `run(signal).then(...)` could let a synchronous throw
escape as an uncaught rejection.** If a `checkStatus`/`observeLocalEndpoint`
dependency threw synchronously instead of returning a promise (a contract
violation, but one this code must survive), that throw propagated out of
`withDeadline`, out of `bootstrapNativeRuntime`, and out of the
`app.whenReady().then(async () => { ...; await bootstrapDaemon(); createWindow(); })`
chain — meaning `createWindow()` would silently never run. Fixed by wrapping
the `run(...)` call itself in a `try/catch` inside `withDeadline`, folding a
synchronous throw into the same `timedOut: true` bucket as a real timeout or
an async rejection.

**3. The whole-bootstrap budget didn't actually cover `spawnDaemon()` or
`sleep()`.** A spawn or sleep dependency that never settled could hang
bootstrap past `deadlineMs` regardless. Fixed *without* introducing any
cancellation of the spawn/sleep themselves — killing a spawn that may have
already created a real OS process, on a mere scheduling delay, is exactly
the "unsafe killing" this bootstrap must never do. Instead, both are now
raced against the remaining budget (a new `spawn-timed-out` outcome for the
spawn case): bootstrap stops *waiting*, never retries, and both promise
outcomes are still fully handled (`.then(ok, reject)` on the raced promise)
so an abandoned late settlement can never surface as an unhandled
rejection.

New regression tests (all real behavior, not source-fixture weakening):
`native-client.test.ts` gained a "callNative abort handling" suite using a
real `mkdtemp`-owned data directory with a real `auth.token` file, aborting
synchronously right after invocation (landing while `callNative` is
suspended at its first real-disk-I/O `await`, reproducing the exact gap)
and asserting rejection with no socket ever opened.
`native-runtime-bootstrap.test.ts` gained: a spawn that never settles →
`spawn-timed-out`, bounded and not retried; a `checkStatus` dependency that
throws synchronously → (at the time of this round) normalized to
`observation-timed-out`, not an uncaught rejection; the same for a
synchronously-throwing `observeLocalEndpoint`. **Round 4 below found that
specific normalization mislabeled a genuine failure as a timeout — see
below for the corrected outcome.** Desktop test count at the end of this
round: **74 → 79**, in the same **11** backend test files as before this
round (native-client `10 → 12`, native-runtime-bootstrap `18 → 21`) — the
renderer-recovery files (`dismissed-sessions.test.ts`,
`harness-launch-recovery.test.ts`, session-list identity tests) were a
separate, later task; see `docs/migration/renderer-recovery-admission.md`
for their own counts.

Verified after this round: `pnpm --filter @drogon/desktop typecheck` clean;
`pnpm --filter @drogon/desktop test` **79/79** (11 files); root contract
suite **72/72** unaffected; offline build succeeds.

## Round 4 (root correction): failure mislabeled as timeout, a sleep call evaluated outside its race, three timer implementations

Root found three more concrete gaps, all in `native-runtime-bootstrap.ts`
(no other backend files touched this round):

**1. A genuine dependency failure was reported as `observation-timed-out`.**
`withDeadline` collapsed a synchronous throw *and* an async rejection into
the same bucket as an actual elapsed timer, so `bootstrapNativeRuntime`
could report "timed out" when no deadline had elapsed at all — the
dependency had simply failed immediately. Fixed by replacing the boolean
`Raced<T>` (`{timedOut}`) with a three-way `{ kind: "value" | "timed-out" |
"failed" }`, and adding two new, honest outcome kinds:
`{ kind: "observation-failed"; message }` (initial `checkStatus`/
`observeLocalEndpoint` failed, not timed out) and
`{ kind: "binary-check-failed"; message }` (`binaryExists()` threw). A
dependency failure still never authorizes a spawn or a retry — same as
before — it's just reported for what it actually was.

**2. `raceRemaining(deps.sleep(ms), remaining())` pre-evaluated the sleep
call outside any race/try.** `deps.sleep(ms)` was invoked directly in
`bootstrapNativeRuntime`'s own stack frame to produce the promise handed to
`raceRemaining` — a synchronous throw from `sleep` itself (a misbehaving
dependency, same class of bug as the round-3 `checkStatus`/
`observeLocalEndpoint` fix, just missed for `sleep`) would have escaped
uncaught, before `raceRemaining` ever got a chance to catch anything.
Fixed by making the shared race function accept a *thunk* (`(signal) =>
Promise<T>`) and calling it inside its own `try`, exactly like
`checkStatus`/`observeLocalEndpoint` already did — `deps.sleep(ms)` is now
only ever invoked inside that `try`. `binaryExists()` (synchronous, no
race involved) got the same treatment via a direct `try/catch` at its call
site.

**3. Three separate timer/race implementations** (`withDeadline`,
`raceRemaining`, and an inline hand-rolled `Promise` for the spawn
decision) were consolidated into one `race()` function used for all four
bounded calls (`checkStatus`, `observeLocalEndpoint`, `spawnDaemon`,
`sleep`). Callers that have no real cancellation-capable adapter
(`spawnDaemon`/`sleep`) simply ignore the `AbortSignal` `race` hands them;
`race`'s own `abort()` on timeout is then a no-op for those, never an
unsafe kill — the "no cancellation for spawn/sleep" guarantee from round 3
is preserved, just through one code path instead of three.

New/renamed test coverage in `native-runtime-bootstrap.test.ts`:

- Both synchronous-throw tests (`checkStatus`, `observeLocalEndpoint`)
  updated to assert `{ kind: "observation-failed", message }` instead of
  the old (incorrect) `observation-timed-out`, and now assert the call
  resolves in under 500ms with a 5-second budget — proving no timer was
  actually waited out.
- New: a `binaryExists` that throws → `binary-check-failed`, spawn never
  attempted.
- New: a `sleep` that never settles does not itself hang the poll loop past
  the deadline.
- New: a `sleep` that throws synchronously cannot escape as an uncaught
  exception (resolves `spawned-then-timed-out`, not a crash).
- **The existing "stalled post-spawn status poll" test was corrected, not
  just kept**: it previously used a `checkStatus` that resolved
  `unverifiable` immediately on every call — a fast repeated "not yet", not
  an actually-stuck call, so it proved the loop's own iteration count was
  bounded but not that a genuinely hung single `checkStatus` call is.
  Rewritten so the first call (the pre-spawn check) answers immediately and
  every call after (the post-spawn polls) never settles at all, asserting
  the same `spawned-then-timed-out` outcome within the deadline.
- All prior actual-timeout/no-spawn/abort tests (development-never-spawns,
  already-healthy, ambiguous/present-never-spawns, Windows,
  binary-missing, the two real-launch-adapter tests, the two real-local-
  endpoint-probe tests) kept unchanged and still passing.

Backend test count after this round: **79 → 82** across the same 11 files
(no new files this round) — all of the change is in
`native-runtime-bootstrap.test.ts` itself, which went `18` (round-3-start)
→ `21` (after round 3) → **24** (after round 4: the two sync-throw tests
were corrected in place, not added, alongside the 3 genuinely new tests
above).

Verified after this round: `pnpm --filter @drogon/desktop typecheck` —
exit 0. `pnpm --filter @drogon/desktop test` — exit 0, **105/105** (14
files: the 82 backend tests above plus the 23 renderer-recovery tests
covered in `docs/migration/renderer-recovery-admission.md`, which were not
touched this round). `pnpm run test:renderer-contracts` — exit 0, **72/72**
unaffected. `pnpm run typecheck:renderer-contracts` — exit 0. `pnpm
--filter @drogon/desktop build` — exit 0.

## Left for the coordinator

- Root's separate package/security-manifest changes were not touched (out of
  scope) and were not re-diffed against this slice beyond the base-identity
  check above.
- No PR opened, no commit made, no dependency installed, no real Electron
  launch performed, per this task's constraints.
- `observeLocalEndpoint`'s classification is best-effort on error `code`
  strings (`ENOENT`/`ECONNREFUSED` vs. everything else); if a platform ever
  surfaces "no listener" under a different code this would currently read
  as `"ambiguous"` (never-spawn), which is the safe direction to be wrong
  in, but is worth root's awareness.
- `spawnDaemon`/`sleep` are bounded (bootstrap stops waiting past the
  deadline) but not cancelled — a spawn that genuinely completes after
  `spawn-timed-out` was already reported will simply be attached to on the
  app's *next* launch, never retried within this one.
