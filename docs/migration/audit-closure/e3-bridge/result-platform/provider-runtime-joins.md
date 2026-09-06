# Provider runtime and request-guard joins

Finite source handoff for **PI-JOIN-RUNTIME** and **PI-JOIN-REQUEST-GUARD** only. Both now have concrete immediate local contracts; acceptance belongs to root. No tests, native calls, providers, credentials, installs, Git operations or children ran. Audit remains **10/12 = 83.3%, delta 0, medium-low confidence**. Next milestone is root review and E3/E5 consolidation; no defensible ETA, flexible24-hour target high risk.

The [machine-readable contracts](provider-runtime-joins.json) contain all branches, exact raw source/range SHA256, read status, original assertion associations, inherited47 gates and execution obligations. Whole-file hashes identify current bytes, not behavior. Range digests concatenate raw inclusive lines with their original terminators (`bytes.splitlines(keepends=True)[first-1:last]`); root verifies the supplied source pin `c97906287bb7a390b25e2025b600d9fb3c25d9c3`.

## Scope and accepted reuse

- Preserve the original21 groups/126 methods, all9037 original test-file allocations/46 packages, and frozen provider/final-local artifacts. This supplement has no new census or smaller acceptance denominator.
- The [root provider review](../../../e3-provider-inputs-root-review.md) accepts13 provider contracts at supplied revision2ba025e. Its raw retry duration/null versus result timestamp, unclamped classifier, and keychain-only preview-matching corrections govern unchanged. Provider auth/parsers are not repeated.
- **SyncDatabase** reuses the concrete [UIG-OPENCODE Database body](../consumer-ingestion-final.json) at `#/ingestionMethods/16`, root-accepted in `audit-root-followup-review.md:320`; current source digest is retained. Queue/credential state reuses accepted **PI-TRANSPORT**, joined here to actual registration. The accepted cycle/cache/publication at7e7544a stays unchanged.
- Account launch materialization is a separately delivered dependency awaiting root integration; neither launch preparation function is certified here. Existing diagnostic redaction/persistence limitations remain OBS-COL-INTEGRATION/OBS-COL-06. Certificate/UI/route internals and external provider behavior are outside these two joins.

## Concrete contracts

### PJ-COMMAND

Owner: Executing Node host filesystem/environment; options can simulate platform selection but do not change host path implementation.

command.ts re-exports the shared implementation. Claude/Codex wrappers specialize the name only. platform defaults to process.platform; pathEnv uses nullish fallback to PATH, then Path, then null, so explicit empty string suppresses environment PATH whereas null does not. PATH entries use imported host delimiter, are trimmed and empty entries removed.

Each PATH directory is scanned before version-manager fallbacks. Windows candidates prefer .cmd, .exe, .bat, bare; POSIX bare. stat must report file and POSIX access X_OK must succeed; Windows does not require X_OK. Failures skip candidates. stat follows symlinks. No match returns the bare command string, not null or a proved unavailable result.

Nvm version directories are sorted numerically descending with reverse lexical tie-break; installed components use parseInt with nonnumeric becoming zero. Default-alias preference follows at most ten hops and stops cycles. Only strict numeric version-prefix tokens select installed versions; missing/uninstalled/system/node/stable/unresolvable aliases leave newest-first fallback. Preferred version is a preference, not an exclusive restriction. Remaining directories cover volta/asdf/fnm/mise/user-local and platform pnpm/npm/Yarn/bun.

withCliRuntimeOnPath returns the original env object for relative commands, absent/unrunnable sibling node or an already-leading exact directory. Otherwise it clones, prepends the command directory and removes exact duplicate directory entries. It does not resolve symlink target runtime, verify ABI/version or run the selected binary.

Windows pairing chooses the first defined case-insensitive PATH key in object enumeration order, else Path; splits/joins with semicolon and deletes other PATH-key casings only on the clone branch. The already-leading early return preserves existing twins. POSIX uses PATH and host delimiter; comparisons are exact strings. options.platform does not change imported isAbsolute/dirname semantics.

