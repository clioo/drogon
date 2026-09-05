# CLI Inventory: Parsing, Transport, Registry, Orchestration, Skills

Read-only investigation. Source: `/Users/carlos/Documents/Drogon-mentu-session` (authorized
read-only reference, not edited). All `src/...` paths below are relative to that checkout. Every
`path:line` anchor was verified against the live tree on 2026-09-05. No product code was written;
this document only.

The prior CLI is a Node/TypeScript program (`src/cli/index.ts`, `#!/usr/bin/env node`) that speaks
newline-delimited JSON RPC to the running desktop runtime over a Unix socket / named pipe, and
(optionally) WebSocket+encryption to a paired remote runtime. It ships as part of the Electron app
and is also launchable standalone; the desktop intercepts direct invocations
(`src/main/startup/cli-command-names`, consumed by `src/cli/cli-command-name-parity.test.ts:12-20`).

## 1. CLI parsing (verified behavior to replicate exactly)

- Entry: `main(argv, cwd)` at `src/cli/index.ts:63-182`.
  - `--version`/`-v` short-circuits before parsing (`index.ts:68-77`), reading the version from the
    adjacent `package.json` (`src/cli/cli-version.ts:5-14`).
  - Two intercepted subcommands bypass the spec parser: `agent-teams-tmux` (`index.ts:78-80`,
    shim at `:202-225`) and `claude-teams` (`index.ts:82-85`, passthrough at `:184-200`).
  - cwd may be overridden by `ORCA_CLI_CWD` so an SSH-relayed invocation resolves cwd-based
    selectors against the caller's remote directory (`index.ts:58-61`).
- Token grammar: `parseArgs` (`src/cli/args.ts:36-79`).
  - Tokens not starting `--` are command path words (`args.ts:43-46`).
  - `--flag=value` is the only way to pass a value that itself starts with `--` (`args.ts:52-56`).
  - Boolean flags (closed set in `src/shared/cli-argument-boundary.ts:4-43`) never consume the next
    token (`args.ts:59-62`).
  - A pre-command flag never swallows a token that would start a registered command path
    (`args.ts:64-67`, index computed by `findCliCommandIndex` at
    `src/shared/cli-argument-boundary.ts:68`); otherwise the next token is consumed as the value
    (`args.ts:68-75`).
  - Repeatable string flags are only `label` and `skill`, joined with a NUL separator
    (`args.ts:24-25`, `:27-34`).
- Global flags: `--help`, `--json`, plus value flags `--pairing-code`, `--environment`
  (`src/shared/cli-argument-boundary.ts:1-2`).
- Aliases/positionals are canonicalized before validation and dispatch: `normalizeCommandPositionals`
  (`args.ts:187-221`) maps e.g. `worktree remove`→`worktree rm` (`src/cli/specs/core.ts:166-171`)
  and folds positional words into named flags, recording positional/flag conflicts instead of
  throwing (`args.ts:205-217`).
- Validation: `validateCommandAndFlags` (`args.ts:230-263`) rejects unknown commands with
  did-you-mean data (`unknownCommandData`) and unknown flags with the full allowed-flag enumeration
  (`effectiveAllowedFlags`, `args.ts:135-146`) — validation and `--help` deliberately expose the
  same effective flag set.
- The spec record shape is `CommandSpec` (`src/cli/command-spec.ts:1-15`): `path`, optional
  `aliases`, `argumentMode: 'passthrough'`, `destructive`, `hidden`, `summary`, `usage`,
  `allowedFlags`, `positionalArgs`, `examples`, `notes`. `specPaths` expands aliases
  (`command-spec.ts:17-19`). This type is effectively the CLI's machine-readable contract and is the
  single most valuable thing to port verbatim as data.
- Help: `printHelp` renders root text, per-group listings, or per-command usage/flags/notes/examples
  (`src/cli/help.ts:9-...`); unknown `help <path>` sets exit code 1 (`index.ts:90-97`).

## 2. Transport (verified)

- Discovery: the CLI reads a runtime metadata file from the platform userData dir
  (`readMetadata`, `src/cli/runtime/metadata.ts:11-31`); path per platform at
  `metadata.ts:42-70` (macOS `~/Library/Application Support/orca`, Windows `%APPDATA%/orca`,
  Linux `$XDG_CONFIG_HOME|~/.config/orca`, overridable with `ORCA_USER_DATA_PATH`).
