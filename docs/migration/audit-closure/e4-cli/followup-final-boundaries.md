# E4 final named CLI source boundaries

2026-09-06 · Source `c97906287bb7a390b25e2025b600d9fb3c25d9c3` · Task `task_25d311c47480` · Dispatch `ctx_a67f0505b20a`

**Recommendation: accept E4's finite source characterization after root reviews this final handoff.** All 30 frozen boundary paths now have a concrete owner, called contract, failure/effect distinctions and later test obligations. This is a recommendation, not root acceptance, complete internal-algorithm verification, executed parity or permission to start implementation. The 234-command scope and accepted S1 mapping are unchanged.

Root has accepted S1 and the earlier 22 S2–S5 helper contracts at their stated caller boundaries: [docs/migration/audit-root-followup-review.md:5](/Users/carlos/Documents/Drogon-rewrite/docs/migration/audit-root-followup-review.md:5) and [docs/migration/audit-root-followup-review.md:117](/Users/carlos/Documents/Drogon-rewrite/docs/migration/audit-root-followup-review.md:117). The current report resolves exactly the frozen `unreviewedBoundaryPaths` in [docs/migration/audit-closure/e4-cli/followup-cli-boundaries.json](/Users/carlos/Documents/Drogon-rewrite/docs/migration/audit-closure/e4-cli/followup-cli-boundaries.json), SHA256 `b1409e82899145b836d61be91c124e3632195f841bb592e4ca10fc2333b57911`. It does not repeat the 204-command review or invent another denominator for imported libraries. Automation validation before destination dispatch does not mean that earlier target-resolution RPCs have not occurred.

Current root-owned source-audit index remains **8/12, approximately 67%, medium-low confidence**, with zero E4 accepted-group change from this handoff. Test migration and product fidelity have zero demonstrated change here. Next milestone is independent root review; the 24-hour full-fidelity deadline remains high risk because baseline/port/platform execution is outstanding.

## Review method, completeness and limits

The lead read the 16 non-hook named bodies and their recorded called contracts; the approved leaf read the 14 hook services and explicit specialization/writer modules. The lead read both complete leaf artifacts, checked their source/test fingerprints, independently sampled Claude, OpenClaude, Codex, Amp, Grok and Hermes plus both shared writers, and read ten further Codex trust, home, TOML and mirror modules. Full source/range fingerprints and reviewer roles are in [docs/migration/audit-closure/e4-cli/followup-final-boundaries.json](/Users/carlos/Documents/Drogon-rewrite/docs/migration/audit-closure/e4-cli/followup-final-boundaries.json). The 136 evidence records comprise 103 source files, 29 assertion-body records and four explicitly unread assertion pointers; those counts are provenance bookkeeping, not closure proof.

Every one of the 30 frozen file hashes matches current reference bytes. Additional hashes identify bytes read; root owns independent comparison against pinned Git blobs. The launch receipt records the requested provider/model and depth, not model authentication. No product test, source-checkout test, generated hook, provider process, profile probe or account operation was run. The only verification performed here is audit-artifact consistency and source-byte identity.

All seven original `remainingGapClasses` are preserved verbatim in JSON, with a separate current reconciliation. E3 sender/relay and E5 WSL/package ownership remain cross-linked; their own unaccepted source gaps do not disappear. Unread internal assertion bodies and third-party/OS/provider behavior are explicitly named preparation or execution obligations, not silently claimed as reviewed or passing.

## Consequential findings and target decisions

- **D-ACL — source_defect.** Sync ACL false is ignored before rename; source mocked assertion expects nonthrow. Attempted Windows hardening is not confidential publication. Source: [src/shared/secure-file.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/secure-file.ts:1). Required later: Root must require failed-restriction publication to fail closed and independently prove actual disposable Windows ACL behavior.
- **D-BARRIER — source_defect.** ProcessResult lacks verified-tree state; false barrier can settle after deadline, hanging barrier Promise may prevent deadline arming. Source: [src/shared/child-process/run-process.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/child-process/run-process.ts:1). Required later: Separate cancellation/result settlement from live/unverifiable/exited and assert bounded signaling/observation with nonsettling injected barrier and actual descendant fixture.
- **D-PHASE — source_validation_gap.** String(phase) membership but strict equality for phase-specific requirements admits coerced phase e.g. array ['failed'] without reason; unsafe integer PID admitted. Source: [src/shared/serve-update-handoff.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/serve-update-handoff.ts:1). Required later: Characterize source and require explicit strict typed handoff/error regression decision; actual ready identity separate.
- **D-SUB — source_failure_shape.** Malformed schema frame ignored, startup resolves before first response, callbacks may throw through cleanup, raw startup timeout unguarded, close/open sending race. Source: [src/shared/remote-runtime-subscription-transport.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/remote-runtime-subscription-transport.ts:1). Required later: Disposable peer and fake clock tests for cleanup, bounds, order and first/late failures; never use broken link as process-exit proof.
- **D-PATH — source_resource_and_effect_gap.** Profiles execute; unbounded stdout, root-only10s kill and retained failed probe cache; synchronous PATH scope does not encompass returned Promise. Source: [src/main/startup/hydrate-shell-path.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/startup/hydrate-shell-path.ts:1). Required later: Preserve intended shell behavior with resource bound/host ownership and isolated profiles, not live user shell.
- **D-GROK-SYNC — source_ownership_difference.** Synchronous remove lacks asynchronous Windows peer commit gate; synchronous install raw-byte recheck is not atomic with rename. Source: [src/main/grok/hook-service.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/grok/hook-service.ts:1). Required later: Keep per-entrypoint characterization and concurrency/peer-unverifiable tests before choosing shared-resource removal policy.
- **D-CODEX-STATUS — source_observable_effect.** Default hook status can create managed home; install may spawn trust RPC/canonicalizer and modify system home, not file-only or pure status. Source: [src/main/codex/codex-home-paths.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/codex-home-paths.ts:1). Required later: Disposable-home effect-order and failure-after-partial-effect fixtures; avoid retry assumptions.
- **D-DISABLE — source_policy_difference.** Copilot install clears disableAllHooks, Droid retains hooksDisabled, Grok honors user-cleared config; providers differ. Source: [src/main/copilot/hook-service.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/copilot/hook-service.ts:1). Required later: Root explicit target policy plus provider-specific fixtures, no universal enable/disable rule.
- **U-REMOTE-WINDOWS — unsupported_source_capability.** Hook remote writers deliberately target POSIX .sh and home paths; native Windows SSH support is not established. Source: [src/main/agent-hooks/installer-utils-remote.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/agent-hooks/installer-utils-remote.ts:1). Required later: Keep unsupported behavior visible and obtain root capability decision; existing WSL guest path is not native Windows SSH support.
- **U-CONTACT — unverifiable_execution.** SFTP timeout/close cannot cancel/prove absence of late remote effects; SIGKILL request/IPC-ready/plist version each prove different things. Source: [src/main/agent-hooks/installer-utils-remote.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/agent-hooks/installer-utils-remote.ts:1). Required later: No blind mutation retry or destructive cleanup on lost contact; actual host/generation/operation identity and runtime tests.

These source defects are characterized findings, not reproduced runtime failures. Keep source-behavior tests and intended correction tests distinct. Root already requires `live / unverifiable / exited`: permission failure, lost transport, timeout, a kill request and a version-string match are not interchangeable evidence.

## Shared hook writer and Codex contracts

### C-HOOK-WRITERS

Owner: Invoking host's home for local calls; SFTP target filesystem for explicit remote calls; shared orchestration admission is root-accepted E4-S4-hooks.

Missing JSON file gives empty object; BOM stripped; malformed/nonplain root or local read error returns null config, rather than throwing a typed filesystem error. Shared managed matcher searches normalized path substrings and decoded PowerShell command, including argv strings; this is lexical ownership, not file provenance authentication. Local scripts create parent, skip identical bytes but rechmod0755 on POSIX, otherwise unique temporary file then chmod-before-rename and cleanup. Only Windows script write permission error retries once after grantDirAcl; failing retry rethrows original error. JSON writer resolves symlink target (dangling link throws), skips identical serialization, optionally preserves existing mode ONLY when preserveMode===true, otherwise default umask applies, creates one rolling .bak, then rename. It does NOT have the script ACL retry. Backup helper rejects symlink destination and temp-copies before rename. No fsync, global transaction, cross-process lock or generally atomic read-modify-write is supplied. Config/script/backup failures can leave earlier effects. Generated script presence refresh runs before accepted disabled/presence admission; absent scripts are not created by refresh itself.
Remote SFTP operation has10s timer; timeout rejects but cannot cancel an in-flight server operation, so a late write/rename is unverifiable. Missing code2 JSON gives {}, malformed returnsnull, other read errors throw. Existing remote mode is preserved07777 or defaults0600; script0755, even if bytes identical. Temp write/chmod/rename; OpenSSH overwrite rename falls back to plain rename ONLY on unsupported code8/recognized message, and other errors throw. Plain rename depends on server overwrite support; no destination unlink fallback. Cleanup temp is best-effort. Remote JSON has no backup. mkdirp accepts mkdir code4 ambiguously after failed directory read. POSIX remote path assumption does not authorize native Windows SSH hooks. Structured error status after catch is failure reporting, not rollback or proof of no effects.

Source anchors: [src/main/agent-hooks/installer-utils.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/agent-hooks/installer-utils.ts:1), [src/main/agent-hooks/installer-utils-remote.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/agent-hooks/installer-utils-remote.ts:1), [src/main/agent-hooks/hooks-json-read.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/agent-hooks/hooks-json-read.ts:1), [src/main/agent-hooks/hook-config-write-path.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/agent-hooks/hook-config-write-path.ts:1), [src/main/rolling-file-backup.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/rolling-file-backup.ts:1), [src/main/agent-hooks/managed-hook-script-refresh.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/agent-hooks/managed-hook-script-refresh.ts:1). Complete-file/range hashes and lead/leaf read roles are in JSON.

Later fixtures:

- Disposable filesystem fixture for symlink/dangling link/hardlink backup, permission and quota failure at script/config/backup/rename, byte-identical mode handling and concurrent installs.
- Mock SFTP each callback error and late-success-after-timeout; actual disposable OpenSSH posix-rename and unsupported-extension servers to verify destination preservation and mode. Never retry provider mutation solely because error status was returned.

### C-CODEX

Owner: E4 hook install/source characterization; invoking local managed and system homes; provider Codex app-server and WSL guest are explicit execution owners. Full account settings promotion implementation belongs shared account/settings capability, not a second E4 command inventory.

