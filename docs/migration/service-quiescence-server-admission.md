# Server quiescence admission: drogond side

Worker checkpoint, 2026-09-06. Scope: `crates/drogond/src/{lib.rs,server.rs}`,
new `crates/drogond/src/service_quiescence.rs`, new
`crates/drogond/tests/service_quiescence.rs`. Core files were owned by the
GLM peer (now root-frozen) and were not modified here. No Git operations were
performed; the pre-change baseline was staged only by copying tracked content
(`git show HEAD:...` is read-only) into and out of the working files this
worker owns.

## What was built

The server's half of `service-quiescence-contract.md`:

- `service_quiescence.rs`: `QuiesceGate` (authorized by the handler that
  served an admitted `runtime.shutdown`, only after the reply write was
  attempted — never from the core flag, which flips before the reply exists)
  and `ConnectionRegistry` (tracks in-flight handlers with a transport clone;
  each handler's `ActiveConnection` guard removes its entry the moment the
  handler exits; `drain` shuts down in-flight transports and waits with a
  bounded deadline).
- `server.rs`: `run_accept_loop_inner` checks the gate at the top of every
  accept retry and after each accept; the production entry
  (`accept_loop_with_limits`, used by `serve`) polls a nonblocking listener
  with a 5 ms interval and treats only its own `WouldBlock` as idle — the
  bounded wake mechanism. Accepted streams are restored to blocking mode
  (macOS inherits `O_NONBLOCK`; a paused client must not look like a
  transport error). Injected accept sources keep the exact pre-quiescence
  error contract: every error they return, `WouldBlock` included, is
  budget-classified as before. Public signatures `accept_loop`,
  `accept_loop_with_limits`, `run_accept_loop` and `handle_connection` are
  unchanged; a connection whose dispatch is an admitted
  `runtime.shutdown` authorizes the gate after the write attempt (success or
  known-uncertain delivery) and closes; refused shutdowns are ordinary
  responses and the connection stays open.
- Exit path: gate observed → listener stops → `drain` (bounded 5 s) → loop
  returns `Ok(())` → `serve` drops the exclusive data-dir lock normally. No
  `process::exit`, no signals, no parsed PIDs.

## Tests-first evidence

RED (retained locally in the ignored `docs/migration/service-quiescence-server-red.log`,
not a published artifact): the exit
assertions fail against the baseline server — 7 failed, all
"serving thread did not exit …", 1 passed (injected accept errors, unchanged).
The fixture is abort-capable so even the RED serving thread terminates
deterministically; failures were genuine timeouts, not fixture artifacts.

GREEN: `cargo --locked --offline test -p drogond` — 11 unit + 12 pre-existing
server tests (unchanged, including the oversized-frame EOF test) + 10 new
quiescence tests, stable across 3 repeated runs; `cargo clippy -p drogond
--all-targets` and rustfmt clean on the owned files.

Coverage in `crates/drogond/tests/service_quiescence.rs`: admitted shutdown →
serving thread exits → exclusive lock reacquired; unauthorized /
`stale_incarnation` / `unsupported_host` refusals keep the service available;
live-child `runtime_busy` (retryable) refusal with the child still live,
then admission after the session exits; idle connections do not hold server
lifetime (600 s idle timeout vs 3 s exit deadline); abrupt client disconnect
right after the shutdown request still drains; plain EOF preserves the
service; injected fatal/transient accept-error semantics unchanged; the
production `accept_loop_with_limits` path exits on its own (no abort) and
returns `Ok(())`; one-shot connections do not accumulate descriptors during
normal serving (the last two were added from coordinator review after the
initial RED and are green-only guards — the reaping test fails on the
intermediate registry revision that held clones until drain).

## Review corrections applied (coordinator, 2026-09-06)

1. Fixture lock moved into the serving thread (no manufactured proof).
2. Registry reaps finished connections during normal serving (guard-based
   removal), with the descriptor-accumulation regression test.
3. Accepted streams explicitly restored to blocking; diagnostics removed.
4. Oversized-frame EOF regression: root-caused to the retained registry
   clone outliving the handler; fixed by guard-based removal. Existing test
   untouched.
5. Production wake no longer depends on a pathname reconnect (connect can
   block on a full backlog; a vanished pathname would sleep forever): the
   production listener is polled nonblocking within a bounded interval;
   `WouldBlock` bypass is narrowly scoped to the production source, never to
   injected errors.

## Residual items for root

- Combined workspace gate, CLI/packaged consumer, kernel process-watch
  acceptance, PR/install: root-owned per contract.
- The `runtime.quiescent-shutdown.v1` capability claim should be signed off
  by root only after the combined core+server suite passes; both halves now
  have scoped evidence (core: `service-quiescence-core-admission.md`).
- The drain bound (`DEFAULT_DRAIN_TIMEOUT = 5 s`) and poll interval
  (`DEFAULT_QUIESCENCE_POLL = 5 ms`) are production defaults chosen here;
  adjust at integration if the packaged consumer needs different bounds.

## Root follow-up after settlement

Root propagates failure to restore an accepted stream's blocking mode and
refuses a connection if its tracking descriptor cannot be cloned. No untracked
handler is admitted on descriptor exhaustion. Worker test counts precede these
edits; root combined tests and the actual process-exit probe remain the next gate.