Source: [src/main/codex-cli/command.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex-cli/command.ts:1); [src/shared/node-cli-command-resolution.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/node-cli-command-resolution.ts:1). Complete bounded ranges and hashes are in JSON.

### PJ-LOCK-IDENTITY

Owner: Executing host, never the coordinator PID namespace; POSIX current UID token and native OS process-incarnation queries.

Host identity promise and boot identity are cached, including fallback outcomes. POSIX first attempts a durable UUIDv4 token beneath the current UID's /var/tmp directory: directory/file lstat must match UID and prohibit group/other permission bits; token must be regular and valid. Draft is wx/0600, published with hard link, then best-effort unlinked and read back; no fsync. Invalid existing EEXIST token is not overwritten.

Linux durable-token failure falls back to process runtime UUID, not machine-id. macOS tries durable token then a one-second native hardware-UUID query, then runtime fallback. Windows uses a one-second registry identity query then runtime fallback. Only checked-in code was read; no identity/credential value was accessed.

Linux process identity combines boot identity, PID namespace and /proc start field after the last closing parenthesis; missing namespace/boot has an unknown marker and start field is not numerically validated. ENOENT means null; other failures yield a self runtime identity or undefined for a foreign process. Proc/filesystem operations lack their own elapsed deadline.

Windows CIM creation-time query has five-second timeout: literal missing maps null; other nonempty output becomes the incarnation string. Failures use kill(pid,0): ESRCH null; live/unknown foreign undefined; self may use runtime fallback. Self result is cached, foreign PIDs queried anew.

macOS/other ps query uses one-second timeout and fixed C locale; nonempty start/command text plus boot identity forms identity, empty means null. Fallback distinguishes ESRCH from unavailable inspection. Same PID is never enough to establish same incarnation; undefined is unverifiable, not exited.

Optional execution-scope fingerprint is composed with host identity. Recovery checks host equality before local PID comparison; a shared-home lock from another host must not be reinterpreted as a local dead PID.

Source: [src/main/agent-hooks/managed-hook-owner-identity.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/agent-hooks/managed-hook-owner-identity.ts:1). Complete bounded ranges and hashes are in JSON.

### PJ-LOCK-PROTOCOL

Owner: Home-scoped filesystem lock, fenced by executing host/process incarnation and in-process active token sets.

Acquisition creates the home .orca directory, checks cancellation, resolves host, cleans orphan records and resolves self identity before setting its default ten-second contention deadline. No private parent mode is requested. Setup IO/native queries are outside that deadline; success path can acquire after elapsed deadline because timeout is checked on contention. Polling/abort does not bound a hung filesystem operation.

Each attempt writes a wx/0600 draft, renames to a token owner record and hard-links the canonical lock. EEXIST is contention; other errors propagate. Successful publication marks active owner. Finally unlinks draft and removes unlinked owner records; draft cleanup can throw after canonical publication, leaving a lock although acquisition rejects. No fsync/durable-commit claim.

Canonical record requires nonempty host/process identity, token consistency and positive safe integer PID. Unknown/malformed canonical and foreign host fail fast; unavailable process inspection fails fast. Confirmed absent/different incarnation or own PID with inactive token permits attempted stale recovery, not a generic kill-zero test.

Recovery renames the owner witness into a claim, writes claimant metadata and fences with active claim tokens. Concurrent claim contention remains active; missing/ambiguous witnesses and foreign/unverifiable claim owners are not guessed dead. Dead claims can be recovered. After claim, canonical token is rechecked: missing/different token counts removed without deleting a replacement; unknown canonical or non-ENOENT unlink failure is unverifiable.

withManagedHookInstallLock releases in finally after callback success or rejection and deactivates owner regardless. Release failure warns and does not turn successful callback into failure; residue may remain for later recovery. Cancellation after acquisition but before callback releases; cancellation after callback starts does not automatically cancel its work. Callback effects can precede a rejection; the lock adds no transaction rollback.