Lead read the ten files listed here beyond the leaf's facade/install/maintenance/status bodies. Default managed home resolver creates directory recursively (including status caller); path-only resolver does not. ORCA_USER_DATA_PATH truthy wins, then macOS Application Support/orca, Windows APPDATA or homedir AppData/Roaming, Linux XDG_CONFIG_HOME or ~/.config. Resource sync only replaces an owned link/copied marker; indeterminate observation preserves state, unowned existing file preserved, AGENTS file copied on WSL preference. Symlink fallback may copy/remove with best-effort cleanup; not atomic across directory contents.
Trust identity is sorted-key canonical JSON of event_name, one command handler, timeout max(1,value??600), async??false and optional statusMessage/matcher; user_prompt_submit/stop omit matcher. SHA256 prefixed sha256:. Trust key is normalized source path:event:group:handler; parser consumes last three colons, admits canonical nonnegative decimal indices without safe-integer cap, ten known event labels and nonempty source path. Windows device/UNC normalization and case folding differ from POSIX; explicit-home identity realpaths parent and retains hooks.json leaf, falling back lexical path on failure. Signature used for ledger recognition excludes positional identity but includes normalized hook behavior.
TOML upsert strips BOM, preserves disabled if any replaced logical entry is disabled unless explicitly overridden, deduplicates matching block ranges, appends if absent, and writes both slash variants for Windows fallback keys. Explicit trustedHash wins over self-computation. Removal only selected normalized block ranges. Atomic file writer preserves existing mode, resolves symlinks, makes rolling backup, uses Windows-retry rename and cleans temporary file on failure; no directory fsync or cross-process transaction proven.
Managed trust ownership cleanup requires matching source/event and recognized current/default-timeout computed hash or signature-matched ledger hash; unreadable ledger becomes null and cannot add ownership. Ledger removal occurs after successful trust removal so failed removal retains retry evidence. WSL stale cleanup restricts guest absolute */hooks.json keys and excludes desired normalized keys; foreign Windows/remote user trust is not inferred owned.
Grant RPC disabled flag affects managed-grant path only, not real-home user trust inspection/repair. Valid ledger match can skip session; pending database backfill, cached unsupported capability and5min transient cooldown choose distinct fallback reasons. Captures original config before clearing self-computed trust and calling capability-gated session. Exactly expected normalized keys, no extras/duplicates, complete successful verification are required; provider hashes retained verbatim. Unsupported/error/verify failure restore original before fallback (restore itself may fail and outer catch reports fallback error, so recovery is not unconditional). Ledger write failure warns after grant, not undoing provider mutation. Returned grant is not evidence that actual provider accepted invocation during this audit.
User-hook mirror rebuilds from system hooks, removing managed and plugin-placeholder commands, JSON-string deduplicating definitions; unreadable snapshot returnsnull to preserve runtime, whereas missing/no-hooks yields empty map. Trust is copied only for signature recognized from system trust and enabled retained; managed insertion increments user groupIndex for managed event labels. enabled text repair is regex-shaped and assumes enabled follows header. Config mirror first promotes runtime setting edits to system; failed promotion/mirror or indeterminate observation leaves baseline unadvanced. Blank/missing source preserves existing runtime; fresh runtime strips runtime-owned trust sections, ordinary settings mirror system with relative-path rewrite, preserving runtime hook/project trust except explicit system revocations and keeping exact-case regrant. Legacy shared home is one-way guarded write, avoiding promotion from retained PTYs. The called promotion, ledger/database, TOML section parser and app-server internals remain named implementation/provider seams whose assertions and integration must be verified; this is an exact caller contract, not blanket correctness proof of every parser/provider import.

Source anchors: [src/main/codex/codex-hook-trust-grant.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/codex-hook-trust-grant.ts:1), [src/main/codex/config-toml-trust.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/config-toml-trust.ts:1), [src/main/codex/codex-hook-identity.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/codex-hook-identity.ts:1), [src/main/codex/codex-home-paths.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/codex-home-paths.ts:1), [src/main/codex/codex-trust-identity.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/codex-trust-identity.ts:1), [src/main/codex/config-toml-hook-trust-edit.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/config-toml-hook-trust-edit.ts:1), [src/main/codex/config-toml-atomic-write.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/config-toml-atomic-write.ts:1), [src/main/codex/codex-managed-trust-reconciliation.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/codex-managed-trust-reconciliation.ts:1), [src/main/codex/codex-hook-user-mirroring.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/codex-hook-user-mirroring.ts:1), [src/main/codex/codex-config-mirror.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/codex-config-mirror.ts:1). Complete-file/range hashes and lead/leaf read roles are in JSON.

Later fixtures:

- Preserve leaf trust-grant assertions: provider hash authoritative; repeated ledger skip; binary stamp invalidates; exact-byte rollback; real-home symlink/mode; flag-off still repairs user trust; user disabled state not broadened.
- Add canonical hash/key corpus for10 events, matcher omission, unsafe index, Win device/UNC/WSL case; TOML duplicates/comments/quoted keys/disabled/BOM; indeterminate filesystem and concurrent promotion/cleanup; rollback failure vs successful restore; status directory creation.
- Read and port four explicitly unreviewed Codex assertion suites before implementing concurrency/WSL/user mirror/runtime repair; use disposable provider process and homes for real app-server matrix, never live account config.

Local JSON admission checks the root's plain-object shape, not every nested hook definition. A syntactically valid malformed nested shape can therefore throw during a service's property access instead of returning its parse-error status; remote install catches only where that service wraps its operation. Registration-count status generally does not prove that the referenced script exists or executes correctly, while plugin services inspect their marker and required source. Add nested-null/primitive/array fixtures and missing-script status fixtures before implementing each affected provider.

## Exact 30-path reconciliation

The identifiers below retain the original frozen path order. Each source link anchors the full reviewed named body; its full hash appears here and the inclusive read-range hash is in JSON. Listed assertion links have a separately declared read tier below; a link alone is not an assertion-body review.

### E4-F01 · E4-S2 · src/shared/task-source-context-schema.ts

[src/shared/task-source-context-schema.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/task-source-context-schema.ts:1) · lines 1–11 · SHA256 `190f0926f38ee5344d1fdd2b5e280e0c31f402bbe94a2a6ced6548ee1ee4e315`.

Owner: Caller/runtime using schema; pure normalization

TaskSourceContextSchema takes unknown, invokes the already-reviewed normalizeStoredTaskSourceContext, returns its normalized object on truthy success; otherwise emits a custom Zod issue 'Invalid task source context' and z.NEVER. No separate defaults/strict object parser or host RPC is introduced by this wrapper.

Original assertion associations: [src/shared/task-source-context.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/task-source-context.test.ts:1).

Exact later obligations:

- Reuse task-source-context.test.ts malformed stored context/schema assertions; add safeParse null/primitive/invalid host/provider and exact normalized omission/null shape parity.

### E4-F02 · E4-S2 · src/shared/github/repository-identity-key.ts

[src/shared/github/repository-identity-key.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/github/repository-identity-key.ts:1) · lines 1–28 · SHA256 `755c06306f7f614aa7695d2f877117f8c5b7c03176bada531bff7b5a2f953416`.

Owner: Pure shared cache identity; GHES separation

Default GitHub host is absent/trim-empty or trim/lowercase github.com. Identity lowercases owner and repo WITHOUT trimming them; trims/lowercases host, omits default host for backward-compatible owner/repo key, prepends nondefault host. Reverse key extraction returns first segment only for exactly three slash-separated segments; null/undefined/other counts return undefined. This is cache namespace syntax, not URL/host ownership validation.

Original assertion associations: [src/shared/github/repository-identity-key.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/github/repository-identity-key.test.ts:1).

Exact later obligations:

- Assert absent/blank/case github.com stable key; distinct GHES hosts; owner/repo whitespace retained; malformed slash segment counts and empty first segment reverse key.

### E4-F03 · E4-S3 · src/shared/e2ee-crypto.ts

[src/shared/e2ee-crypto.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/e2ee-crypto.ts:1) · lines 1–76 · SHA256 `0f187808227a77b9e3d6799741d2145e205820f6c5119db9b39c3e218bbfecc4`.

Owner: Caller and paired runtime use identical wire format; third-party cryptographic correctness/randomness is library/platform execution obligation

TweetNaCl box keyPair and box.before form shared keys. Public-key decode rejects encoded length>44 then Buffer base64-decodes and requires exactly32 decoded bytes, without canonical alphabet/padding check; encode just Buffer base64. Encryption UTF-8 encodes, generates random nonce each call, box.after encrypts and concatenates nonce+ciphertext; no plaintext cap in encrypt/encryptBytes themselves. Text decrypt rejects encoded length above ceil((4MiB+nonceLength+overheadLength)/3)*4 then permissive base64 decode; bytes decrypt rejects shorter than nonce+overhead, splits nonce, box.open.after returns null on authentication failure, TextDecoder replaces malformed UTF-8. Byte decrypt has no independent max length. Invalid key lengths/library errors are not caught.

Original assertion associations: [src/main/runtime/rpc/e2ee-crypto.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/runtime/rpc/e2ee-crypto.test.ts:1), [src/shared/remote-runtime-client.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/remote-runtime-client.test.ts:1).

Exact later obligations:

- Port generated-key peer fixtures already listed; add roundtrip empty/Unicode/binary, tamper/wrong key/short bundle, exact encoded cap and noncanonical key base64, invalid key lengths, and demonstrate primitive no outbound plaintext cap versus caller-enforced admission.

### E4-F04 · E4-S3 · src/shared/abort-signal-reason.ts

[src/shared/abort-signal-reason.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/abort-signal-reason.ts:1) · lines 1–29 · SHA256 `ef979f2aa87e3d6712dc80abb4d86a8c6e0fa7a1d807cfa1bf35c82b362b7455`.

Owner: Caller cancellation observation; no process termination authority

Returns the original Error signal.reason by identity; non-Error reasons become Error('The operation was aborted.') named AbortError. throwIfSignalAborted is inert without aborted signal. waitForPromiseWithSignal returns original promise with no signal; pre-aborted rejects immediately; otherwise once abort listener rejects and removes itself, and promise success/failure settles with original value/error then finally removes listener. It does not cancel the underlying promise/work and first settlement wins.

Original assertion associations: [src/shared/remote-runtime-client.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/remote-runtime-client.test.ts:1).

Exact later obligations:

- Assert no-signal promise identity, original Error identity, string/null default, abort-before and abort/resolve/reject races, listener cleanup and underlying work continuation.

### E4-F05 · E4-S3 · src/shared/json-text-structure-limit.ts

[src/shared/json-text-structure-limit.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/json-text-structure-limit.ts:1) · lines 1–80 · SHA256 `d2c02e311eda500d935589f167106890cec715a141d4976dc89860c0dc6b6bfd`.

Owner: Caller preparse resource guard; pure synchronous scan

Both limits must be nonnegative safe integers else RangeError. Single UTF-16 scan ignores quoted content with backslash escape tracking; outside strings counts only braces/brackets/comma/colon. Strictly exceeding token count throws JsonTextStructureCapacityError structuralTokens before depth handling; opening bracket increments depth and overlimit throws nestingDepth; closing floors depth at0. It does not validate JSON grammar, balanced delimiters, unterminated strings, scalar lengths or numeric values; caller JSON.parse/schema remains required.

Original assertion associations: [src/shared/json-text-structure-limit.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/json-text-structure-limit.test.ts:1).

Exact later obligations:

