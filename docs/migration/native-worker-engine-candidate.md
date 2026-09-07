# Native worker engine candidate — not accepted

The engine now compiles a fresh-worker launch path using the existing harness
planner, staged request ledger, session reservation, private worker environment
and retained PTY handles. Attempt/session/credential admission commits before
spawn; failed attachment retains the handle and does not repeat spawn on replay.
Per-attempt weakly retained operation gates serialize launch and cancellation
without keeping SQLite or receipt-map locks over process I/O.

Stop/abandon/release are draft integrations with exact-session observations.
Worker show derives liveness from the retained handle or durable exited state;
missing handles cannot turn a stored live row into live process evidence.
Task completion can promote only pending children whose prerequisites all
completed, in the caller's transaction. The two new domain cases pass.

Only compile and pre-existing run/task/foreign-host tests have been checked for
the worker integration. Fresh launch, cancellation races, historical cancellation,
receipt fault injection, reopen and credential handling still need real PTY
regressions and independent review. Known review concern: idempotent cancellation
of an old already-fenced attempt must not regress a replacement task's status.

Worker read, mailbox/report wiring, question closure, persisted attempt history,
daemon-owned CLI configuration and existing-session reuse remain pending.
No native orchestration capability is advertised, no model was launched through
this candidate, and no installed application or user daemon was changed.
