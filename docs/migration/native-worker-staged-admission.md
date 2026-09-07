# Native worker staged admission

The real Engine worker boundary test fails before implementation:
`workerStart` returns `method_not_found` instead of refusing the foreign
execution host. This is one absent-method failure; the later five methods
and no-effect assertions were not reached. Run/task integration hooks were
temporarily withheld while their separately owned domain was unfinished;
no substitute domain or fake RPC success was used.

`RequestLedger::run_staged` adds the external-effect path needed by native
worker launch and exact-resource stop. It reuses the existing request table,
fingerprint, in-flight slots, and receipt decoder. The original `run` and
database-only `run_atomic` remain unchanged.

- Authorization precedes in-memory and durable receipt inspection.
- Database-only preparation and the pending receipt commit together.
- The external effect runs outside both database and ledger mutexes.
- Finalization and the completed receipt commit together; a missing pending
  row cannot be reported as a successful receipt update.
- Concurrent same-process callers join one effect. Pending receipts after
  restart and uncertain final persistence never authorize another effect.
- An effect panic becomes an uncertain outcome, not another execution.

Ten real-SQLite regression cases cover these boundaries, including failed
admission/final commits, receipt triggers, a second observer connection,
deterministic in-flight joining, and reopening an uncertain receipt. The first
fixture run failed during setup because SQLite NOFOLLOW rejected macOS's
`/var` alias; canonicalizing the test directory fixed setup. Those failures
are not behavioral RED evidence.

This seam is not yet wired into worker RPCs. The engine still must retain
exact session handles, arbitrate cancellation versus launch, recheck worker
credentials in mutations, and prevent stale coordinators from replaying
receipts. No process lifecycle, cross-platform completion, or full native
coordination capability is claimed by these database tests.