Source: [src/main/agent-hooks/managed-hook-install-lock.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/agent-hooks/managed-hook-install-lock.ts:1); [src/main/agent-hooks/managed-hook-lock-records.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/agent-hooks/managed-hook-lock-records.ts:1); [src/main/agent-hooks/managed-hook-lock-claims.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/agent-hooks/managed-hook-lock-claims.ts:1). Complete bounded ranges and hashes are in JSON.

### PJ-SQLITE

Owner: Executing host native node:sqlite; existing accepted UIG-OPENCODE Database body reused.

Accepted Database is the default alias of SyncDatabase wrapping dynamically loaded DatabaseSync, prepare/all/get/run, exec, pragma and close; options readonly/fileMustExist/timeout are forwarded/handled by that body.

fileMustExist checks before native open, with a TOCTOU gap; statement LRU is capped at256, pragma/wildcard excluded from caching, DDL regex clears cache before exec, close clears cache and closes driver.

Missing native module/open/query/close failures propagate. Simple pragma returns first column of first row or undefined. Native schema, WAL, locks, driver-version behavior and materialization require fixtures; accepted scanner outcomes do not assert every wrapper branch.

Source: [src/main/sqlite/sync-database.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/sqlite/sync-database.ts:1). Complete bounded ranges and hashes are in JSON.

### PJ-WINDOWS-KILL

Owner: Executing Windows host; Electron app metrics when available, empty set in unavailable/non-Electron paths; no SSH exit inference.

Invalid/nonpositive/noninteger PID resolves void. Guard refuses a PID listed in current Electron Chromium metrics, records refusal and resolves without launching taskkill. Metrics are filtered to positive integers; missing API/failed metrics yields an empty set and therefore permits admission, with best-effort diagnostic logging. It is not a full ancestry or process-incarnation proof.

taskkill receives /pid String(pid) /T /F, timeout5000 and windowsHide. Native callback resolves regardless of error, including process-not-found/timeout. An execFile synchronous throw in the Promise executor rejects. Guard/breadcrumb code runs before Promise creation; a propagated logger failure there can throw synchronously.

No independent callback-settlement timer or confirmation of target exit exists here. Successful Promise means attempted/best-effort completion, not exited. Caller PI-PTY drain/hard-kill wait semantics remain its accepted separate contract; no reinterpretation of false/ignored termination evidence.

Source: [src/main/windows-process-tree-kill.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/windows-process-tree-kill.ts:1); [src/main/own-chromium-tree-kill-guard.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/own-chromium-tree-kill-guard.ts:1); [src/main/orca-chromium-process-pids.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/orca-chromium-process-pids.ts:1); [src/main/crash-reporting/self-initiated-tree-kill-log.ts:54](/Users/carlos/Documents/Drogon-mentu-session/src/main/crash-reporting/self-initiated-tree-kill-log.ts:54). Complete bounded ranges and hashes are in JSON.

### PJ-GUARD-BINDING

Owner: Electron main-process app/default session; does not intercept arbitrary Node fetch/child process or automatically guard every custom partition.

Foundation installs default onBeforeRequest guard early and registers anonymous app.on(login) forwarding webContents and defaultSession fallback into the accepted credential handler. No disposer/idempotence flag is returned. A later foundation failure leaves earlier registrations installed; retrying initialization could accumulate login listeners.

Later foundation queues applyElectronProxySettings, stores its Promise.then(success,rejection) in initialProxyApplicationReady and installs the default request guard again immediately. Rejection branch warns and resolves the barrier; it does not reset failed readiness. Early guard sees no policy state as ready, so no claim of fail-closed interception before initial policy enqueue.

Both serve and desktop launch paths await that barrier without checking a success result. A failed proxy application permits startup to proceed while this guard cancels requests for failed session state. Pending policy delays callback. Guard answers {} on ready and {cancel:true} on false, using either synchronous boolean or Promise.then; it adds no timeout, rejection handler or request-generation token.

Repeated onBeforeRequest registration and interaction with other listeners require an Electron fixture; source shows two registrations, not two independent guaranteed listeners. There is no default guard teardown in the named binding lifecycle and no login listener removal there. This statement is bounded to these owners, not a census of every app listener.

