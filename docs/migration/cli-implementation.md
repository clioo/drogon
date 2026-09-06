# drogon-cli implementation — first vertical slice

Implementation report for the frozen contract in `docs/migration/protocol-v1.md`
(§Envelope, §Methods and result shapes, §Rust implementation boundary). Owned
files: `crates/drogon-cli/**` and this document. Everything else was left
untouched except one mechanical `Cargo.lock` entry (see §7).

## 1. Files delivered

```
crates/drogon-cli/
  Cargo.toml            workspace deps only (clap, tokio, serde, serde_json,
                        uuid, sha2, base64, thiserror; dev: tempfile)
  src/main.rs           entry point, exit-code mapping, error output rules
  src/lib.rs            module wiring, #![forbid(unsafe_code)]
  src/cli.rs            clap surface + client-side usage validation
  src/paths.rs          data dir / endpoint / auth-token resolution
  src/wire.rs           request frame build (bounded) + strict response checks
  src/transport.rs      one-shot connection, bounded frame read, bounded timeout
  src/client.rs         request-id minting, typed per-method result shapes,
                        RFC3339 validation
  src/commands.rs       verb → method/params mapping, single-stdout rendering
  src/output.rs         human text rendering (never prints the auth token)
  tests/common/mod.rs   mock native service (real Unix socket + auth.token)
  tests/integration.rs  25 end-to-end tests through the real binary
  tests/parser.rs       7 argv-boundary/exit-code tests on the real binary
```

## 2. Surface implemented (exactly the frozen verbs)

```
drogon-cli [--data-dir PATH] [--json] [--request-id ID] <command>

status
workspace add PATH [--name NAME]        → workspace.register {path, name?}
workspace list                          → workspace.list {}
terminal create --workspace ID -- COMMAND [ARGS...] → session.start
terminal list [--workspace ID]          → session.list {workspaceId?}
terminal read --session ID --incarnation TOKEN
                                        → session.read {sessionId, incarnation, cursor:0}
terminal send --session ID --incarnation TOKEN --text TEXT
                                        → session.write {dataBase64 = base64(utf8(TEXT))}
terminal resize --session ID --incarnation TOKEN --cols N --rows N
                                        → session.resize
terminal close --session ID --incarnation TOKEN
                                        → session.stop
rpc METHOD [--params JSON]              → METHOD verbatim (diagnostic passthrough)
```

Global flags work before or after the subcommand. `--request-id` is accepted
on every command: explicit ids enable mutation replay per the frozen
contract; otherwise a fresh UUIDv4 is minted per request.

Deliberate minimalities (documented, not silently missing):
- `terminal resize` adds required `--cols`/`--rows` because
  `session.resize` has required `cols`/`rows` params with no default in the
  method table; there is no meaning for a resize without a target size. This
  is parameterization required by the protocol, not a new verb.
- `terminal read` intentionally has no extra flags: the service defaults
  (cursor 0, limitBytes 65536) apply, and anything richer goes through
  `rpc session.read --params {...}` — which is exactly what the diagnostic
  verb is for. Acceptance scripts already use this.
- `terminal create` requires the literal `--` separator (clap `last = true`
  rejects bare positionals: "unexpected argument"). Everything after `--`
  becomes argv verbatim; there is no shell interpolation anywhere in the
  crate (`command`/`args` travel as separate JSON fields).
- `rpc` prints the validated wire envelope in both text and JSON modes
  (there is no human form for arbitrary methods).

## 3. Transport and security behavior

- Endpoint: `<data-dir>/runtime-v1.sock` (Unix); Windows pipe name
  `\\.\pipe\drogon-v1-<first 24 lowercase hex SHA256 of canonical data-dir
  UTF-8 path>` computed per contract (`paths::windows_pipe_name`, hash test
  runs on all platforms). Data-dir default order:
  `--data-dir` > `DROGON_DATA_DIR` > macOS `~/Library/Application
  Support/Drogon` > Linux `$XDG_DATA_HOME/drogon` | `~/.local/share/drogon`
  > Windows `%APPDATA%/Drogon`. Empty env values count as unset (tested).