- Assert exact/plus-one limits, invalid limits, quotes/backslash parity, separators inside/outside strings, malformed unmatched closing/unterminated string passes scanner but parse fails, token-before-depth precedence.

### E4-F06 · E4-S3 · src/shared/remote-runtime-subscription-transport.ts

[src/shared/remote-runtime-subscription-transport.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/remote-runtime-subscription-transport.ts:1) · lines 1–318 · SHA256 `51019065291ee52fa66aec2f144a69287ea60080e23f921d31796e4abeadf318`.

Owner: Caller owns encrypted socket, queues and callbacks; paired server owns operations; link death is unverifiable process state

Serializes auth/request before socket; creates ephemeral key, maxPayload-bounded WebSocket, optionally disables perMessageDeflate only when false. Startup timeout uses raw setTimeout timeoutMs without the one-shot safe-delay guard. Ready/auth transitions send encrypted initial request and resolve subscription immediately after authentication, before first RPC success. Malformed JSON fails; schema-invalid parsed RPC and keepalive are silently ignored, matching main request id invokes onResponse repeatedly, pending request id resolves, other id fails. Binary before ready/undecryptable fails; ready binary invokes optional callback. No compatibility preflight or runtimeId equality check added here.
Close is idempotent, marks closing, rejects pending RPCs, releases JS queues and requests socket close; socket-buffer budget remains charged until actual close. Failure before startup rejects after cleanup; after startup calls onError, cleanup and onClose in that order. Callback exceptions are not isolated, so onError throw can interrupt cleanup; explicit close may await actual close event indefinitely. sendBinary rejects oversized/not-ready/not-OPEN and otherwise encrypts/queues; after close is requested there is no separate closing check in sendBinary/sendRequest, so an OPEN race needs fixture.
Request channel accepts safe integer timer0..2147483647, writable socket, at most32 pending, bounded serialization; reply clears its timer and resolves raw success/failure envelope. Request timeout or enqueue failure fails entire subscription and rejects all pending. Binary queue defaults soft8MiB/max64MiB/4096frames, request queue soft1MiB/max16MiB/64frames; optional process budget can deny registration/queued memory. FIFO queue sends when bufferedAmount<=softcap and budget allows, accounts bytes/frames before overflow, supports cancellation/release exactly once and drops backlog on nonwritable drain. Nonfinite bufferedAmount treated0; unknown option bounds are not generally validated; invalid finite positive drain batch defaults infinity. Socket and queue budgets are separate, with socket retained until close.
Liveness timer default10s, deadline25s after a probe, strict > timeout. Frames/ping/pong reset outstanding probe, delayed tick>1.5 intervals or backward time sends a fresh probe instead of declaring death. Ping throws ignored; dead callback fails and terminates socket best-effort. Timers unref when supported. No authenticated message replay/sequence enforcement beyond NaCl and RPC ids exists in this layer.

Called source anchors: [src/shared/remote-runtime-subscription-frame-router.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/remote-runtime-subscription-frame-router.ts:1), [src/shared/remote-runtime-subscription-request-channel.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/remote-runtime-subscription-request-channel.ts:1), [src/shared/remote-runtime-socket-liveness.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/remote-runtime-socket-liveness.ts:1), [src/shared/remote-runtime-subscription-outbound.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/remote-runtime-subscription-outbound.ts:1), [src/shared/ws-outbound-backpressure-queue.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/ws-outbound-backpressure-queue.ts:1).

Original assertion associations: [src/shared/remote-runtime-socket-liveness.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/remote-runtime-socket-liveness.test.ts:1), [src/shared/remote-runtime-client.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/remote-runtime-client.test.ts:1), [src/shared/ws-outbound-backpressure-queue.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/ws-outbound-backpressure-queue.test.ts:1).

Exact later obligations:

- Reuse full remote-runtime-client.test.ts plus socket-liveness and queue assertions; add startup invalid timer vs per-request rejection, auth-success-before-initial-failure, schema-invalid silence vs invalid JSON failure, callbacks throwing, close-open send race, two onClose paths, sustained tiny/zero frame FIFO/caps/cancel release and buffered memory held until actual close.
- Generated-key loopback real ws: tamper, binary states, mismatched/pending IDs, 32/33 outstanding, request-timeout kills all, half-open/sleep/backward-clock, exact frame/byte caps and mixed-version peers. No live pairing credentials.

### E4-F07 · E4-S3 · src/shared/child-process/run-process.ts

[src/shared/child-process/run-process.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/child-process/run-process.ts:1) · lines 1–400 · SHA256 `4ddddae3012551a036a30634dc60b87746a1d1136ca40af16236875b55359f86`.

Owner: Process runs on invoking execution host; caller owns streams for spawnProcess; barrier is local process-tree observation, never remote ownership proof

resolveSpawn always shell:false/windowsHide:true, default pipe streams, caller env/cwd/detached/verbatim; barrier forces detached on POSIX. Windows .cmd/.bat uses spec.env.ComSpec ?? process.env.ComSpec ?? cmd.exe and a single verbatim /d /v:off /s /c command line; quotes/backslashes/percent escaped, CR/LF rejected. This differs from stricter CLI windows-batch-spawn rejection helper.
Async run pre-abort invokes termination callback and returns code/signal null, empty streams,timedOut false without spawning. Default30s and8MiB per stream; timeout null disables, no safe-delay guard here. Input ends stdin immediately; stream errors swallowed, stdout/stderr capture PREFIX bytes with possible replacement char at UTF-8 cutoff and outputTruncated true. Nonzero exit resolves, spawn/child errors reject; settle clears timers/abort listener. Nonbarrier timeout/abort signals root then SIGKILL after2s and resolves even without close.
Barrier signals tree, defers error/exit/close; Windows initial verified result can settle early, POSIX waits force verification after2s; failed attempts kill root and set a10s deadline before settling unverified. Root exit before stopping can permit settlement; close invokes exactly-once reporter. Returned ProcessResult omits barrier verification, so null result or cancellation is NOT tree exit proof; reporting callback can throw. POSIX tree signals negative pid, force probes ps pgid/state up to2s treating all zombies as quiescent; fallback kill0 only ESRCH proves absent (EPERM remains exists). Windows skips taskkill if real exit/signal known to avoid recycled PID; taskkill /t /f close0 counts success, error/nonzero/2s timeout falls back root and false. OS races/actual descendant proof remain integration obligations.
Sync variant uses same argv with spawnSync timeout/maxBuffer and buffer decoding; ETIMEDOUT becomes timedOut true, other errors including ENOBUFS throw, outputTruncated always false. It does not implement async abort/barrier/callback behavior despite accepting the same spec. Kill observer is optional diagnostic, exceptions ignored.
The10s unverified deadline starts only after barrier signal/force promises resolve and mark the attempt complete; a supplied barrier Promise that never settles can prevent that deadline from starting. This contradicts any unconditional bounded-settlement interpretation and needs a dedicated regression.

Called source anchors: [src/shared/child-process/windows-command-line.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/child-process/windows-command-line.ts:1), [src/shared/child-process/bounded-output-sink.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/child-process/bounded-output-sink.ts:1), [src/shared/child-process/process-tree-termination.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/child-process/process-tree-termination.ts:1), [src/shared/child-process/child-termination-reporter.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/child-process/child-termination-reporter.ts:1), [src/shared/child-process/process-tree-kill-observer.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/child-process/process-tree-kill-observer.ts:1), [src/shared/child-process/process-spec.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/child-process/process-spec.ts:1).

Original assertion associations: [src/shared/child-process/run-process.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/child-process/run-process.test.ts:1), [src/shared/child-process/run-process-termination-failure.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/child-process/run-process-termination-failure.test.ts:1), [src/shared/child-process/process-tree-termination.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/child-process/process-tree-termination.test.ts:1), [src/shared/child-process/windows-command-line.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/child-process/windows-command-line.test.ts:1), [src/shared/child-process/windows-command-line.win32.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/child-process/windows-command-line.win32.test.ts:1).

Exact later obligations:

- Port run-process, Windows command-line, bounded-output and process-tree assertions; exercise timeout/abort before/after spawn, stream EPIPE, prefix truncation, descendant pipe retention, custom barrier rejecting/hanging/false, deadline with no root exit and reporter exactly-once.
- Actual isolated POSIX/Windows child trees, zombie/permission/recycled PID protections; demonstrate unverified result cannot release shared-resource ownership. Sync ETIMEDOUT/ENOBUFS/no signal handling and adversarial .cmd argv corpus on Windows.

### E4-F08 · E4-S3 · src/shared/serve-update-handoff.ts

[src/shared/serve-update-handoff.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/serve-update-handoff.ts:1) · lines 1–79 · SHA256 `b7f2c4a93a7ce10890f948cbd549d9cc0f50b2ea11f4fcd7550652e66bae39d6`.

Owner: Pure local handoff parser; file path rooted in caller-selected userDataPath

Path joins user data with serve-update-handoff.json. Parser requires truthy object, schemaVersion1, phase whose String() is one of install-requested/failed/completed, nonempty string from/target version, positive integer servingPid; only strict phase==='failed' requires string reason and strict completed requires nonempty runtimeId. Returns ORIGINAL cast object retaining unknown keys, arrays/custom phase coercion can pass when properties fit; Number.isInteger does not enforce safe integer. Supervisor message requires exact type orca:serve-ready and nonempty version/runtimeId, preserves extra fields. Nonempty whitespace admitted, no semver, live PID or runtime identity authentication.

Original assertion associations: [src/main/serve-update-handoff.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/serve-update-handoff.test.ts:1), [src/main/serve-update-handoff.app-environment.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/serve-update-handoff.app-environment.test.ts:1), [src/cli/runtime/launch.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/cli/runtime/launch.test.ts:1).

Exact later obligations:

- Assert each phase/message accepted/rejected, whitespace/unsafe integer, phase coercion vs strict checks, extra fields retained and exact path; serialized JSON phase object acceptance is characterization requiring strict target regression.

### E4-F09 · E4-S3 · src/cli/runtime/serve-update-supervisor.ts

[src/cli/runtime/serve-update-supervisor.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/cli/runtime/serve-update-supervisor.ts:1) · lines 1–293 · SHA256 `3cd094753949093437e00688f2b2289813c2e6a8e85a41be50e46d2156d7de15`.

Owner: Foreground CLI supervisor owns its spawned child and handoff file; updater owns installation, actual IPC-ready source owns reported runtime; E5 shared update boundary