Source: [src/main/network/electron-proxy-request-guard.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/network/electron-proxy-request-guard.ts:1); [src/main/startup/main-process-ready-foundation.ts:52](/Users/carlos/Documents/Drogon-mentu-session/src/main/startup/main-process-ready-foundation.ts:52); [src/main/startup/main-process-ready.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/startup/main-process-ready.ts:1); [src/main/startup/main-process-preflight.ts:240](/Users/carlos/Documents/Drogon-mentu-session/src/main/startup/main-process-preflight.ts:240); [src/main/startup/main-process-runtime-launch.ts:119](/Users/carlos/Documents/Drogon-mentu-session/src/main/startup/main-process-runtime-launch.ts:119); [src/main/index.ts:108](/Users/carlos/Documents/Drogon-mentu-session/src/main/index.ts:108). Complete bounded ranges and hashes are in JSON.

### PJ-GUARD-STATE-AUTH

Owner: Accepted PI-TRANSPORT per-Session WeakMap queue and credential map, now joined to actual binding; original provider auth selection unchanged.

No state means ready true; failed or retired means false; pending waits for the latest queue tail, following replacement tails on resolve or reject. Only latest completion sets ready/failed. Queue serializes after prior rejection and retries three times with zero/100ms delays; this bounds attempts, not elapsed native setProxy/resolveProxy/close time.

Configured application awaits setProxy, then updates applied key/result and credentials before awaiting closeAllConnections; settled key follows close. A close failure can leave credentials installed and readiness failed. setProxy failure can preserve previous credentials. Later queued success can restore readiness; old-tail failure must not override newer pending state.

Release switches to system first, clears settled key and credentials before close, and clears applied key after close. Failure setting system can leave previous credentials. Retirement marks retired synchronously, queues release even though retired and finally clears credentials; it does not abort an in-flight apply, which can temporarily publish credentials before retirement completes.

Login uses isProxy and webContents.session when supplied, else the provided default Session. Credentials must exist for that exact Session and normalized bracket-stripped/lowercase host and exact port. Matching prevents default and invokes callback with stored decoded credentials; nonmatching leaves event/callback untouched. Malformed percent decoding retains raw value.

Credential match does not additionally validate origin URL, scheme, realm, readiness, retirement flag or request generation. Thus failed readiness blocks guarded requests but does not itself prevent answering a matching existing login challenge; during retirement/close failure credential availability can differ from request readiness. This is source composition, not a reproduced native race or credential success claim.

Node/CLI policy with no default resolver cannot acquire this Electron-session enforcement. Custom MiniMax/OpenCode provider partitions retain accepted own setup/cleanup/proxy limitations; central helper presence does not prove guard installation there. Root's duration/timestamp, nonclamping-classifier and keychain-only preview corrections remain unchanged.

Source: [src/main/network/proxy-settings.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/network/proxy-settings.ts:1); [src/main/network/bounded-proxy-application.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/network/bounded-proxy-application.ts:1); [src/main/network/electron-proxy-credentials.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/network/electron-proxy-credentials.ts:1); [src/main/network/electron-default-proxy-session.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/network/electron-default-proxy-session.ts:1). Complete bounded ranges and hashes are in JSON.

### PJ-GUARD-PARTITION-LIFETIME

Owner: Only adjacent managed browser Session guard install/remove seam, not certificate trust, UI, route transport or all partition behavior.

browser-manager module constructs the certificate controller and injects it into the manager; manager's optional forwarding calls controller install/remove, which delegates to BrowserCertificateRequestGuard. Its Set prevents duplicate installation for a Session; listener composes proxy readiness with the separate certificate decision. remove sets onBeforeRequest(null) and drops session trust/guard state.

Partition installer starts proxy application (unless app-wide proxy opted out), clears credentials and rethrows on proxy failure, and installs the composed guard once per configured partition. Already-configured calls still return the new proxy Promise. Opted-out route partition uses its separately owned transport, not proof app-wide proxy governs it.