- Local RPC: one-shot TCP/unix-socket connection per request carrying
  `{id, authToken, method, params, orchestration* envelope}` and reading newline-delimited JSON
  frames (`sendRequest`, `src/cli/runtime/transport.ts:9-197`; request write at `:182-196`).
  - `{"_keepalive":true}` frames refresh the client timer without settling the promise
    (`transport.ts:125-129`), which is what makes long-polls (check --wait, terminal wait,
    worker-start) survive past the default timeout.
  - Errors: `runtime_unavailable` (no transport/connect fail/peer close, `:25-31`, `:69-90`),
    `runtime_timeout` (`:38-50`), `invalid_runtime_response` (bad JSON/schema/mismatched id,
    `:107-167`), runtimeId change mid-flight (`:168-177`).
- Remote RPC: when a pairing offer resolves, requests go through the WebSocket transport
  (`src/cli/runtime/websocket-transport.ts:5-20`, wrapping
  `src/shared/remote-runtime-client.ts`); selected via `--pairing-code` (parsed pairing URL) or
  `--environment <name|id>` (saved environment store), never both
  (`resolveRemotePairing`, `src/cli/runtime/client.ts:296-321`).
- Client: `RuntimeClient` (`client.ts:50-286`) — default 60s request timeout (`:66-68`), lazy
  client construction in `main` (`index.ts:160-174`), per-method timeout policy where long-poll
  inner budgets widen the socket timeout by a 10s grace (`client.ts:41`, `:169-192`), and an
  orchestration contract preflight that rejects mutations against runtimes lacking the
  `orchestration.contract.v1` capability (`client.ts:233-252`;
  `src/shared/protocol-version.ts:57-58`).
- Error type: `RuntimeClientError {code, message, data?}` (`src/cli/runtime/types.ts:10-21`) with
  secrets redacted from `data` (`types.ts:19`); server failures are re-thrown as
  `RuntimeRpcFailureError` preserving the full failure envelope (`types.ts:23-37`).

## 3. Command registry and dispatch

- Specs are grouped static arrays composed into `COMMAND_SPECS` (`src/cli/specs/index.ts:21-40`):
  core/open-serve-status, artifacts, account, project, file, automations, browser basic/advanced,
  orchestration, computer, agent-hooks, diagnostics, introspection, environment, linear, vm,
  emulator, skills.
- Handlers are lazy-loaded groups with eager key lists (`src/cli/handler-group-manifest.ts:14-255`);
  `dispatch` (`src/cli/dispatch.ts:39-55`) joins the command path into a `"a b"` key, rejects
  duplicates at table build (`dispatch.ts:17-31`), and throws `invalid_argument` for unrouted keys.
- A CI guard proves specs↔handlers parity: `findRegistryParityGaps`
  (`src/cli/registry-parity.ts:10-21`) with the live-tree test (`registry-parity.test.ts:8-20`),
  manifest-vs-export drift (`handler-group-manifest.test.ts:46-58`), routability of every exported
  handler record (`:86-103`), and top-level names matching the Electron launch redirect
  (`cli-command-name-parity.test.ts:7-25`).

## 4. Command parity map

### 4.1 Workspace registration (repo / worktree / project)

| CLI command | RPC method | Spec | Handler |
|---|---|---|---|
| `repo list` | `repo.list` | `specs/core.ts:36-40` | `handlers/repo.ts:8-11` |
| `repo add --path` | `repo.add` | `specs/core.ts:41-46` | `handlers/repo.ts:12-18` (remote path rejected via `repo-path-arguments`) |
| `repo show/set-base-ref/search-refs` | `repo.show/setBaseRef/searchRefs` | `specs/core.ts:48-64` | `handlers/repo.ts:19-39` |
| `worktree list/show/current/create/set/rm/ps` | `worktree.*` | `specs/core.ts:66-187` | `handlers/worktree.ts` (`'worktree create'` at `:208`) |
| `project list/setups/setup-*` | `project.*` | `specs/project.ts:4-126` | `handlers/project.ts` |
| `host list` / `environment add/list/show/rm` | local store + `listSshTargets` | `specs/environment.ts:5-46` | `handlers/environment.ts:37-61` (host list), `:18-...` (add) |