Resume waits for target bundle version, records failure on timeout but still spawns existing executable with expectedHandoff null. Loop waits child EXIT (not stream close), requires expected replacement readiness verified or returns1; reads handoff catch=>null and only install-requested with matching servingPid when child.pid exists triggers replacement. Ordinary numeric code returns, forwarded-signal exit maps null to0, unsolicited signal throws diagnostic. Replacement can be spawned after failed install wait; no blanket abort of old-version service availability.
Expected readiness has60s timeout; valid IPC ready of targetVersion marks verified and writes completion then clears handoff; wrong version or timeout marks failed, persists failure best effort, SIGTERM then force timer. IPC runtimeId only nonempty, not cryptographically attested. State-write error on completion marks failed, stderr and terminate; child exit awaits stateWrite before resolving. Error event records failure before reject. SIGINT/SIGTERM forwarded except Windows (console already delivers), Linux also SIGHUP; force timer applies on all, cleanup removes listeners/timers.
Read sync/async failures returnnull; clear unlink swallows all errors. Write uses handoffPath.process.pid.tmp mode0600 then rename, no fsync, directory creation, lock or cleanup on write/rename failure; complete writes completed then best-effort unlink. Concurrent same-parent writes share temp path. Termination uses child.kill only, with no verified descendant barrier; forced signaling and IPC readiness are different from complete service/installed binary integrity.
Force-kill grace is10s renderer acknowledgement +20s teardown +5s scheduling margin =35s. Missing/signal exit diagnostic is runtime_serve_failed; macOS SIGABRT adds likely-window-server explanation and crash-report guidance, explicitly an inference not a diagnosed cause.

Called source anchors: [src/shared/quit-teardown-deadline.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/quit-teardown-deadline.ts:1), [src/cli/runtime/serve-signal-exit-diagnostic.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/cli/runtime/serve-signal-exit-diagnostic.ts:1).

Original assertion associations: [src/cli/runtime/launch.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/cli/runtime/launch.test.ts:1).

Exact later obligations:

- Port serve update/launch assertions; timeout, wrong version, spawn error, child exit before ready, same-version repeated messages, completion/failure write rejection, install timeout fallback, stale PID handoff and undefined child PID.
- Mocked signals plus actual isolated Windows/Linux/macOS supervisor child; force-grace, buffered stdout after exit, failed kill and no-exit, temp/rename/unlink races, restart recovery, no live app replacement.

### E4-F10 · E4-S3 · src/cli/runtime/mac-app-update-bundle.ts

[src/cli/runtime/mac-app-update-bundle.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/cli/runtime/mac-app-update-bundle.ts:1) · lines 1–87 · SHA256 `ba270a94a7fc01d8614d036820967eaaf50869817b1cac76a49e877fb0277ca3`.

Owner: Caller macOS bundle filesystem observation; not package signature or runtime readiness

Only darwin: takes three dirname levels of executable and accepts path suffix .app; does not verify intermediate Contents/MacOS names. Reads Contents/Info.plist UTF8, regex extracts/trim CFBundleShortVersionString, read/parse missing=>null. Exact target version short-circuits true; otherwise120s default timer,250ms polling and parent-directory fs.watch to survive whole-bundle replacement. Single in-flight read; watcher creation/error falls back polling; finish clears timeout/poll and closes watcher. Non-mac/path failure returnsfalse. File matching alone does not prove code signature, executable health, atomic update completion or IPC-ready.

Original assertion associations: [src/cli/runtime/launch.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/cli/runtime/launch.test.ts:1).

Exact later obligations:

- Mac and off-platform fixture path/contents/regex variants, exact match, delayed replacement, watcher throw/error, read errors, concurrent events, timeout cleanup and malformed/version whitespace; actual signed packaged upgrade belongs E5 runtime acceptance.

### E4-F11 · E4-S4 · src/main/claude/hook-service.ts

[src/main/claude/hook-service.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/claude/hook-service.ts:1) · lines 1–344 · SHA256 `e66bc19f3ab3f3391bf6b1802c3ec6928a87a8cb1829632b7303fd4fc2de7cdb`.

Owner: Claude local home .claude/settings.json and shared .orca/agent-hooks; remote supplied POSIX home .claude/settings.json

Install merges 13 lifecycle events through hook-settings, sweeps managed script-name variants, writes executable before JSON. Status counts expected invocations: zero not_installed, some partial with missing events, all installed; parse failure returns error. Local install alone may install managed statusLine; user slot and empty slot plus prior marker are opt-out. Marker write failure is swallowed. Remove strips managed hooks/statusLine and best-effort removes marker but retains generated scripts. Refresh checks existing statusLine script without agent gate. Windows script emits {} before environment guards and skips background CLAUDE_JOB_DIR; POSIX captures stdin and may spool. Remote install catches errors into status, uses .sh and never installs statusLine; error status cannot prove no prior file writes.

Called source anchors: [src/main/claude/hook-settings.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/claude/hook-settings.ts:1).

Original assertion associations: [src/main/claude/hook-service.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/claude/hook-service.test.ts:1).

Exact later obligations:

- 13 event presence/missing/stale, user slot versus opt-out marker, script-before-config failure, marker failure, background/Devin stdin ordering, remote failure at each SFTP stage and no statusLine.

### E4-F12 · E4-S4 · src/main/openclaude/hook-service.ts

[src/main/openclaude/hook-service.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/openclaude/hook-service.ts:1) · lines 1–8 · SHA256 `647aa6b2698a3a5a6f38fd7ae81513836806a76a8eb89898009b28b95f62af80`.

Owner: ClaudeHookService specialization with OPENCLAUDE_HOOK_SETTINGS; local .openclaude, supplied remote POSIX home

Eight-line facade selects agent openclaude/display OpenClaude/settings. It inherits Claude install/remove/status and errors, but install skips statusLine, omits Devin skip and still generates Claude protocol payload. Inherited refresh still refreshes an already-present statusLine path; inherited remove still strips a matching managed statusLine. No separate guarantee of zero writes from statusLine absence.

Original assertion associations: [src/main/claude/hook-service.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/claude/hook-service.test.ts:1).

Exact later obligations:

- Cross-agent local/remote isolation; pre-existing managed statusLine refresh/removal even though never installed here; inherited 13 events and parse/partial branches.

### E4-F13 · E4-S4 · src/main/codex/hook-service.ts

[src/main/codex/hook-service.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/hook-service.ts:1) · lines 1–29 · SHA256 `5ee67e8ef70bf12e8ff6cfd52689627f1c7ccb1dadab44478518b2b9ea1a9c3c`.

Owner: Local managed runtime CODEX_HOME plus system ~/.codex user settings; SSH supplied POSIX runtime home; WSL selected distro runtime

Facade exports implementation. Install is async, serializes runtime/system trust mutation, deduplicates WSL and launch-prep lanes; writes shared script then sanitized hooks.json containing managed entries before mirrored user entries, writes trust last and cleans legacy managed entries. Status includes event registration and enabled/current trust key/hash checks; parse and partial are distinct. Default getHome creates managed runtime directory even during getStatus. Disable/remove retains or refreshes user hooks and trust; system legacy cleanup can mutate real-home hooks/config separately from managed-home registration. RPC trust uses provider-reported hashes with validated expected coverage, ledger/binary checks, fallback/self-computed path, rollback and retry cooldown; see C-CODEX below. WSL canonicalizer and provider app-server are process effects, so file-only is false. SSH remote install can defer trust and is POSIX-specific; no remote Windows support implied.

Called source anchors: [src/main/codex/codex-hook-service-implementation.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/codex-hook-service-implementation.ts:1), [src/main/codex/codex-hook-definition.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/codex-hook-definition.ts:1), [src/main/codex/codex-hook-script.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/codex-hook-script.ts:1), [src/main/codex/codex-hook-local-install.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/codex-hook-local-install.ts:1), [src/main/codex/codex-hook-remote-install.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/codex-hook-remote-install.ts:1), [src/main/codex/codex-hook-local-maintenance.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/codex-hook-local-maintenance.ts:1), [src/main/codex/codex-hook-status.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/codex-hook-status.ts:1), [src/main/codex/codex-hook-legacy-cleanup.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/codex-hook-legacy-cleanup.ts:1), [src/main/codex/codex-hook-trust-cleanup.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/codex-hook-trust-cleanup.ts:1), [src/main/codex/codex-hook-wsl-runtime.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/codex-hook-wsl-runtime.ts:1), [src/main/codex/codex-wsl-hook-install-plan.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/codex-wsl-hook-install-plan.ts:1).

Original assertion associations: [src/main/codex/hook-service-managed-install.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/hook-service-managed-install.test.ts:1), [src/main/codex/hook-service-trust-grant.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/hook-service-trust-grant.test.ts:1), [src/main/codex/hook-service-legacy-cleanup.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/hook-service-legacy-cleanup.test.ts:1).

Exact later obligations:

- All 8 managed events and trust missing/stale/disabled, group/handler offsets with mirrored user hooks, duplicate install concurrency, user-data/account separation, malformed and unreadable system/runtime state, real-home symlink/mode preservation, cleanup race, exact-byte rollback, RPC unsupported/timeout/malformed/partial results, WSL canonicalization/cache and host identity, status-directory effect.

### E4-F14 · E4-S4 · src/main/gemini/hook-service.ts

[src/main/gemini/hook-service.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/gemini/hook-service.ts:1) · lines 1–311 · SHA256 `7133c6414855d0045dd16e90d6fc88fca919c47dbb612af13df22c2bceb397bc`.

Owner: Local ~/.gemini/settings.json; supplied remote POSIX home

BeforeAgent/AfterAgent/AfterTool/BeforeTool registered; install sweeps managed entries even in old non-managed event buckets, preserves user entries, writes script then config. Exact wrapped command status gives installed/not_installed/partial; parse failure error. Remove sweeps all event buckets. Windows encoded launcher differs from remote always-POSIX .sh; remote returns structured errors after possible script effect.

Original assertion associations: [src/main/gemini/hook-service.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/gemini/hook-service.test.ts:1).

Exact later obligations:

- Exact four-event shape, stale PreToolUse removal, partial/malformed config, user-hook preservation, all remote filesystem failure stages and Windows encoded invocation.

### E4-F15 · E4-S4 · src/main/antigravity/hook-service.ts

[src/main/antigravity/hook-service.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/antigravity/hook-service.ts:1) · lines 1–233 · SHA256 `e9f3bd6ff1ce520431a83f5da165cc0dd21b5fc29f4c2ff4ad0d2b41782bfc5f`.

Owner: Local ~/.gemini/config/hooks.json orca-status bundle; remote POSIX counterpart

Separate orca-status bundle, not Gemini settings registration. Five events PreInvocation/PostInvocation/Stop/PreToolUse/PostToolUse. PreToolUse supplies decision ask including missing-script fallback; no permission allow/deny override. Windows five wrappers supply ORCA_ANTIGRAVITY_EVENT around shared core. Status checks bundle/event registrations and stale managed entries; install/remove preserve user bundles and clean managed names. Parse/remote error status remains distinct from permission answer.

Called source anchors: [src/main/antigravity/hook-events.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/antigravity/hook-events.ts:1), [src/main/antigravity/hook-script.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/antigravity/hook-script.ts:1), [src/main/antigravity/hooks-json-bundle.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/antigravity/hooks-json-bundle.ts:1).

Original assertion associations: [src/main/antigravity/hook-service.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/antigravity/hook-service.test.ts:1).

Exact later obligations:

- User bundles and stale cross-platform entries, every event JSON answer including absent script, Windows wrapper environment/stdin, partial bundles, remote script/config failure.