Normal profile deletion removes persisted profile first, retires session synchronously and awaits proxy release/storage/cache cleanup under best-effort catch; it returns true despite cleanup failure. Security callbacks/guard intentionally remain because Electron Session and attached guests can survive profile deletion.

Failed-profile cleanup instead starts retirement, then clears user-agent and partition policies in a catch, then awaits retirement under warning catch. Clear invalidates proxy-application memo, removes configured marker, removes certificate guard and resets named permission/download handlers. Source does not cancel callbacks already awaiting readiness. Route cleanup also explicitly removes policies. These owners have different teardown contracts.

Guard removal is a local call, not proof a lingering guest cannot issue new requests. Pending callbacks may settle after removal; no native listener lifetime/callback-once evidence was executed. Certificate trust decisions, user-agent and permission implementations beyond this immediate ownership seam are outside the requested join, not reopened.

Source: [src/main/browser/browser-certificate-request-guard.ts:35](/Users/carlos/Documents/Drogon-mentu-session/src/main/browser/browser-certificate-request-guard.ts:35); [src/main/browser/browser-session-partition-policies.ts:72](/Users/carlos/Documents/Drogon-mentu-session/src/main/browser/browser-session-partition-policies.ts:72); [src/main/browser/browser-manager-state.ts:172](/Users/carlos/Documents/Drogon-mentu-session/src/main/browser/browser-manager-state.ts:172); [src/main/browser/browser-manager.ts:11](/Users/carlos/Documents/Drogon-mentu-session/src/main/browser/browser-manager.ts:11); [src/main/browser/browser-certificate-trust-controller.ts:29](/Users/carlos/Documents/Drogon-mentu-session/src/main/browser/browser-certificate-trust-controller.ts:29); [src/main/browser/browser-session-registry.ts:279](/Users/carlos/Documents/Drogon-mentu-session/src/main/browser/browser-session-registry.ts:279); [src/main/browser/browser-session-profile-retirement.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/browser/browser-session-profile-retirement.ts:1); [src/main/browser/browser-session-route-policies.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/browser/browser-session-route-policies.ts:1). Complete bounded ranges and hashes are in JSON.

## Original assertions and execution boundary

All files below remain whole-file baseline/port obligations. “Read” means assertion bodies were inspected, never executed here. The selected browser/startup ranges do not claim the rest of those suites was reread. Previously accepted SQLite/scanner and provider allocations remain referenced unchanged.