Key behaviors: worktree selectors accept `active|current` (cwd-resolved to `id:<repoId>::<path>`),
`path:`, `id:`, `name:`, `branch:`, `issue:`, `identity:` forms
(`src/cli/selectors.ts:28-37`, `:104-140`); cwd shortcuts are rejected for remote runtimes
(`selectors.ts:92-102`); `worktree create` supports `--agent`/`--prompt` startup, parent lineage,
`--setup run|skip|inherit`, and marks provenance (`handlers/worktree.ts:208-280`,
spec notes `specs/core.ts:112-127`).

### 4.2 Terminal

| CLI command | RPC method | Spec | Handler |
|---|---|---|---|
| `terminal list` | `terminal.list` | `specs/core.ts:188-197` | `handlers/terminal.ts:96-108` |
| `terminal show` | `terminal.show` | `specs/core.ts:198-203` | `handlers/terminal.ts:109-114` |
| `terminal read` (`--cursor/--limit/--screen`) | `terminal.read` | `specs/core.ts:204-226` | `handlers/terminal.ts:115-149` (screen∧cursor rejected `:127-132`; old-host screen guard `:139-147`) |
| `terminal send` (`--text/--enter/--interrupt`) | `terminal.send` | `specs/core.ts:227-233` | `handlers/terminal.ts:150-166` (exit 1 when `send.accepted === false`, `:163-165`) |
| `terminal wait --for exit|tui-idle` | `terminal.wait` | `specs/core.ts:234-240` | `handlers/terminal.ts:167-186` (5-min RPC ceiling `:47-50`; exit 1 on unsatisfied `:181-185`) |
| `terminal create` (`--worktree/--title/--command/--focus`) | `terminal.create` | `specs/core.ts:251-267` | `handlers/terminal.ts:200-223` (remote requires `--worktree` `:201-206`) |
| `terminal switch` (alias `focus`) | `terminal.focus` | `specs/core.ts:268-277` | `handlers/terminal.ts:87-93,225` |
| `terminal close` (`[--terminal][--tab] | --worktree X --all`) | `terminal.close`/`closeTab`/`closeAll` | `specs/terminal-close.ts:4-21` | `handlers/terminal.ts:226-286` |
| `terminal rename`/`split`/`stop` (`stop` is hidden) | `terminal.rename`/`split`/`stop` | `specs/core.ts:241-250,279-300` | `handlers/terminal.ts:187-192,287-303` |

Omitted `--terminal` resolves to the active terminal of the current worktree via
`terminal.resolveActive` (`src/cli/selectors.ts:206-218`); identity remint goes through
`terminal.resolvePane` (`handlers/orchestration/terminal-identity.ts:77-80`).

**Resize parity gap (verified):** the reference CLI has **no** `terminal resize` command — no
resize spec or handler exists anywhere under `src/cli`. The runtime exposes
`terminal.resizeForClient` (`src/main/runtime/rpc/methods/terminal/terminal-lifecycle-methods.ts:118`)
plus viewport methods (`terminal.updateViewport`, `terminal.setDisplayMode`,
`terminal-viewport-methods.ts:14-118`), consumed by the renderer only. Drogon must decide whether
the first CLI exposes resize at all; if it does, it is new CLI surface, not a port.

**Close semantics worth porting verbatim:** a transport success is not a stop receipt —
`ptyStopVerdict` `live` / `unverifiable` are converted to `terminal_stop_live` /
`terminal_stop_unverifiable` failures with the full receipt preserved in `error.data`
(`handlers/terminal.ts:52-85`, `:271-284`), matching the repo-wide liveness vocabulary.

### 4.3 Harness selection

- The harness union `TuiAgent` (claude, codex, opencode, gemini, pi, … 36 entries) is at
  `src/shared/tui-agent.ts:3-40`; per-agent launch argv/env config in
  `src/shared/tui-agent-config.ts:69` (source table), `:291` (`TUI_AGENT_CONFIG`), `:306`
  (`getTuiAgentLaunchCommand`); telemetry mapping `src/shared/agent-kind.ts:16-52`.
- CLI surface: `worktree create --agent <id> --prompt <text>` (`handlers/worktree.ts:219`,
  `:268-272`; spec `specs/core.ts:122-123`) and
  `orchestration worker-start (--agent <agent> | --terminal <handle>) [--model <id>] [--effort
  <level>]` (`specs/orchestration-worker-specs.ts:8,23-26`; handler
  `handlers/orchestration/worker-launch-handler.ts:13-107`; model/effort require the
  `ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY` capability, `:15-28`; non-ready
  state exits 1, `:59-61`).
