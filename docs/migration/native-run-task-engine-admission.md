# Run/task Engine admission — pending domain integration

The unregistered `coordination_runs.rs` module stages the seven typed run/task handlers around the existing atomic receipt ledger. It is deliberately not in the production dispatcher until the transaction-only domain implementation lands. The new core dependency and startup error variant are preparatory, not evidence of working RPCs.

Mutations derive host/actor-namespaced receipt keys, acquire lifecycle admission, and recheck the coordinator before any receipt lookup. Reads use one SQLite snapshot and do not create receipts. Takeover replay permits only the exact successful prior request whose saved binding still equals the current binding after its own generation increment.

The existing real Engine RED suite is extended with takeover retry, stale-authority-before-conflict, receipt-insert rollback, actor/host isolation, and concurrent/reopen cases. These extensions await the domain hook; they must run before this slice is accepted. Worker attempts and mail remain separate integration requirements.