### E4-F16 · E4-S4 · src/main/amp/hook-service.ts

[src/main/amp/hook-service.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/amp/hook-service.ts:1) · lines 1–114 · SHA256 `91b171f1c90e05ce8936aeee07b9f047a5de4567b0677ded210bfb5e5e2cb94f`.

Owner: Local ~/.config/amp/plugins/orca-agent-status.ts; remote supplied POSIX plugin path

Plugin marker plus session.start/agent.start/tool.call/tool.result/agent.end source handlers determine installed/partial. Missing not_installed, unreadable error, unmanaged file partial and never overwritten/unlinked. Install temp+rename skips identical content; no generic JSON backup or explicit mode contract. Remove only marker-owned file. Generated plugin enqueues bounded posts rather than blocking tool.call; its source returns action allow, which must be characterized as provider integration rather than inherited Antigravity policy.

Called source anchors: [src/main/amp/agent-status-plugin-source.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/amp/agent-status-plugin-source.ts:1), [src/main/amp/managed-plugin-install-status.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/amp/managed-plugin-install-status.ts:1).

Original assertion associations: [src/main/amp/hook-service.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/amp/hook-service.test.ts:1).

Exact later obligations:

- User plugin refusal, missing each of five handlers, marker collision, identical write, rename/read failures; execute generated plugin against disposable provider API harness for queue and action semantics.

### E4-F17 · E4-S4 · src/main/cursor/hook-service.ts

[src/main/cursor/hook-service.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/cursor/hook-service.ts:1) · lines 1–295 · SHA256 `be6cdfb8d149e9123ec471c47b9933a2586ffca35efa7ffd7244f87c0b11c988`.

Owner: Local ~/.cursor/hooks.json; supplied remote POSIX home

Top-level command definitions with compatibility cleanup/status of nested hooks shape. Install sets version1 only if undefined, preserving explicit other version; sweeps managed entries and writes scripts before config. Per-event response environment and fallback JSON differ from ordinary lifecycle posts. Partial for missing registrations, parse failure error; remote POSIX generated paths regardless of local Windows.

Called source anchors: [src/main/cursor/hook-events.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/cursor/hook-events.ts:1), [src/main/cursor/hook-script.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/cursor/hook-script.ts:1).

Original assertion associations: [src/main/cursor/hook-service.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/cursor/hook-service.test.ts:1).

Exact later obligations:

- Top-level/nested mixed cleanup, explicit version null/other versus absent, missing/empty stdin response JSON, curl failure off stdout, Windows cmd/Git Bash and remote errors.

### E4-F18 · E4-S4 · src/main/droid/hook-service.ts

[src/main/droid/hook-service.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/droid/hook-service.ts:1) · lines 1–331 · SHA256 `ded5d2feddda6ba4fbf91bb72119f6451f24d2f371d63bd4f7bf7c7954a982a1`.

Owner: Local ~/.factory/settings.json; supplied remote POSIX home

Eight events SessionStart/UserPromptSubmit/Stop/SubagentStop/PreToolUse/PostToolUse/PermissionRequest/Notification, tool matchers '*'. Shared local/remote config builder sweeps managed entries and adds registrations. hooksDisabled===true produces partial detail even when registrations are missing; install does not clear disabling setting. Parse failure error; otherwise presence controls installed/not_installed/partial; Windows launcher distinct from remote POSIX.

Original assertion associations: [src/main/droid/hook-service.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/droid/hook-service.test.ts:1).

Exact later obligations:

- Disabled true combined with zero/some/all events, false/absent preserved, exact matcher semantics, user entries preserved, local/remote builder equivalence and script/config failure ordering.

### E4-F19 · E4-S4 · src/main/command-code/hook-service.ts

[src/main/command-code/hook-service.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/command-code/hook-service.ts:1) · lines 1–234 · SHA256 `a3eec8bbfa2aaaa7ed45ba1e82946924c1e2da61ae355bc8030c591f1550fd91`.

Owner: Local ~/.commandcode/settings.json; supplied remote POSIX home; generated script recovers invoking pane environment

PreToolUse/PostToolUse/Stop use '.*' tool matcher. Install/remove shared JSON ownership rules and exact event command status; incomplete events partial. Generated script recovers stripped environment through ancestor /proc environ or ps eww and candidate endpoint files matched to loopback port; selected recovered values must not clobber fresh pane coordinates. This is script execution behavior, not an install-time provider connection.

Called source anchors: [src/main/command-code/command-code-managed-script.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/command-code/command-code-managed-script.ts:1).

Original assertion associations: [src/main/command-code/hook-service.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/command-code/hook-service.test.ts:1).

Exact later obligations:

- Three events/matcher; ancestor traversal/permissions/missing endpoint/stale token/live fresh token; offline generated-script harness for UTF8 payload, timeout and stdout; remote partial writes.

### E4-F20 · E4-S4 · src/main/grok/hook-service.ts

[src/main/grok/hook-service.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/grok/hook-service.ts:1) · lines 1–302 · SHA256 `9965327b6e2fa2115e68fc6094d5ad0aad5177ac92a03387e1c747f950aec170`.

Owner: GROK_HOME or ~/.grok/hooks/orca-status.json; Windows shared owner token directory; remote validated Grok home

Install respects existing hooks-empty config unless userInitiated true or own symlink-cleanup marker matches; rechecks raw bytes after writing script and before config, returning error on generation change. This check is not an atomic compare-and-swap. Windows registers owner before JSON, unregisters on throw. Status exact event command count; malformed error. Synchronous remove unregisters current owner and can unlink owned remnant without async peer gate; async remove uses hold/commit generation guard and Windows peer checks, returns current status when peer owns. Symlinks remain and target is stripped; cleanup marker permits later reinstall. Scripts retained. Remote uses validated home and POSIX writer.

Called source anchors: [src/main/grok/grok-hook-config.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/grok/grok-hook-config.ts:1), [src/main/grok/grok-hook-config-file.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/grok/grok-hook-config-file.ts:1), [src/main/grok/grok-hook-config-cleanup.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/grok/grok-hook-config-cleanup.ts:1), [src/main/grok/grok-hook-script.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/grok/grok-hook-script.ts:1), [src/main/grok/grok-hook-remote-install.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/grok/grok-hook-remote-install.ts:1), [src/main/grok/grok-hook-owners.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/grok/grok-hook-owners.ts:1), [src/main/grok/grok-hook-symlink-cleanup-marker.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/grok/grok-hook-symlink-cleanup-marker.ts:1).

Original assertion associations: [src/main/grok/hook-service.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/grok/hook-service.test.ts:1).

Exact later obligations:

- Sync versus async owner semantics; stale/recycled/permission-unverifiable peer; edit between raw check and commit, held-file restoration failure, symlink identity/marker drift, explicit opt-out, orphan remnant with non-hook keys, no lost-contact cleanup authorization.

### E4-F21 · E4-S4 · src/main/copilot/hook-service.ts

[src/main/copilot/hook-service.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/copilot/hook-service.ts:1) · lines 1–201 · SHA256 `3dba3c72a72024bb15812c81e14aa8a675bb660ef2bbc3fec5fd31009deeab53`.

Owner: COPILOT_HOME or ~/.copilot/hooks/orca.json; supplied remote POSIX home

Dedicated hooks file uses bash/powershell definitions, timeoutSec5 and case-sensitive event names. Install forces version1 and deletes disableAllHooks rather than preserving user disable policy. Status reports disabled or stale registrations partial and malformed JSON error. Remove only matching managed entries, preserving nested/direct user commands, and does not create an unused file.

Called source anchors: [src/main/copilot/copilot-managed-hook-definitions.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/copilot/copilot-managed-hook-definitions.ts:1), [src/main/copilot/copilot-managed-script.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/copilot/copilot-managed-script.ts:1), [src/main/copilot/copilot-remote-hook-install.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/copilot/copilot-remote-hook-install.ts:1).

Original assertion associations: [src/main/copilot/hook-service.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/copilot/hook-service.test.ts:1).

Exact later obligations:

- Force-version and disableAllHooks policy characterization/target decision, exact event casing, mixed user definitions, no-create removal, malformed/null roots, remote timeout/partial file effects.

### E4-F22 · E4-S4 · src/main/hermes/hook-service.ts

[src/main/hermes/hook-service.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/hermes/hook-service.ts:1) · lines 1–174 · SHA256 `1e8194b2f3bd8b97fe8ca22536b7f264d1e653613525d646f35b44641881a883`.

Owner: HERMES_HOME or ~/.hermes config.yaml and plugins/orca-status

Writes managed plugin.yaml and __init__.py then enables plugin in YAML: sorts enabled names, removes name from disabled, normalizes malformed list values. Status uses managed marker/files and enabled-not-disabled config; disabled/missing component partial, read errors error. Remove recursively deletes marker-owned plugin directory and disables name; nested extra user files under marker-owned directory are not individually protected. Generated Python reports normalized/bounded payload; actual CLI/Python tests may early return when binary unavailable.

Called source anchors: [src/main/hermes/hermes-config-yaml.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/hermes/hermes-config-yaml.ts:1), [src/main/hermes/hermes-home-filesystem.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/hermes/hermes-home-filesystem.ts:1), [src/main/hermes/hermes-managed-plugin-source.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/hermes/hermes-managed-plugin-source.ts:1).

Original assertion associations: [src/main/hermes/hook-service.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/hermes/hook-service.test.ts:1).

Exact later obligations:

- Malformed YAML/list/type and partial file ordering, preserve other plugins, both enabled/disabled, remove with extra files under managed directory, IO failures and generated Python payload bounds; require actual provider/py prerequisites to avoid vacuous pass.

### E4-F23 · E4-S4 · src/main/devin/hook-service.ts

[src/main/devin/hook-service.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/devin/hook-service.ts:1) · lines 1–248 · SHA256 `c3fc391215758a4c966c292ab568b5b0ba2b5a79a32a9d1e4eed797aebcdfa89`.

Owner: Local ~/.config/devin/config.json; Windows APPDATA/devin/config.json; supplied remote POSIX home

JSONC reader keeps original text and patch serializer edits changed hook buckets, preserving unrelated comments/formatting. SessionStart/UserPromptSubmit/Stop/PostCompaction/SessionEnd plus tool events, no tool matcher. Status reports overlap from read_config_from.claude and missing-event partial. Windows bare cmd-safe path or encoded wrapper, POSIX script remote; install script then config and remote catch-to-error.

Called source anchors: [src/main/devin/hook-settings.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/devin/hook-settings.ts:1), [src/main/devin/hook-config-json.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/devin/hook-config-json.ts:1).

Original assertion associations: [src/main/devin/hook-service.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/devin/hook-service.test.ts:1).

Exact later obligations:

- Exact no-matcher semantics, comments/BOM/unrelated fields, duplicate/malformed JSONC source, imported Claude overlap, missing APPDATA behavior, cmd unsafe path/stdio and remote writer failures.

### E4-F24 · E4-S4 · src/main/kimi/hook-service.ts