- `claude-teams` passthrough (`specs/core.ts:24-34`, `index.ts:184-200`) — the Orca side only
  enables native panes and forwards argv to Claude Code.
- Harness *detection* is used by `skills install` target selection
  (`handlers/skills.ts:162-171`, probing `src/shared/tui-agent-detection-commands`), not by
  worktree/worker start (the runtime owns launch).

### 4.4 Run / Task / Dispatch lifecycle

All under `orchestration` (`specs/orchestration.ts:5-278`,
`specs/orchestration-worker-specs.ts:3-120`; handlers aggregated
`handlers/orchestration.ts:19-34`). Mutations are idempotency-fenced: `--retry-request <id>`
replays the recorded outcome instead of re-executing
(`callOrchestrationMutation`, `handlers/orchestration/mutation-request.ts:5-21`); the mutation
method set is fixed at `src/shared/orchestration-rpc-contract.ts:18-41` (retired legacy:
`orchestration.run`/`runStop`, `:43-45`; retired CLI stubs at
`handlers/orchestration/dispatch-handlers.ts:69-83`).

| Command | RPC | Anchor |
|---|---|---|
| `run-create --objective` | `orchestration.runCreate` | spec `:6-16`; handler `run-handlers.ts:13-22` |
| `run-use --id [--takeover-legacy]` | `orchestration.runUse` | spec `:17-26`; handler `:24-34` |
| `run-current` / `run-list` / `run-show` | `runCurrent`/`runList`/`runShow` | spec `:27-44`; handlers `:36-84` |
| `send` (message + lifecycle types; `--type worker_done` requires `--outcome`; group recipients rejected for worker_done/heartbeat; capability envelope) | `orchestration.send` | spec `:45-81`; handler `message-send-handler.ts:62-136` (guards `:55-59`, `:68-74`, `:76-82`; settlement `:109`) |
| `check` (`--ack/--unread/--peek/--all/--types/--wait/--timeout-ms`) | `orchestration.check` | spec `:82-115`; handler `message-check-handler.ts:30-...` (mode mutual-exclusion `:34-41`; 15s stderr keepalives `check-keepalive.ts:1`) |
| `reply --id --body`, `inbox` | `orchestration.reply`/`inbox` | spec `:116-128`; `message-methods` |
| `task-create` / `task-list [--brief]` / `task-update --status` | `taskCreate`/`taskList`/`taskUpdate` | spec `:129-161`; handler `task-handlers.ts:19-113` (status enum `:9-16`, validation `:93-99`) |
| `worker-start` (see 4.3) | `orchestration.workerStart` | spec `orchestration-worker-specs.ts:4-41` |
| `worker-show` / `worker-read` | `workerShow`/`workerRead` | `:42-63`; `worker-observation-handlers.ts:16-51` |
| `worker-stop`/`abandon`/`release`/`retain`/`list` | `workerStop`/`workerAbandon`/`workerRelease`/`workerRetain`/`workerList` | `:64-119`; `worker-terminal-handlers.ts:18-106` |
| `dispatch --task --to [--inject/--dry-run/--return-preamble]` | `orchestration.dispatch` | spec `:163-179`; `dispatch-handlers.ts:11-39` |
| `dispatch-show [--preamble]` | `orchestration.dispatchShow` | spec `:191-197`; `dispatch-handlers.ts:43-67` |
| `request-show --request` (read-only receipt probe) | `orchestration.requestShow` | spec `:180-190`; `mutation-request-show-handler.ts` |
| `ask` / `reply` | `orchestration.ask` | spec `:198-219`; `question-handler.ts` |
| `gate-create/gate-resolve/gate-list` | `gateCreate`/`gateResolve`/`gateList` | spec `:249-270`; `gate-handlers.ts` |
| `reset (--all|--tasks|--messages)` | `orchestration.reset` | spec `:271-277`; `reset-handler.ts` |

Sender identity: `--from` flag → live `ORCA_TERMINAL_HANDLE` → `ORCA_PANE_KEY` remint via
`terminal.resolvePane` → fail closed with `no_active_sender_terminal`
(`handlers/orchestration/terminal-identity.ts:6-36`, `:67-90`, `:145-151`). Lifecycle sends carry
`senderPaneKey` and `waitForLifecycleSettlement`
(`message-send-handler.ts:96-98`); worker_done is settled only when the runtime confirms
(`requireWorkerDoneSettlement`, `:109`).

### 4.5 Skills

