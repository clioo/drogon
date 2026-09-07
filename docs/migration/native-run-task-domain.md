# Native run/task domain — root acceptance in progress

Pi produced the initial schema, runs, tasks and pagination implementation. Root
requested a stable handoff after repeated compiler defects and duplicate
definitions, then interrupted generation with Escape when editing continued.
Orca confirmed `Operation aborted`; the exact dispatch was explicitly abandoned
without process effects. Release retained the terminal as `identity_unproven`.
Files were preserved. No successful worker report or process-exit claim is made.

The initial independent `cargo test --offline -p drogon-orchestration` failed
compilation: two missing `ok()` calls, an invalid boxed-error method and a
nonexistent timestamp field on `TaskSummary`. Root corrected only those compile
errors first. The resulting command ran zero tests; this was not acceptance.

Root then added eight real SQLite regression tests in `tests/domain_contract.rs`.
The compiled run returned exit 101: two passed and six failed. Failures reproduced
explicit takeover by a different coordinator, run pagination, task pagination,
future-version refusal with multiple schema rows, invalid negative generation
decoding and leaked trigger error content. Migration rollback and dependency
deduplication/cross-run refusal passed. Run/task RPC integration is still pending.