- Auth token read from `<data-dir>/auth.token` per invocation, trimmed of
  trailing newlines. The token is never logged, never appears in errors, and
  request `Debug` formatting excludes it (drogon-protocol already enforces
  this; integration test `auth_token_value_never_reaches_output` asserts the
  full stdout+stderr of a failing run stays token-free).
- One connection per request; `{"_keepalive"}`-style tricks are not needed at
  this slice. Frames are single-line JSON bounded by `MAX_FRAME_BYTES`
  (1 MiB): requests are size-checked before writing; responses are read by a
  fixed-chunk loop that errors out once the buffer exceeds the limit, so a
  newlineless flood cannot grow the allocation (tested with a 2 MiB flood).
- Total round trip is bounded (30 s default) by a single deadline over
  connect+write+read. Timeout, connection refusal, missing socket/token, and
  peer close before a full frame all map to code `unverifiable` — exit 1,
  never `exited`, never a retry, never a daemon/service launch. The
  missing-runtime test also asserts the data directory is still empty
  afterwards (nothing was spawned or created).
- No automatic retry of ambiguous mutations exists anywhere in the crate;
  `--request-id` replay is the only recovery mechanism, per contract.

## 4. Strict response validation

Every response passes four gates (any failure is exit 1):
1. frame parses as JSON;
2. deserializes into the protocol `Response` shape;
3. `Response::validate(expected_request_id)` — protocol 1, matching request
   id, exactly one of `result`/`error` per `ok` (this catches the required
   protocol-mismatch, wrong-request-id, and bad-envelope cases as typed
   `invalid_argument` failures);
4. per-method result decode into typed structs with required fields
   (`hostId`, `verdict` enum `live|unverifiable|exited`, `exitCode: number|
   null`, etc.), RFC3339 `createdAt` validation, and unknown-field tolerance
   (additive fields survive; a malformed result is refused as
   `internal_error: service returned a malformed <method> result; refusing to
   guess`, never guessed at).

Under `--json` the *raw validated envelope* is printed (pretty), so additive
fields reach scripts untouched; failure envelopes print to stdout, usage
errors never touch stdout. Human mode prints one text block for success and
`error: <code>: <message>` on stderr for failures.

## 5. Exit codes (frozen)

| Exit | Meaning | Examples (all tested) |
| --- | --- | --- |
| 0 | ok | `status`, `--help`, `--version` |
| 1 | operation/transport failure | server `ok:false` (e.g. `stale_incarnation`, `not_found` — code passes through verbatim), missing runtime, connect refusal, timeout, protocol mismatch, malformed envelope/result, oversize frame |
| 2 | usage errors | clap parse failures, `terminal create` without `--`, cols/rows outside 1..=1000, non-object `--params`, empty `--session`, invalid `--request-id`; stdout always empty |

## 6. Test results (real run, macOS arm64, Rust 1.98.0, offline)

```
cargo test -p drogon-cli --offline
test result: ok. 36 passed; 0 failed   (unit: parser, wire, transport, paths, shapes)
test result: ok. 25 passed; 0 failed   (integration vs mock native service)
test result: ok.  7 passed; 0 failed   (binary argv/exit-code)
cargo clippy -p drogon-cli --offline --all-targets → 0 warnings
```

Required scenarios, all covered and passing:
- protocol mismatch (protocol 2) → exit 1 typed failure
- bad auth response shape (`ok:true` + `error`) → exit 1
- wrong requestId in response → exit 1
- oversized/no-newline 2 MiB flood → bounded read, exit 1 "protocol limit"
- peer disconnect without response → exit 1 `unverifiable`, never `exited`
- stalling server with 150 ms transport budget → `unverifiable` within the
  bound (library-level transport test)
- stable exits: ok 0 / server error 1 / usage 2 (including `--json` usage
  errors leaving stdout empty)