Specs `specs/skills.ts:4-119`; handlers `handlers/skills.ts:314-343`.

- `skills list` / `skills get <topic> [--full]` read a bundled generated guide table
  (`bundled-skill-guides.ts`, lazy-imported to keep startup cheap, `handlers/skills.ts:317-319`);
  `get` aliases `show` (`specs/skills.ts:48`).
- `skills installed` / `skills share` are a separate handler group
  (`handler-group-manifest.ts:246-249`, `handlers/skill-sharing.ts`) and require the runtime.
- `skills install`/`update` shell out to the community `skills` CLI via `npx --yes`
  (`runNpxSkills`, `handlers/skills.ts:106-157`), default global, `--local` flips scope
  (`:281-284`), target agents auto-detected or `--agent <name,...>` required when none detected
  (`:173-220`), `--dry-run` prints the exact argv (`:286-295`), `--json` only with `--dry-run`
  (`:297-305`), and SSH-forwarded shells are refused (`:272-279`).

### 4.6 Runtime lifecycle commands

`open` (launch app + wait for window, `client.openOrca` at `client.ts:254-286`; handler
`handlers/core.ts:92`), `status` (`getCliStatus` local/remote projection, `client.ts:194-231`;
handler `:124`), `serve` (foreground headless runtime, spec `specs/serve.ts:4-34`, handler
`handlers/core.ts:112`).

## 5. Stable JSON errors and exit codes (contract to freeze)

- `--json` success prints the raw RPC success envelope (`printResult`,
  `src/cli/format.ts:74-84`). Text mode prints per-command formatters.
- `--json` failure prints a `RuntimeRpcFailure` envelope with `{id:"local", ok:false,
  error:{code, message, data}, _meta:{runtimeId:null}}` for local errors, or the server envelope
  unchanged for RPC failures (`reportCliError`, `format.ts:132-158`; envelope type
  `src/shared/runtime-rpc-envelope.ts:52-76`).
- Exit codes observed: 0 success; 1 for (a) any caught error (`index.ts:178-181`), (b) help miss
  (`index.ts:90-97`), (c) `terminal send` rejected (`handlers/terminal.ts:163-165`), (d)
  `terminal wait` unsatisfied (`:181-185`), (e) close with `live`/`unverifiable` PTY verdict
  (`:274-284`), (f) `worker-start` not `ready` (`worker-launch-handler.ts:59-61`).
- Error codes seen in CLI code: `invalid_argument`, `runtime_unavailable`, `runtime_timeout`,
  `invalid_runtime_response`, `incompatible_runtime`, `runtime_open_timeout`,
  `desktop_activation_blocked`, `method_not_found` (translated to `incompatible_runtime`),
  `selector_not_found`, `no_active_sender_terminal`, `terminal_stop_live`,
  `terminal_stop_unverifiable`, `terminal_handle_stale`, `terminal_gone`, `no_active_terminal`,
  `terminal_not_found`, `orchestration_migration_required`, plus pass-through server codes
  (`format.ts:86-122`, `handlers/terminal.ts:52-85`, `terminal-identity.ts:58-65`,
  `client.ts:282-294`). Human errors append `Next step:` lines derived from `error.data.nextSteps`
  (`format.ts:101-111`, `:179-184`) — the same data ships inside the JSON envelope, so text and
  JSON recovery guidance never diverge.

## 6. Host targeting (verified)

Three host axes, never freely mixable:

1. `--host local` — explicit local machine.
2. `--host ssh:<target-id>` — an SSH target the *connected* runtime owns; resolved/validated
   against that runtime (`resolveHostFlagTarget`, `src/cli/execution-host-flag.ts:130-148`).
3. `--host runtime:<environment-id>` — a paired Orca server; resolved from the local pairing store
   *before* any client exists and the connection retargeted, name lookup rejected (id-only, with
   ambiguity errors), and conflicting `--pairing-code`/`--environment` rejected
   (`resolveHostFlagEnvironmentId`, `execution-host-flag.ts:52-110`; canonicalized into
   `--host runtime:<id>` at `index.ts:143-148`).
- `--environment <name|id>` and `--pairing-code` select the remote connection directly
  (`client.ts:296-321`); ambient `ORCA_ENVIRONMENT` is background config that loses to explicit
  flags but is checked for disagreement (`index.ts:114-142`).
