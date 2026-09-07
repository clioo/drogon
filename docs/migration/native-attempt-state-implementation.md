# Native attempt state — integration in progress

The internal `coordination_attempts` module now implements transaction-only
attempt admission, explicit replacement, cancellation, launch finalization and
report settlement. It does not open a database or operate a process. Core's
existing request ledger remains the only receipt store. The attempt table stores
typed lifecycle state, not operation receipts or credentials.

A partial unique index allows one current attempt per host/run/task. Replacement
keeps the prior row and fences it in the same transaction. A final report and
cancellation cannot both win. A late launch finalizer preserves an earlier final
report or cancellation. Repeated same-outcome reports return the original message
identity; contradictory or replaced-attempt reports fail. The first actual report
may correct `agent_prompt_stalled`, but not an unrelated launch failure.

Twelve focused SQLite tests pass. They cover rollback, active-attempt refusal,
explicit replacement and retained history, replacement rollback, report/cancel
ordering, host/run isolation, schema refusal, duplicate/conflicting reports,
prompt-observation correction and inconsistent stored identity. These are state
tests, not proof of concurrent daemon behavior or native worker launch.

`session::stop_with_action` separately preserves whether an exact retained handle
accepted a signal, even if exit persistence fails. An already-observed exit takes
no signal action. A failed signal is `unverifiable`, not `signalled`; exit evidence
is still independently required. Two real-PTY unit tests and the existing engine
18/persistence 2 tests pass (one existing child-probe entry remains ignored).
The generic session RPC retains its existing response shape.

Harness discovery/launch planning is now one reusable function used by the current
`harness.start` implementation and available for worker integration.

Still pending: wiring the attempt migration into atomic startup, current
coordinator authentication at each caller, task transitions, atomic mailbox/report
commit, attempt-scoped launch/cancel synchronization, daemon methods and real
daemon/CLI acceptance. No orchestration capability is advertised. The installed
preview is unchanged. Dead-code warnings remain for unconnected integration seams.
