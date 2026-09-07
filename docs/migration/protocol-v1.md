# Drogon protocol v1 — first vertical slice contract

Coordinator-owned contract, frozen for the first implementation wave on 2026-09-05. Additions require coordination, not independent wire inventions. This describes the initial slice, not the final feature set.

## Transport and authority

Native local IPC: Unix domain socket on macOS/Linux, same-user named pipe on Windows. No public TCP listener. Data belongs to a dedicated Drogon data directory, never Orca's profile. `drogond --data-dir PATH` owns SQLite and PTYs; CLI and Electron are clients. Closing/reloading a client must not kill sessions. One service owns a data directory; prove endpoint ownership before publishing and never remove another owner's socket. Refuse ambiguous incumbents.

Initial concrete layout: `runtime-v1.sock`, `auth.token`, and `drogon.sqlite3` under the data directory. Windows pipe name: `\\.\pipe\drogon-v1-<first 24 lowercase hex SHA256 of canonical data-directory UTF-8 path>`. CLI defaults to `DROGON_DATA_DIR` if set; otherwise macOS `~/Library/Application Support/Drogon`, Linux `$XDG_DATA_HOME/drogon` (fallback `~/.local/share/drogon`), Windows `%APPDATA%/Drogon`. Electron resolves the same directory and passes it explicitly to the service. Tests always use an isolated explicit directory. Initial CLI service start is explicit (`drogond --data-dir PATH`); a failed `status` must not silently launch another daemon.

Frames are newline-delimited UTF-8 JSON, bounded to 1 MiB before allocation grows further. One request gets one response; the initial slice uses bounded cursor reads rather than a separate binary stream. Unknown optional fields are tolerated; unknown protocol or method returns a typed error, never silence. Control clients may keep a connection or reconnect per request. No automatic retry of ambiguous mutations unless they reuse the same request ID and byte-equivalent semantic payload.

The service authenticates every connection/request with a random token stored in the private data directory. Never echo the token or inherit it into harness environment. Unix directory/socket/token permissions must be restricted; Windows must enforce same-user access before advertising support. Data directory and endpoint validation must reject unsafe symlink/ownership cases. Endpoint names use semantic version, not build hash. Host targets that are not implemented are rejected; never substitute local execution.

## Envelope

```json
{"protocol":1,"requestId":"caller-generated-uuid","auth":"private-token","method":"status","params":{}}
```

```json
{"protocol":1,"requestId":"caller-generated-uuid","ok":true,"result":{}}
```

```json
{"protocol":1,"requestId":"caller-generated-uuid","ok":false,"error":{"code":"stale_incarnation","message":"Session identity changed; refresh before acting.","retryable":false}}
```

JSON fields are camelCase. IDs are opaque nonempty strings; do not embed paths in session IDs. Responses have exactly one of result/error according to ok. Core errors are stable string codes: `invalid_argument`, `unsupported_protocol`, `method_not_found`, `unauthorized`, `not_found`, `stale_incarnation`, `unverifiable`, `request_conflict`, `unsupported_host`, `unsupported_platform`, `io_error`, `internal_error`. No raw backtraces, auth values or arbitrary environment dump.

## Methods and result shapes

| Method | Params | Result |
| --- | --- | --- |
| `status` | `{}` | `{hostId, serviceInstanceId, protocol:1, capabilities:string[], version, processId?:number}` |
| `workspace.register` | `{path, name?}` | `Workspace` |
| `workspace.list` | `{}` | `{workspaces:Workspace[]}` |
| `session.start` | `{workspaceId, command, args:string[], cols:80, rows:24}` | `Session` |
| `session.list` | `{workspaceId?}` | `{sessions:Session[]}` |
| `session.read` | `{sessionId, incarnation, cursor:0, limitBytes?:65536}` | `{session:Session, dataBase64, startCursor, nextCursor, truncated}` |
| `session.write` | `{sessionId, incarnation, dataBase64}` | `{acceptedBytes}` |
| `session.resize` | `{sessionId, incarnation, cols, rows}` | `Session` |
| `session.stop` | `{sessionId, incarnation}` | `Session` |

`Workspace = {id, path, name, kind:"folder"|"git", hostId}`. Canonicalize and verify an existing directory. Ordinary folders are first-class; .git may be a directory or worktree pointer file. Do not run Git mutations for registration.

`Session = {id, workspaceId, hostId, incarnation, command, args, cols, rows, verdict:"live"|"unverifiable"|"exited", exitCode:number|null, createdAt:string}`. `createdAt` is UTC RFC3339. `incarnation` is an unpredictable per-spawn token; service instance identity is separately renewed per service start. Session ownership is established from retained process handles, not a PID read from persisted data.

Capabilities initially reflect only working methods: `workspace.v1`, `session.pty.v1`, `session.cursor-read.v1`, `session.incarnation.v1`, `request.idempotency.v1` only when actually implemented and tested. Do not advertise remote, lifecycle recovery or platform features that are not verified.

