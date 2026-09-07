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