- argv boundary: `terminal create --workspace ws-1 -- cargo run --release
  --features "big name"` produces `command="cargo"`,
  `args=["run","--release","--features","big name"]`; missing `--` is a usage
  error
- paths with spaces travel verbatim through `workspace add`
- `send --text "héllo → wörld ✓"` produces exactly one UTF-8→base64 encoding
  on the wire
- read: human output decodes bytes; `--json` preserves `dataBase64`/cursors
- explicit `--request-id` replays verbatim across invocations; default ids
  are valid UUIDv4
- missing runtime (no dir / no socket / no token) → `unverifiable`, and no
  daemon is launched (data dir untouched)
- server error codes (`stale_incarnation`, `not_found`) pass through verbatim
- token value never reaches stdout/stderr

## 7. Honest limitations and coordination notes

1. **Cargo.lock**: building the new workspace member added the
   `drogon-cli` package entry to `Cargo.lock` (names of existing workspace
   deps only; no registry packages added or version-bumped — everything was
   already locked and the build ran `--offline`). The coordinator owns the
   file and may want to re-verify the entry. No other lock edits were made
   by this worker.
2. **Windows transport is implemented but unvalidated.** The pipe-name
   computation and the tokio named-pipe connect path exist behind
   `#[cfg(windows)]` and the hash logic is unit-tested everywhere, but every
   integration test is `#[cfg(unix)]` (Unix socket mock). Per the frozen
   contract ("Library support is not platform validation"), Windows
   same-user enforcement must not be advertised until it has real test
   evidence on Windows.
3. **Timeout is a 30 s constant** (`transport::DEFAULT_TIMEOUT`), bounded as
   required but not user-configurable — the frozen surface has no timeout
   flag and adding one was out of scope. It is a single named constant if
   the coordinator wants to expose it later.
4. **No service-side behavior is implied.** The mock server implements just
   enough of the protocol to exercise the client; concurrent-admission
   replay, SQLite persistence, ring buffers and PTY ownership are drogon-core/
   drogond concerns and were not touched. `scripts/accept-core-cli.mjs` was
   read (not modified) to confirm the CLI surface matches what acceptance
   invokes: `status`, `workspace add/list`, `rpc ... --request-id`,
   `terminal send ... --text` — all implemented as invoked, exit 1 on
   `ok:false` as `expectsRpcError` requires.
5. **dev-dependency feature note**: `tokio` is used with the workspace
   definition; tests use the multi-thread flavor only. No new dependencies
   were introduced beyond the allowed list.

## 8. Review corrections (second dispatch, 2026-09-05)

All seven defects flagged in coordinator review (msg_7d1ad35634ea,
msg_1ecdac54fa87) are implemented, each with tests:

1. **Request id preserved on every transport failure/timeout.** The id is
   minted (or taken from `--request-id`) at the very start of `commands::run`,
   before `Client::open`, and threaded through `Client::call`,
   `transport::roundtrip`, `connect` and every `transport_loss` mapping —
   connect refusal, write/read IO, peer close, oversize frame, and timeout all
   produce `CliError::Local` carrying the original id. JSON failure envelopes
   therefore keep the replay id (tested: peer disconnect with
   `--request-id caller-fixed-rid` yields `requestId == "caller-fixed-rid"`
   in the envelope; same for missing-runtime and the library-level timeout
   test).
2. **No debug_assert on externally provided params.** `Client::call` now runs
   the envelope `Request::validate()` with `?`/`map_err` and returns a typed
   `CliError::Local` (invalid_argument) with the request id. Panics are
   impossible from caller input.
3. **Safe RFC3339 validation.** `is_rfc3339_utc` operates on bytes, rejects
   any non-ASCII input before indexing (malformed Unicode like
   `2026-09-05T12:34:56+aé:x` returns false, never panics), validates
   day-in-month including leap years (Feb 29 only in leap years, century
   rule included), bounds offsets to ±23:59 (99:99 rejected), and keeps
   second=60 (leap second) legal. Unit tests cover all of these plus
   multi-byte garbage at several positions.
