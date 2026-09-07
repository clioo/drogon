# Authenticated quiescent service shutdown

Root-owned additive contract, 2026-09-06. This closes the packaged fixture's
PID-signal ownership gap and provides safe explicit local maintenance. It is
not automatic shutdown on UI close, forced cleanup, or SSH implementation.

## Wire and authority

- Add capability `runtime.quiescent-shutdown.v1` only when implemented.
- `runtime.shutdown` requires `{hostId, serviceInstanceId}` matching the
  currently authenticated service. Foreign host is `unsupported_host`;
  old service instance is `stale_incarnation`. Validate these fences before
  looking up historical receipts: an old instance's receipt cannot stop a
  replacement. No caller-supplied PID, signal or force flag.
- Return `{hostId, serviceInstanceId, accepted:true}` only after durable
  admission. Accepted is not an exited verdict. Losing the reply is
  unverifiable; never retry with another identity or signal a discovered PID.
- Add optional `processId` to status for kernel-observer correlation on the
  execution host. It is not signaling authority. Existing status fields and
  methods retain their semantics; no protocol-version bump or stream opcode.
- Old peers receive method_not_found and are not killed as fallback. The
  new CLI/acceptance must check the capability before requesting shutdown.

## Quiescence and linearization

Use the current Engine, SQLite admission ledger, host identity, sessions and
native listener. No parallel registry or JSON database. Validate all inputs
before effects. Shutdown may proceed only if every persisted session is
positively exited and no spawn/mutation is in flight. Pending, live and
unverifiable rows refuse with a retryable `runtime_busy` error. Never stop
those sessions on the caller's behalf.

Serialize admission with new session/harness starts and other mutations,
without serializing normal unrelated I/O or holding a global mutex across
PTY reads/writes/waits. A narrow try-acquired lifecycle write gate can refuse
busy instead of waiting behind blocked I/O; existing operations use its read
side. Freeze new mutations once shutdown admission is durable. A failed
receipt write must not authorize exit. Use current request fingerprints and
conflicting-ID behavior; concurrent repeats must not create another effect.

The serving process itself exits through its own control path. Arrange for
the listener loop to wake/stop and release its lock after the response is
written or delivery becomes uncertain; do not call kill on a parsed PID.
Do not call process::exit from Engine, bypass cleanup destructors or break
the existing transient/fatal accept-error contract. Bound idle connections
during service termination. Client disconnect without a shutdown request
must still preserve all sessions and the service.

## Tests before implementation

Extend the actual Engine/service suites; missing-symbol compilation is not
behavioral RED. First assert the method against today's method_not_found,
then implement. Cover empty service, live child refusal (child remains live),
recovered unverifiable refusal, pending row refusal, wrong host/instance,
invalid params, duplicate/conflicting request IDs, new-instance replay,
concurrent start versus shutdown, persistence refusal and blocked mutation.
Service tests must exercise real authenticated sockets and observe an owned
service thread/process exit, not merely a shutdown response or socket loss.
Keep all existing379 tests, accept-loop error tests and actual crash fixtures.
No user data, user processes, global environment mutation or raw PID signals.

Before replacing packaged cleanup, root will register a kernel process watch
against status.processId, re-confirm the exact host/service identity, request
shutdown and observe kernel exit. If observation fails, retain failed evidence
and report unverifiable. This remains a separate acceptance step, not inferred
from unit tests. Windows runtime stays unimplemented until its own transport
and lifecycle tests pass. Root owns CLI/packaged consumer integration and PR.