[src/main/kimi/hook-service.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/kimi/hook-service.ts:1) · lines 1–277 · SHA256 `7370bd5dd3d88689ffa14ea1e43d5ae6dfb10dcef266dee5ef55edd242907b8f`.

Owner: KIMI_CODE_HOME or ~/.kimi-code/config.toml; shared POSIX script on all platforms including Windows Git Bash

Marker-delimited managed TOML block stripped and appended on install, stripped on remove; status scans expected managed events/command matches. Script written before config; JSON writer generalized behavior does not apply to TOML preservation: dedicated atomic write and rolling backup used. Outside-block source retained; repeated install remains one block. Single .sh means usable shell runtime remains external platform obligation.

Called source anchors: [src/main/kimi/kimi-hook-config-toml.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/kimi/kimi-hook-config-toml.ts:1).

Original assertion associations: [src/main/kimi/hook-service.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/kimi/hook-service.test.ts:1).

Exact later obligations:

- Outside-block byte roundtrip, CRLF/BOM/multiple/unclosed markers, partial event registrations, repeat install and config/script write failures, actual Windows Git Bash command execution.

### E4-F25 · E4-S4 · src/main/startup/hydrate-shell-path.ts

[src/main/startup/hydrate-shell-path.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/startup/hydrate-shell-path.ts:1) · lines 1–399 · SHA256 `4e22524de7a6943b69897df68e3841f36133d4cd6befc315fc1ab4cdc9adfe79`.

Owner: Invoking local process/user shell; may run profile scripts and mutate process.env PATH, never remote host PATH

Module initialization snapshots launch PATH key/value before later seeding; probes copy env with ORCA_SHELL_PATH_PROBE=1 and restore launch PATH, removing alternative case keys on Windows. runWithLaunchPath temporarily swaps process env and restores in finally but only around synchronous callback (a returned Promise outlives scope). POSIX resolves SHELL or /bin/zsh mac, /bin/bash other; Windows cmd=>no shell, POSIX-family config=>configured Git Bash path (not arbitrary wsl), PowerShell requires basename powershell.exe/pwsh.exe. Null/empty configured shell defaults PowerShell.
Probe loads POSIX -ilc or PowerShell -NoLogo -Command WITHOUT NoProfile; Git Bash calls cygpath -wp, PowerShell UTF8. stdout is unbounded string with per-chunk UTF8 decode, ANSI subset stripped, first two sentinel occurrences extracted, trim/split/dedupe preserves order. Nonzero exit status ignored when delimited PATH exists; missing markers/empty =>empty_path. Spawn event error=>spawn_error; synchronous spawn throw rejects Promise. After10s root SIGKILL best effort returns timeout with no descendant proof, listener cleanup removes handlers.
Cache stores success/failure/rejected Promise until force/config reset. Serialized probeQueue continues after rejection; Windows restore owned PATH before next probe, fallback only spawn_error (not empty/timeout), configuration version prevents returning stale result by requesting current cache. Configure change restores owned PATH, increments version, clears cache. Merge returns newly added segments only but also reorders existing shell paths to front; POSIX exact identity, Windows normalize/lowercase/remove trailing separator outside root. Windows ownership restore keeps baseline plus external additions absent from previous applied value, not arbitrary external reorder/removal; first case-insensitive env path key chosen.

Called source anchors: [src/main/startup/windows-shell-path-ownership.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/startup/windows-shell-path-ownership.ts:1), [src/shared/windows-terminal-shell.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/windows-terminal-shell.ts:1).

Original assertion associations: [src/main/startup/hydrate-shell-path.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/startup/hydrate-shell-path.test.ts:1), [src/main/startup/windows-shell-path-ownership.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/startup/windows-shell-path-ownership.test.ts:1).

Exact later obligations:

- Port hydration and Windows ownership tests; isolated mock profile runners for10s, banners/ANSI/sentinels/nonzero/sync throw, cache failure/force, stale configuration race, fallback-only-spawn_error, inherited PATH case keys and marker.
- Actual disposable PowerShell/Git Bash/POSIX profiles after acceptance; assert no personal profile write and preserve host/WSL distinction, UTF8 chunk split, huge-output bound intended regression, restore with external additions/removals.

### E4-F26 · E4-S4 · src/shared/remote-pairing-address.ts

[src/shared/remote-pairing-address.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/remote-pairing-address.ts:1) · lines 1–147 · SHA256 `dcdfce5217f6e558ba8c6a58131c0683d58812b3389ec6cf937a10c3add5e014`.

Owner: Pure caller classification of declared endpoint, not DNS resolution or connectivity proof

Classifier lowercases, strips outer IPv6 brackets and one trailing dot without trimming. Mapped hex IPv4 (::[ffff:]hhhh:hhhh) recurses; fixed localhost aliases, .localhost suffix or any127. prefix=>loopback, strict100.64..127 IPv4=>tailscale, private10/172.16..31/192.168 or IPv6 fc00/7,fe80/10=>lan; remaining dot/colon=>public else custom. Private IPv4 checker only integer octets, not0..255; IPv6 first hextet parseInt is permissive, so classifier alone is not IP validation.
parseHostAccessLink first uses S2/S4 pairing parser, rejects mobile scope, catches URL construction invalid-destination, requires ws/wss nonempty hostname and no hash (unsupported-destination), rejects0.0.0.0/::/mapped unspecified or port0 as non-connectable. Returns original pairing, endpoint.host display and classifier result; userinfo/query/path are not prohibited, endpoint is not dialed. Environment store classifier call remains narrower than this whole access-link admission.

Called source anchors: [src/shared/tailnet-address.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/tailnet-address.ts:1).

Original assertion associations: [src/shared/remote-pairing-address.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/remote-pairing-address.test.ts:1).

Exact later obligations:

- Port remote-pairing-address and tailnet-address assertions; loopback alias/trailing-dot/mapped IPv4, strict tailnet boundaries, malformed private strings, custom/public, protocol/hash/userinfo/query/path, mobile scope, unspecified/port0 and no network effects.

### E4-F27 · E4-S4 · src/shared/node-bounded-file-reader.ts

[src/shared/node-bounded-file-reader.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/node-bounded-file-reader.ts:1) · lines 1–134 · SHA256 `2cffa451b72d059226e0c2d4b6d2a5203cb8ddafb358d5e828dcd3436d197ecb`.

Owner: Calling filesystem host; path functions own fd, handle overload leaves caller fd open

Sync validates max nonnegative safe integer before open; async path opens first then handle variant validates inside try/finally. fstat/stat size must safe integer>=0 and <=max; no regular-file/symlink/ownership guard. Allocates initial size, positioned reads until EOF, returning truncated-to-read buffer and ORIGINAL stats; handles shrink. Once full probes1 byte, rejects if offset>=max otherwise grows at least64KiB/double but <=max, copies probe, repeats to capture growth. Exact max at EOF succeeds, max+1 rejects NodeFileReadTooLargeError(observed,max), max0 admits empty only. Path wrappers always close; close failure can replace prior success/error. OS allocation/read/stat exceptions propagate, giant safe limits can still allocation-fail.

Original assertion associations: [src/shared/node-bounded-file-reader.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/node-bounded-file-reader.test.ts:1).

Exact later obligations:

- Port node-bounded-file-reader.test.ts; exact/max0/growth/shrink/sparse/short reads and initial invalid size, async-open-before-validation versus sync-validation-before-open, directory/symlink/read/close errors and original stats after growth.

### E4-F28 · E4-S4 · src/shared/node-bounded-json-stringify.ts

[src/shared/node-bounded-json-stringify.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/node-bounded-json-stringify.ts:1) · lines 1–165 · SHA256 `fcadabc537aa3125d1ee514026ecca5b8e2a76aabca7e29f08d3d35008001622`.

Owner: Caller memory and JS serialization semantics; getters/toJSON can execute caller object code

maxBytes must nonnegative safe integer. JSON.stringify with replacer counts punctuation, keys and normalized indentation while traversing, throws JsonStringifyByteLimitError as soon as accounted bytes>max; actual final UTF8 length is checked again and returned. Undefined/function/symbol omitted in objects/root and null in arrays, root omission=>TypeError; boxed Number/String/Boolean valueOf normalized, finite numbers String length, nonfinite null. String byte count handles JSON escapes, lone surrogate six-character escape and pair4-byte UTF8; rawJSON uses byteLength where platform supports. Indent numeric floor/clamp0..10 or first10 string UTF16 units, passed original space to JSON.stringify. Object tracking uses WeakMaps reset on emitted container; repeated references follow native stringify and cycles/BigInt/getters/toJSON exceptions propagate. No independent depth guard or protection from arbitrary toJSON side effects.

Original assertion associations: [src/shared/node-bounded-json-stringify.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/node-bounded-json-stringify.test.ts:1).

Exact later obligations:

- Port node-bounded-json-stringify.test.ts; exact UTF8/escape/indent limits, sparse arrays/undefined/boxed/rawJSON, cyclic/BigInt/toJSON/getter/repeated references, negative/NaN/infinite space and max, verify early count agrees with final native bytes without weakening native exceptions.

### E4-F29 · E4-S4 · src/shared/secure-path-windows-acl.ts

[src/shared/secure-path-windows-acl.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/secure-path-windows-acl.ts:1) · lines 1–150 · SHA256 `9348091f365c613f86da01beffd0ead49c5e1f8d6468a41518f846899e619802`.

Owner: Invoking Windows current-user filesystem and System32 tools; no selected remote host implicit mutation

SID lazily cached including null failure; invokes SystemRoot||WINDIR||C:\\Windows/System32/whoami.exe /user /fo csv /nh with5s timeout, naive split quoted CSV second column, no SID format validation. Async best-effort no SID=>return; PowerShell absolute path, NoProfile/NonInteractive/ExecutionPolicy Bypass, target/SID/directory separate args, windowsHide5s; callback errors ignored, synchronous execFile throw not caught. Sync wraps execFileSync and returns true on success, false on all error/no SID.
PowerShell disables inheritance without preserving inherited entries, removes all explicit access rules, grants current SID, SYSTEM and Administrators FullControl (directory inherit container/object). Verification demands protected ACL and every remaining rule allowed SID/Allow/FullControl; does NOT verify all three expected identities actually exist. OS permission/translation behavior is execution boundary.
CRITICAL caller contract: secure-file.ts invokes sync ACL on temp but ignores false and still rename publishes; final false merely avoids caching. Thus comments promising restriction before publication exceed actual fail-open behavior. Read/directory hardening optimistically caches async attempt including failures/no SID; Windows directory cache path-only can miss recreation. POSIX chmod throws rather than false. Require explicit secure-publication target decision, not claim Windows confidentiality from attempted ACL.

Called source anchors: [src/shared/secure-file.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/secure-file.ts:1).

Original assertion associations: [src/shared/secure-file.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/secure-file.test.ts:1).

Exact later obligations:

- Port secure-file.test.ts Windows mocked assertions and inspect ACL-script argument/verification tests; add whoami malformed/missing/cached-failure, async vs sync errors, unexpected/deny/incomplete ACL sets, same-path recreation and failed temp/final restriction publication characterization.
- After source gate, real disposable Windows ACL fixture directory with inherited broad ACL: prove publication fails closed for intended rewrite, no real accounts/credentials, and correct SYSTEM/Admin/current-user rights.