## Required behavior

- Validate required fields, sizes (cols/rows 1..1000), command/argv NULs, base64, and read limits. Command and args stay separate; no shell-string interpolation. A shell is only used when explicitly selected as the executable.
- A byte ring buffer keeps the latest 1 MiB per session initially. Cursors are monotonically increasing absolute byte offsets. Old cursor returns retained tail with `truncated:true` and its actual start cursor; future cursor is an error. Preserve raw bytes in base64; UI uses streaming UTF-8 decoding. `limitBytes` is 1..65536. Truncation never means process exit.
- Require incarnation equality before read/write/resize/stop. No stale event or reused PID can operate on another session. Every mutating request is keyed by requestId plus canonical method/params fingerprint; an identical replay returns its original result, conflicting reuse errors. Concurrent duplicate session.start must create only one process.
- Persist workspace/session identities, exit evidence and request admission/results before reporting durable success. Persist pending spawn admission before spawning. After service crash, pending/previously-live records are `unverifiable` until owning-host process evidence proves otherwise; never silently spawn again or signal an old PID. Do not claim that SQLite recreates an OS PTY master after service death.
- Closing Electron or CLI disconnects only. Exact stop requires the matching owned child identity and observed exit before returning `exited`. Failure to inspect/reach a process is `unverifiable`; normal exit records real exit code where known. Test multiple simultaneous sessions and descendants; do not claim broad descendant cleanup based on killing one PID.
- File read/write, Git, harness discovery, orchestration, Mentu and Bots are subsequent additive methods, not fabricated first-slice output. No legacy runtime proxy behind drogon-cli.

## Additive quiescent shutdown (implementation acceptance pending)

The separate [quiescent shutdown contract](service-quiescence-contract.md)
defines `runtime.shutdown {hostId, serviceInstanceId}` and capability
`runtime.quiescent-shutdown.v1`. Advertise it only with the complete, verified
core and serving-process implementation. It requires explicit authenticated
intent; ordinary client/window closure still leaves the service running.

`status.processId`, when present, is a positive execution-host PID for kernel
exit observation only, never permission to signal a process. The new request
does not accept a PID or force option. An old service without the capability
must be refused without a kill fallback; no protocol version or stream opcode
changes. Wrong host/instance retains `unsupported_host`/`stale_incarnation`.

Additive `runtime_busy` (retryable) means shutdown cannot be admitted while
mutations or pending/live/unverifiable sessions remain, or new mutation effects
are refused after the durable freeze. A matching request ID still replays its
original outcome: a known busy refusal may be reconsidered under a fresh
request ID; a lost mutation response must not be retried under a new identity.
`accepted:true` proves durable admission, not process exit. The client must
independently observe exit; transport loss alone remains `unverifiable`.

## Rust implementation boundary

Coordinator provides `drogon-protocol::{Request, Response, RpcError, PROTOCOL_VERSION, MAX_FRAME_BYTES}`. `drogon-core` exports `Engine::open(data_dir: &Path) -> Result<Engine, RpcError>` and `Engine::dispatch(&self, request: Request) -> Response`. Engine is safe to share through `Arc`; blocking operations must not hold global locks during child IO/wait. Authentication/framing is enforced in `drogond` before dispatch; core also validates protocol and all params. A caller never receives direct SQLite mutation access.

CLI exposes `drogon-cli --data-dir PATH [--json] status`, `workspace add PATH [--name NAME]`, `workspace list`, `terminal create --workspace ID -- COMMAND [ARGS...]`, `terminal list [--workspace ID]`, `terminal read|send|resize|close --session ID --incarnation TOKEN`, and diagnostic `rpc METHOD --params JSON [--request-id ID]`. `send --text` is UTF-8 encoded once to base64; `read` human output decodes bytes, JSON preserves wire bytes/cursors. Explicit `--request-id` is available for mutations and repeatability. Exit 0 for ok, 1 for operation/transport failure, 2 for usage errors. `--json` emits one JSON result, no progress noise on stdout. Transport loss returns `unverifiable`, never `exited`.

Electron uses a narrow validated preload bridge, no renderer Node/process APIs. It may launch the exact bundled service when no incumbent is present, but does not run the selected harness itself. It adopts the existing service and keeps it alive across window closure. The first renderer implements workspace selection, terminal tabs, output/input, resize, exact close, refresh and service errors using real RPC state.

## Evidence and references

The source inventories and daemon endpoint/SSH boundary documents identify contracts to preserve. Library APIs checked: [portable-pty](https://docs.rs/portable-pty/latest/portable_pty/), [Tokio named pipes](https://docs.rs/tokio/latest/tokio/net/windows/named_pipe/index.html), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security). Library support is not platform validation; Windows and remote acceptance need their own actual test evidence.