- Local-only commands (`account`, `artifacts`, `environment`, `host`, `serve`, `agent`, `vm`,
  `agent-context`) ignore remote selection entirely so a stale env var cannot route them
  (`shouldIgnoreRemoteSelection`, `index.ts:29-43`; suppressed at `:149-159`); `host list` and
  `environment list` additionally reject store-retargeting flags (`handlers/environment.ts:38-41`).
- `host list` prints all three kinds with copy-pastable selectors (`format.ts:218-236`).
- Commands that accept server-side filtering accept both `runtime:<id>` and `local` spellings for
  rows stamped by the routed machine (`hostFilterMatchesHostId`,
  `execution-host-flag.ts:112-124`).

## 7. Regression tests (reuse as specifications/fixtures)

- Harness pattern, not snapshots: tests mock `./runtime-client` and `./runtime/environments`,
  queue RPC fixtures, call `main([...])`, and assert on the `callMock` params and stdout
  (`src/cli/index-test-harness.ts:19-109`; example
  `index-terminal-commands.test.ts:1-60`; env save/restore `:112-202`). The mock deliberately
  re-exports the real error classes so `instanceof` narrowing matches production
  (`index-test-harness.ts:20-24`).
- Registry guards (port these as tests first): `registry-parity.test.ts:8-20`,
  `handler-group-manifest.test.ts:38-142`, `cli-command-name-parity.test.ts:7-25`.
- Parser/format unit suites: `args.test.ts`, `flags.test.ts`, `format.test.ts`,
  `command-suggestion.test.ts`, `quote-stripped-json-flag.test.ts`, `linear-format.test.ts`,
  `terminal-format-draft.test.ts`, `terminal-read-screen.test.ts`,
  `worktree-selector-wsl-posix-path.test.ts`, `base64-payload-byte-count.test.ts`,
  `shell-command-quote.test.ts`, `vocabulary-policy.test.ts` (all under `src/cli/`).
- Behavioral suites asserting exact RPC params / exit codes / JSON shapes:
  `index.test.ts`, `index-terminal-commands.test.ts`, `index-terminal-list-host-scope.test.ts`,
  `index-omitted-host-scope-selectors.test.ts`, `index-worktree-create-{target,agent,parent,
  linear}.test.ts`, `index-worktree-selector-resolution.test.ts`, `index-orchestration.test.ts`,
  `index-automation-*.test.ts`, `index-environment-commands.test.ts`,
  `index-serve-command.test.ts`, `index-project-setup.test.ts`, `index-device-commands.test.ts`,
  `index-local-command-routing-flags.test.ts`, `index-vm-recipe-doctor.test.ts`,
  `index-memory-diagnostics.test.ts`, `cli-version.test.ts`, `runtime-client.test.ts`,
  `runtime-client-deferral.test.ts`, `serve-electron-flag-parity.test.ts`,
  `main-module-bundle-parity.test.ts`.
- Handler-level suites (orchestration semantics): `handlers/orchestration*.test.ts`
  (lifecycle JSON rejection, timeout CLI, gate CLI, check identity, federated settlement,
  worker CLI, task-create CLI, windows-ask CLI), `handlers/terminal.test.ts`,
  `handlers/orchestration-module-boundaries.test.ts`, spec contract tests like
  `specs/orchestration.test.ts:4-16` (notes text is contract: valid `--type` list),
  `specs/skills.test.ts`, `specs/bundled-guide-flags.test.ts`.
- Runtime-side (server half) orchestration RPC suites live under
  `src/main/runtime/rpc/methods/orchestration-*.test.ts` (~40 files) — the CLI-side tests above are
  the portable half; the server-half tests characterize behavior Drogon's Rust service must match
  but are not directly runnable fixtures.
- Transport/runtime suites: `runtime/transport.test.ts`, `runtime/websocket-transport.test.ts`,
  `runtime/envelope-schema.test.ts`, `runtime/client-error-recovery.test.ts`,
  `runtime/client-timeout-policy.test.ts`, `runtime/launch.test.ts`, `runtime/status.test.ts`,
  `runtime/environments.test.ts`, `runtime/orchestration-recovery-command.test.ts`,
  `runtime/serve-signal-exit-diagnostic.test.ts`, `runtime/types.test.ts`.

## 8. Reuse vs rewrite

Reuse as data/specification (port verbatim, tests enforce parity):
- `CommandSpec` tables for the target command set — they are already the human+machine contract
  (`src/cli/command-spec.ts:1-15` + specs files), including notes that encode semantics (screen
  vs stream reads, close liveness verdicts, worker_done settlement).