### E4-F30 · E4-S4 · src/shared/secure-path-hardening-cache.ts

[src/shared/secure-path-hardening-cache.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/secure-path-hardening-cache.ts:1) · lines 1–74 · SHA256 `06ce6342d4cacf1b436ccb0886506da1ae09ad4d7f91cc54233f9c005ff0be7d`.

Owner: Per-process in-memory LRU only; cached value is caller claim, not fresh permission proof

get promotes existing entry to newest; missing returns undefined. set computes UTF8 key bytes, deletes same-key old entry BEFORE admission; rejects key>per-key or total cap or maxEntries<=0; evicts oldest until entries<maxEntries and total fits, inserts accounting. No runtime validation for NaN/fraction/negative bounds beyond comparisons. Values not size-bounded; only keys counted. delete/clear update retained byte count; state returns entries/keyBytes and oldest-to-newest path array. No filesystem stat/ACL or time expiration occurs here.

Original assertion associations: [src/shared/secure-path-hardening-cache.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/secure-path-hardening-cache.test.ts:1), [src/shared/secure-file.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/secure-file.test.ts:1).

Exact later obligations:

- Port secure-file cache bound/drift assertions or dedicated cache suite if located; exact byte/entry caps, multibyte, overwrite-too-large removes old, LRU get eviction, value undefined, zero/NaN/fraction bounds and no filesystem effects.

## Assertion bodies and execution handoff

**Zero assertions were executed.** The following bodies were read, with their actual assertion limits rather than titles used as evidence. The launch suite was read only through line 330; other listed records cover their full declared file. Leaf-only records were read by the leaf and reviewed through its report by the lead; they are not presented as independent complete lead rereads.

| Assertion body | Read range / reviewer | What the assertions establish |
| --- | --- | --- |
| [src/shared/github/repository-identity-key.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/github/repository-identity-key.test.ts:1) | 1–14; lead | Asserts GitHub.com host trimming/case collapse and nondefault GHES:port isolation; no owner/repo whitespace or reverse extraction assertion. |
| [src/shared/json-text-structure-limit.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/json-text-structure-limit.test.ts:1) | 1–40; lead | Exact7 token/depth3 acceptance, one-less cap typed errors, escaped string structure ignored; invalid limits/invalid grammar not covered. |
| [src/shared/node-bounded-file-reader.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/node-bounded-file-reader.test.ts:1) | 1–103; lead | Mock FileHandle stable read/close, oversize before read, within-limit growth, zero stat proc-like growth, beyond-limit typed error and stat/read failure close; no sync/real filesystem race/close failure. |
| [src/shared/node-bounded-json-stringify.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/node-bounded-json-stringify.test.ts:1) | 1–109; lead | Native exact byte/string equality with Unicode/lone surrogate/omissions/repeated references, indent normalization, early toJSON visitation stop, toJSON once, root large string, invalid max and undefined root; rawJSON branch returns early if unavailable, never universal PASS. |
| [src/shared/secure-path-hardening-cache.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/secure-path-hardening-cache.test.ts:1) | 1–61; lead | UTF8 exact key cap, one-over rejection preserving a DIFFERENT key, get-promoted LRU entry eviction and total-byte eviction; same-key failed overwrite and malformed bounds remain additions. |
| [src/shared/remote-pairing-address.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/remote-pairing-address.test.ts:1) | 1–99; lead | Classifier table including mapped IPv4/localhost aliases; display host/IPv6 brackets, invalid protocol/hash/unspecified/port0 and mobile grant rejection. Test titled blocks absolute localhost actually asserts ok:true with loopback, so preserve assertion body not title. |
| [src/shared/child-process/run-process.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/child-process/run-process.test.ts:1) | 1–239; lead | Hidden shell:false platform routing and .cmd quote parity corpus; real Node fixture sync timeout vs deliberate signal, failure code, output prefix/exact cap, unkillable timeout/abort, stdin EPIPE, pre-abort no spawn and termination callback. POSIX tree fixture asserts descendant TERM marker (not full descendant inventory/exit); skips Windows. |
| [src/shared/child-process/run-process-termination-failure.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/child-process/run-process-termination-failure.test.ts:1) | 1–193; lead | Mocked tree helpers: exactly-once close reporter, live-child error waits later close reporter, false barrier2s+10s settlement, forced verified no-close, root-never-reports leaves callback uncalled, early root exit, deferred error and object barrier root SIGKILL. No actual OS termination proof; one branch skips Windows. |
| [src/main/startup/hydrate-shell-path.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/startup/hydrate-shell-path.test.ts:1) | 1–294; lead | Custom spawner exact results, cache/force/rejected queue, no-shell, returned error classes; fake10s kill/listener cleanup; launch PATH snapshot/probe marker/Windows key casing; merge new and reordered existing paths. Mock result propagation is not proof real profile failures are correctly classified. |
| [src/shared/remote-runtime-socket-liveness.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/remote-runtime-socket-liveness.test.ts:1) | 1–64; lead | Fake-time resume grants fresh probe and eventual dead once; inbound activity clears resumed probe. Not complete ping throw/backward clock/cadence/close matrix. |
| [src/cli/runtime/launch.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/cli/runtime/launch.test.ts:1) | 1–330; lead | Four macOS-only fixtures: old owner exit waits replaced bundle and expected ready message; wrong version failure/no retry; spawn failure persisted before reject; no-ready60s triggers TERM and failure/no retry. Uses fake children and temp bundle/plist, not actual updater or IPC authentication. |
| [src/shared/secure-file.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/secure-file.test.ts:1) | 1–467; lead | Mocks SID/PowerShell command and script assertions, inheritance bits, best-effort ACL failure, file/directory LRU/drift, async reads vs sync temp/final writes, failure retries and nonWindows no PowerShell, actual temp POSIX chmod branches. Lines330-364 explicitly expect writeSecureFile not to throw when all sync ACL calls deny: confirms fail-open API characterization, not confidentiality. POSIX cases skip Windows. |
| [src/shared/child-process/process-tree-termination.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/child-process/process-tree-termination.test.ts:1) | 1–160; lead | Mock Windows taskkill waits close0, nonzero fallback false, skips reaped PID taskkill, diagnostic observer; POSIX mocked nonquiescent deadline false and negative group signal. No actual recycled PID or real Windows descendants. |
| [src/main/startup/windows-shell-path-ownership.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/startup/windows-shell-path-ownership.test.ts:1) | 1–50; lead | Drive/UNC normalization and trailing roots, PATH/Path full baseline restoration, external appended segment preservation and first-effective case key when duplicates. Not external removal/reorder preservation or actual shell. |
| [src/main/claude/hook-service.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/claude/hook-service.test.ts:1) | 1–665; leaf | encoded Windows lifecycle hook; install preserves Bedrock/user settings and sweeps old managed entries; statusLine install/user-slot/remove/opt-out-marker; CLAUDE_JOB_DIR guard ordering; remote SFTP shape + no statusLine + 0o755; parse-error status; OpenClaude isolation local+remote |
| [src/main/gemini/hook-service.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/gemini/hook-service.test.ts:1) | 1–191; leaf | stale PreToolUse swept; user hooks preserved; win32 encoded launcher; exact event set |
| [src/main/antigravity/hook-service.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/antigravity/hook-service.test.ts:1) | 1–370; leaf | bundle event set/matchers; PreToolUse ask decision incl missing-script; win32 wrappers env; stale entries replaced; user bundle preserved; no policy-overriding decisions |
| [src/main/amp/hook-service.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/amp/hook-service.test.ts:1) | 1–140; lead+leaf | install source invariants; user plugin never overwritten; remove only managed; partial for missing handlers |
| [src/main/cursor/hook-service.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/cursor/hook-service.test.ts:1) | 1–326; leaf | top-level command schema; version 1; protocol JSON incl empty stdin and missing script; curl failure off stdout; win32 cmd+Git Bash branches |
| [src/main/droid/hook-service.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/droid/hook-service.test.ts:1) | 1–123; leaf | event set + matchers; no userData leak; win32 encoded launcher; hooksDisabled partial |
| [src/main/command-code/hook-service.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/command-code/hook-service.test.ts:1) | 1–212; leaf | event set + .* matchers; env recovery script; stale endpoint no-clobber via live HTTP; missing event partial |
| [src/main/grok/hook-service.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/grok/hook-service.test.ts:1) | 1–547; leaf | GROK_HOME guard; user-cleared empty config respected; remnant removal with non-hook key; symlink write-through async+sync; reinstall-after-quit; GROK_HOME env wins; matcher never bare star |
| [src/main/copilot/hook-service.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/copilot/hook-service.test.ts:1) | 1–313; leaf | version forced; disableAllHooks cleared; stale/disabled partial states; remove only managed; no file creation when unused; nested user hooks untouched; malformed JSON error status |
| [src/main/hermes/hook-service.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/hermes/hook-service.test.ts:1) | 1–269; leaf | plugin files + enablement; other plugins preserved; malformed list normalized; not-enabled partial; real CLI guarded; Python POST normalization bounds |
| [src/main/devin/hook-service.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/devin/hook-service.test.ts:1) | 1–257; leaf | events no tool matcher; unrelated keys preserved; JSONC comments preserved; read_config_from detail; win32 wrapper; not_installed/partial; APPDATA path |
| [src/main/kimi/hook-service.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/kimi/hook-service.test.ts:1) | 1–92; leaf | not_installed pre-install; block+script install; user config byte round-trip; single block on reinstall |
| [src/main/codex/hook-service-managed-install.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/hook-service-managed-install.test.ts:1) | 1–417; leaf | in-flight system config.toml serialization; permission_request trust key; per-account home isolation; _managed dropped; win32 launcher branches; curl UTF-8 + spaced worktreeId; Orca userData isolation |
| [src/main/codex/hook-service-trust-grant.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/hook-service-trust-grant.test.ts:1) | 1–407; lead+leaf | RPC-granted hashes authoritative; byte-stable repeat; ledger retry; symlink+user trust rebase; mode preserved; binary stamp invalidates ledger; no duplicate trust keys; exact-byte restore after RPC failure |
| [src/main/codex/hook-service-legacy-cleanup.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/hook-service-legacy-cleanup.test.ts:1) | 1–344; leaf | legacy system ~/.codex hooks sweep preserving user + other _managed; 30k-list cleanup; legacy profile file removed/stripped; malformed runtime hooks.json still cleans on remove; _managed sanitized on remove; duplicate-representation cleanup keeps runtime hooks+trust |

Existing assertions still requiring body review in this handoff:

