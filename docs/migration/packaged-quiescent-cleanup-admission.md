# Packaged quiescent-cleanup admission (harness side)

Leaf delivery, 2026-09-06. Owned files only: `scripts/packaged-fixture-daemon.mjs`,
`scripts/packaged-fixture-daemon.test.mjs`, this document. No shared manifest,
observer, product-code, or Git-state changes; root owns integration and the
native service half of this contract.

## Contract (additive, harness side)

- `status` must carry `processId` (positive integer, kernel-observer
  correlation ONLY, never a signal target) and advertise
  `runtime.quiescent-shutdown.v1`. Missing capability or an invalid
  `processId` fails closed with no PID-signal fallback.
- `runtime.shutdown {hostId, serviceInstanceId}` must match the authenticated
  current service and reply `{hostId, serviceInstanceId, accepted:true}` after
  a durable freeze; the process then exits itself after the reply (delivery
  uncertain). Busy / stale / foreign / unsupported denies fail the cleanup.
- `packagedFixtureDaemon(binary, cli, dataDir)` keeps its public signature and
  its `rpc` / `capture` / `stop` surface used by `accept-desktop.mjs`
  (plus an additive `identity()` reader). One narrow additional helper,
  `createFixtureDaemonWithSeams`, carries the injectable `rpcImpl` /
  `observerImpl` seams for deterministic unit flow evidence.
- Fenced `stop()` order: capture identity → pre-cleanup `status` reconfirm →
  stop only `live` sessions owned by this exact fixture via their incarnation
  RPC (an `unverifiable`/recovered or foreign-host session is never acted on;
  a `session.stop` that does not prove `exited` fails) → register the existing
  `startExitObserver` against the reconfirmed `processId` → reconfirm
  host/service/process unchanged AFTER observer readiness → fenced
  `runtime.shutdown` → require the matching `accepted:true` reply AND a kernel
  `exit` observation → clean the directly-owned observer gracefully. Lost
  reply, timeout, changed identity, or observer failure stays
  failure/unverifiable and the fixture is retained. A forced/unknown observer
  cleanup can never count as PASS. No `lsof`, no `ps`, no `process.kill`
  anywhere in the new implementation.

## Tests-first evidence

- RED history, stated honestly: the first run against the pre-contract
  factory failed at import (missing named exports) — a preparation failure,
  not behavioral RED. Real assertion RED was then reproduced against the
  running contract implementation for six review defects (recapture transfer,
  `session.stop` host/incarnation echo, double observer-stop on throwing
  cleanup, missing-array inventories read as empty, unsafe-integer
  `processId`) before fixing them.
- GREEN (pinned
  `/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test
scripts/packaged-fixture-daemon.test.mjs`): **24 pass / 0 fail**, covering
  the previous 17 (stale capture/reconfirm before and after observer
  readiness, unsupported capability, invalid `processId`, busy/refused
  shutdown, malformed `accepted` identity, observer ready/exit failures,
  forced-cleanup refusal, unverifiable and foreign-host sessions never acted
  on, non-`exited` `session.stop`, no `lsof`/`ps`/`process.kill` fallback)
  plus recapture semantics (same identity allowed; restarted
  host/service/process refused without transferring ownership), `session.stop`
  replies echoing a foreign `hostId` or rotated `incarnation` (checked against
  the real producer `to_json` in `crates/drogon-core/src/session.rs`, which
  returns the full Session row), a single unified RPC+observer event log
  proving observer readiness lands after live-session stops and before the
  final `status` and `runtime.shutdown`, an `observer.stop` that throws being
  invoked exactly once with the failure retained, malformed inventories
  failing instead of reading as empty, and unsafe-integer `processId`
  refusal. `processId` now requires `Number.isSafeInteger`.
- Related existing suite `scripts/live-child-crash-fixture.test.mjs`
  (untouched shared observer): **26 pass / 0 fail** on this host.
- Scope: fake CLI RPC plus fake kernel observer, no user daemon. This is unit
  flow evidence, NOT native runtime proof of an actual daemon shutdown.

## Explicit gaps (root-owned)

Root independently inspected the final consumer, its tests and the actual
Session producer fields, then ran 50/50 consumer + existing observer tests
and 66/66 packaging tests on pinned Node24. The counts overlap by 24 consumer
cases; they are not 116 unique tests. The suite is now included in
`test:packaging`. The worker's correction RED chronology is reported above;
root independently reproduced the final GREEN, not that historical RED.
These checks do not exercise the actual service shutdown or admit installation.

- Native proof awaits the separate product implementation of
  `status.processId` + `runtime.shutdown` and root's post-merge packaged
  acceptance: a real CLI `status` with the capability, a fenced shutdown that
  freezes durably and self-exits, and a kernel-observed exit through the real
  `startExitObserver`. This delivery must not be cited as an actual
  daemon/shutdown implementation or full packaged acceptance.
- `accept-desktop.mjs` still calls `capture()` / `rpc("status")` /
  `stop()` unchanged; its end-to-end packaged path exercises the new
  contract only once the service half lands.