- Global/boolean flag tables and the `findCliCommandIndex` precedence rules
  (`src/shared/cli-argument-boundary.ts:1-91`) — reimplement in Rust with the same closed sets and
  the same test vectors from `args.test.ts`/`flags.test.ts`.
- Error envelope + code vocabulary + `nextSteps` recovery data convention (§5) — freeze as
  drogon-cli's JSON contract from day one.
- Host targeting rules (§6) including the "local-only commands ignore remote selection" list.
- Test fixtures `test-fixtures.ts` (`okFixture`/`buildWorktree`/`queueFixtures`,
  `src/cli/test-fixtures.ts:24-60`) and the mock-`main()` harness pattern — directly translatable
  to Rust integration tests (enqueue responses, run the parser/dispatcher, assert emitted params).

Rewrite in Rust:
- Socket/packet transport (tokio UnixStream/NamedPipe; keep newline-delimited JSON, keepalive
  refresh, runtimeId guard), WebSocket+pairing transport when remote pairing is added.
- Dispatch/registry engine (static spec table + generated handler map; keep duplicate-key and
  parity guards as `#[cfg(test)]` tests).
- Handlers themselves are thin RPC param-mappers (`handlers/repo.ts` is 40 lines; terminal/orchestration
  similar) — low-risk ports once the client and error types exist.
- `skills install/update` child-process orchestration and agent detection (platform PATH probing)
  — port last; it is self-contained.

Defer / do not port: browser/computer/emulator/linear/automations/vm groups (out of first-slice
scope), `agent-teams-tmux` shim, WSL UNC path rewriting (`selectors.ts:46-78`) until WSL is a
supported target, Electron launch-redirect concerns (`cli-command-names`), `serve` (Drogon's
runtime is the Rust service; a `serve`-equivalent is a service concern, not CLI parsing).

## 9. Recommended minimum drogon-cli surface (first vertical slice)

Slice 1 — "agent can drive one workspace" (matches the actual worker loop used by Orca agents):
1. Parsing/registry/error envelope: specs + `--json`/`--help`, stable failure JSON, exit codes (§5).
2. `open`/`status` — proves transport + metadata discovery.
3. Workspace registration: `repo list/add/show`, `worktree list/show/current/create` (selector
   grammar from §4.1; defer `set/rm/ps`).
4. Terminal: `create`, `list`, `read` (incl. `--screen` guard), `send` (incl. exit-1 on rejected),
   `close` (with liveness verdict semantics), `wait`. **Decide explicitly on resize**: reference CLI
   omits it; recommend deferring resize out of the CLI contract until the runtime method contract
   is frozen, then add `terminal resize` as new surface.
5. Host targeting: `--host local` acceptance + rejection rules + `host list`; defer
   `--pairing-code`/WebSocket remote and `ssh:` routing to the remote slice (keep the flag
   grammar reserved so flags don't change meaning later).

Slice 2 — dogfooding the orchestration loop (what this worker session itself consumed):
`orchestration run-create/run-current/send/check/reply/task-create/task-list/task-update/dispatch/
dispatch-show/ask` + worker `worker-start/worker-show/worker-read/worker-stop`, with
`--retry-request` idempotency and sender-identity fallbacks (`ORCA_TERMINAL_HANDLE`/pane key)
because dogfooding agents are exactly the callers that need them.

Slice 3 — skills (`skills list/get` bundled guides; `installed/share`), then `skills install/
update`, `project setup-*`, `worktree set/rm/ps`, gates, `request-show`, `reset`, and the retired
`coordinator-start/stop` stubs only if legacy parity is required.

Each slice should carry its parity tests from §7 (registry guards + mocked-`main` param assertions)
ported as Rust integration tests before the handler ships.

## 10. Open questions for the coordinator

1. `terminal resize`: new CLI surface in Drogon (runtime already has `terminal.resizeForClient`),
   or explicitly out of contract for v1?
2. Remote pairing (`--pairing-code`, `--environment`, WebSocket transport) and `ssh:` host routing:
   which slice owns them, and does Drogon keep the same pairing-store file format?
3. Does drogon-cli keep the `orca` binary name/verb spellings verbatim (recommended for test/fixture
   reuse) or rename to `drogon`?
4. `serve`/`open`: in the Rust rewrite the desktop launcher and the headless service split —
   confirm whether `open` remains a CLI verb or becomes service supervision.
