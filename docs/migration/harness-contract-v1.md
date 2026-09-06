# Harness launch extension

Coordinator-owned additive extension to protocol v1. Runtime methods reuse the existing native IPC, authentication, mutation receipts and exact session identity. No proxy to Orca and no second execution engine.

`harness.list {}` returns `{hostId, harnesses:[{harnessId, displayName, availability, executable}]}`. Availability is `available`, `missing` or `unsupported_launcher`; it proves only executable discovery on the service's host, not authentication, model availability, quota or readiness. No network, executable probes or credential reads happen during discovery. Only absolute PATH entries participate.

`harness.start {workspaceId, harnessId, model?, provider?, effort?, prompt?, permissionMode?, cols?, rows?}` returns the existing `Session` and uses the caller's single durable request ID. It never silently switches harnesses, providers or models. Clients negotiate `harness.catalog.v1` / `harness.launch.v1`; older services return `method_not_found`. Existing methods and result shapes remain unchanged.

Supported adapters initially: `claude`, `pi`, `opencode`, `antigravity` (`agy` accepted as an input alias). The core resolves the executable; clients cannot override it in this method. `permissionMode` defaults to `inherit`; explicit `unattended` emits Claude/AGY `--dangerously-skip-permissions`, OpenCode `--auto`, or Pi `--approve`. Pi's flag trusts project files for that invocation; it is **not** a claim that Pi implements the same per-tool approval model. No global settings are modified.

Models stay opaque provider IDs. Pi alone exposes separate `provider`; efforts are validated against each adapter's documented CLI surface. OpenCode effort is currently refused, not guessed. Prompts remain one argv value, never shell interpolation. Pi messages are prefixed with `Drogon task:` because its current parser interprets leading `@` as a file argument and does not provide a normal `--` terminator. OpenCode uses an equals-bound prompt option so leading flag-like text remains a value. Runtime-owned Orca environment identifiers are removed from child processes to prevent accidental use of another runtime's control identity.

The new Rust library `crates/drogon-harness` is coordinator-owned. Local discovery and ten library tests passed on macOS. `node scripts/accept-core-cli.mjs --harness pi` additionally passed actual installed-Pi TUI launch, request replay and exact stop through Drogon's own service with isolated Pi configuration and no prompt/inference request. Evidence: `.preflight/acceptance/core-cli-1788640220268-a8f85732-08cb-4fa0-b1ac-16d4b87f12ae.json`. UI selection, resumed provider sessions, model catalogs, host-specific configuration, model readiness and token reporting require their own subsequent evidence. Windows batch launchers are refused until the Windows argv adapter exists. No Windows runtime acceptance is claimed.

## Provenance

Behavioral references read from the preserved checkout at `c97906287bb7a390b25e2025b600d9fb3c25d9c3`: `src/shared/tui-agent-config.ts` (Claude/Pi/OpenCode/Antigravity records) and `src/shared/tui-agent-startup-session-options.test.ts` (explicit preferences and argv boundaries). Installed `claude --help`, `pi --help`, `opencode --help`, `agy --help` were checked on 2026-09-05; Pi's actual `dist/cli/args.js` was read to verify its special positional parsing. Rust implementation is new; existing upstream notices are retained in `THIRD_PARTY_NOTICES.md` for reused frontend code.
# Typed and rendered acceptance checkpoint

The typed `drogon-cli harness list/start` surface and Electron launch menu now exercise this contract. Coordinator acceptance at 20:59 UTC proved typed/RPC same-request replay, installed Pi TUI startup, rendered form operation and exact identity recovery after reload/stop. See `foundation-status.md` for reports and limits. This does not prove model authentication or replace the separate Pi + DGX experiment.