4. **Per-method invariant validation before output** via
   `Client::decode_checked`: status (protocol pinned to 1, nonempty
   identity fields), workspace (nonempty id/path/hostId), session (nonempty
   id/workspaceId/hostId/incarnation, cols and rows 1..=1000), read (valid
   base64, `nextCursor >= startCursor`, and `nextCursor - startCursor ==
   decoded byte count`), write (`acceptedBytes == actual input byte count`).
   Violations exit 1 with `internal_error: … violating protocol invariants`.
   Seven integration tests each break one invariant against the fake native
   service and assert the refusal.
5. **Workspace paths resolved against the CLI process cwd before the RPC**;
   invalid UTF-8 is a usage error (exit 2) instead of a lossy-replacement
   string on the wire. Tests run the CLI binary with a cwd different from
   the daemon fixture directory and assert the absolute joined path on the
   wire, plus a raw invalid-UTF-8 argv test.
6. **`terminal read` gained `--cursor` and `--limit-bytes`** (additive
   grammar per coordinator approval): defaults preserved (cursor 0,
   `limitBytes` unset on the wire = service default 65536), client-side
   usage validation of 1..=65536, pagination beyond the first 64 KiB
   covered end-to-end (params forwarded, cursor range rendered, JSON
   preserves wire cursors/bytes).
7. **`terminal close` exit semantics:** only verdict `exited` exits 0.
   Verdicts `live` and `unverifiable` keep the rendered session identity on
   stdout (text mode adds a stderr warning; JSON mode returns the raw
   success envelope so the caller retains verdict/context) but exit 1.
   Tested in both text and JSON modes for both non-exited verdicts.

Verification commands and results (macOS arm64, Rust 1.98.0, offline, exit
codes checked explicitly with no pipe masking):

```
cargo test -p drogon-cli --locked --offline
  → exit 0; 90 tests total: 42 unit + 41 integration + 7 binary argv,
    0 failed, 0 ignored
cargo clippy -p drogon-cli --all-targets --locked --offline -- -D warnings
  → exit 0, zero diagnostics
cargo fmt --package drogon-cli           (and `-- --check` → exit 0)
cargo build -p drogon-cli --offline --release → exit 0
```

Known limitations carried over from the first slice (unchanged): Windows
transport is implemented behind `#[cfg(windows)]` but unvalidated (no real
Windows test evidence — do not advertise); the 30 s round-trip timeout
remains a named constant, not a flag; `terminal read` still sends `cursor`
explicitly (default 0) while `limitBytes` is only sent when the flag is
given, matching the service defaults. The stopped-output acceptance tests
owned by Sonnet were not touched; none of these changes weaken them — close
verdict handling and cursor-span invariants make the CLI stricter, not laxer.

## 9. Native harness commands (third dispatch, 2026-09-05)

Implemented `harness list` and `harness start` per
`docs/migration/harness-contract-v1.md`, gated on service capabilities.
Read-only inputs: the frozen contract, `crates/drogon-harness` public types
(availability enum, launch planning) and the `harness.list`/`harness.start`
implementations in `crates/drogon-core` — none modified.

### Surface

```
drogon-cli harness list
drogon-cli harness start --workspace <id> --harness <id>
           [--model <exact-id>] [--provider <Pi-provider>] [--effort <value>]
           [--prompt <text>] [--permission-mode inherit|unattended]
```

### Behavior

- **Capability gate before any optional method**: `harness list` requires
  `harness.catalog.v1`, `harness start` requires `harness.launch.v1`, checked
  via a read-only `status` preflight using a distinct request id. A missing
  capability yields `method_not_found: this Drogon service does not advertise
  <capability>; update the Drogon service on the execution host…` — exit 1,
  no fallback to shell/session.start/anything (integration tests assert the
  mock received *only* `status`).
