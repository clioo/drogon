# Desktop Bot creation boundary — prepared, not activated

At integration base `b73dfbf`, ROOT added a structural creation boundary by
extending the existing snapshot record schema and following the existing file
mutation transport pattern. No IPC handler, preload method, renderer control or
native capability was registered by this change.

- Scope remains explicit `hostId`/`workspaceId`, including folder workspaces.
- Caller `requestId` is passed separately to `callNative`, never in native params.
- Native remains authoritative for preset/harness catalogs and text policy.
- Requests are strict; responses must be born-empty and match an explicit Bot ID.
- Native errors and transport rejection are preserved without retries or fallback.
- The current create DTO does not echo host/workspace; this boundary cannot
  independently establish response host ownership. Native authorization must prove it.

Node 24 verification on 2026-09-07:

- Initial test collection failed because the new bridge module did not exist:
  setup failure, zero tests, **not behavioral RED**.
- New bridge suite: 24 passing tests with injected transport results.
- Full desktop Vitest: 39 files, 475 passing tests; TypeScript check exits zero.
- One intermediate test-only tuple typing error was corrected before the final check.

These are boundary unit tests, not source-parity, Engine, rendered or installed
acceptance. Native create/run integration and their real authorization, transaction,
replay and execution tests remain prerequisites for any activation.

## Public Engine RED — 15:01 UTC

ROOT added `crates/drogon-core/tests/native_bot_create_engine.rs`, separate
from the V4-owned domain tests. All seven tests compile against the public
Engine and real SQLite. They currently fail because `bot.create` returns
`method_not_found`; this is executable behavioral RED, not a missing import.
The downstream assertions remain unexercised until registration: born-empty
scoped persistence, exact replay after restart, changed-parameter conflict,
authentication and workspace authorization before replay, atomic receipt
failure rollback, and concurrent same-request admission. No process or model
is launched by this suite. It is not a claim that those behaviors pass.

## Public Engine integration — 15:18 UTC

ROOT adapted the stable V4 B6 domain implementation from `0c12abe` into
`bot_mutation_rpc.rs`, registered `bot.create`, and reused canonical
`RequestLedger::run_atomic` and `workspace::owned_path`. The lifecycle gate
fences shutdown; scope authorization runs before receipt lookup on every call.
Worker credentials remain denied by the existing authenticated dispatcher.
No `bots.v1` capability or desktop control is activated here.

The suite was extended to 11 executable RED cases before registration; all
11 now pass against the public Engine and real SQLite. The added checks cover
invalid explicit IDs, strict/born-empty input, missing/foreign workspaces,
shutdown admission and milliseconds matching the source `createBot` clock
(`src/main/persistence/loading-store/bot-persistence.ts:56`, pinned source).
An additional real registered-worker test proves both fresh creation and
replay of an administrator's creation are denied without a second record.

ROOT final checks: full `cargo test --workspace --locked --offline --quiet`
exits zero (one pre-existing ignored test is not acceptance); `cargo clippy
--workspace --all-targets --locked --offline -- -D warnings` and `cargo fmt
--all -- --check` exit zero. No model invocation. These are native integration
results, not rendered, packaged, Windows or whole-product parity evidence.