- [src/main/codex/hook-service-wsl-runtime.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/hook-service-wsl-runtime.test.ts:1): 704 lines; present for completeness; body not read by this leaf
- [src/main/codex/hook-service-concurrent-launch-install.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/hook-service-concurrent-launch-install.test.ts:1): 154 lines; present for completeness; body not read by this leaf
- [src/main/codex/hook-service-runtime-trust-repair.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/hook-service-runtime-trust-repair.test.ts:1): 259 lines; present for completeness; body not read by this leaf
- [src/main/codex/hook-service-user-hook-mirroring.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/hook-service-user-hook-mirroring.test.ts:1): 581 lines; present for completeness; body not read by this leaf
- [src/main/codex/config-toml-trust-hook-removal.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/config-toml-trust-hook-removal.test.ts:1): Read assertion bodies and run/port unchanged before implementing the named Codex trust/TOML/mirror internal seam; filename is navigation only.
- [src/main/codex/config-toml-trust-paths.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/config-toml-trust-paths.test.ts:1): Read assertion bodies and run/port unchanged before implementing the named Codex trust/TOML/mirror internal seam; filename is navigation only.
- [src/main/codex/config-toml-trust-hook-read.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/config-toml-trust-hook-read.test.ts:1): Read assertion bodies and run/port unchanged before implementing the named Codex trust/TOML/mirror internal seam; filename is navigation only.
- [src/main/codex/config-toml-trust-hook-upsert.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/config-toml-trust-hook-upsert.test.ts:1): Read assertion bodies and run/port unchanged before implementing the named Codex trust/TOML/mirror internal seam; filename is navigation only.
- [src/main/codex/codex-config-mirror.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/codex-config-mirror.test.ts:1): Read assertion bodies and run/port unchanged before implementing the named Codex trust/TOML/mirror internal seam; filename is navigation only.
- [src/main/codex/config-settings-promotion.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/config-settings-promotion.test.ts:1): Read assertion bodies and run/port unchanged before implementing the named Codex trust/TOML/mirror internal seam; filename is navigation only.
- [src/main/codex/config-toml-trust-api-parity.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/config-toml-trust-api-parity.test.ts:1): Read assertion bodies and run/port unchanged before implementing the named Codex trust/TOML/mirror internal seam; filename is navigation only.
- [src/main/codex/config-toml-trust-hash.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/config-toml-trust-hash.test.ts:1): Read assertion bodies and run/port unchanged before implementing the named Codex trust/TOML/mirror internal seam; filename is navigation only.
- [src/main/codex/config-toml-trust-key.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/config-toml-trust-key.test.ts:1): Read assertion bodies and run/port unchanged before implementing the named Codex trust/TOML/mirror internal seam; filename is navigation only.
- [src/main/codex/config-toml-trust-project.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex/config-toml-trust-project.test.ts:1): Read assertion bodies and run/port unchanged before implementing the named Codex trust/TOML/mirror internal seam; filename is navigation only.
- [src/main/runtime/rpc/e2ee-crypto.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/runtime/rpc/e2ee-crypto.test.ts:1): Located exact existing suite; read bodies before running/porting this related boundary.
- [src/shared/ws-outbound-backpressure-queue.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/ws-outbound-backpressure-queue.test.ts:1): Located exact existing suite; read bodies before running/porting this related boundary.
- [src/shared/child-process/windows-command-line.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/child-process/windows-command-line.test.ts:1): Located exact existing suite; read bodies before running/porting this related boundary.
- [src/shared/child-process/windows-command-line.win32.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/child-process/windows-command-line.win32.test.ts:1): Located exact existing suite; read bodies before running/porting this related boundary.
- [src/main/serve-update-handoff.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/serve-update-handoff.test.ts:1): Located exact existing suite; read bodies before running/porting this related boundary.
- [src/main/serve-update-handoff.app-environment.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/serve-update-handoff.app-environment.test.ts:1): Located exact existing suite; read bodies before running/porting this related boundary.

The companion JSON contains **77 exact baseline command invocations**, including the 28 previously preserved commands, newly read suites and named related suites. These commands are for a coordinator-approved isolated pinned baseline checkout with prepared pinned dependencies/native runtime; they must not run in the read-only reference or against live homes. The native-runtime preparation gate remains coordinator-owned. For example, the stored command form is `pnpm exec vitest run --config config/vitest.config.ts <exact source test path>`; JSON contains each concrete path.

After baseline characterization, run the unchanged candidate assertion ports before implementing each capability and record behavioral RED. Compile/setup failure is not RED; skipped platform tests, optional rawJSON branches, missing Python/provider early returns and source-shaped mocks are not parity PASS. Then implement only after the full audit gate and obtain integrated GREEN. Preserve the accepted S1 and 30 reused skills/terminal/workspace contracts and all previous formatter/account/VM obligations.

Real execution matrices remain:

- macOS disposable Keychain/permissions
- Windows named-pipe/ACL/CONIN$/batch/taskkill fixture tree
- Linux Unix socket/process groups/AppImage probe mocks
- WSL distro/DrvFs ownership
- generated-key loopback old/current protocol peers
- fixed timezone DST/leap-day schedules
- Disposable Codex app-server version/capability/ledger and clean homes; no live credentials
- POSIX SSH SFTP OpenSSH extension/fallback/timeouts with generated hook payloads
- Real installed packaged upgrade readiness/signature tests owned by E5, no live preview replacement in audit

## Shared ownership and remaining gap classes

- **E3:** Desktop sender/frame subscription lifetime and remote environment controller generations; E4 encrypted subscription failure and queue contract differs. Reuse source evidence; whole E3 acceptance is root-owned. Evidence: [docs/migration/audit-closure/e3-bridge/report.md:29](/Users/carlos/Documents/Drogon-rewrite/docs/migration/audit-closure/e3-bridge/report.md:29).
- **E5:** WSL manager/launch/recovery/link/deps and guest ownership; E4 Codex hook install plan supplies host-specific paths/trust. E5 remaining guest/manager assertion source omissions remain E5-owned. Reuse bounded source evidence, not whole E5 acceptance. Evidence: [docs/migration/audit-closure/e5-platform/report.md:116](/Users/carlos/Documents/Drogon-rewrite/docs/migration/audit-closure/e5-platform/report.md:116).
- **E5:** Accepted install/build source boundaries and publication authority; E4 supervisor observes plist and IPC only. Source acceptance reused; real package/signature/updater/installed app tests still mandatory. Evidence: [docs/migration/audit-root-followup-review.md:90](/Users/carlos/Documents/Drogon-rewrite/docs/migration/audit-root-followup-review.md:90).

| Preserved class | Current source disposition | Remaining obligation |
| --- | --- | --- |
| S2-transitive | Named schema/cache helpers now source-characterized; accepted normalization evidence reused. | Run original/schema edge assertions and port normalized null/omission/GHES behavior. |
| S3-transitive | Named crypto/abort/limits/subscription/process/supervisor/bundle callers and finite implementations now characterized. | E3 sender/window lifecycle and E5 installed-update/WSL ownership remain linked shared boundaries; crypto/OS/provider and mixed-version runtime execution not proven. |
| S4-provider-effects | All14 services plus PATH now characterized; corrected lead-reviewed leaf integrated. | Provider RPC/actual generated scripts, keychain/provider disagreements from accepted report, unsupported native Windows SSH, Codex internal seam assertion review and host effects remain named obligations. |
| S4-persistence | Classifier/bounded IO/serializer/Windows ACL/cache bodies now characterized. | ACL fail-open target decision and real platform admission/permission/late effects required. |
| S5-review | Resolved by root bounded acceptance117-140; previous source class preserved verbatim for traceability. | Original formatter/null/error/output assertion suites and accepted S1/30 reused contracts remain unchanged. |
| execution | Unchanged execution debt; zero tests run. | Approved isolated baseline then candidate behavioral RED, unchanged assertion ports, implementation after audit gate, integrated GREEN and real host/runtime acceptance. |
| liveness | Root explicit decision in review: source false on permission exception must not become candidate exited. | live/unverifiable/exited fixtures across local status, process barriers, SFTP/SSH/WSL/subscriptions; loss of contact never destructive cleanup proof. |

No new source capability may be dropped because it is unsupported or externally owned. Native Windows SSH hooks remain explicitly unsupported at this source boundary; existing WSL support is different. Codex app-server, settings promotion, ledger/database and TOML section helpers have named caller contracts here; their complete internal behavior is not inferred merely from imports. Their precise original suites and provider/OS fixtures remain mandatory before the corresponding implementation wave.

## Lead corrections to the preserved leaf

- Generic local JSON writer mode preservation is opt-in; Windows ACL retry belongs script write, not JSON write.
- Remote10s timeout rejects and leaves late-effect uncertainty; it is not successful fail-open nor rollback. Plain rename fallback is conditional on unsupported OpenSSH extension.
- OpenClaude skips statusLine install but inherited refresh/remove can touch an existing managed statusLine.
- Codex default status may create directory; install can execute app-server/WSL helpers and alter system config/trust. Lead read trust identity/TOML/mirror/reconciliation boundaries beyond leaf omission.
- Grok sync remove lacks async peer gate; raw-byte recheck before sync write is not atomic concurrency proof.
- Leaf E3/E5 references are bounded shared source evidence, not blanket acceptance of all WSL/relay source or runtime behavior.
- Provider disable-policy and plugin permission-answer differences are retained; common hook transport does not homogenize policy.

Leaf source: [docs/migration/audit-closure/e4-cli/leaf/hook-boundaries.md](/Users/carlos/Documents/Drogon-rewrite/docs/migration/audit-closure/e4-cli/leaf/hook-boundaries.md) and [docs/migration/audit-closure/e4-cli/leaf/hook-boundaries.json](/Users/carlos/Documents/Drogon-rewrite/docs/migration/audit-closure/e4-cli/leaf/hook-boundaries.json). Neither leaf file was overwritten during integration. This lead report's qualifications govern any broader leaf shorthand.

## Child settlement and handoff

Approved child Run `run_e436c9848848`, Task `task_d9f6b4cea867`, Dispatch `ctx_569264623570`, exact retained terminal `term_fb38efd1-70b7-45a4-8334-7ce638505da3`; requested `opencode --model alibaba-token-plan/deepseek-v4-flash-0731 --auto`, verified depth 2, no descendants. Worker-start receipt `5d159406-3dfe-446f-a701-87ed6eba764d`; depth receipt `bcc75c60-588b-46a2-8a1b-9f86c6929813`; succeeded completion `msg_5903ced7c7a5`; official release `bf530cc6-7811-407b-8bc4-70fff98a62a7`; acknowledgement `b5fb0e43-7fdc-4a98-8c85-70811d3c2daf`. The external terminal was retained with processAction none, not killed; there are zero unsettled owned children.

Artifact verification passed: exact frozen path order/set, all 136 current source/assertion file and range hashes, seven document evidence records, all 77 referenced baseline suite paths, and all 14 preserved prior artifact hashes matched. This is document/source identity verification, not execution of those suites.

Only this report and its JSON were written by the lead; the approved leaf wrote its two disjoint hook-boundary artifacts. Existing E4 candidates, central ledgers, product files, source checkout, profiles and credentials were preserved. No installs, Git mutations, commits, pushes or PRs occurred. Root owns final acceptance and the Astra-to-Sol implementation gate.