- **Replay identity**: the preflight status request id is distinct, but every
  error is re-keyed onto the operation id via `CliError::retaining_request_id`
  (transport failures, preflight decode failures, and missing-capability all
  carry the caller's `--request-id`). The final `harness.start` mutation is
  sent with the caller's id byte-for-byte; integration tests capture both
  requests and prove the ids (mutation id unchanged, preflight id distinct).
- **Typed catalog checks** (`check_harness_catalog`): catalog `hostId` must
  equal the status `hostId`; every entry needs nonempty `harnessId` and
  `displayName`; `availability` must be exactly `available`, `missing` or
  `unsupported_launcher`; `available` requires a nonempty absolute host
  path; `missing` must not claim an executable. Absolute-ness is judged by
  path shape (unix `/...`, windows `X:\…`, `X:/…`, `\\unc`) — deliberately
  not via the client's own `Path::is_absolute`, so Windows execution-host
  paths pass on a macOS client. Additive/unknown JSON fields are preserved
  verbatim, and unknown future harness ids remain displayable (typed checks
  use strings, never the closed coordinator enum).
- **Start result checks**: the returned `Session` goes through the existing
  `check_session` invariants plus new identity assertions —
  `workspaceId` must equal the requested `--workspace` and `hostId` must
  equal the status host identity; mismatches exit 1.
- **Literal forwarding, server-authoritative policy**: prompt/model/provider/
  effort are forwarded as one JSON string each — no shell interpolation, no
  @-file expansion, no rewriting (the service adds the `Drogon task:` Pi
  prefix and equals-bound OpenCode prompt itself). CLI checks are
  intentionally basic only: nonempty/bounded/no-control for ids and
  preferences, leading-dash refusal on model/provider/effort (flag-injection
  hygiene, mirrors the server), prompt ≤32768 bytes and non-blank, and the
  `--permission-mode` enum (default `inherit`). Effort enums and the
  Pi-only provider rule are server-side by design; `--harness` is
  shape-checked, not enumerated, so additive future harness ids keep
  working. `--prompt` accepts flag-like text (`allow_hyphen_values`),
  matching the literal-prompt contract.

### Verification (exit codes checked explicitly, no pipe masking)

```
cargo fmt --package drogon-cli && cargo fmt --package drogon-cli -- --check
  → exit 0
cargo test -p drogon-cli --locked --offline
  → exit 0; 109 tests total: 53 unit + 49 integration + 7 binary argv,
    0 failed, 0 ignored
cargo clippy -p drogon-cli --all-targets --locked --offline -- -D warnings
  → exit 0, zero diagnostics
cargo build -p drogon-cli --offline --release → exit 0
```

New fake-native-service coverage: catalog rendering with unknown harness id
and additive fields (text+JSON), missing `harness.catalog.v1` and missing
`harness.launch.v1` refusals with operation-id retention and captured-methods
proof of no fallback, literal prompt/model/provider/effort/permissionMode
forwarding (prompt contains `@file`, flag-like text, quotes, newline),
caller request id unchanged on the mutation with distinct preflight id,
server `not_found` passthrough with operation id, catalog invariant refusal
(empty displayName), and start-result workspace/host mismatch refusal.
Unit coverage: permission-mode default/wire mapping and unknown-value
rejection, flag-like model refusal (space and equals forms), preference
shape checks, harness id shape-not-enum, prompt literal/blank/oversize,
absolute-path shapes for both host conventions, catalog invariants, and
additive-field tolerance.

### Limits

- `harness list`/`start` were tested against the in-process mock service
  only; live acceptance against the real service (installed Pi TUI) is the
  coordinator's `scripts/accept-core-cli.mjs --harness pi` run, which the
  CLI surface was verified to match (`harness start` params map 1:1 to the
  frozen `harness.start` method).
- No new dependencies; `agy` alias resolution, effort enums, Pi provider
  restriction and prompt prefixing are service-side and were not duplicated
  in the CLI.
- Windows: unchanged status — transport and launch adapters on Windows need
  real platform evidence; nothing here claims it.
