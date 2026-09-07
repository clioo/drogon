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

## Read-path integration

Root reproduced and corrected missing task attempt history through the real
Engine after reopen. History preserves sequence ordinals, replacement links and
the current assignment; process observations are taken outside the SQLite
transaction, with missing handles reported as unverifiable. An indexed 501-row
probe refuses histories beyond 500 instead of silently omitting old attempts.
The 16 run/task engine tests and 13 attempt unit tests pass.

Root also reproduced unsupported workerRead with actual PTY output and
fixture-seeded attempt metadata, then implemented bounded 64 KiB terminal
chunks over the existing session reader. The opaque cursor binds host, run,
dispatch, session and incarnation. Raw bytes and truncation survive in content;
cross-attempt cursors and unavailable retained output are refused. An explicit
transcript request is unsupported (or source_changed with a terminal cursor),
not silently reinterpreted as a transcript. Auto uses terminal output with a
transcript_unavailable entry reason. Live empty streams retain a polling cursor;
an empty confirmed-exited stream ends pagination. One chunk per call remains
within any valid entry limit. This does not implement provider transcripts.

The CLI validates terminal byte spans through its existing read validator and
decodes bytes only for human output; JSON retains the original content. Root
recorded a subprocess RED before this rendering fix. The full CLI suite now
passes 167 cases. The PTY read test passes with exact-session cleanup and tests
post-reopen refusal; it is not evidence of real workerStart or model execution.

Mailbox/report wiring, question closure, daemon-owned CLI configuration and
existing-session reuse remain pending.
No native orchestration capability is advertised, no model was launched through
this candidate, and no installed application or user daemon was changed.