| Original suite | Actual evidence read |
| --- | --- |
| [src/main/codex-cli/command.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex-cli/command.test.ts:1) | Full assertion bodies: PATH precedence, non-runnable/directory skip, install fallbacks for Claude/Codex, bare fallback, batch dedupe, version-manager directories, sibling-runtime pairing, original-object no-op and Windows path casing/dedupe. Simulated platform options and temp files do not prove real Windows shell execution. |
| [src/shared/nvm-default-alias.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/nvm-default-alias.test.ts:1) | Full bodies: default vs newest, highest matching prefix, alias chain, missing/uninstalled/cycle/system fallback, eleven invalid tokens, numeric zero prefix and CLI outside preferred version. Preserve Windows skip for literal lts/* fixture. |
| [src/shared/cli-runtime-pairing-boundary.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/cli-runtime-pairing-boundary.test.ts:1) | Full bodies are lexical repository ratchets with allowlist: resolver/spawn regex without pairing is exactly allowlist; stale exceptions empty. Not behavioral runtime pairing or actual process launch evidence; preserve original allowlist unchanged. |
| [src/main/agent-hooks/managed-hook-owner-identity.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/agent-hooks/managed-hook-owner-identity.test.ts:1) | Full mocked assertion bodies: durable host token/no machine-id, shared endpoint differing host/namespace, boot/process changes, unavailable fallbacks, explicit composed identity, Windows creation-time/self-cache and macOS retry. No real registry/ps/proc/keychain execution. |
| [src/main/agent-hooks/managed-hook-install-lock.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/agent-hooks/managed-hook-install-lock.test.ts:1) | Full bodies: contention timeout, same-process serial callbacks, shared inode/two links, malformed legacy rejection, stale/reboot identities, foreign/unverifiable owner refusal, concurrent recovery, dead recovery claimant, missing witness, orphan/malformed preservation, replacement-owner late release, failed unlink then recovery and waiting abort. File is skipped on Windows. Its host-identity helper can touch /var/tmp outside test home: later baseline must use an isolated host/filesystem capsule; do not run against a personal profile. Same-process callbacks do not prove multiple real relays. |
| [src/main/windows-process-tree-kill.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/windows-process-tree-kill.test.ts:1) | Full bodies: exact native argv/options, callback error resolves, invalid PID suppresses exec. exec is mocked, so timeout settlement and actual death are unrun. |
| [src/main/own-chromium-tree-kill-guard.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/own-chromium-tree-kill-guard.test.ts:1) | Full bodies: mocked metrics/refusal and attempt breadcrumbs, guard integration into kill/account gates, metrics failure/coalescing; ancestry fixtures are retained assertions, not proof the narrow PID-membership guard traverses ancestry. |
| [src/main/network/electron-proxy-request-guard.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/network/electron-proxy-request-guard.test.ts:1) | Full five-case bodies: delay callback until ready, transient retry, third-attempt success, exhausted retries cancel, retired Session stays blocked. Fake listener/Session only. |
| [src/main/network/proxy-settings-session.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/network/proxy-settings-session.test.ts:1) | Full bodies: per-session/default isolation, memo and credential changes, coalescing/serialization/latest readiness, failed/retired state, pending retirement, cleanup failure credentials, slow environment vs explicit pin, fallback, failed-close reapply/release, retry exhaustion and untouched session. Synthetic native methods only. |
| [src/main/network/proxy-settings.test.ts:133](/Users/carlos/Documents/Drogon-mentu-session/src/main/network/proxy-settings.test.ts:133) | Read only133–219: decoded proxy authentication and default-session fallback; wrong host/port and nonproxy event do not answer. Other original assertions retained as unrun whole-file allocation, not claimed reread. |
| [src/main/startup/main-process-ready-phase-ordering.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/startup/main-process-ready-phase-ordering.test.ts:1) | Read1–152: mocked foundation/runtime/i18n/launch ordering and settlement; proxy startup checks are source-text includes/index order, not actual default-session registration/interception tests. |
| [src/main/browser/browser-session-partition-proxy-install.test.ts:235](/Users/carlos/Documents/Drogon-mentu-session/src/main/browser/browser-session-partition-proxy-install.test.ts:235) | Read235–253: clearing partition policies during pending proxy install prevents another proxy application; selected assertion body only, whole-file allocation retained. |
| [src/main/browser/browser-session-registry.test.ts:272](/Users/carlos/Documents/Drogon-mentu-session/src/main/browser/browser-session-registry.test.ts:272) | Read272–316: nondefault deletion true/profile absent and normal/delayed deletion retain request/security guards. Selected assertions only; no actual Electron lingering guest request. |

## Exact remaining acceptance

No unread immediate local implementation is retained **within these two named joins**. OS/SQLite/Electron native contracts are genuine execution boundaries; callback registration, type annotations and digest counts do not prove their behavior. The following are mandatory unrun work, in addition to every inherited BM/R/F and other gate; source quirks above are not silently designated fixes.

**PJ-T-COMMAND** — Sol runtime/CLI port and platform test owners after whole source acceptance.

- Run original command and nvm whole suites without weakened assertions plus original lexical boundary/allowlist; record skips separately.
- Behavioral RED then GREEN for explicit empty/null PATH, duplicate casing with already-leading runtime, extension precedence, denied/symlink/directory candidates, alias cycle/depth/invalid prefix and alias read errors; separate existing source quirks from approved corrections.
- Use disposable real Windows/macOS/Linux/WSL/SSH host fixtures to confirm delimiter/absolute-path semantics and sibling node actually used without relying on schema or regex; test unsupported runtime ABI separately. No personal installations.

**PJ-T-LOCK** — Sol hook/runtime filesystem and OS owners.

- Preserve both original identity/lock whole files including Windows skip and all failure assertions; baseline only in isolated filesystem/OS capsule because identity may touch /var/tmp.
- Behavioral RED/GREEN for hardlink publication failure, draft unlink failure after publication, dead/foreign/undefined incarnation, ambiguous witness, concurrent claimers, replacement lock during release, release unlink failure preserving callback result, orphan malformed records and abort at each await.
- Real separate-process shared-home contention on supported local filesystems and SSH hosts; same endpoint/different boot/namespace, permissions/symlinks/hardlink unsupported, clock/deadline overshoot and hung IO. Scope by host; undefined/contact loss remains unverifiable. No account/home credential operations.

**PJ-T-SQLITE** — Sol usage/runtime native SQLite owners; retain UIG-OPENCODE allocation.

- Reuse all accepted UIG-OPENCODE original scanner/test allocations without replacing them by wrapper tests.
- Faithful baseline/port fixtures for module unavailable, readonly/missing file, open/query/close failure, empty/simple pragma undefined, statement eviction/exclusion, DDL cache clear even on failure and open precheck race.
- Supported Node/native-version fixtures with synthetic database: schema evolution/WAL/locks/partial materialization/close; verify actual results and errors. Never open real account DB.

**PJ-T-WINDOWS** — Sol Windows runtime/native owners.

- Original kill and guard whole suites baseline unchanged then faithful port RED/GREEN; keep source resolving callback failure separate from any intended structured termination result.
- Synthetic guard cases metrics unavailable, Chromium PID membership, invalid PID, logger failure before Promise, synchronous exec throw, callback errors/timeout and callback never arrives.
- Disposable authorized Windows child process tree only: timeout behavior, late callback, PID reuse/TOCTOU, own Chromium exclusions and handle cleanup. Successful Promise is not exited; verify live/unverifiable/exited independently and preserve SSH loss-of-contact semantics.

**PJ-T-GUARD** — Sol Electron session/network and startup owners.

- Retain all original whole proxy/request/startup/browser assertion files above and central allocation; source-text ordering checks do not replace behavioral startup assertions.
- Behavioral RED/GREEN with synthetic Sessions for no-state early allow, two registrations, failed initial application with fulfilled startup barrier, pending latest-tail replacement, failed close with credentials retained, setProxy failure with old credentials, retired in-flight publication then final credential clear.
- Fake login challenges: exact Session vs default/no webContents, normalized IPv6/case host and exact port, nonproxy/wrong session/host/port; challenge during failed/retired readiness and multiple login listeners. Assert preventDefault/callback count and no cross-session credential selection using dummy values only.
- Disposable Electron app fixture with controlled loopback proxy only after authorization: real onBeforeRequest replacement/filter behavior, callbacks outstanding during removal, login event host/session identity, retries/close rejection/hang, destroyed guest, normal deletion guard retained vs failed-profile/route cleanup removal. No provider requests, active profiles or actual credentials.
- Keep unexpected early allow/no timeout/cleanup races as source characterization; root-approved fixes require separate intended-correction assertions and must not silently alter baseline. Node/custom partitions must demonstrate their own policy; do not infer all transport is blocked by global guard.

The source baseline must retain original assertions in disposable source-derived capsules, with actual revision/config/command/results. Port faithfully, obtain behavioral RED before implementation and GREEN afterward; setup failures are not RED, skips are not PASS, and mocks of missing product behavior are not parity. Preserve local/folder/SSH/WSL mixed-version ownership and `live` / `unverifiable` / `exited`; contact loss is not exit. Native and provider authorization remains separate future work.

Proposed disposition: root may accept this bounded source characterization after independent review. Whole E3/E5 acceptance, original-suite execution, intended corrections and actual Sol implementation remain separate gates. Only the two assigned new files are delivered; all prior reports and MIT/copyright provenance remain unchanged.

