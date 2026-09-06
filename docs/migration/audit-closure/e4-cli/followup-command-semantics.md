# E4-S1 command semantics follow-up

Proposed result: all **204 newly mapped commands** now have manually authored CLI handler/request-builder contracts; the **30 accepted contracts are reused**. Root review is required before accepting E4-S1. **E4 remains open** for S2–S5, and no baseline, port, runtime or parity test ran.

Source: `c97906287bb7a390b25e2025b600d9fb3c25d9c3` at `/Users/carlos/Documents/Drogon-mentu-session`, read-only. This directory is the only write target; all earlier candidate files are preserved. No product effects, installs, child workers or Git mutations occurred.

The JSON companion contains the complete machine-readable records, source hashes, preserved-file hashes, assertion-read ranges and exact per-command testing obligations. The author script is a hand-authored artifact renderer, not a semantic extractor; command counts check omissions only.

## Scope and notation

Payload descriptions denote constructed JS objects: undefined keys may exist before transport serialization. Optional conditional spreads are explicit. Printed phrases describe semantic fields; imported formatter goldens remain S5. Shared G applies to parsed invocations; raw claude-teams bypasses it. No generic null coercion beyond explicitly stated flags.

Global parsed flags: help and json use presence; environment and pairing-code require nonempty string when present. Local-family exceptions and ignored page flags are explicit below. The accepted argument contract remains the authority for normal argv parsing, positionals, repeats and hidden aliases. The raw first-token claude-teams path is specialized below; agent-teams-tmux and version entry paths remain inherited entry-point evidence, outside the234 canonical-command denominator.

## Argument rules

- **R**: Required nonempty string; no trim; absent/boolean/empty -> invalid_argument. Literal null stays string.
- **RE**: Required string, including empty; absent/boolean -> invalid_argument. No trim or null coercion.
- **O**: Optional nonempty string, no trim; absent/boolean/empty -> undefined; literal null remains string.
- **TR**: Required trimmed string; absent/boolean/whitespace -> invalid_argument.
- **TO**: Optional trimmed nonempty string; absent/boolean/whitespace -> undefined.
- **N**: Optional Number(string), finite; absent/boolean/empty -> undefined, nonfinite -> invalid_argument.
- **PI**: N; undefined stays undefined, otherwise must integer >0 or invalid_argument. No safe-integer bound imposed by this helper.
- **NI**: N; undefined stays undefined, otherwise must integer >=0 or invalid_argument. No safe-integer bound imposed by this helper.
- **RF**: R then Number, finite; otherwise invalid_argument.
- **RP**: R then Number, finite >0; fractions allowed; otherwise invalid_argument.
- **P**: Presence via flags.has: any stored value, including empty or string false, activates; absence does not.
- **T**: True only when stored value === boolean true; string true/false/empty do not activate.
- **J**: O then quote-stripped-JSON diagnostic; returns original string, not parsed JSON. Downstream validation remains separate.
- **SAFE**: If absent undefined. If present requires nonempty string; trim then Number must positive safe integer AND exact BigInt numeric-text value must agree. Supports optional plus, hex/binary/octal, decimal/fraction/exponent only if mathematically integral; rejects rounding-to-integer text. Invalid -> invalid_argument; no generic max timer cap here (method policy S3).
- **REP**: O split at NUL repeated-flag separator; remove zero-length entries without trim; absent -> [].
- **NULLN**: Exact string null -> null, otherwise N.
- **IG**: Accepted syntax but deliberately unread by this handler; global syntax validation still applies.

## Shared finite CLI contracts

### G

Normal argv uses the accepted parser contract. Equals values are strings, including empty. Boolean-set flags do not consume next token; other flags may store true when valueless. label/skill repeat with NUL, all other repeats overwrite. Positionals bind declared flag names; collision fails. help presence resolves before runtime/validation; json presence selects JSON even --json=false. pairing-code/environment must be nonempty strings if present. Conditional page acceptance follows supportsBrowserPageFlag, even on some nonbrowser commands where it is unused. Unless row overrides, command errors are caught by main and exit 1; successful handlers do not reset prior process.exitCode (fresh process success is 0).

Source: `src/cli/args.ts:24-77`, `src/cli/args.ts:187-263`, `src/shared/cli-argument-boundary.ts:1-46`, `src/cli/index.ts:68-180`. Full-file SHA256 values are in JSON evidence.

### OUT

printResult: JSON full success envelope after prepareComputerCliJsonResult; text console.log of named formatter/result string. Text errors stderr; JSON RPC errors preserve failure envelope, local errors use id local, ok false, code/message/data, runtimeId null. False/null result fields alone do not change exit unless row says so. Complex formatter layouts are S5 boundaries, not implicit success proofs.

Source: `src/cli/format.ts:70-189`. Full-file SHA256 values are in JSON evidence.

### H

Standard runtime selection: explicit runtime host resolves local pairing store and rejects contradictory pairing/environment; canonical runtime id selects paired server. SSH selects connected-runtime SSH authority. Ambient pairing/environment apply unless row pins local. No client cwd inferred on a remote server. Client default timeout 60000 ms; explicit row timeout overrides. RPC implementation/transport is S3; no loss of contact implies exited. Method timeout specialization in client: workerStart validates transport timer limit and uses max(shared readiness+grace,60000); waiting check with finite positive inner timeout uses max(inner+LONG_POLL_CLIENT_GRACE_MS,60000). Those shared grace/readiness policies and transport remain S3.

Source: `src/cli/index.ts:29-43`, `src/cli/index.ts:111-176`, `src/cli/execution-host-flag.ts:23-218`, `src/cli/runtime/client.ts:70-171`. Full-file SHA256 values are in JSON evidence.

### B

Browser target: O page; page without explicit worktree (or all) -> {page}, no cwd read. Explicit worktree with page validates/normalizes it. Without page, O worktree: all -> undefined; active/current -> longest-enclosing concrete id locally, reject remotely; other explicit selector normalized including proven WSL path conversion. Omitted local worktree -> try current and catch any error to undefined; remote omission -> undefined (server focus). Payload spread is this target. Cwd is ORCA_CLI_CWD nonempty override else process.cwd. Current lookup calls worktree.list({limit:10000}), longest enclosing resolved path, equal lengths keep first. WSL explicit path conversion reads that list only for proven caller distro or /mnt/drive shape; unmatched retains typed selector. Cross-platform predicates remain S2.

Source: `src/cli/selectors.ts:174-264`. Full-file SHA256 values are in JSON evidence.

### BW

Browser worktree-only helper as B without page lookup. A parser-accepted page on open-url is ignored, not used to target a page. Same worktree-selector behavior as B including worktree.list limit10000 and WSL proof, but never reads page.

Source: `src/cli/selectors.ts:174-204`. Full-file SHA256 values are in JSON evidence.

### C

R app; O session/worktree mutually exclusive. Session -> {session,app}; otherwise {app,worktree:BW}. NI window-id/window-index mutually exclusive; present numbers included. no-screenshot P -> noScreenshot:true, otherwise undefined; restore-window P -> restoreWindow:true only when present. All action specs include these common flags via COMPUTER_ACTION_FLAGS, including no-screenshot and app absent from old flattened literal list. Session/worktree exclusivity is truthiness after O normalization, not raw presence; empty/boolean partner is ignored.

Source: `src/cli/specs/computer.ts:4-11`, `src/cli/selectors.ts:266-290`, `src/cli/handlers/computer-action-flags.ts:22-58`. Full-file SHA256 values are in JSON evidence.

### E

O worktree/device/emulator. Worktree all -> undefined; active/current resolves current locally/rejects remote; other explicit string is returned as typed. Remote omission -> undefined; local omission -> nonblank ORCA_WORKTREE_ID (original spelling), else trimmed folder: ORCA_WORKSPACE_ID, else current with catch-all undefined. Device/emulator pass together when provided, not exclusive; target preserves worktree.

Source: `src/cli/selectors.ts:293-360`. Full-file SHA256 values are in JSON evidence.

### ID

O from/terminal explicit wins. ORCA_TERMINAL_HANDLE is preserved for ordinary send/check/ask/reply. Coordinator identity validates env handle with terminal.show; only stale/gone triggers pane-key remint via terminal.resolvePane, never arbitrary focus for a stale sender. Missing sender can use local active resolution; no_active_terminal becomes no_active_sender_terminal. Unrelated transport errors propagate. Validation stale/gone checks error.code only. Pane remint absorbs terminal_not_found/terminal_handle_stale/terminal_gone via code OR exact message; runtime_unavailable is not absorbed in the coordinator call. Missing pane remint then no_active_sender_terminal. Explicit handles are not proactively validated.

Source: `src/cli/handlers/orchestration/terminal-identity.ts:5-158`. Full-file SHA256 values are in JSON evidence.

### MUT

O retry-request forwarded as orchestrationRequestId iff truthy; runtime client owns capability preflight and request minting. Error becomes orchestrationMutationRecoveryError. No automatic reissue with a fresh identity. Exact transported envelope and durable effects remain S3.

Source: `src/cli/handlers/orchestration/mutation-request.ts:5-25`, `src/cli/runtime/client.ts:95-171`. Full-file SHA256 values are in JSON evidence.

### LCTX

Context always includes remote boolean, cwd only if local, optional ORCA_WORKTREE_ID and ORCA_TERMINAL_HANDLE if truthy. Standard write target: O id plus T current; both -> invalid_argument, neither -> linear_issue_required. O workspace all -> linear_invalid_workspace. Payload {input,current,workspaceId,context}.

Source: `src/cli/linear-request-builders.ts:160-221`. Full-file SHA256 values are in JSON evidence.

### BODY

Presence body/body-file exclusive even empty/boolean. Explicit body uses RE; body-file uses R then local absolute-or-cwd path read, or - reads non-TTY stdin. UTF8 buffered; body may be empty; length cap from LINEAR_WRITE_BODY_CAP=65000 characters (constant read; full shared contract S2) -> linear_body_too_large. Optional body omission -> undefined; required omission -> invalid_argument. Read failure propagates.

Source: `src/cli/linear-request-builders.ts:254-316`. Full-file SHA256 values are in JSON evidence.

### PRJ

Project-host-setup calls translate only RuntimeClientError method_not_found to incompatible_runtime; preserve zero-params call arity. Host parser requires local/ssh:/runtime: nonempty; create resolves SSH authority while clone/existing-folder preserve parsed SSH for runtime refusal. Path helper local relative -> cwd absolute; off-client path must be runtime-absolute. Remote path predicate accepts leading slash, drive-letter colon slash/backslash, or UNC double-backslash; preserves raw path, S3 runtime effects.

Source: `src/cli/handlers/project.ts:34-91`, `src/cli/repo-path-arguments.ts:1`. Full-file SHA256 values are in JSON evidence.

### FILE

Explicit worktree presence must carry nonempty string. Resolve explicit selector, else remote rejects and local requires current. Relative file path passes through. Absolute path triggers worktree.show: translate caller WSL flavor only with distro/UNC proof, relativize only inside root, root itself -> invalid_argument; outside root passes unchanged for runtime guard. This helper treats explicit worktree all as literal selector all (unlike browser/emulator all->undefined). Unopened changed records enter skipped with reason kind + file; unresolved conflict skip reason distinguishes edit/diff.

Source: `src/cli/handlers/file.ts:32-115`. Full-file SHA256 values are in JSON evidence.

### ART

Pinned local signed-in account; reject explicit environment/pairing-code. TO api-url overrides trimmed ambient API URL; optional trimmed ambient cloud auth is forwarded, never printed by this audit. Cloud operation ok -> value; reconnect-required -> authentication_required; other status -> authentication_unconfigured. File operations support bridge source metadata (S4); share/update infer .html/.htm or .md/.markdown content type, preflight settings.get and deny only explicit false before content read; failed preflight defers. Read bounded nonempty file/stdin and serialized request byte limit; not-file, too-large, unsupported type, empty -> invalid_argument. SourceKey absolute local cwd+file unless bridged. No secrets read/executed here. Explicit-selector rejection helper scans environment then pairing-code by flags.has; first present throws invalid_argument with command-specific suffix; ambient variables alone do not trigger rejection.

Source: `src/cli/handlers/artifacts.ts:25-161`. Full-file SHA256 values are in JSON evidence.

### AUTO

Schedule: O trigger/schedule mutually exclusive; missing with day/time rejects; create requires one, edit may omit. manual rejects. Presets hourly/daily/weekdays/weekly; time only daily/weekdays/weekly, day weekly-only 0..6 decimal integer. Default time09:00, weekly day1; hourly00:00. Custom raw cron/RRULE validated by shared function S2. Output {rrule,dtstart:Date.now()}. Provider exact registered TuiAgent (S2). Enabled/disabled and reuse-session/fresh-session: string value rejected, true flags mutually exclusive, absence undefined. Precheck absence with timeout rejects; value must string, trimmed blank -> null; nonblank -> {command,timeoutSeconds:PI(default60,max600)}. Source-context present must string JSON; null clears; else object normalized by shared S2 or error. Workspace-mode O: existing, new-per-run/new_per_run -> new_per_run; others error. Target repo/workspace/project constraints in TARGET; destination/expected-owner fences preserved, older no-generation differs from missing target. Precheck timeout upper600 is checked only after nonblank command; blank command returns null first. Day/time checks use presence, whereas trigger/schedule exclusivity uses nonempty O values. Literal null only clears precheck when blank or source-context JSON null, not generic text fields.

Source: `src/cli/handlers/automation-handler-flags.ts:21-322`, `src/cli/handlers/automations.ts:57-159`, `src/cli/automation-destination.ts:22-95`. Full-file SHA256 values are in JSON evidence.

### TARGET

Repo and workspace exclusive; project target flags incompatible with workspace and checked against repo by helper. Project setup resolves to repo selector + validated runContext. Create no target locally tries current and catches to {}, remote -> {}; edit uses explicit targets only. Owner lookup automation.show supplies expectedOwner for edit/remove/run; destination repo/worktree authority resolves self or SSH target generation; missing SSH target -> invalid-destination conflict, missing old-host generation -> undefined. Exact project setup selector rules are expanded below in notes. Project-target presence is project/host/project-host-setup; repo presence incompatible even if valueless; host requires project or setup presence. Present project/setup must R. List ready setups only; explicit setup chooses matching ready ID without rechecking supplied project/host. Otherwise filter project, choose first if no host; with host prefer normalized exact then compatibility local/runtime. Missing match invalid_argument; method_not_found incompatible_runtime. Return repo=id:setup.repoId. No ambiguity rejection here.

Source: `src/cli/worktree-project-target.ts:1`, `src/cli/handlers/automations.ts:57-159`. Full-file SHA256 values are in JSON evidence.

### ACC

Pinned local, reject explicit environment/pairing-code. accounts.list({refreshUsage:false}); add first status.get requires ACCOUNT_IMPORT_RUNTIME_CAPABILITY then lists existing accounts. Interactive child exit failure rejects; temporary credentials never printed. Cleanup single-flight and awaited after child termination. POSIX signal forwards then5s grace thenSIGKILL+1s; Windows taskkill /T /F timeout5s then close1s/direct fallback. SIGHUP129/SIGINT130/SIGTERM143; interruption while registering warns possible registration. Primary add error retained and cleanup failure warned; cleanup-only failure thrown. S4 keychain/profile/process effects unexecuted. Login wrapper resolves CLI executable then getSpawnArgsForWindows; unsafe batch sentinel -> invalid_environment naming unsafe path; other errors preserved. Build child env from stripped parent+extra, prepend missing version-manager bins (Path casing rule on Windows), then withCliRuntimeOnPath. stdioForWindowsInteractiveChild(json) disposed even on synchronous spawn throw. Child error -> internal launch error; exit exactly0 resolves, other/null -> internal exit error. Command-resolution, batch grammar and console devices remain S4. Accounts formatting: no rows -> No managed provider accounts.; otherwise count header plus emails and active marker if id equals legacy active, runtime host active or any WSL active. No usage columns. Explicit-selector rejection helper scans environment then pairing-code by flags.has; first present throws invalid_argument with command-specific suffix; ambient variables alone do not trigger rejection.

Source: `src/cli/handlers/account.ts:1`, `src/cli/handlers/interactive-login-interruption.ts:1`. Full-file SHA256 values are in JSON evidence.

### HOOK

Pinned local regardless explicit pairing/environment (global syntax still validates). Profile index then .bak; valid active ID regex and membership selects profiles/id/orca-data.json, otherwise legacy path. Missing state -> defaults; malformed state -> runtime_error. Read hooks enabled unless explicit false, normalize disabled agents (S2). Updating runtime: getCliStatus reachable then settings.update timeout10s; any failure -> offline state merge defaults+existing+enabled, atomic temp write/rename with best-effort temp cleanup. Runtime success uses getManagedAgentHookStatuses; offline calls applyAgentStatusHooksEnabled. Exact managed profile/hook side effects remain S4.

Source: `src/cli/handlers/agent-hooks.ts:34-211`. Full-file SHA256 values are in JSON evidence.

### ENV

Pinned local pairing store at getDefaultUserDataPath; handler calls shared redaction before output (S3 environment store/secret/decoding boundary). environment/global pairing values still validated by G. page syntactically accepted and ignored on host/environment. List variants explicitly reject environment/pairing-code with structured next steps; add/show/rm use local store and do not retarget runtime. Explicit-selector rejection helper scans environment then pairing-code by flags.has; first present throws invalid_argument with command-specific suffix; ambient variables alone do not trigger rejection.

Source: `src/cli/handlers/environment.ts:22-153`, `src/cli/remote-selection-flag-rejection.ts:1`, `src/cli/index.ts:29-43`. Full-file SHA256 values are in JSON evidence.

### JDIAG

J diagnostic trims only for detection and returns original raw input. Any double quote or valid JSON bypasses detection. Otherwise must be bracket array or brace object with nonempty comma-split trimmed body; arrays require every token /^[A-Za-z0-9_.:+-]+$/, objects every entry /^([A-Za-z0-9_.+-]+):([A-Za-z0-9_.+-]+)$/. Matching damaged shape -> invalid_argument, conditional PowerShell5.1 guidance without echoing value; no repair. Other invalid JSON passes to runtime. Thus quoted-looking malformed data is not universally rejected locally.

Source: `src/cli/quote-stripped-json-flag.ts:13-63`. Full-file SHA256 values are in JSON evidence.

### OCOMP

compatibilityCliCommand: exact ORCA_CLI_COMMAND orca|orca-ide|orca-dev wins, else Linux orca-ide and other platforms orca. Packaged Windows command (ask only): ORCA_WINDOWS_PACKAGED_CLI_LAUNCHER !==1 -> undefined; otherwise ORCA_CLI_COMMAND must orca|orca-ide (not dev) or invalid_argument before question mutation. devMode true iff ORCA_DEV_CLI_INVOCATION===1 OR ORCA_USER_DATA_PATH contains orca-dev. Flush awaits empty stdout.write callback, errors reject. None of these establishes runtime compatibility; S3 owns remote semantics.

Source: `src/cli/handlers/orchestration/runtime-compatibility.ts:1-47`. Full-file SHA256 values are in JSON evidence.

## Per-command contracts

### account add

Source: `src/cli/handlers/account.ts:299-321`, SHA256 `2f98077d0915bbee1fbdeba16fe5b81b76ba8192f3edfc6d2dfd8d31b9d0745c`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, ACC. Host: Pinned local; explicit remote selectors rejected.

Flags: `--agent`: O — Absent defaults claude; present must nonempty string exact claude|codex; boolean/empty/other invalid..

Normalized operation: Claude: claude auth login --claudeai with temp CLAUDE_CONFIG_DIR then accounts.addClaudeFromConfigDir({configDir,previousLegacyCredentialsSha256:darwin hash-or-null}); Codex: codex login --device-auth temp CODEX_HOME then accounts.addCodexFromHome({sourceHome})

Output: Preserve import RPC response envelope after cleanup success; text formatAccountsBlock for selected provider. JSON stdout is only response envelope; interactive child stdout redirects to stderr via S4 stdio helper.

Branches/errors: Claude Darwin snapshots/restores legacy keychain and deletes temporary keychain; all branches remove temp directory. Capability refusal before spawn. ACC governs cleanup/signal precedence.

Exit: Normal success0/errors1 plus ACC signal129/130/143.

Existing assertion bodies read: `src/cli/handlers/account.test.ts:156-174`, `src/cli/handlers/account.test.ts:560-661`. No execution.

### account list

Source: `src/cli/handlers/account.ts:322-336`, SHA256 `2f98077d0915bbee1fbdeba16fe5b81b76ba8192f3edfc6d2dfd8d31b9d0745c`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, ACC. Host: Pinned local; explicit remote selectors rejected.

Flags: no command-specific flags.

Normalized operation: accounts.list({refreshUsage:false})

Output: Preserve accounts.list RPC envelope; text Claude accounts block + blankline + Codex block (ACC).

Branches/errors: No interactive login or refresh request.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: `src/cli/handlers/account.test.ts:560-661`. No execution.

### agent hooks off

Source: `src/cli/handlers/agent-hooks.ts:245-248`, SHA256 `e868bd3318a49c543024e671d9d91a0f0717d780f22c87a6d09fc7325fa69950`.

Aliases: none. Positionals bind: none. Factory specialization: `setAgentHooksEnabled(client,false)`.

Shared contracts: G, OUT, HOOK. Host: Pinned local; see HOOK/ENV.

Flags: `--page`: IG.

Normalized operation: setAgentHooksEnabled(client,false) -> localSuccess({enabled:false,settingsPath,appliedBy:runtime|offline,statuses})

Output: enabled/appliedBy/settingsPath then agent: state rows

Branches/errors: HOOK controls fallback and effects; no confirmation.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### agent hooks on

Source: `src/cli/handlers/agent-hooks.ts:249-252`, SHA256 `e868bd3318a49c543024e671d9d91a0f0717d780f22c87a6d09fc7325fa69950`.

Aliases: none. Positionals bind: none. Factory specialization: `setAgentHooksEnabled(client,true)`.

Shared contracts: G, OUT, HOOK. Host: Pinned local; see HOOK/ENV.

Flags: `--page`: IG.

Normalized operation: setAgentHooksEnabled(client,true) -> localSuccess({enabled:true,settingsPath,appliedBy:runtime|offline,statuses})

Output: enabled/appliedBy/settingsPath then agent: state rows

Branches/errors: HOOK controls fallback and effects; no confirmation.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### agent hooks prepare-codex

Source: `src/cli/handlers/agent-hooks.ts:212-235`, SHA256 `e868bd3318a49c543024e671d9d91a0f0717d780f22c87a6d09fc7325fa69950`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, HOOK. Host: Pinned local; see HOOK/ENV.

Flags: `--page`: IG.

Normalized operation: If nonblank WSL_DISTRO_NAME: agentHooks.prepareCodexForWslPane({codexHome:env??empty,orcaCodexHome:env??empty,wslDistro:raw env}) timeout50000; else settings.get timeout1000 then disk fallback -> prepareManagedCodexHomeBeforeShellLaunch({userDataPath,hooksEnabled:enabled && codex not disabled})

Output: No output, including JSON

Branches/errors: WSL branch swallows every RPC failure and returns; local branch errors propagate. Runtime settings used only if agentStatusHooksEnabled boolean.

Exit: WSL error swallowed success0; local helper error1; otherwise0.

Existing assertion bodies read: `src/cli/handlers/agent-hooks.test.ts:129-169`. No execution.

### agent hooks status

Source: `src/cli/handlers/agent-hooks.ts:236-244`, SHA256 `e868bd3318a49c543024e671d9d91a0f0717d780f22c87a6d09fc7325fa69950`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, HOOK. Host: Pinned local; see HOOK/ENV.

Flags: `--page`: IG.

Normalized operation: readHookSettingsFromDisk + getManagedAgentHookStatuses -> localSuccess({enabled,settingsPath,appliedBy:offline,statuses})

Output: enabled/appliedBy/settingsPath then agent: state rows

Branches/errors: Status uses disk directly, no runtime read.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### agent-context

Source: `src/cli/handlers/introspection.ts:8-15`, SHA256 `cbda4f06f6c9221a19449b8472f69516fe6045300f23a6a3c831cd9ea13c886f`.

Aliases: none. Positionals bind: none. 

Shared contracts: G. Host: No runtime or profile access.

Flags: no command-specific flags.

Normalized operation: buildAgentContext(COMMAND_SPECS)

Output: JSON bare schema pretty2; text: commandCount commands (schema v1). plus Run orca agent-context --json for full schema.

Branches/errors: Pure registry output schemaVersion1; sorted command names; command/path/aliases/argumentMode/summary/usage/effective flags/positionalArgs/examples/notes. No runtime call.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: `src/cli/agent-context.test.ts:1-93`. No execution.

### artifacts delete

Source: `src/cli/handlers/artifacts.ts:206-214`, SHA256 `6e73f165404e4f2ef6e57e1ce7ea900b13a4d4ca8f1729c2d92d7478752e0c76`.

Aliases: `artifacts rm`. Positionals bind: id. 

Shared contracts: G, OUT, ART. Host: Pinned local; explicit remote selectors rejected.

Flags: `--id`: TR; `--api-url`: TO.

Normalized operation: artifacts.delete({id:trimmed required id,...cloudOptions})

Output: Preserve RPC envelope; replace result {deleted:true}; Artifact deleted.

Branches/errors: No file/content preflight.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### artifacts list

Source: `src/cli/handlers/artifacts.ts:164-176`, SHA256 `6e73f165404e4f2ef6e57e1ce7ea900b13a4d4ca8f1729c2d92d7478752e0c76`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, ART. Host: Pinned local; explicit remote selectors rejected.

Flags: `--cursor`: TO; `--api-url`: TO.

Normalized operation: artifacts.list({...cloudOptions,cursor only if truthy})

Output: Preserve RPC envelope, replace result operation.value; formatArtifactListPage (S5).

Branches/errors: No file/content preflight.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: `src/cli/handlers/artifacts.test.ts:36-131`. No execution.

### artifacts share

Source: `src/cli/handlers/artifacts.ts:177-185`, SHA256 `6e73f165404e4f2ef6e57e1ce7ea900b13a4d4ca8f1729c2d92d7478752e0c76`.

Aliases: none. Positionals bind: file. 

Shared contracts: G, OUT, ART. Host: Pinned local; explicit remote selectors rejected.

Flags: `--file`: TR — Required unless bridge supplies file/source metadata.; `--api-url`: TO.

Normalized operation: artifacts.share({sourceKey,content,contentType,fileName:bridge.fileName??basename(sourceKey),...cloudOptions})

Output: Preserve RPC envelope; replace result with operation.value; formatArtifactShared (S5).

Branches/errors: Same file/preflight pipeline for share; preflight disabled -> ARTIFACT_SHARING_DISABLED_CODE with shared message/nextSteps; operation result union follows ART. Local transport/bridge details S3/S4.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: `src/cli/handlers/artifacts.test.ts:36-131`. No execution.

### artifacts unshare

Source: `src/cli/handlers/artifacts.ts:195-205`, SHA256 `6e73f165404e4f2ef6e57e1ce7ea900b13a4d4ca8f1729c2d92d7478752e0c76`.

Aliases: none. Positionals bind: file. 

Shared contracts: G, OUT, ART. Host: Pinned local; explicit remote selectors rejected.

Flags: `--file`: TR — Required unless bridge source key supplied.; `--api-url`: TO.

Normalized operation: artifacts.unshare({sourceKey:bridge key or local absolute file,...overrides})

Output: Preserve RPC envelope; replace result {deleted:true}; Artifact deleted.

Branches/errors: Does not read file or preflight sharing permission.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### artifacts update

Source: `src/cli/handlers/artifacts.ts:186-194`, SHA256 `6e73f165404e4f2ef6e57e1ce7ea900b13a4d4ca8f1729c2d92d7478752e0c76`.

Aliases: none. Positionals bind: file. 

Shared contracts: G, OUT, ART. Host: Pinned local; explicit remote selectors rejected.

Flags: `--file`: TR — Required unless bridge supplies file/source metadata.; `--api-url`: TO.

Normalized operation: artifacts.update({sourceKey,content,contentType,fileName:bridge.fileName??basename(sourceKey),...cloudOptions})

Output: Preserve RPC envelope; replace result with operation.value; formatArtifactShared (S5).

Branches/errors: Same file/preflight pipeline for update; preflight disabled -> ARTIFACT_SHARING_DISABLED_CODE with shared message/nextSteps; operation result union follows ART. Local transport/bridge details S3/S4.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### automations create

Source: `src/cli/handlers/automations.ts:172-205`, SHA256 `105339cc5db83d4de61bec4c0e610582589d041453884c561120f6fe9fa4abd8`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, AUTO, TARGET. Host: H with command-specific target fields/contracts.

Flags: `--repo`: O; `--workspace`: O; `--project`: O — Presence requires R in project resolver; `--host`: O — Requires project or project-host-setup presence; `--project-host-setup`: O — Presence requires R; `--name`: R; `--prompt`: R; `--precheck`: O — Absent undefined; present nonstring rejects; trimmed blank null; `--precheck-timeout`: PI; `--source-context`: O — Presence JSON parsed, null clears; shared normalizer S2; `--workspace-mode`: O — existing|new-per-run|new_per_run; `--base-branch`: O; `--reuse-session`: T — Boolean-only; exclusive fresh-session; `--fresh-session`: T — Boolean-only; exclusive reuse-session; `--timezone`: O; `--enabled`: T — Boolean-only; exclusive disabled; `--disabled`: T — Boolean-only; exclusive enabled; `--missed-run-grace-minutes`: PI; `--trigger`: O; `--schedule`: O; `--day`: O — If present must decimal digits integer0..6; boolean/empty invalid; weekly-only; absent1.; `--time`: O — Absent09:00 for nonhourly; if present string matching 1-2 digit hour:2digit minute, hour0..23/minute0..59; boolean/empty invalid; preset applicability via AUTO.; `--provider`: R — Exact registered TuiAgent.

Normalized operation: automation.create({name,prompt,agentId,precheck,runContext?,sourceContext?,repo,workspace,workspaceMode:explicit or (workspace?existing:new_per_run),baseBranch,reuseSession,timezone,enabled,missedRunGraceMinutes,...schedule, destination?})

Output: formatAutomationShow (S5)

Branches/errors: Requires schedule/trigger. Validation before destination resolution. AUTO/TARGET specify omission and defaults.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: `src/cli/index-automation-schedule.test.ts:56-186`. No execution.

### automations edit

Source: `src/cli/handlers/automations.ts:206-239`, SHA256 `105339cc5db83d4de61bec4c0e610582589d041453884c561120f6fe9fa4abd8`.

Aliases: none. Positionals bind: id. 

Shared contracts: G, OUT, H, AUTO, TARGET. Host: H with command-specific target fields/contracts.

Flags: `--id`: R; `--repo`: O; `--workspace`: O; `--project`: O — Presence requires R in project resolver; `--host`: O — Requires project or project-host-setup presence; `--project-host-setup`: O — Presence requires R; `--name`: O; `--prompt`: O; `--precheck`: O — Absent undefined; present nonstring rejects; trimmed blank null; `--precheck-timeout`: PI; `--source-context`: O — Presence JSON parsed, null clears; shared normalizer S2; `--workspace-mode`: O — existing|new-per-run|new_per_run; `--base-branch`: O; `--reuse-session`: T — Boolean-only; exclusive fresh-session; `--fresh-session`: T — Boolean-only; exclusive reuse-session; `--timezone`: O; `--enabled`: T — Boolean-only; exclusive disabled; `--disabled`: T — Boolean-only; exclusive enabled; `--missed-run-grace-minutes`: PI; `--trigger`: O; `--schedule`: O; `--day`: O — If present must decimal digits integer0..6; boolean/empty invalid; weekly-only; absent1.; `--time`: O — Absent09:00 for nonhourly; if present string matching 1-2 digit hour:2digit minute, hour0..23/minute0..59; boolean/empty invalid; preset applicability via AUTO.; `--provider`: O — Registered TUI agent exact ID.

Normalized operation: automation.show({id}) owner fence; automation.update({id,expectedOwner?,destination?,updates:{name,prompt,agentId,precheck,runContext?,sourceContext?,repo,workspace,workspaceMode,baseBranch,reuseSession,timezone,enabled,missedRunGraceMinutes,...optional schedule}})

Output: formatAutomationShow (S5)

Branches/errors: No implicit cwd target on edit; no requirement at least one update.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: `src/cli/index-automation-schedule.test.ts:56-186`. No execution.

### automations list

Source: `src/cli/handlers/automations.ts:162-165`, SHA256 `105339cc5db83d4de61bec4c0e610582589d041453884c561120f6fe9fa4abd8`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, AUTO. Host: H with command-specific target fields/contracts.

Flags: no command-specific flags.

Normalized operation: automation.list()

Output: formatAutomationList

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### automations remove

Source: `src/cli/handlers/automations.ts:240-248`, SHA256 `105339cc5db83d4de61bec4c0e610582589d041453884c561120f6fe9fa4abd8`.

Aliases: none. Positionals bind: id. 

Shared contracts: G, OUT, H, AUTO, TARGET. Host: H with command-specific target fields/contracts.

Flags: `--id`: R.

Normalized operation: automation.show({id}) -> automation.delete({id,expectedOwner?})

Output: formatAutomationRemoved (S5)

Branches/errors: Owner fence lookup precedes mutation.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### automations run

Source: `src/cli/handlers/automations.ts:249-257`, SHA256 `105339cc5db83d4de61bec4c0e610582589d041453884c561120f6fe9fa4abd8`.

Aliases: none. Positionals bind: id. 

Shared contracts: G, OUT, H, AUTO, TARGET. Host: H with command-specific target fields/contracts.

Flags: `--id`: R.

Normalized operation: automation.show({id}) -> automation.runNow({id,expectedOwner?})

Output: formatAutomationRun

Branches/errors: Owner fence lookup precedes mutation.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### automations runs

Source: `src/cli/handlers/automations.ts:258-263`, SHA256 `105339cc5db83d4de61bec4c0e610582589d041453884c561120f6fe9fa4abd8`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, AUTO. Host: H with command-specific target fields/contracts.

Flags: `--id`: O.

Normalized operation: automation.runs({automationId:id})

Output: formatAutomationRuns

Branches/errors: Omitted id lists across automations.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### automations show

Source: `src/cli/handlers/automations.ts:166-171`, SHA256 `105339cc5db83d4de61bec4c0e610582589d041453884c561120f6fe9fa4abd8`.

Aliases: none. Positionals bind: id. 

Shared contracts: G, OUT, H, AUTO. Host: H with command-specific target fields/contracts.

Flags: `--id`: R.

Normalized operation: automation.show({id})

Output: formatAutomationShow (S5)

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### back

Source: `src/cli/handlers/browser-nav.ts:54-58`, SHA256 `b39225ef7c3e844d00b9c414f438af04ed1dd200a17ef6190193b4b128458ec8`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O.

Normalized operation: browser.back(target(B))

Output: Back to result.url — result.title

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### capture start

Source: `src/cli/handlers/browser-capture.ts:54-58`, SHA256 `172ad59350524a6fdebeb17a27239eeee0d0cfbaa6d221520c81006d7d303625`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O.

Normalized operation: browser.capture.start(target(B))

Output: Capture started (console + network)

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### capture stop

Source: `src/cli/handlers/browser-capture.ts:59-63`, SHA256 `172ad59350524a6fdebeb17a27239eeee0d0cfbaa6d221520c81006d7d303625`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O.

Normalized operation: browser.capture.stop(target(B))

Output: Capture stopped

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### check

Source: `src/cli/handlers/browser-interact.ts:79-79`, SHA256 `e2c3ddbdfca82279889d482729d655cc795112c61f104e133d40888e2d63ef9e`.

Aliases: none. Positionals bind: none. Factory specialization: `checkHandler(true)`.

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--element`: R.

Normalized operation: browser.check({element,checked:true} merged with target(B))

Output: result.checked ? Checked element : Unchecked element

Branches/errors: Factory checkHandler(true); output follows returned checked, not requested true.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### claude-teams

Source: `src/cli/handlers/core.ts:62-90`, SHA256 `f89d4a0387218221bcd85e199fd63d6090624084bd8ad009901b064249b484df`.

Aliases: none. Positionals bind: none. 

Shared contracts: raw path only. Host: Pinned local RuntimeClient(undefined,undefined,null,null), bypass normal argv parser; raw suffix never selects Orca host.

Flags: no command-specific flags.

Normalized operation: Raw argv suffix -> withTeammateModeAuto -> client.call agentTeams.prepareLaunch({paneKey,env:parent env minus ELECTRON_RUN_AS_NODE/undefined}) -> spawn claude(args,{stdio:inherit,env:parent+launch.env})

Output: Inherited child stdio, no CLI JSON/help handling

Branches/errors: First argv token special dispatch before parser. Any exact --teammate-mode or --teammate-mode= prefix prevents auto insertion; otherwise prepend --teammate-mode auto. Windows unsupported_platform; missing ORCA_PANE_KEY invalid_environment. S4 process lifecycle.

Exit: Child numeric exit preserved; signal without numeric exit1, otherwise0; spawn/launch errors1.

Existing assertion bodies read: `src/cli/handlers/core.test.ts:1-133`. No execution.

### clear

Source: `src/cli/handlers/browser-interact.ts:87-92`, SHA256 `e2c3ddbdfca82279889d482729d655cc795112c61f104e133d40888e2d63ef9e`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--element`: R.

Normalized operation: browser.clear({element} merged with target(B))

Output: Cleared result.cleared

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### click

Source: `src/cli/handlers/browser-interact.ts:39-44`, SHA256 `e2c3ddbdfca82279889d482729d655cc795112c61f104e133d40888e2d63ef9e`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--element`: R.

Normalized operation: browser.click({element} merged with target(B))

Output: Clicked result.clicked

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### clipboard read

Source: `src/cli/handlers/browser-env.ts:95-99`, SHA256 `4760b0388adee9082f3bd2009be652e52648e766d329f97ac2e9359959d21638`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O.

Normalized operation: browser.clipboardRead(target(B))

Output: Pretty JSON

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### clipboard write

Source: `src/cli/handlers/browser-env.ts:100-105`, SHA256 `4760b0388adee9082f3bd2009be652e52648e766d329f97ac2e9359959d21638`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--text`: R.

Normalized operation: browser.clipboardWrite({text} merged with target(B))

Output: Clipboard updated

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### computer capabilities

Source: `src/cli/handlers/computer.ts:33-36`, SHA256 `ab0f29d7e160c6a0dcab9b15e1224aff88a6ab4bb9bd3ff1b9e16e8ec9352bf9`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H. Host: H with command-specific target fields/contracts.

Flags: no command-specific flags.

Normalized operation: computer.capabilities({})

Output: provider (platform, protocol version); Apps and Windows boolean fields; Observation screenshot/elementFrames/annotatedScreenshot; Actions only truthy supports.actions names

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### computer click

Source: `src/cli/handlers/computer.ts:88-101`, SHA256 `ab0f29d7e160c6a0dcab9b15e1224aff88a6ab4bb9bd3ff1b9e16e8ec9352bf9`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, C. Host: H with command-specific target fields/contracts.

Flags: `--app`: R; `--session`: O; `--worktree`: O; `--window-id`: NI; `--window-index`: NI; `--restore-window`: P; `--no-screenshot`: P; `--element-index`: NI; `--x`: N; `--y`: N; `--click-count`: PI; `--mouse-button`: O — left|right|middle; `--modifiers`: O — typeof string including empty preserved; boolean -> undefined; shared validator S2.

Normalized operation: computer.click({target(C),elementIndex,x,y,clickCount,mouseButton,modifiers,observe(C)})

Output: formatComputerAction('click',result,{target(C),observe(C)}) (S5)

Branches/errors: Require app first; window exclusivity; then exactly elementIndex OR complete x+y. Partial coordinates or mixing reject. No coordinate bounds.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: `src/cli/handlers/computer-action-validation.test.ts:32-107`. No execution.

### computer drag

Source: `src/cli/handlers/computer.ts:130-143`, SHA256 `ab0f29d7e160c6a0dcab9b15e1224aff88a6ab4bb9bd3ff1b9e16e8ec9352bf9`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, C. Host: H with command-specific target fields/contracts.

Flags: `--app`: R; `--session`: O; `--worktree`: O; `--window-id`: NI; `--window-index`: NI; `--restore-window`: P; `--no-screenshot`: P; `--from-element-index`: NI; `--to-element-index`: NI; `--from-x`: N; `--from-y`: N; `--to-x`: N; `--to-y`: N.

Normalized operation: computer.drag({target(C),fromElementIndex,toElementIndex,fromX,fromY,toX,toY,observe(C)})

Output: formatComputerAction('drag',result,{target(C),observe(C)}) (S5)

Branches/errors: Require app; complete two element indexes XOR complete four coordinates. Any partial group invalid even if the other group complete.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: `src/cli/handlers/computer-action-validation.test.ts:339-438`. No execution.

### computer get-app-state

Source: `src/cli/handlers/computer.ts:79-87`, SHA256 `ab0f29d7e160c6a0dcab9b15e1224aff88a6ab4bb9bd3ff1b9e16e8ec9352bf9`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, C. Host: H with command-specific target fields/contracts.

Flags: `--app`: R; `--session`: O; `--worktree`: O; `--window-id`: NI; `--window-index`: NI; `--restore-window`: P; `--no-screenshot`: P.

Normalized operation: computer.getAppState({target(C),no action fields,observe(C)})

Output: formatGetAppState (S5)

Branches/errors: Observe validation before app/session/worktree selection; no required action.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: `src/cli/handlers/computer-action-validation.test.ts:32-107`. No execution.

### computer hotkey

Source: `src/cli/handlers/computer.ts:172-185`, SHA256 `ab0f29d7e160c6a0dcab9b15e1224aff88a6ab4bb9bd3ff1b9e16e8ec9352bf9`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, C. Host: H with command-specific target fields/contracts.

Flags: `--app`: R; `--session`: O; `--worktree`: O; `--window-id`: NI; `--window-index`: NI; `--restore-window`: P; `--no-screenshot`: P; `--key`: R.

Normalized operation: computer.hotkey({target(C),key,observe(C)})

Output: formatComputerAction('hotkey',result,{target(C),observe(C)}) (S5)

Branches/errors: Require app; computerUseHotkeyValidationMessage failure -> invalid_argument (S2 grammar boundary).

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: `src/cli/handlers/computer-action-validation.test.ts:32-107`. No execution.

### computer list-apps

Source: `src/cli/handlers/computer.ts:37-40`, SHA256 `ab0f29d7e160c6a0dcab9b15e1224aff88a6ab4bb9bd3ff1b9e16e8ec9352bf9`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H. Host: H with command-specific target fields/contracts.

Flags: no command-specific flags.

Normalized operation: computer.listApps({})

Output: formatListApps (S5)

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### computer list-windows

Source: `src/cli/handlers/computer.ts:73-78`, SHA256 `ab0f29d7e160c6a0dcab9b15e1224aff88a6ab4bb9bd3ff1b9e16e8ec9352bf9`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H. Host: H with command-specific target fields/contracts.

Flags: `--app`: R.

Normalized operation: computer.listWindows({app})

Output: formatListWindows (S5)

Branches/errors: No session/workspace target here.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### computer paste-text

Source: `src/cli/handlers/computer.ts:186-199`, SHA256 `ab0f29d7e160c6a0dcab9b15e1224aff88a6ab4bb9bd3ff1b9e16e8ec9352bf9`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, C. Host: H with command-specific target fields/contracts.

Flags: `--app`: R; `--session`: O; `--worktree`: O; `--window-id`: NI; `--window-index`: NI; `--restore-window`: P; `--no-screenshot`: P; `--text`: R — Required unless text-stdin present; `--text-stdin`: P.

Normalized operation: computer.pasteText({target(C),text,observe(C)})

Output: formatComputerAction('paste-text',result,{target(C),observe(C)}) (S5)

Branches/errors: Require app; text and text-stdin presence exclusive. stdin must non-TTY; UTF8 buffer; empty stdin text rejects.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: `src/cli/handlers/computer-action-validation.test.ts:339-438`. No execution.

### computer perform-secondary-action

Source: `src/cli/handlers/computer.ts:102-115`, SHA256 `ab0f29d7e160c6a0dcab9b15e1224aff88a6ab4bb9bd3ff1b9e16e8ec9352bf9`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, C. Host: H with command-specific target fields/contracts.

Flags: `--app`: R; `--session`: O; `--worktree`: O; `--window-id`: NI; `--window-index`: NI; `--restore-window`: P; `--no-screenshot`: P; `--element-index`: NI — Required after optional NI parse; `--action`: R.

Normalized operation: computer.performSecondaryAction({target(C),elementIndex,action,observe(C)})

Output: formatComputerAction('perform-secondary-action',result,{target(C),observe(C)}) (S5)

Branches/errors: Require app before observe/action validation; no action enum in CLI.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### computer permissions

Source: `src/cli/handlers/computer.ts:41-72`, SHA256 `ab0f29d7e160c6a0dcab9b15e1224aff88a6ab4bb9bd3ff1b9e16e8ec9352bf9`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H. Host: H with command-specific target fields/contracts.

Flags: `--id`: O — accessibility|screenshots.

Normalized operation: computer.permissions(id?{id}:{})

Output: nonDarwin permission-only-on-macOS message; Darwin opened-helper or checked + helper path + permission statuses or unknown + nextStep or already granted + Allow instructions iff launchedHelper

Branches/errors: No openedSettings/permission status based failure. Runtime may open settings; unexecuted S4.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### computer press-key

Source: `src/cli/handlers/computer.ts:158-171`, SHA256 `ab0f29d7e160c6a0dcab9b15e1224aff88a6ab4bb9bd3ff1b9e16e8ec9352bf9`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, C. Host: H with command-specific target fields/contracts.

Flags: `--app`: R; `--session`: O; `--worktree`: O; `--window-id`: NI; `--window-index`: NI; `--restore-window`: P; `--no-screenshot`: P; `--key`: R.

Normalized operation: computer.pressKey({target(C),key,observe(C)})

Output: formatComputerAction('press-key',result,{target(C),observe(C)}) (S5)

Branches/errors: Require app; computerUsePressKeyValidationMessage failure -> invalid_argument (S2 grammar boundary).

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: `src/cli/handlers/computer-action-validation.test.ts:32-107`. No execution.

### computer scroll

Source: `src/cli/handlers/computer.ts:116-129`, SHA256 `ab0f29d7e160c6a0dcab9b15e1224aff88a6ab4bb9bd3ff1b9e16e8ec9352bf9`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, C. Host: H with command-specific target fields/contracts.

Flags: `--app`: R; `--session`: O; `--worktree`: O; `--window-id`: NI; `--window-index`: NI; `--restore-window`: P; `--no-screenshot`: P; `--element-index`: NI; `--x`: N; `--y`: N; `--direction`: R — up|down|left|right; `--pages`: N — If defined >0; fractions allowed.

Normalized operation: computer.scroll({target(C),elementIndex,x,y,direction,pages,observe(C)})

Output: formatComputerAction('scroll',result,{target(C),observe(C)}) (S5)

Branches/errors: Require app; exactly elementIndex OR complete x+y; no coordinate bounds.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### computer set-value

Source: `src/cli/handlers/computer.ts:200-213`, SHA256 `ab0f29d7e160c6a0dcab9b15e1224aff88a6ab4bb9bd3ff1b9e16e8ec9352bf9`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, C. Host: H with command-specific target fields/contracts.

Flags: `--app`: R; `--session`: O; `--worktree`: O; `--window-id`: NI; `--window-index`: NI; `--restore-window`: P; `--no-screenshot`: P; `--element-index`: NI — Required after optional parse; `--value`: RE — Required unless value-stdin present; `--value-stdin`: P.

Normalized operation: computer.setValue({target(C),elementIndex,value,observe(C)})

Output: formatComputerAction('set-value',result,{target(C),observe(C)}) (S5)

Branches/errors: Require app; value and value-stdin presence exclusive; non-TTY UTF8 stdin may be empty, unlike text.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: `src/cli/flags.test.ts:1-11`, `src/cli/handlers/computer-action-validation.test.ts:339-438`. No execution.

### computer type-text

Source: `src/cli/handlers/computer.ts:144-157`, SHA256 `ab0f29d7e160c6a0dcab9b15e1224aff88a6ab4bb9bd3ff1b9e16e8ec9352bf9`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, C. Host: H with command-specific target fields/contracts.

Flags: `--app`: R; `--session`: O; `--worktree`: O; `--window-id`: NI; `--window-index`: NI; `--restore-window`: P; `--no-screenshot`: P; `--text`: R — Required unless text-stdin present; `--text-stdin`: P.

Normalized operation: computer.typeText({target(C),text,observe(C)})

Output: formatComputerAction('type-text',result,{target(C),observe(C)}) (S5)

Branches/errors: Require app; text and text-stdin presence exclusive. stdin must non-TTY; UTF8 buffer; empty stdin text rejects.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: `src/cli/handlers/computer-action-validation.test.ts:339-438`. No execution.

### console

Source: `src/cli/handlers/browser-capture.ts:64-78`, SHA256 `172ad59350524a6fdebeb17a27239eeee0d0cfbaa6d221520c81006d7d303625`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--limit`: PI.

Normalized operation: browser.console({limit only if defined} merged with target(B))

Output: Empty entries -> No console entries; else [level] text newline joined

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### cookie delete

Source: `src/cli/handlers/browser-cookie.ts:79-93`, SHA256 `927c5432634060f74b533e51467bb27765ff9fe4e9e98a1a5e5a3a57d2fa84e7`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--name`: R; `--domain`: O; `--url`: O.

Normalized operation: browser.cookie.delete({name,domain/url only if truthy} merged with target(B))

Output: Cookie name deleted

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### cookie get

Source: `src/cli/handlers/browser-cookie.ts:32-45`, SHA256 `927c5432634060f74b533e51467bb27765ff9fe4e9e98a1a5e5a3a57d2fa84e7`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--url`: O.

Normalized operation: browser.cookie.get({url} merged with target(B))

Output: Empty cookies -> No cookies; else name=value (domain), newline joined

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### cookie set

Source: `src/cli/handlers/browser-cookie.ts:46-78`, SHA256 `927c5432634060f74b533e51467bb27765ff9fe4e9e98a1a5e5a3a57d2fa84e7`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--name`: R; `--value`: RE; `--domain`: O; `--path`: O; `--sameSite`: O; `--secure`: P; `--httpOnly`: P; `--expires`: O — Unlike O: present empty/boolean is invalid; Number must finite >=0, fractions allowed; missing undefined..

Normalized operation: browser.cookie.set({name,value,domain/path/sameSite only if truthy,secure/httpOnly:true if present,expires if defined} merged with target(B))

Output: result.success ? Cookie name set : Failed to set cookie name

Branches/errors: No sameSite enum validation; false success is text, no failure exit.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: `src/cli/flags.test.ts:1-11`, `src/cli/browser-cookie-credentials-empty-value.test.ts:1-117`. No execution.

### dblclick

Source: `src/cli/handlers/browser-interact.ts:45-50`, SHA256 `e2c3ddbdfca82279889d482729d655cc795112c61f104e133d40888e2d63ef9e`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--element`: R.

Normalized operation: browser.dblclick({element} merged with target(B))

Output: Double-clicked input element

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### diagnostics memory

Source: `src/cli/handlers/diagnostics.ts:6-9`, SHA256 `2f7adef6acfa2202e08cd19194aa58a2da8ded74c7926ac638f39a4f2b34a87b`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H. Host: H with command-specific target fields/contracts.

Flags: no command-specific flags.

Normalized operation: diagnostics.memory()

Output: formatMemorySnapshot (S5)

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### dialog accept

Source: `src/cli/handlers/browser-env.ts:106-111`, SHA256 `4760b0388adee9082f3bd2009be652e52648e766d329f97ac2e9359959d21638`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--text`: O.

Normalized operation: browser.dialogAccept({text} merged with target(B))

Output: Dialog accepted

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### dialog dismiss

Source: `src/cli/handlers/browser-env.ts:112-116`, SHA256 `4760b0388adee9082f3bd2009be652e52648e766d329f97ac2e9359959d21638`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O.

Normalized operation: browser.dialogDismiss(target(B))

Output: Dialog dismissed

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### download

Source: `src/cli/handlers/browser-interact.ts:211-217`, SHA256 `e2c3ddbdfca82279889d482729d655cc795112c61f104e133d40888e2d63ef9e`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--selector`: R; `--path`: R.

Normalized operation: browser.download({selector,path} merged with target(B))

Output: Downloaded to input path

Branches/errors: Path passed to target runtime without local resolution/read.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### drag

Source: `src/cli/handlers/browser-interact.ts:117-123`, SHA256 `e2c3ddbdfca82279889d482729d655cc795112c61f104e133d40888e2d63ef9e`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--from`: R; `--to`: R.

Normalized operation: browser.drag({from,to} merged with target(B))

Output: Dragged result.dragged.from → result.dragged.to

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### emulator attach

Source: `src/cli/handlers/emulator.ts:127-145`, SHA256 `95997a18e85e8d447bfcb8145a85d0679d908901ac26f3f8b34f45df691e58da`.

Aliases: none. Positionals bind: device. 

Shared contracts: G, OUT, H, E. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--device`: O; `--focus`: T.

Normalized operation: emulator.attach({device:Odevice,worktree:E.worktree,focus})

Output: Attached to result.info??result .deviceUdid || inputdevice || default emulator; optional preview streamURL

Branches/errors: Only worktree/device/focus public; emulator target not forwarded.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure. Timeout: 180000 ms.

Existing assertion bodies read: `src/cli/handlers/emulator.test.ts:57-205`. No execution.

### emulator ax

Source: `src/cli/handlers/emulator.ts:284-292`, SHA256 `95997a18e85e8d447bfcb8145a85d0679d908901ac26f3f8b34f45df691e58da`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, E. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--device`: O; `--emulator`: O.

Normalized operation: emulator.ax({...E})

Output: Pretty JSON

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### emulator button

Source: `src/cli/handlers/emulator.ts:183-193`, SHA256 `95997a18e85e8d447bfcb8145a85d0679d908901ac26f3f8b34f45df691e58da`.

Aliases: none. Positionals bind: name. 

Shared contracts: G, OUT, H, E. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--device`: O; `--emulator`: O; `--name`: R.

Normalized operation: emulator.button({name,...E})

Output: Pressed name

Branches/errors: No CLI button enum.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### emulator devices

Source: `src/cli/handlers/emulator.ts:122-126`, SHA256 `95997a18e85e8d447bfcb8145a85d0679d908901ac26f3f8b34f45df691e58da`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, E. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O.

Normalized operation: emulator.listDevices({worktree:E.worktree})

Output: Nonarray/empty -> No emulator devices found; rows backend android->Android else iOS; state/name/id missing ->empty

Branches/errors: device/emulator not forwarded (not public on this spec).

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### emulator exec

Source: `src/cli/handlers/emulator.ts:205-215`, SHA256 `95997a18e85e8d447bfcb8145a85d0679d908901ac26f3f8b34f45df691e58da`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, E. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--device`: O; `--emulator`: O; `--command`: R.

Normalized operation: emulator.exec({command,...E})

Output: String result directly, otherwise pretty JSON

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### emulator gesture

Source: `src/cli/handlers/emulator.ts:172-182`, SHA256 `95997a18e85e8d447bfcb8145a85d0679d908901ac26f3f8b34f45df691e58da`.

Aliases: none. Positionals bind: points. 

Shared contracts: G, OUT, H, E. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--device`: O; `--emulator`: O; `--points`: R — Parse JSON array or object.points, length2..64; each object type begin|move|end; x/y finite numbers0..1; optional edge integer0..4; drop extra fields.

Normalized operation: emulator.gesture({points:normalized {type,x,y,edge?}[],...E})

Output: Sent gesture with n points

Branches/errors: Malformed JSON or point -> invalid_argument; no local begin/end ordering rule.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### emulator install

Source: `src/cli/handlers/emulator.ts:240-256`, SHA256 `95997a18e85e8d447bfcb8145a85d0679d908901ac26f3f8b34f45df691e58da`.

Aliases: none. Positionals bind: path. 

Shared contracts: G, OUT, H, E. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--device`: O; `--emulator`: O; `--path`: R — resolveRepoPathArgument local cwd absolute; remote POSIX/Windows/UNC absolute required; `--reinstall`: T.

Normalized operation: emulator.install({path:resolvedPath,reinstall,...E})

Output: Installed resolvedPath

Branches/errors: No local APK read; false reinstall explicit.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: `src/cli/handlers/emulator.test.ts:57-205`. No execution.

### emulator kill

Source: `src/cli/handlers/emulator.ts:216-227`, SHA256 `95997a18e85e8d447bfcb8145a85d0679d908901ac26f3f8b34f45df691e58da`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, E. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--device`: O; `--emulator`: O.

Normalized operation: emulator.kill({...E})

Output: Killed result.deviceUdid || inputdevice || emulator

Branches/errors: No returned verdict changes exit.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### emulator launch

Source: `src/cli/handlers/emulator.ts:257-268`, SHA256 `95997a18e85e8d447bfcb8145a85d0679d908901ac26f3f8b34f45df691e58da`.

Aliases: none. Positionals bind: package. 

Shared contracts: G, OUT, H, E. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--device`: O; `--emulator`: O; `--package`: R; `--activity`: O.

Normalized operation: emulator.launch({package,activity,...E})

Output: Launched package

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### emulator list

Source: `src/cli/handlers/emulator.ts:117-121`, SHA256 `95997a18e85e8d447bfcb8145a85d0679d908901ac26f3f8b34f45df691e58da`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, E. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O.

Normalized operation: emulator.list({worktree:E.worktree})

Output: Pretty JSON

Branches/errors: device/emulator not forwarded (only worktree is public on this list spec).

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### emulator logcat

Source: `src/cli/handlers/emulator.ts:293-302`, SHA256 `95997a18e85e8d447bfcb8145a85d0679d908901ac26f3f8b34f45df691e58da`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, E. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--device`: O; `--emulator`: O; `--lines`: PI.

Normalized operation: emulator.logcat({lines,...E})

Output: formatLogcat (S5)

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### emulator permissions

Source: `src/cli/handlers/emulator.ts:269-283`, SHA256 `95997a18e85e8d447bfcb8145a85d0679d908901ac26f3f8b34f45df691e58da`.

Aliases: none. Positionals bind: op, package, permission. 

Shared contracts: G, OUT, H, E. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--device`: O; `--emulator`: O; `--op`: R — grant|revoke|reset; `--package`: O; `--permission`: O.

Normalized operation: emulator.permissions({op,package:request.packageName,permission,...E})

Output: reset -> Reset runtime permissions; otherwise op package

Branches/errors: reset forbids truthy package/permission; grant/revoke require nonempty package and permission.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: `src/cli/handlers/emulator.test.ts:57-205`. No execution.

### emulator rotate

Source: `src/cli/handlers/emulator.ts:194-204`, SHA256 `95997a18e85e8d447bfcb8145a85d0679d908901ac26f3f8b34f45df691e58da`.

Aliases: none. Positionals bind: orientation. 

Shared contracts: G, OUT, H, E. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--device`: O; `--emulator`: O; `--orientation`: R.

Normalized operation: emulator.rotate({orientation,...E})

Output: Rotated orientation

Branches/errors: No CLI orientation enum.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### emulator shutdown

Source: `src/cli/handlers/emulator.ts:228-239`, SHA256 `95997a18e85e8d447bfcb8145a85d0679d908901ac26f3f8b34f45df691e58da`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, E. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--device`: O; `--emulator`: O.

Normalized operation: emulator.shutdown({...E})

Output: Shut down result.deviceUdid || inputdevice || emulator

Branches/errors: No returned verdict changes exit.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### emulator tap

Source: `src/cli/handlers/emulator.ts:146-160`, SHA256 `95997a18e85e8d447bfcb8145a85d0679d908901ac26f3f8b34f45df691e58da`.

Aliases: none. Positionals bind: x, y. 

Shared contracts: G, OUT, H, E. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--device`: O; `--emulator`: O; `--x`: RF — 0..1 inclusive; `--y`: RF — 0..1 inclusive.

Normalized operation: emulator.tap({x,y,...E})

Output: Tapped (x,y)

Branches/errors: Target resolution precedes numeric validation.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### emulator type

Source: `src/cli/handlers/emulator.ts:161-171`, SHA256 `95997a18e85e8d447bfcb8145a85d0679d908901ac26f3f8b34f45df691e58da`.

Aliases: none. Positionals bind: text. 

Shared contracts: G, OUT, H, E. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--device`: O; `--emulator`: O; `--text`: R.

Normalized operation: emulator.type({text,...E})

Output: Typed text

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### environment add

Source: `src/cli/handlers/environment.ts:18-33`, SHA256 `2c0f58597279b6c9667b13b179d874a4a43cd9390b21ecd4edc05cdb9c677fa8`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, ENV. Host: Pinned local; see HOOK/ENV.

Flags: `--name`: R; `--pairing-code`: R; `--page`: IG.

Normalized operation: addEnvironmentFromPairingCode(localDataPath,{name,pairingCode}) -> redact -> localSuccess({environment})

Output: Saved environment name (id).

Branches/errors: Explicit environment accepted but unused for routing; add store validation S3.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### environment list

Source: `src/cli/handlers/environment.ts:62-70`, SHA256 `2c0f58597279b6c9667b13b179d874a4a43cd9390b21ecd4edc05cdb9c677fa8`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, ENV. Host: Pinned local; see HOOK/ENV.

Flags: `--page`: IG.

Normalized operation: listEnvironments(localDataPath).map(redact) -> localSuccess({environments})

Output: formatEnvironmentList (S5)

Branches/errors: Reject explicit environment or pairing-code.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: `src/cli/index-local-command-routing-flags.test.ts:1-184`. No execution.

### environment rm

Source: `src/cli/handlers/environment.ts:80-89`, SHA256 `2c0f58597279b6c9667b13b179d874a4a43cd9390b21ecd4edc05cdb9c677fa8`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, ENV. Host: Pinned local; see HOOK/ENV.

Flags: `--environment`: R; `--page`: IG.

Normalized operation: removeEnvironment(localDataPath,environment) -> redact -> localSuccess({removed})

Output: Removed environment name (id).

Branches/errors: Pairing-code validates globally but ignored; no confirmation.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: `src/cli/index-local-command-routing-flags.test.ts:1-184`. No execution.

### environment show

Source: `src/cli/handlers/environment.ts:71-79`, SHA256 `2c0f58597279b6c9667b13b179d874a4a43cd9390b21ecd4edc05cdb9c677fa8`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, ENV. Host: Pinned local; see HOOK/ENV.

Flags: `--environment`: R; `--page`: IG.

Normalized operation: resolveEnvironment(localDataPath,environment) -> redact -> localSuccess({environment})

Output: formatEnvironment (S5)

Branches/errors: Pairing-code if supplied validates globally but ignored here; lookup errors S3.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: `src/cli/index-local-command-routing-flags.test.ts:1-184`. No execution.

### eval

Source: `src/cli/handlers/browser-nav.ts:74-79`, SHA256 `b39225ef7c3e844d00b9c414f438af04ed1dd200a17ef6190193b4b128458ec8`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--expression`: R.

Normalized operation: browser.eval({expression} merged with target(B))

Output: result.result value returned directly to console.log

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### exec

Source: `src/cli/handlers/browser-tab.ts:89-94`, SHA256 `50c0426b92932da0f8a6d63f6811eff4a8c80dcec715d2b6acbae330824c858e`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--command`: R.

Normalized operation: browser.exec({command} merged with target(B))

Output: Pretty JSON

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### file diff

Source: `src/cli/handlers/file.ts:205-216`, SHA256 `c9e8af7f7551ff5221223afa7f352a141cf0ccd49661ac5ddd2df3f45fa70cee`.

Aliases: none. Positionals bind: path. 

Shared contracts: G, OUT, H, FILE. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O — Presence requires R; FILE targeting; `--path`: R; `--staged`: T.

Normalized operation: files.openDiff({worktree,relativePath:FILE(path),staged})

Output: opened -> Opened diff for result.relativePath.; else Did not open diff for result.relativePath: result.kind file.

Branches/errors: staged false explicitly sent; false opened no exit failure.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### file open

Source: `src/cli/handlers/file.ts:195-204`, SHA256 `c9e8af7f7551ff5221223afa7f352a141cf0ccd49661ac5ddd2df3f45fa70cee`.

Aliases: none. Positionals bind: path. 

Shared contracts: G, OUT, H, FILE. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O — Presence requires R; FILE targeting; `--path`: R.

Normalized operation: files.open({worktree,relativePath:FILE(path)})

Output: opened -> Opened result.relativePath.; else Did not open result.relativePath: result.kind file.

Branches/errors: False opened no exit failure.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### file open-changed

Source: `src/cli/handlers/file.ts:217-277`, SHA256 `c9e8af7f7551ff5221223afa7f352a141cf0ccd49661ac5ddd2df3f45fa70cee`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, FILE. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O — Presence requires R; FILE targeting; `--mode`: O — Absent default diff; present must R and edit|diff|both.

Normalized operation: git.status({worktree}); iterate entries -> files.open / files.openDiff; return status envelope with {worktree,mode,opened,skipped,totalChanged:entries.length}

Output: totalChanged0 -> No changed files.; else Opened opened.length changed file targets.; append Skipped count and - path: reason??not opened lines when any.

Branches/errors: edit: skip deleted/unresolved-conflict, deduplicate paths. diff: skip unresolved-conflict, staged=entry.area===staged; both does edit then diff for eligible entry. Returned opened/kind recorded; no result-based failure.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: `src/cli/handlers/file.test.ts:204-274`. No execution.

### fill

Source: `src/cli/handlers/browser-interact.ts:51-61`, SHA256 `e2c3ddbdfca82279889d482729d655cc795112c61f104e133d40888e2d63ef9e`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--element`: R; `--value`: R.

Normalized operation: browser.fill({element,value} merged with target(B))

Output: Filled result.filled

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### find

Source: `src/cli/handlers/browser-interact.ts:196-210`, SHA256 `e2c3ddbdfca82279889d482729d655cc795112c61f104e133d40888e2d63ef9e`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--locator`: R; `--value`: R; `--action`: R; `--text`: O.

Normalized operation: browser.find({locator,value,action,text} merged with target(B))

Output: Pretty JSON

Branches/errors: No CLI locator/action enum validation.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### focus

Source: `src/cli/handlers/browser-interact.ts:81-86`, SHA256 `e2c3ddbdfca82279889d482729d655cc795112c61f104e133d40888e2d63ef9e`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--element`: R.

Normalized operation: browser.focus({element} merged with target(B))

Output: Focused result.focused

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### forward

Source: `src/cli/handlers/browser-nav.ts:66-73`, SHA256 `b39225ef7c3e844d00b9c414f438af04ed1dd200a17ef6190193b4b128458ec8`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O.

Normalized operation: browser.forward(target(B))

Output: Truthy result?.url -> Navigated forward to URL; else Navigated forward

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### full-screenshot

Source: `src/cli/handlers/browser-nav.ts:126-134`, SHA256 `b39225ef7c3e844d00b9c414f438af04ed1dd200a17ef6190193b4b128458ec8`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--format`: O — exact jpeg else png, including missing/invalid.

Normalized operation: browser.fullScreenshot({format} merged with target(B))

Output: Full-page screenshot captured (result.format)

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### geolocation

Source: `src/cli/handlers/browser-env.ts:38-53`, SHA256 `4760b0388adee9082f3bd2009be652e52648e766d329f97ac2e9359959d21638`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--latitude`: RF; `--longitude`: RF; `--accuracy`: O — if truthy Number finite >0; otherwise omitted.

Normalized operation: browser.geolocation({latitude,longitude,accuracy?} merged with target(B))

Output: Geolocation set to returned latitude, longitude

Branches/errors: No CLI geographic range bound.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### get

Source: `src/cli/handlers/browser-interact.ts:142-152`, SHA256 `e2c3ddbdfca82279889d482729d655cc795112c61f104e133d40888e2d63ef9e`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--what`: R; `--element`: O.

Normalized operation: browser.get({what,selector:element} merged with target(B))

Output: String result directly; otherwise pretty JSON

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### goto

Source: `src/cli/handlers/browser-nav.ts:43-53`, SHA256 `b39225ef7c3e844d00b9c414f438af04ed1dd200a17ef6190193b4b128458ec8`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--url`: R.

Normalized operation: browser.goto({url} merged with target(B))

Output: Navigated to result.url — result.title

Branches/errors: timeoutMs=60000; URL syntax not validated here.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### highlight

Source: `src/cli/handlers/browser-interact.ts:218-223`, SHA256 `e2c3ddbdfca82279889d482729d655cc795112c61f104e133d40888e2d63ef9e`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--selector`: R.

Normalized operation: browser.highlight({selector} merged with target(B))

Output: Highlighted input selector

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### host list

Source: `src/cli/handlers/environment.ts:37-61`, SHA256 `2c0f58597279b6c9667b13b179d874a4a43cd9390b21ecd4edc05cdb9c677fa8`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, ENV. Host: Pinned local; see HOOK/ENV.

Flags: `--page`: IG.

Normalized operation: local listEnvironments -> {kind:environment,name,id,selector:--environment name}; local listSshTargets -> {kind:ssh,name:label,id,selector:--host ssh:id}; prepend local row -> localSuccess({hosts})

Output: formatHostList (S5)

Branches/errors: Reject explicit remote selection even though pinned local; SSH list fallback is separate host-selector-alternatives boundary.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: `src/cli/index-local-command-routing-flags.test.ts:1-184`. No execution.

### hover

Source: `src/cli/handlers/browser-interact.ts:111-116`, SHA256 `e2c3ddbdfca82279889d482729d655cc795112c61f104e133d40888e2d63ef9e`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--element`: R.

Normalized operation: browser.hover({element} merged with target(B))

Output: Hovered result.hovered

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### inserttext

Source: `src/cli/handlers/browser-interact.ts:164-169`, SHA256 `e2c3ddbdfca82279889d482729d655cc795112c61f104e133d40888e2d63ef9e`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--text`: R.

Normalized operation: browser.keyboardInsertText({text} merged with target(B))

Output: Text inserted

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### intercept disable

Source: `src/cli/handlers/browser-capture.ts:33-40`, SHA256 `172ad59350524a6fdebeb17a27239eeee0d0cfbaa6d221520c81006d7d303625`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O.

Normalized operation: browser.intercept.disable(target(B))

Output: Interception disabled

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### intercept enable

Source: `src/cli/handlers/browser-capture.ts:16-32`, SHA256 `172ad59350524a6fdebeb17a27239eeee0d0cfbaa6d221520c81006d7d303625`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--patterns`: O — truthy -> split comma trim, retain empties; otherwise omitted.

Normalized operation: browser.intercept.enable({patterns?} merged with target(B))

Output: Interception enabled for joined result.patterns or *

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### intercept list

Source: `src/cli/handlers/browser-capture.ts:41-53`, SHA256 `172ad59350524a6fdebeb17a27239eeee0d0cfbaa6d221520c81006d7d303625`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O.

Normalized operation: browser.intercept.list(target(B))

Output: Empty requests -> No paused requests; else [id] method url (resourceType), newline joined

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### is

Source: `src/cli/handlers/browser-interact.ts:153-163`, SHA256 `e2c3ddbdfca82279889d482729d655cc795112c61f104e133d40888e2d63ef9e`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--what`: R; `--element`: R.

Normalized operation: browser.is({what,selector:element} merged with target(B))

Output: String(result)

Branches/errors: A false result prints false without a failure exit.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### keypress

Source: `src/cli/handlers/browser-interact.ts:102-110`, SHA256 `e2c3ddbdfca82279889d482729d655cc795112c61f104e133d40888e2d63ef9e`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--key`: R.

Normalized operation: browser.keypress({key} merged with target(B))

Output: Pressed result.pressed

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### linear assignee clear

Source: `src/cli/handlers/linear.ts:171-176`, SHA256 `dd1ceb4457dbd1f94017183cd62e80d9a81f9f2b4fe0b36ab47fe45eef61da93`.

Aliases: none. Positionals bind: id. 

Shared contracts: G, OUT, H, LCTX. Host: H with command-specific target fields/contracts.

Flags: `--id`: O; `--current`: T; `--workspace`: O — all rejected for writes.

Normalized operation: linear.issueUpdateTask({LCTX,operation:'assignee',assigneeId:null})

Output: formatLinearTaskUpdate (S5)

Branches/errors: Explicit null clears; no to-id/me flags.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure. Timeout: 75000 ms.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### linear assignee set

Source: `src/cli/handlers/linear.ts:169-170`, SHA256 `dd1ceb4457dbd1f94017183cd62e80d9a81f9f2b4fe0b36ab47fe45eef61da93`.

Aliases: none. Positionals bind: id. 

Shared contracts: G, OUT, H, LCTX. Host: H with command-specific target fields/contracts.

Flags: `--id`: O; `--current`: T; `--workspace`: O — all rejected for writes; `--me`: T; `--to-id`: O.

Normalized operation: linear.issueUpdateTask({LCTX,operation:'assignee',assigneeMe:true if me else assigneeId:to-id})

Output: formatLinearTaskUpdate (S5)

Branches/errors: Exactly one true me or truthy to-id required.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure. Timeout: 75000 ms.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### linear attach

Source: `src/cli/handlers/linear.ts:229-240`, SHA256 `dd1ceb4457dbd1f94017183cd62e80d9a81f9f2b4fe0b36ab47fe45eef61da93`.

Aliases: none. Positionals bind: id. 

Shared contracts: G, OUT, H, LCTX. Host: H with command-specific target fields/contracts.

Flags: `--id`: O; `--current`: T; `--workspace`: O — all rejected for writes; `--url`: R — new URL requires protocol http:|https:; preserve input string; `--title`: O; `--write-id`: O — If present requires R plus isLinearUuid; failure linear_invalid_write_id (S2 UUID grammar).

Normalized operation: linear.issueAttachLink({LCTX,url,title,writeId})

Output: formatLinearAttach (S5)

Branches/errors: Invalid URL -> linear_invalid_url.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure. Timeout: 75000 ms.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### linear comment add

Source: `src/cli/handlers/linear.ts:216-228`, SHA256 `dd1ceb4457dbd1f94017183cd62e80d9a81f9f2b4fe0b36ab47fe45eef61da93`.

Aliases: none. Positionals bind: id. 

Shared contracts: G, OUT, H, LCTX, BODY. Host: H with command-specific target fields/contracts.

Flags: `--id`: O; `--current`: T; `--workspace`: O — all rejected for writes; `--body`: RE — Presence-based BODY; optional/required per row; `--body-file`: R — Required value only if present; BODY; `--reply-to`: O; `--write-id`: O — If present requires R plus isLinearUuid; failure linear_invalid_write_id (S2 UUID grammar).

Normalized operation: linear.issueAddComment({LCTX,body,replyTo,writeId})

Output: formatLinearCommentAdd (S5)

Branches/errors: BODY required, including empty allowed; read body before write target validation.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure. Timeout: 75000 ms.

Existing assertion bodies read: `src/cli/handlers/linear.test.ts:280-416`. No execution.

### linear create

Source: `src/cli/handlers/linear.ts:241-275`, SHA256 `dd1ceb4457dbd1f94017183cd62e80d9a81f9f2b4fe0b36ab47fe45eef61da93`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, BODY. Host: H with command-specific target fields/contracts.

Flags: `--title`: R; `--body`: RE — Presence-based BODY; optional/required per row; `--body-file`: R — Required value only if present; BODY; `--team`: O; `--project`: O; `--state`: O; `--assignee`: O; `--priority`: O — If present priority-name R rule; `--estimate`: O — If present R Number integer>=0; `--due-date`: O — If present required strict date; `--label`: REP; `--parent`: O; `--parent-current`: T; `--workspace`: O — all rejected; `--write-id`: O — If present requires R plus isLinearUuid; failure linear_invalid_write_id (S2 UUID grammar).

Normalized operation: linear.issueCreate({title,body only if defined,teamInput,projectInput,state,assignee,priority,estimate,dueDate,labels:REP,parentInput:parent,parentCurrent,workspaceId,writeId,context})

Output: formatLinearCreate (S5)

Branches/errors: Truthy parent and true parent-current exclusive. Labels absent ->[]; priority/estimate/date absence ->undefined. Optional body, required title only in CLI.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure. Timeout: 75000 ms.

Existing assertion bodies read: `src/cli/handlers/linear.test.ts:545-648`. No execution.

### linear due-date clear

Source: `src/cli/handlers/linear.ts:207-212`, SHA256 `dd1ceb4457dbd1f94017183cd62e80d9a81f9f2b4fe0b36ab47fe45eef61da93`.

Aliases: none. Positionals bind: id. 

Shared contracts: G, OUT, H, LCTX. Host: H with command-specific target fields/contracts.

Flags: `--id`: O; `--current`: T; `--workspace`: O — all rejected for writes.

Normalized operation: linear.issueUpdateTask({LCTX,operation:'dueDate',dueDate:null})

Output: formatLinearTaskUpdate (S5)

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure. Timeout: 75000 ms.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### linear due-date set

Source: `src/cli/handlers/linear.ts:201-206`, SHA256 `dd1ceb4457dbd1f94017183cd62e80d9a81f9f2b4fe0b36ab47fe45eef61da93`.

Aliases: none. Positionals bind: id. 

Shared contracts: G, OUT, H, LCTX. Host: H with command-specific target fields/contracts.

Flags: `--id`: O; `--current`: T; `--workspace`: O — all rejected for writes; `--to`: R — YYYY-MM-DD exact and real UTC calendar date; preserve string; years00..99 fail Date.UTC equality.

Normalized operation: linear.issueUpdateTask({LCTX,operation:'dueDate',dueDate:to})

Output: formatLinearTaskUpdate (S5)

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure. Timeout: 75000 ms.

Existing assertion bodies read: `src/cli/handlers/linear.test.ts:280-416`. No execution.

### linear estimate clear

Source: `src/cli/handlers/linear.ts:195-200`, SHA256 `dd1ceb4457dbd1f94017183cd62e80d9a81f9f2b4fe0b36ab47fe45eef61da93`.

Aliases: none. Positionals bind: id. 

Shared contracts: G, OUT, H, LCTX. Host: H with command-specific target fields/contracts.

Flags: `--id`: O; `--current`: T; `--workspace`: O — all rejected for writes.

Normalized operation: linear.issueUpdateTask({LCTX,operation:'estimate',estimate:null})

Output: formatLinearTaskUpdate (S5)

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure. Timeout: 75000 ms.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### linear estimate set

Source: `src/cli/handlers/linear.ts:189-194`, SHA256 `dd1ceb4457dbd1f94017183cd62e80d9a81f9f2b4fe0b36ab47fe45eef61da93`.

Aliases: none. Positionals bind: id. 

Shared contracts: G, OUT, H, LCTX. Host: H with command-specific target fields/contracts.

Flags: `--id`: O; `--current`: T; `--workspace`: O — all rejected for writes; `--to`: R — Number must integer>=0; no safe bound.

Normalized operation: linear.issueUpdateTask({LCTX,operation:'estimate',estimate:Number(to)})

Output: formatLinearTaskUpdate (S5)

Branches/errors: Unlike save-issue cannot pass null/fraction/negative.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure. Timeout: 75000 ms.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### linear issue

Source: `src/cli/handlers/linear.ts:79-88`, SHA256 `dd1ceb4457dbd1f94017183cd62e80d9a81f9f2b4fe0b36ab47fe45eef61da93`.

Aliases: none. Positionals bind: id. 

Shared contracts: G, OUT, H. Host: H with command-specific target fields/contracts.

Flags: `--id`: O; `--current`: T; `--workspace`: O — all rejected; `--full`: T; `--comments`: T; `--children`: T; `--attachments`: T; `--relations`: T; `--activity`: T; `--depth`: NI — Presence requires effective children/full; provided >5 rejects; absent2; otherwise0..5..

Normalized operation: linear.issueContext({input:id,current:id?false:Tcurrent,workspaceId,include:{comments,children,attachments,relations,activity}:full OR respective flag,depth:provided??2,context})

Output: text warnings then formatLinearIssue (S5)

Branches/errors: Unlike write targets, id wins over current instead of error; neither allowed to runtime. Full true uses120000ms, otherwise unspecified/default. Depth presence with false children rejects even if empty/boolean.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure. Timeout: full true120000 else default ms.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### linear label add

Source: `src/cli/handlers/linear.ts:213-213`, SHA256 `dd1ceb4457dbd1f94017183cd62e80d9a81f9f2b4fe0b36ab47fe45eef61da93`.

Aliases: none. Positionals bind: id. Factory specialization: `runLabelUpdate(ctx,'add')`.

Shared contracts: G, OUT, H, LCTX. Host: H with command-specific target fields/contracts.

Flags: `--id`: O; `--current`: T; `--workspace`: O — all rejected for writes; `--label`: REP — At least one retained member required.

Normalized operation: linear.issueUpdateTask({LCTX,operation:'labels',labelMode:'add',labels:REP})

Output: formatLinearTaskUpdate (S5)

Branches/errors: No empty-list clear via set; [] rejects.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure. Timeout: 75000 ms.

Existing assertion bodies read: `src/cli/handlers/linear.test.ts:280-416`. No execution.

### linear label remove

Source: `src/cli/handlers/linear.ts:214-214`, SHA256 `dd1ceb4457dbd1f94017183cd62e80d9a81f9f2b4fe0b36ab47fe45eef61da93`.

Aliases: none. Positionals bind: id. Factory specialization: `runLabelUpdate(ctx,'remove')`.

Shared contracts: G, OUT, H, LCTX. Host: H with command-specific target fields/contracts.

Flags: `--id`: O; `--current`: T; `--workspace`: O — all rejected for writes; `--label`: REP — At least one retained member required.

Normalized operation: linear.issueUpdateTask({LCTX,operation:'labels',labelMode:'remove',labels:REP})

Output: formatLinearTaskUpdate (S5)

Branches/errors: No empty-list clear via set; [] rejects.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure. Timeout: 75000 ms.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### linear label set

Source: `src/cli/handlers/linear.ts:215-215`, SHA256 `dd1ceb4457dbd1f94017183cd62e80d9a81f9f2b4fe0b36ab47fe45eef61da93`.

Aliases: none. Positionals bind: id. Factory specialization: `runLabelUpdate(ctx,'set')`.

Shared contracts: G, OUT, H, LCTX. Host: H with command-specific target fields/contracts.

Flags: `--id`: O; `--current`: T; `--workspace`: O — all rejected for writes; `--label`: REP — At least one retained member required.

Normalized operation: linear.issueUpdateTask({LCTX,operation:'labels',labelMode:'set',labels:REP})

Output: formatLinearTaskUpdate (S5)

Branches/errors: No empty-list clear via set; [] rejects.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure. Timeout: 75000 ms.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### linear list

Source: `src/cli/handlers/linear.ts:144-158`, SHA256 `dd1ceb4457dbd1f94017183cd62e80d9a81f9f2b4fe0b36ab47fe45eef61da93`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H. Host: H with command-specific target fields/contracts.

Flags: `--filter`: O — Default assigned; assigned|created|all|completed|open; `--team`: O; `--limit`: PI; `--workspace`: O.

Normalized operation: linear.agentIssueList({filter,teamInput:team,limit,workspaceId})

Output: text warnings then formatLinearIssueList (S5)

Branches/errors: Unlike search/project-list no CLI clamping.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### linear list-issues

Source: `src/cli/handlers/linear-list-issues.ts:15-45`, SHA256 `10ca237cc07854b22b82ae19412e61f439523cfb1c9491af0bcbe9da5c36fd32`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H. Host: H with command-specific target fields/contracts.

Flags: `--team`: O; `--cycle`: O; `--label`: O — Repeated labels remain NUL-concatenated string; not REP; `--limit`: PI; `--query`: O; `--state`: O; `--cursor`: O; `--order-by`: O — createdAt|updatedAt; `--project`: O; `--release`: O; `--assignee`: O; `--delegate`: O; `--parent-id`: O; `--priority`: NI — At most4; `--created-at`: O; `--updated-at`: O; `--include-archived`: T; `--workspace`: O.

Normalized operation: linear.mcpListIssues({team,cycle,label,limit,query,state,cursor,orderBy,project,release,assignee,delegate,parentId,priority,createdAt,updatedAt,includeArchived,workspaceId})

Output: text warnings then formatLinearMcpIssueList (S5)

Branches/errors: No date-filter parsing; false includeArchived explicitly sent; warnings text only.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### linear priority clear

Source: `src/cli/handlers/linear.ts:183-188`, SHA256 `dd1ceb4457dbd1f94017183cd62e80d9a81f9f2b4fe0b36ab47fe45eef61da93`.

Aliases: none. Positionals bind: id. 

Shared contracts: G, OUT, H, LCTX. Host: H with command-specific target fields/contracts.

Flags: `--id`: O; `--current`: T; `--workspace`: O — all rejected for writes.

Normalized operation: linear.issueUpdateTask({LCTX,operation:'priority',priority:0})

Output: formatLinearTaskUpdate (S5)

Branches/errors: Clear means numeric0, not null.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure. Timeout: 75000 ms.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### linear priority set

Source: `src/cli/handlers/linear.ts:177-182`, SHA256 `dd1ceb4457dbd1f94017183cd62e80d9a81f9f2b4fe0b36ab47fe45eef61da93`.

Aliases: none. Positionals bind: id. 

Shared contracts: G, OUT, H, LCTX. Host: H with command-specific target fields/contracts.

Flags: `--id`: O; `--current`: T; `--workspace`: O — all rejected for writes; `--to`: R — toLocaleLowerCase then none:0 urgent:1 high:2 medium:3 low:4; numeric strings rejected.

Normalized operation: linear.issueUpdateTask({LCTX,operation:'priority',priority:mapped-name})

Output: formatLinearTaskUpdate (S5)

Branches/errors: Locale lowercase without trimming; names only.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure. Timeout: 75000 ms.

Existing assertion bodies read: `src/cli/handlers/linear.test.ts:280-416`. No execution.

### linear project list

Source: `src/cli/handlers/linear.ts:131-143`, SHA256 `dd1ceb4457dbd1f94017183cd62e80d9a81f9f2b4fe0b36ab47fe45eef61da93`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H. Host: H with command-specific target fields/contracts.

Flags: `--query`: O; `--limit`: PI — Absent20; positive integers cap50; shared clamp read at agent-access.ts188.; `--workspace`: O.

Normalized operation: linear.agentProjectList({query,limit:min(provided??20,50),workspaceId})

Output: text warnings then formatLinearProjectList (S5)

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### linear relation add

Source: `src/cli/handlers/linear.ts:77-77`, SHA256 `dd1ceb4457dbd1f94017183cd62e80d9a81f9f2b4fe0b36ab47fe45eef61da93`.

Aliases: none. Positionals bind: id. Factory specialization: `linearRelationWriteHandler('add')`.

Shared contracts: G, OUT, H, LCTX. Host: H with command-specific target fields/contracts.

Flags: `--id`: O; `--current`: T; `--workspace`: O — all rejected for writes; `--related`: R; `--type`: R — blocks->blocks, blocked-by->blockedBy, related->relatedTo, duplicate-of->duplicateOf.

Normalized operation: linear.issueRelationWrite({LCTX,relatedInput:related,relationship:mapped type,operation:'add'})

Output: formatLinearRelationWrite (S5)

Branches/errors: Invalid relationship -> invalid_argument; no write-id on this command.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure. Timeout: 75000 ms.

Existing assertion bodies read: `src/cli/handlers/linear.test.ts:280-416`. No execution.

### linear relation remove

Source: `src/cli/handlers/linear.ts:78-78`, SHA256 `dd1ceb4457dbd1f94017183cd62e80d9a81f9f2b4fe0b36ab47fe45eef61da93`.

Aliases: `linear relation rm`. Positionals bind: id. Factory specialization: `linearRelationWriteHandler('remove')`.

Shared contracts: G, OUT, H, LCTX. Host: H with command-specific target fields/contracts.

Flags: `--id`: O; `--current`: T; `--workspace`: O — all rejected for writes; `--related`: R; `--type`: R — blocks->blocks, blocked-by->blockedBy, related->relatedTo, duplicate-of->duplicateOf.

Normalized operation: linear.issueRelationWrite({LCTX,relatedInput:related,relationship:mapped type,operation:'remove'})

Output: formatLinearRelationWrite (S5)

Branches/errors: Invalid relationship -> invalid_argument; no write-id on this command.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure. Timeout: 75000 ms.

Existing assertion bodies read: `src/cli/handlers/linear.test.ts:280-416`. No execution.

### linear save-issue

Source: `src/cli/handlers/linear-save-issue.ts:12-18`, SHA256 `3fc9ff4463d6bbbceae2f8041d4fbd06fa6e9561b94d577bbdb7465ca391bdd2`.

Aliases: none. Positionals bind: id. 

Shared contracts: G, OUT, H, BODY. Host: H with command-specific target fields/contracts.

Flags: `--id`: O; `--current`: T; `--workspace`: O — all rejected for writes; `--body`: RE — Presence-based BODY; optional/required per row; `--body-file`: R — Required value only if present; BODY; `--team`: O; `--title`: O; `--description`: O; `--state`: O; `--assignee`: O — Exact null -> null; `--priority`: O — Presence uses required priority-name rule; see priority set; `--estimate`: NULLN; `--due-date`: O — Presence exact null clears; else strict date rule; `--label`: REP — Absent undefined; present boolean/empty ->[]; `--project`: O — Exact null clears; `--parent-id`: O — Exact null clears; `--write-id`: O — If present requires R plus isLinearUuid; failure linear_invalid_write_id (S2 UUID grammar).

Normalized operation: linear.saveIssue({input:id,current,workspaceId,context,team,title,description:description??body,state,assignee,priority,estimate,dueDate,labels,project,parentId,writeId})

Output: formatLinearSaveIssue (S5)

Branches/errors: id/current exclusive but neither is allowed (create mode). workspace all rejected. Body+nonempty description exclusive. Estimate allows finite negative/fraction values at CLI boundary and exact null. No required title/team here; runtime validation S3.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure. Timeout: 75000 ms.

Existing assertion bodies read: `src/cli/handlers/linear.test.ts:545-648`. No execution.

### linear search

Source: `src/cli/handlers/linear.ts:89-100`, SHA256 `dd1ceb4457dbd1f94017183cd62e80d9a81f9f2b4fe0b36ab47fe45eef61da93`.

Aliases: none. Positionals bind: query. 

Shared contracts: G, OUT, H. Host: H with command-specific target fields/contracts.

Flags: `--query`: R; `--limit`: PI — Absent20; positive integers cap50; shared clamp read at agent-access.ts188.; `--workspace`: O.

Normalized operation: linear.agentSearchIssues({query,limit:min(provided??20,50),workspaceId})

Output: text warnings then formatLinearSearch (S5)

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### linear status set

Source: `src/cli/handlers/linear.ts:159-168`, SHA256 `dd1ceb4457dbd1f94017183cd62e80d9a81f9f2b4fe0b36ab47fe45eef61da93`.

Aliases: none. Positionals bind: id. 

Shared contracts: G, OUT, H, LCTX. Host: H with command-specific target fields/contracts.

Flags: `--id`: O; `--current`: T; `--workspace`: O — all rejected for writes; `--to`: R.

Normalized operation: linear.issueSetState({LCTX,to})

Output: formatLinearStatusSet (S5)

Branches/errors: No local state-name enum.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure. Timeout: 75000 ms.

Existing assertion bodies read: `src/cli/handlers/linear.test.ts:280-416`. No execution.

### linear team labels

Source: `src/cli/handlers/linear.ts:124-130`, SHA256 `dd1ceb4457dbd1f94017183cd62e80d9a81f9f2b4fe0b36ab47fe45eef61da93`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H. Host: H with command-specific target fields/contracts.

Flags: `--team`: R; `--workspace`: O.

Normalized operation: linear.agentTeamLabels({teamInput:team,workspaceId})

Output: formatLinearTeamLabels (S5)

Branches/errors: No warnings printed by this handler.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### linear team list

Source: `src/cli/handlers/linear.ts:101-109`, SHA256 `dd1ceb4457dbd1f94017183cd62e80d9a81f9f2b4fe0b36ab47fe45eef61da93`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H. Host: H with command-specific target fields/contracts.

Flags: `--workspace`: O.

Normalized operation: linear.agentTeamList({workspaceId})

Output: text warnings then formatLinearTeamList (S5)

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### linear team members

Source: `src/cli/handlers/linear.ts:110-116`, SHA256 `dd1ceb4457dbd1f94017183cd62e80d9a81f9f2b4fe0b36ab47fe45eef61da93`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H. Host: H with command-specific target fields/contracts.

Flags: `--team`: R; `--workspace`: O.

Normalized operation: linear.agentTeamMembers({teamInput:team,workspaceId})

Output: formatLinearTeamMembers (S5)

Branches/errors: No warnings printed by this handler.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### linear team states

Source: `src/cli/handlers/linear.ts:117-123`, SHA256 `dd1ceb4457dbd1f94017183cd62e80d9a81f9f2b4fe0b36ab47fe45eef61da93`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H. Host: H with command-specific target fields/contracts.

Flags: `--team`: R; `--workspace`: O.

Normalized operation: linear.agentTeamStates({teamInput:team,workspaceId})

Output: formatLinearTeamStates (S5)

Branches/errors: No warnings printed by this handler.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### mouse down

Source: `src/cli/handlers/browser-interact.ts:177-182`, SHA256 `e2c3ddbdfca82279889d482729d655cc795112c61f104e133d40888e2d63ef9e`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--button`: O.

Normalized operation: browser.mouseDown({button} merged with target(B))

Output: Mouse button input-or-left pressed

Branches/errors: left is text fallback only; missing button remains undefined in payload; no CLI enum.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### mouse move

Source: `src/cli/handlers/browser-interact.ts:170-176`, SHA256 `e2c3ddbdfca82279889d482729d655cc795112c61f104e133d40888e2d63ef9e`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--x`: RF; `--y`: RF.

Normalized operation: browser.mouseMove({x,y} merged with target(B))

Output: Mouse moved to x,y

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### mouse up

Source: `src/cli/handlers/browser-interact.ts:183-188`, SHA256 `e2c3ddbdfca82279889d482729d655cc795112c61f104e133d40888e2d63ef9e`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--button`: O.

Normalized operation: browser.mouseUp({button} merged with target(B))

Output: Mouse button input-or-left released

Branches/errors: left is text fallback only; missing button remains undefined in payload; no CLI enum.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### mouse wheel

Source: `src/cli/handlers/browser-interact.ts:189-195`, SHA256 `e2c3ddbdfca82279889d482729d655cc795112c61f104e133d40888e2d63ef9e`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--dy`: RF; `--dx`: N.

Normalized operation: browser.mouseWheel({dy,dx} merged with target(B))

Output: Mouse wheel scrolled dy=... plus dx only when nonnull

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### network

Source: `src/cli/handlers/browser-capture.ts:79-93`, SHA256 `172ad59350524a6fdebeb17a27239eeee0d0cfbaa6d221520c81006d7d303625`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--limit`: PI.

Normalized operation: browser.network({limit only if defined} merged with target(B))

Output: Empty entries -> No network entries; else status url (mimeType, sizeB) newline joined

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### open

Source: `src/cli/handlers/core.ts:91-94`, SHA256 `f89d4a0387218221bcd85e199fd63d6090624084bd8ad009901b064249b484df`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H. Host: H with command-specific target fields/contracts.

Flags: no command-specific flags.

Normalized operation: client.openOrca()

Output: Full getCliStatus success envelope; text formatCliStatus (S5).

Branches/errors: Remote returns initial getCliStatus without local launch. Local desktopWindowStatus blocked -> desktop_activation_blocked before launch or during polling; launchOrcaApp always called for nonblocked local initial state; available returns immediately, otherwise status polling every250ms up to15000ms then runtime_open_timeout. S4 launcher boundary.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### open-url

Source: `src/cli/handlers/browser-tab.ts:18-27`, SHA256 `50c0426b92932da0f8a6d63f6811eff4a8c80dcec715d2b6acbae330824c858e`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, BW. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--url`: R; `--page`: IG — Conditional page parser allowance; this handler uses BW only..

Normalized operation: browser.openUrl({url,worktree:BW})

Output: Opened URL in tab result.browserPageId

Branches/errors: timeoutMs=60000

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### orchestration ask

Source: `src/cli/handlers/orchestration/question-handler.ts:19-108`, SHA256 `f997f50832dd13717d8ee83c2bf831a979235e9f81bf7bb68f23c660dd6c09bf`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, ID, MUT, OCOMP. Host: H with command-specific target fields/contracts.

Flags: `--retry-request`: O; `--question`: O; `--resume`: O; `--options`: O; `--to`: O; `--from`: O; `--run`: O; `--dispatch-capability`: O; `--timeout-ms`: SAFE — Absent request timeout undefined; client605000. Provided clamp to1800000 then client+5000..

Normalized operation: orchestration.ask({to,run,question,resume,options,timeoutMs:parsed absent?undefined:clamped,from:ordinaryID,compatibilityCliCommand,compatibilityWindowsCommand}, {timeoutMs:shared resolved client budget,orchestrationCapability:Odispatch-capability} plus MUT request option)

Output: JSON.stringify(result.result) bare compact JSON; text legacyCompatibility.resumeRequired -> Question id committed. + Resume with command, else answer !==null prints answer. timedOut -> ask timeout after effective ms (thread); cancelled -> connection closed or cancelled with question id, stderr only text.

Branches/errors: Exactly one truthy question/resume; resume+options presence invalid. Identity resolves before this check. Flush before resumeRequired exit75. If legacyCompatibility.answerAcknowledgement and answer!==null, flush then orchestration.check({terminal:from,compatibilityQuestionAck:JSON.stringify(ack)}). Timeout/cancellation handled after ack; ack failure enters error reporting.

Exit: resumeRequired75; timedOut/cancelled1; answer0; errors1.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### orchestration check

Source: `src/cli/handlers/orchestration/message-check-handler.ts:31-88`, SHA256 `c7dbff8b2261757dd09b353441b7ffaf65baac7645015facacf0a960ba7354fa`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, ID, MUT, OCOMP. Host: H with command-specific target fields/contracts.

Flags: `--retry-request`: O; `--terminal`: O; `--wait`: P; `--peek`: P; `--unread`: P; `--all`: P; `--timeout-ms`: SAFE; `--types`: O; `--format`: P; `--run`: O; `--ack`: O.

Normalized operation: orchestration.check({terminal:ordinaryID,terminalPaneKey:only without explicit terminal,unread:unread?true:peek?false:undefined,peek:peek?true:undefined,all:all?true:undefined,types,format:presence?true:undefined,compatibilityCliCommand,run,ack,wait:wait?true:undefined,timeoutMs}; MUT options) Handler also sends inject:undefined for public invocations.

Output: prepareOrchestrationCheckOutput then print and flush; legacy compatibility acknowledgment after flush (S5)

Branches/errors: At most one unread/peek/all; wait may combine with any. Keepalive only while wait RPC pending, stopped finally. Legacy peek filters read!==1; wait && removedReadRows && no remaining unread rows -> peek_wait_unsupported. Warning only if removedReadRows && rawRowCount>=100; then stale formatted removed. No timedOut/cancelled/connectionLost-based failure exit. inject read exists but public spec rejects it. Compatibility acknowledgment only nonempty ackMessageIds after flush; ack payload JSON {messageIds,types:comma split trimmed nonempty}.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### orchestration coordinator-start

Source: `src/cli/handlers/orchestration/dispatch-handlers.ts:69-75`, SHA256 `3532dc8e28859a609f7a5d80fd929d93d47939e4eeba78f1e9b41268ad83e94a`.

Aliases: `orchestration run`. Positionals bind: none. 

Shared contracts: G, OUT. Host: No runtime selection used.

Flags: `--from`: IG; `--max-concurrent`: IG; `--poll-interval-ms`: IG; `--spec`: IG; `--worktree`: IG.

Normalized operation: orchestration.none(No RPC)

Output: No success output

Branches/errors: Always throws orchestration_migration_required, legacy automatic coordinator retired/no effects message, orchestrationMigrationData(command_retired) (S2/S5).

Exit: Always1.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### orchestration coordinator-stop

Source: `src/cli/handlers/orchestration/dispatch-handlers.ts:77-83`, SHA256 `3532dc8e28859a609f7a5d80fd929d93d47939e4eeba78f1e9b41268ad83e94a`.

Aliases: `orchestration run-stop`. Positionals bind: none. 

Shared contracts: G, OUT. Host: No runtime selection used.

Flags: no command-specific flags.

Normalized operation: orchestration.none(No RPC)

Output: No success output

Branches/errors: Always throws orchestration_migration_required, legacy automatic coordinator retired/no effects message, orchestrationMigrationData(command_retired) (S2/S5).

Exit: Always1.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### orchestration dispatch

Source: `src/cli/handlers/orchestration/dispatch-handlers.ts:11-39`, SHA256 `3532dc8e28859a609f7a5d80fd929d93d47939e4eeba78f1e9b41268ad83e94a`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, ID, MUT, OCOMP. Host: H with command-specific target fields/contracts.

Flags: `--retry-request`: O; `--task`: R; `--to`: O — Required R unless dry-run presence; `--from`: O; `--run`: O; `--inject`: P; `--return-preamble`: P; `--dry-run`: P.

Normalized operation: orchestration.dispatch({task,to,run,from:coordinatorID,inject:presence?true:undefined,returnPreamble:presence?true:undefined,dryRun:presence?true:undefined,devMode})

Output: Returned dryRun true -> preamble??empty; otherwise Dispatched dispatch?.task_id -> dispatch?.id [dispatch?.status], append nonempty returned preamble with separator regardless requested flag.

Branches/errors: Presence false string still dry-run; no runtime worker effects assumed from CLI handler.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### orchestration dispatch-show

Source: `src/cli/handlers/orchestration/dispatch-handlers.ts:43-67`, SHA256 `3532dc8e28859a609f7a5d80fd929d93d47939e4eeba78f1e9b41268ad83e94a`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, ID, OCOMP. Host: H with command-specific target fields/contracts.

Flags: `--task`: R; `--preamble`: P; `--from`: O.

Normalized operation: orchestration.dispatchShow({task,preamble:presence?true:undefined,from:preamble?coordinatorID:undefined,devMode})

Output: Truthy returned preamble AND requested preamble -> preamble; no dispatch -> No dispatch context found.; otherwise dispatch.id task=task_id [status].

Branches/errors: from accepted but ignored unless preamble.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### orchestration gate-create

Source: `src/cli/handlers/orchestration/gate-handlers.ts:8-24`, SHA256 `5c87c56df4060eac7f3708fbe9533c221015d627dc5f33e8ba8ef1da0f6f5c81`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, ID, MUT, JDIAG. Host: H with command-specific target fields/contracts.

Flags: `--retry-request`: O; `--task`: R; `--question`: R; `--options`: J; `--from`: O.

Normalized operation: orchestration.gateCreate({task,question,options,from:coordinatorID})

Output: Gate id created for task [status]

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: `src/cli/quote-stripped-json-flag.test.ts:1-53`. No execution.

### orchestration gate-list

Source: `src/cli/handlers/orchestration/gate-handlers.ts:37-59`, SHA256 `5c87c56df4060eac7f3708fbe9533c221015d627dc5f33e8ba8ef1da0f6f5c81`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, ID. Host: H with command-specific target fields/contracts.

Flags: `--task`: O; `--status`: O; `--run`: O; `--from`: O.

Normalized operation: orchestration.gateList({task,status,run,from:run?undefined:coordinatorID})

Output: No gates found or id task=task [status] question rows

Branches/errors: Named run bypasses identity; status has no CLI enum.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### orchestration gate-resolve

Source: `src/cli/handlers/orchestration/gate-handlers.ts:26-35`, SHA256 `5c87c56df4060eac7f3708fbe9533c221015d627dc5f33e8ba8ef1da0f6f5c81`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, ID, MUT. Host: H with command-specific target fields/contracts.

Flags: `--retry-request`: O; `--id`: R; `--resolution`: R; `--from`: O.

Normalized operation: orchestration.gateResolve({id,resolution,from:coordinatorID})

Output: Gate id resolved: resolution

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### orchestration inbox

Source: `src/cli/handlers/orchestration/message-inbox-handlers.ts:32-63`, SHA256 `049ae8d586dbee22e0716c60e1855b86cc81a55c9db2bdb840a731b88b29909d`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H. Host: H with command-specific target fields/contracts.

Flags: `--terminal`: O; `--limit`: PI; `--full`: P.

Normalized operation: orchestration.inbox({terminal,limit})

Output: Message headings with read-only tag; full adds body/payload; empty inbox marker

Branches/errors: No sender identity resolution; full affects text only, JSON envelope retains response.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### orchestration reply

Source: `src/cli/handlers/orchestration/message-inbox-handlers.ts:16-30`, SHA256 `049ae8d586dbee22e0716c60e1855b86cc81a55c9db2bdb840a731b88b29909d`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, ID, MUT. Host: H with command-specific target fields/contracts.

Flags: `--retry-request`: O; `--id`: R; `--body`: R; `--from`: O; `--run`: O.

Normalized operation: orchestration.reply({id,body,from:ordinaryID,run})

Output: Replied result.message.id

Branches/errors: No body-file helper on reply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### orchestration request-show

Source: `src/cli/handlers/orchestration/mutation-request-show-handler.ts:8-29`, SHA256 `66a907a2193da3be14664a91e6ff2d20635303f0ec459705232fb03a88454cbd`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H. Host: H with command-specific target fields/contracts.

Flags: `--request`: R.

Normalized operation: orchestration.requestShow({request})

Output: Request id/state/method/interpretation receipt

Branches/errors: Only RuntimeClientError method_not_found -> incompatible_runtime; no retry/mutation.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### orchestration reset

Source: `src/cli/handlers/orchestration/reset-handler.ts:7-28`, SHA256 `46c1aeb2d4ef3d21cf050deeaf45a32cce0d052032930c6c7ba35432ec53cc73`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, MUT. Host: H with command-specific target fields/contracts.

Flags: `--retry-request`: O; `--all`: P; `--tasks`: P; `--messages`: P.

Normalized operation: orchestration.reset({all:present?true:undefined,tasks:present?true:undefined,messages:present?true:undefined})

Output: Reset: result.reset

Branches/errors: Exactly one all/tasks/messages required.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### orchestration run-create

Source: `src/cli/handlers/orchestration/run-handlers.ts:13-22`, SHA256 `e3fc8c08902ab75df2fbaccc2be5ab30f182decb71f5d5e7d13fb8b282ed4086`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, ID, MUT. Host: H with command-specific target fields/contracts.

Flags: `--retry-request`: O; `--objective`: R; `--from`: O.

Normalized operation: orchestration.runCreate({objective,from:coordinatorID})

Output: Run id created and bound: objective

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### orchestration run-current

Source: `src/cli/handlers/orchestration/run-handlers.ts:36-44`, SHA256 `e3fc8c08902ab75df2fbaccc2be5ab30f182decb71f5d5e7d13fb8b282ed4086`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, ID. Host: H with command-specific target fields/contracts.

Flags: `--from`: O.

Normalized operation: orchestration.runCurrent({from:coordinatorID})

Output: run ? id objective : No Run is bound to this terminal.

Branches/errors: Null is normal success.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### orchestration run-list

Source: `src/cli/handlers/orchestration/run-handlers.ts:46-65`, SHA256 `e3fc8c08902ab75df2fbaccc2be5ab30f182decb71f5d5e7d13fb8b282ed4086`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H. Host: H with command-specific target fields/contracts.

Flags: `--limit`: PI — Absent100, imported ORCHESTRATION_RUN_PAGE_LIMIT; no CLI max beyond positive integer.; `--cursor`: O.

Normalized operation: orchestration.runList({limit:provided??100,cursor})

Output: No Runs found or rows id + legacy inspect-only tag + objective; append More Runs: --cursor cursor if truthy

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### orchestration run-show

Source: `src/cli/handlers/orchestration/run-handlers.ts:67-84`, SHA256 `e3fc8c08902ab75df2fbaccc2be5ab30f182decb71f5d5e7d13fb8b282ed4086`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H. Host: H with command-specific target fields/contracts.

Flags: `--id`: R.

Normalized operation: orchestration.runShow({id})

Output: id + legacy inspect-only tag + objective; consumer generation and created timestamp

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### orchestration run-use

Source: `src/cli/handlers/orchestration/run-handlers.ts:24-34`, SHA256 `e3fc8c08902ab75df2fbaccc2be5ab30f182decb71f5d5e7d13fb8b282ed4086`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, ID, MUT. Host: H with command-specific target fields/contracts.

Flags: `--retry-request`: O; `--id`: R; `--from`: O; `--takeover-legacy`: P.

Normalized operation: orchestration.runUse({id,from:coordinatorID,takeoverLegacy:true only if present})

Output: Using Run id: objective

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### orchestration send

Source: `src/cli/handlers/orchestration/message-send-handler.ts:62-136`, SHA256 `b78b7774f952e2c57090224f9393c0448d9441cb0775d19f701f9a7062f1729e`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, ID, MUT, JDIAG, OCOMP. Host: H with command-specific target fields/contracts.

Flags: `--retry-request`: O; `--to`: O; `--from`: O; `--run`: O; `--subject`: R; `--body`: O; `--type`: O; `--priority`: O; `--thread-id`: O; `--payload`: J; `--task-id`: O; `--dispatch-id`: O; `--outcome`: O — Only worker_done; succeeded|failed when defined; `--files-modified`: O — Split comma, trim, drop empty; `--report-path`: O; `--phase`: O; `--dispatch-capability`: O.

Normalized operation: orchestration.send({from:ordinaryID,to,run,subject,body,type,priority,threadId,payload:raw J or JSON.stringify({taskId?,dispatchId?,outcome?,filesModified?,reportPath?,phase?}),senderPaneKey:env||undefined,waitForLifecycleSettlement:type===worker_done?true:undefined,devMode}; call option orchestrationCapability if truthy)

Output: Sent id / Queued id for worker Dispatch / Queued id for Run home / Sent n messages to n recipients; append Warning: message lines

Branches/errors: Any defined structured field forbids raw payload. worker_done/heartbeat cannot target @group and require explicitfrom/envhandle before fallback identity. requireWorkerDoneSettlement called; rejected lifecycle throws its code/reason. Settlement runtime polling S3.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: `src/cli/quote-stripped-json-flag.test.ts:1-53`. No execution.

### orchestration task-create

Source: `src/cli/handlers/orchestration/task-handlers.ts:19-36`, SHA256 `352e334ae0381bf7de2341237a83e17ebc6ca04ff72d980de0e44c4468799141`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, ID, MUT. Host: H with command-specific target fields/contracts.

Flags: `--retry-request`: O; `--spec`: R; `--display-name`: O; `--deps`: O; `--parent`: O; `--run`: O; `--from`: O; `--task-title`: O.

Normalized operation: orchestration.taskCreate({spec,taskTitle:task-title,displayName,deps:raw string,parent,run,callerTerminalHandle:coordinatorID})

Output: Created task.id [task.status]

Branches/errors: deps is not locally parsed JSON.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### orchestration task-list

Source: `src/cli/handlers/orchestration/task-handlers.ts:38-90`, SHA256 `352e334ae0381bf7de2341237a83e17ebc6ca04ff72d980de0e44c4468799141`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, ID. Host: H with command-specific target fields/contracts.

Flags: `--status`: O; `--brief`: P; `--ready`: P; `--run`: O; `--from`: O.

Normalized operation: orchestration.taskList({status,brief:presence?true:undefined,ready:presence?true:undefined,run,callerTerminalHandle:run?undefined:coordinatorID})

Output: count0 -> legacyReadOnly?No legacy tasks (read-only).:No tasks.; otherwise label=(display_name??task_title??spec).slice(0,60), id/status, dispatched+assignee suffix (dispatch_id??question-mark); legacyReadOnly prepends Legacy Run runId (read-only).

Branches/errors: Explicit run bypasses identity, so supplied from ignored there. brief response missing any spec_truncated property uses shared abbreviation fallback (S5).

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### orchestration task-update

Source: `src/cli/handlers/orchestration/task-handlers.ts:92-113`, SHA256 `352e334ae0381bf7de2341237a83e17ebc6ca04ff72d980de0e44c4468799141`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, ID, MUT. Host: H with command-specific target fields/contracts.

Flags: `--retry-request`: O; `--id`: R; `--status`: R — pending|ready|dispatched|completed|failed|blocked; `--result`: O; `--run`: O; `--from`: O.

Normalized operation: orchestration.taskUpdate({id,status,result:raw string,run,callerTerminalHandle:coordinatorID})

Output: Updated task.id -> task.status

Branches/errors: No local parsing of result.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### orchestration worker-abandon

Source: `src/cli/handlers/orchestration/worker-terminal-handlers.ts:39-52`, SHA256 `da3ee739d34b71cec693dd58adb2e8f82bb53d2d16b8f680c6528ca30f20a1ac`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, MUT. Host: H with command-specific target fields/contracts.

Flags: `--retry-request`: O; `--dispatch`: R.

Normalized operation: orchestration.workerAbandon({dispatch})

Output: Worker dispatch [state] plus Warning

Branches/errors: No returned-state failure check.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### orchestration worker-list

Source: `src/cli/handlers/orchestration/worker-terminal-handlers.ts:81-125`, SHA256 `da3ee739d34b71cec693dd58adb2e8f82bb53d2d16b8f680c6528ca30f20a1ac`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H. Host: H with command-specific target fields/contracts.

Flags: `--run`: O; `--terminal-state`: O — active|reclaimable|retained|release_pending|release_unknown|released.

Normalized operation: orchestration.workerList({run,terminalState})

Output: No workers found or dispatch/task/workerState/terminalState??none; append nonempty counts

Branches/errors: No caller identity needed.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### orchestration worker-read

Source: `src/cli/handlers/orchestration/worker-observation-handlers.ts:37-60`, SHA256 `9e19cbdaa41c0b82d28667a23e115aaff0aeab135f9f44df5ec4011c3a982049`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H. Host: H with command-specific target fields/contracts.

Flags: `--dispatch`: R; `--cursor`: O — Digits-only becomes parseInt base10 (no safety bound); otherwise string; `--source`: O — auto|transcript|terminal; `--limit`: PI.

Normalized operation: orchestration.workerRead({dispatch,cursor,source,limit})

Output: Legacy/terminal tail joined newline; transcript messages role then text/tool call JSON/tool result error prefix/image URL-or-omitted; trimEnd and blankline separated

Branches/errors: No local default source inserted; shared formatting/transport S3/S5.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: `src/cli/handlers/orchestration-worker-cli.test.ts:291-345`. No execution.

### orchestration worker-release

Source: `src/cli/handlers/orchestration/worker-terminal-handlers.ts:54-66`, SHA256 `da3ee739d34b71cec693dd58adb2e8f82bb53d2d16b8f680c6528ca30f20a1ac`.

Aliases: none. Positionals bind: none. Factory specialization: `Separate explicit handler; same release-receipt formatter`.

Shared contracts: G, OUT, H, MUT. Host: H with command-specific target fields/contracts.

Flags: `--retry-request`: O; `--dispatch`: R.

Normalized operation: orchestration.workerRelease({dispatch})

Output: Dispatch/state/reason/process; archive source??none/status??unknown; lastError/recovery lines

Branches/errors: Retained/pending/already released are settled answers; never treat lost contact as exited.

Exit: state===release_unknown1; other states0; errors1.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### orchestration worker-retain

Source: `src/cli/handlers/orchestration/worker-terminal-handlers.ts:68-79`, SHA256 `da3ee739d34b71cec693dd58adb2e8f82bb53d2d16b8f680c6528ca30f20a1ac`.

Aliases: none. Positionals bind: none. Factory specialization: `Separate explicit handler; same release-receipt formatter`.

Shared contracts: G, OUT, H, MUT. Host: H with command-specific target fields/contracts.

Flags: `--retry-request`: O; `--dispatch`: R.

Normalized operation: orchestration.workerRetain({dispatch})

Output: Dispatch/state/reason/process; archive source??none/status??unknown; lastError/recovery lines

Branches/errors: Retained/pending/already released are settled answers; never treat lost contact as exited.

Exit: state===release_unknown1; other states0; errors1.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### orchestration worker-show

Source: `src/cli/handlers/orchestration/worker-observation-handlers.ts:16-35`, SHA256 `9e19cbdaa41c0b82d28667a23e115aaff0aeab135f9f44df5ec4011c3a982049`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H. Host: H with command-specific target fields/contracts.

Flags: `--dispatch`: R.

Normalized operation: orchestration.workerShow({dispatch})

Output: Worker/Dispatch observation formatter: missing observation or agentWait=unknown; explicit null=none; preserve wait reason/source

Branches/errors: Does not collapse unknown into exited. Exact layout S5.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### orchestration worker-start

Source: `src/cli/handlers/orchestration/worker-launch-handler.ts:13-69`, SHA256 `d985b68d9781b693a56de4e37c402ede184a817b4d922f719de55a72f79ff9a3`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, ID, MUT, OCOMP. Host: H with command-specific target fields/contracts.

Flags: `--retry-request`: O; `--task`: R; `--on`: O; `--worktree`: O; `--name`: O; `--repo`: O; `--base-branch`: O; `--display-name`: O; `--comment`: O; `--setup`: O; `--agent`: O; `--model`: O; `--effort`: O; `--terminal`: O; `--retry-of`: O; `--timeout-ms`: SAFE; `--run`: O; `--from`: O.

Normalized operation: orchestration.workerStart({task,on,worktree,name,repo,baseBranch,displayName,comment,setup,agent,model,effort,terminal,retryOf,timeoutMs,run,from:coordinatorID,devMode})

Output: Worker dispatch [state] for task; lastError -> failedStage??start: error, else optional Warning

Branches/errors: Truthy model or effort first calls status.get; missing launch-preferences capability incompatible_runtime. No CLI provider/model enum validation. Timeout field is payload, not call timeout override. Client method policy widens effective transport timeout and can reject unsafe timer+grace; S3 owns exact readiness/grace contract.

Exit: state!==ready sets1; ready0; errors1.

Existing assertion bodies read: `src/cli/handlers/orchestration-worker-cli.test.ts:145-165`. No execution.

### orchestration worker-stop

Source: `src/cli/handlers/orchestration/worker-terminal-handlers.ts:18-37`, SHA256 `da3ee739d34b71cec693dd58adb2e8f82bb53d2d16b8f680c6528ca30f20a1ac`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, MUT. Host: H with command-specific target fields/contracts.

Flags: `--retry-request`: O; `--dispatch`: R.

Normalized operation: orchestration.workerStop({dispatch})

Output: Worker dispatch [state] process=action plus lastError and Warning

Branches/errors: Unknown stop remains unproved.

Exit: state===stop_unknown1; other states0; errors1.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### pdf

Source: `src/cli/handlers/browser-nav.ts:121-125`, SHA256 `b39225ef7c3e844d00b9c414f438af04ed1dd200a17ef6190193b4b128458ec8`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O.

Normalized operation: browser.pdf(target(B))

Output: PDF exported (result.data.length bytes base64)

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### project list

Source: `src/cli/handlers/project.ts:94-97`, SHA256 `21f4b3b37faebba32500a61183b88d682d90cd9abedeec9111d8d12b486ea057`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H. Host: H with command-specific target fields/contracts.

Flags: no command-specific flags.

Normalized operation: project.list()

Output: formatProjectList

Branches/errors: Ordinary runtime call.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### project setup-clone

Source: `src/cli/handlers/project.ts:132-152`, SHA256 `21f4b3b37faebba32500a61183b88d682d90cd9abedeec9111d8d12b486ea057`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, PRJ. Host: H with command-specific target fields/contracts.

Flags: `--project`: R; `--host`: R — parse host only, no SSH connection resolution; `--url`: R; `--destination`: R — Local cwd absolute; remote must absolute Windows/UNC/POSIX; `--display-name`: O.

Normalized operation: projectHostSetup.clone({projectId:project,hostId:parseHostFlag(flags).id,url,destination:resolved path,displayName})

Output: formatProjectHostSetupResult

Branches/errors: No URL validator; remote path requirement before call.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: `src/cli/index-project-setup.test.ts:586-647`. No execution.

### project setup-create

Source: `src/cli/handlers/project.ts:153-181`, SHA256 `21f4b3b37faebba32500a61183b88d682d90cd9abedeec9111d8d12b486ea057`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, PRJ. Host: H with command-specific target fields/contracts.

Flags: `--project`: R; `--host`: R — resolveHostFlagTarget including SSH authority; `--setup-id`: O; `--path`: O — If truthy resolve local cwd or require remote absolute; `--kind`: O — git|folder; `--display-name`: O; `--worktree-base-path`: O; `--state`: O — ready|not-set-up|setting-up|error|unsupported; `--method`: O — imported-existing-folder|cloned|provisioned; `--git-username`: O.

Normalized operation: projectHostSetup.create({projectId,hostId,setupId,path,kind,displayName,worktreeBasePath,gitUsername,setupState:state,setupMethod:method})

Output: formatProjectHostSetupCreateResult (S5)

Branches/errors: Omitted optional fields remain undefined; literal null is not clearing. Enumerated invalid strings reject.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### project setup-delete

Source: `src/cli/handlers/project.ts:206-215`, SHA256 `21f4b3b37faebba32500a61183b88d682d90cd9abedeec9111d8d12b486ea057`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, PRJ. Host: H with command-specific target fields/contracts.

Flags: `--setup`: R.

Normalized operation: projectHostSetup.delete({setupId:setup})

Output: formatProjectHostSetupDeleteResult (S5)

Branches/errors: No local confirmation.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### project setup-update

Source: `src/cli/handlers/project.ts:182-205`, SHA256 `21f4b3b37faebba32500a61183b88d682d90cd9abedeec9111d8d12b486ea057`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, PRJ. Host: H with command-specific target fields/contracts.

Flags: `--setup`: R; `--path`: O — If truthy resolve local cwd or require remote absolute; `--kind`: O — git|folder; `--display-name`: O; `--worktree-base-path`: O; `--state`: O — ready|not-set-up|setting-up|error|unsupported; `--method`: O — imported-existing-folder|cloned|provisioned|legacy-repo; `--git-username`: O.

Normalized operation: projectHostSetup.update({setupId:setup,updates:{path,kind,displayName,worktreeBasePath,gitUsername,setupState:state,setupMethod:method}})

Output: formatProjectHostSetupUpdateResult (S5)

Branches/errors: No requirement that any update field be present.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### project setups

Source: `src/cli/handlers/project.ts:98-111`, SHA256 `21f4b3b37faebba32500a61183b88d682d90cd9abedeec9111d8d12b486ea057`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, PRJ. Host: H with command-specific target fields/contracts.

Flags: `--project`: O; `--host`: O — resolveHostFlagTarget including SSH authority; filter with hostFilterMatchesHostId.

Normalized operation: projectHostSetup.list() -> filter optional projectId and host -> replace envelope result {setups}

Output: formatProjectHostSetupList

Branches/errors: No projectId sent to list; filtering occurs in CLI.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### reload

Source: `src/cli/handlers/browser-nav.ts:59-65`, SHA256 `b39225ef7c3e844d00b9c414f438af04ed1dd200a17ef6190193b4b128458ec8`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O.

Normalized operation: browser.reload(target(B))

Output: Reloaded result.url — result.title

Branches/errors: timeoutMs=60000.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### screenshot

Source: `src/cli/handlers/browser-nav.ts:34-42`, SHA256 `b39225ef7c3e844d00b9c414f438af04ed1dd200a17ef6190193b4b128458ec8`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--format`: O — Only exact jpeg forwarded; all other/missing -> undefined..

Normalized operation: browser.screenshot({format: jpeg-or-undefined} merged with target(B))

Output: formatScreenshot (S5)

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### scroll

Source: `src/cli/handlers/browser-nav.ts:80-93`, SHA256 `b39225ef7c3e844d00b9c414f438af04ed1dd200a17ef6190193b4b128458ec8`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--direction`: R — enum up|down; `--amount`: PI.

Normalized operation: browser.scroll({direction,amount} merged with target(B))

Output: Scrolled result.scrolled

Branches/errors: Invalid direction -> invalid_argument before target lookup.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### scrollintoview

Source: `src/cli/handlers/browser-interact.ts:136-141`, SHA256 `e2c3ddbdfca82279889d482729d655cc795112c61f104e133d40888e2d63ef9e`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--element`: R.

Normalized operation: browser.scrollIntoView({element} merged with target(B))

Output: Scrolled input element into view

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### select

Source: `src/cli/handlers/browser-interact.ts:68-78`, SHA256 `e2c3ddbdfca82279889d482729d655cc795112c61f104e133d40888e2d63ef9e`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--element`: R; `--value`: R.

Normalized operation: browser.select({element,value} merged with target(B))

Output: Selected result.selected

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### select-all

Source: `src/cli/handlers/browser-interact.ts:93-101`, SHA256 `e2c3ddbdfca82279889d482729d655cc795112c61f104e133d40888e2d63ef9e`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--element`: R.

Normalized operation: browser.selectAll({element} merged with target(B))

Output: Selected all in result.selected

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### serve

Source: `src/cli/handlers/core.ts:95-122`, SHA256 `f89d4a0387218221bcd85e199fd63d6090624084bd8ad009901b064249b484df`.

Aliases: none. Positionals bind: none. 

Shared contracts: G. Host: Pinned local; explicit/ambient remote selection suppressed.

Flags: `--project-root`: O — typeof string including empty, else null; `--no-pairing`: T; `--mobile-pairing`: T; `--recipe-json`: T; `--port`: O — If present: nonempty string whose Number is integer 0..65535; preserve original string, do not coerce payload.; `--pairing-address`: O — typeof string including empty else null; `--page`: IG.

Normalized operation: serveOrcaApp({json,projectRoot,noPairing,mobilePairing,recipeJson,port:absent null or validated original string,pairingAddress})

Output: Delegated app stdio; no ordinary printResult

Branches/errors: no-pairing + mobile-pairing rejects; recipe-json rejects either pairing flag and requires truthy project-root. Local serve launcher boundary S4.

Exit: Return value of serveOrcaApp assigned process.exitCode; errors1.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### set credentials

Source: `src/cli/handlers/browser-env.ts:72-83`, SHA256 `4760b0388adee9082f3bd2009be652e52648e766d329f97ac2e9359959d21638`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--user`: R; `--pass`: RE.

Normalized operation: browser.setCredentials({user,pass} merged with target(B))

Output: HTTP auth credentials set for input user

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: `src/cli/flags.test.ts:1-11`, `src/cli/browser-cookie-credentials-empty-value.test.ts:1-117`. No execution.

### set device

Source: `src/cli/handlers/browser-env.ts:54-59`, SHA256 `4760b0388adee9082f3bd2009be652e52648e766d329f97ac2e9359959d21638`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--name`: R.

Normalized operation: browser.setDevice({name} merged with target(B))

Output: Device emulation set to input name

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### set headers

Source: `src/cli/handlers/browser-env.ts:66-71`, SHA256 `4760b0388adee9082f3bd2009be652e52648e766d329f97ac2e9359959d21638`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--headers`: R.

Normalized operation: browser.setHeaders({headers} merged with target(B))

Output: Extra HTTP headers set

Branches/errors: Headers string is not JSON parsed in CLI.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### set media

Source: `src/cli/handlers/browser-env.ts:84-94`, SHA256 `4760b0388adee9082f3bd2009be652e52648e766d329f97ac2e9359959d21638`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--color-scheme`: O; `--reduced-motion`: O.

Normalized operation: browser.setMedia({colorScheme:color-scheme,reducedMotion:reduced-motion} merged with target(B))

Output: Media preferences set

Branches/errors: No CLI enum.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### set offline

Source: `src/cli/handlers/browser-env.ts:60-65`, SHA256 `4760b0388adee9082f3bd2009be652e52648e766d329f97ac2e9359959d21638`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--state`: O.

Normalized operation: browser.setOffline({state} merged with target(B))

Output: Offline mode state-or-toggled

Branches/errors: No CLI enum and omitted state is not replaced by toggled in payload.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### snapshot

Source: `src/cli/handlers/browser-nav.ts:29-33`, SHA256 `b39225ef7c3e844d00b9c414f438af04ed1dd200a17ef6190193b4b128458ec8`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O.

Normalized operation: browser.snapshot(target(B))

Output: formatSnapshot (S5)

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### status

Source: `src/cli/handlers/core.ts:123-129`, SHA256 `f89d4a0387218221bcd85e199fd63d6090624084bd8ad009901b064249b484df`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H. Host: H with command-specific target fields/contracts.

Flags: no command-specific flags.

Normalized operation: client.getCliStatus()

Output: Full getCliStatus success envelope; text formatStatus (S5).

Branches/errors: Only !json && !result.result.runtime.reachable sets exitCode1; JSON unreachable remains successful response.

Exit: Errors1; text unreachable1; JSON unreachable0; reachable0.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### storage local clear

Source: `src/cli/handlers/browser-storage.ts:25-29`, SHA256 `1e1f2d882888209ae3fccbf5ee8a08e59d2048e57fd37cb0a4b9b09a30ee7a68`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O.

Normalized operation: browser.storage.local.clear(target(B))

Output: localStorage cleared

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### storage local get

Source: `src/cli/handlers/browser-storage.ts:7-12`, SHA256 `1e1f2d882888209ae3fccbf5ee8a08e59d2048e57fd37cb0a4b9b09a30ee7a68`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--key`: R.

Normalized operation: browser.storage.local.get({key} merged with target(B))

Output: Pretty JSON

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### storage local set

Source: `src/cli/handlers/browser-storage.ts:13-24`, SHA256 `1e1f2d882888209ae3fccbf5ee8a08e59d2048e57fd37cb0a4b9b09a30ee7a68`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--key`: R; `--value`: RE.

Normalized operation: browser.storage.local.set({key,value} merged with target(B))

Output: localStorage[input key] set

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: `src/cli/flags.test.ts:1-11`, `src/cli/browser-storage-empty-value.test.ts:1-134`. No execution.

### storage session clear

Source: `src/cli/handlers/browser-storage.ts:47-51`, SHA256 `1e1f2d882888209ae3fccbf5ee8a08e59d2048e57fd37cb0a4b9b09a30ee7a68`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O.

Normalized operation: browser.storage.session.clear(target(B))

Output: sessionStorage cleared

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### storage session get

Source: `src/cli/handlers/browser-storage.ts:30-35`, SHA256 `1e1f2d882888209ae3fccbf5ee8a08e59d2048e57fd37cb0a4b9b09a30ee7a68`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--key`: R.

Normalized operation: browser.storage.session.get({key} merged with target(B))

Output: Pretty JSON

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### storage session set

Source: `src/cli/handlers/browser-storage.ts:36-46`, SHA256 `1e1f2d882888209ae3fccbf5ee8a08e59d2048e57fd37cb0a4b9b09a30ee7a68`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--key`: R; `--value`: RE.

Normalized operation: browser.storage.session.set({key,value} merged with target(B))

Output: sessionStorage[input key] set

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: `src/cli/flags.test.ts:1-11`, `src/cli/browser-storage-empty-value.test.ts:1-134`. No execution.

### tab close

Source: `src/cli/handlers/browser-tab.ts:80-88`, SHA256 `50c0426b92932da0f8a6d63f6811eff4a8c80dcec715d2b6acbae330824c858e`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--index`: NI.

Normalized operation: browser.tabClose({index} merged with target(B))

Output: Tab closed

Branches/errors: Neither index nor page is required; no result.closed check.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### tab create

Source: `src/cli/handlers/browser-tab.ts:69-79`, SHA256 `50c0426b92932da0f8a6d63f6811eff4a8c80dcec715d2b6acbae330824c858e`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, BW. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--url`: O; `--profile`: O.

Normalized operation: browser.tabCreate({url,worktree:BW,profileId:profile})

Output: Created tab result.browserPageId

Branches/errors: timeoutMs=60000; page not accepted.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### tab current

Source: `src/cli/handlers/browser-tab.ts:41-45`, SHA256 `50c0426b92932da0f8a6d63f6811eff4a8c80dcec715d2b6acbae330824c858e`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, BW. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O.

Normalized operation: browser.tabCurrent({worktree:BW})

Output: formatTabShow (S5)

Branches/errors: page not accepted.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### tab list

Source: `src/cli/handlers/browser-tab.ts:28-35`, SHA256 `50c0426b92932da0f8a6d63f6811eff4a8c80dcec715d2b6acbae330824c858e`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, BW. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--show-profile`: P.

Normalized operation: browser.tabList({worktree:BW})

Output: show-profile presence -> formatTabListWithProfiles(value,true), otherwise formatTabList (S5)

Branches/errors: page is not accepted for tab list.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### tab profile clone

Source: `src/cli/handlers/browser-profile.ts:98-106`, SHA256 `07e71413a03bacdeffdbf8b346bb7def88fb735263c0ffc7455da1e1f6d46155`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--profile`: R.

Normalized operation: browser.tabProfileClone({profileId:profile} merged with target(B))

Output: formatTabProfileClone (S5)

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### tab profile create

Source: `src/cli/handlers/browser-profile.ts:36-59`, SHA256 `07e71413a03bacdeffdbf8b346bb7def88fb735263c0ffc7455da1e1f6d46155`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H. Host: H with command-specific target fields/contracts.

Flags: `--label`: R; `--scope`: O — default isolated; enum isolated|imported; `--no-ua-spoof`: T.

Normalized operation: browser.profileCreate({label,scope,userAgentMode:native only if no-ua-spoof true})

Output: Created profile id-or-unknown (label-or-input)

Branches/errors: Invalid scope -> invalid_argument; result.profile === null -> runtime_error. label repeat uses NUL parser; no local split here.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### tab profile delete

Source: `src/cli/handlers/browser-profile.ts:60-70`, SHA256 `07e71413a03bacdeffdbf8b346bb7def88fb735263c0ffc7455da1e1f6d46155`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H. Host: H with command-specific target fields/contracts.

Flags: `--profile`: R.

Normalized operation: browser.profileDelete({profileId:profile})

Output: deleted true -> Deleted profile id; false -> Profile id was not deleted

Branches/errors: False deletion does not set failure.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### tab profile list

Source: `src/cli/handlers/browser-profile.ts:32-35`, SHA256 `07e71413a03bacdeffdbf8b346bb7def88fb735263c0ffc7455da1e1f6d46155`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H. Host: H with command-specific target fields/contracts.

Flags: no command-specific flags.

Normalized operation: browser.profileList(no params)

Output: formatBrowserProfileList (S5)

Branches/errors: No workspace/page selector accepted.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### tab profile set

Source: `src/cli/handlers/browser-profile.ts:71-84`, SHA256 `07e71413a03bacdeffdbf8b346bb7def88fb735263c0ffc7455da1e1f6d46155`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--profile`: R.

Normalized operation: browser.tabSetProfile({profileId:profile} merged with target(B))

Output: Switched result.browserPageId to result.profileLabel ?? result.profileId ?? default

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### tab profile show

Source: `src/cli/handlers/browser-profile.ts:85-89`, SHA256 `07e71413a03bacdeffdbf8b346bb7def88fb735263c0ffc7455da1e1f6d46155`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O.

Normalized operation: browser.tabProfileShow(target(B))

Output: formatTabProfileShow (S5)

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### tab profile use-default

Source: `src/cli/handlers/browser-profile.ts:90-97`, SHA256 `07e71413a03bacdeffdbf8b346bb7def88fb735263c0ffc7455da1e1f6d46155`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O.

Normalized operation: browser.tabSetProfile({profileId:'default'} merged with target(B))

Output: Switched result.browserPageId to Default

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### tab show

Source: `src/cli/handlers/browser-tab.ts:36-40`, SHA256 `50c0426b92932da0f8a6d63f6811eff4a8c80dcec715d2b6acbae330824c858e`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O.

Normalized operation: browser.tabShow(target(B))

Output: formatTabShow (S5)

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### tab switch

Source: `src/cli/handlers/browser-tab.ts:46-68`, SHA256 `50c0426b92932da0f8a6d63f6811eff4a8c80dcec715d2b6acbae330824c858e`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--index`: NI; `--focus`: P.

Normalized operation: browser.tabSwitch({index,page,focus:true only if present} merged with target(B))

Output: Switched to tab result.switched (result.browserPageId)

Branches/errors: Requires index !== undefined OR truthy page; both allowed; missing both invalid_argument.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### type

Source: `src/cli/handlers/browser-interact.ts:62-67`, SHA256 `e2c3ddbdfca82279889d482729d655cc795112c61f104e133d40888e2d63ef9e`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--input`: R.

Normalized operation: browser.type({input} merged with target(B))

Output: Typed input

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### uncheck

Source: `src/cli/handlers/browser-interact.ts:80-80`, SHA256 `e2c3ddbdfca82279889d482729d655cc795112c61f104e133d40888e2d63ef9e`.

Aliases: none. Positionals bind: none. Factory specialization: `checkHandler(false)`.

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--element`: R.

Normalized operation: browser.check({element,checked:false} merged with target(B))

Output: result.checked ? Checked element : Unchecked element

Branches/errors: Factory checkHandler(false); output follows returned checked, not requested false.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### upload

Source: `src/cli/handlers/browser-interact.ts:124-135`, SHA256 `e2c3ddbdfca82279889d482729d655cc795112c61f104e133d40888e2d63ef9e`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--element`: R; `--files`: R — split comma, trim each, do not drop empty members.

Normalized operation: browser.upload({element,files:string[]} merged with target(B))

Output: Uploaded result.uploaded file(s)

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### viewport

Source: `src/cli/handlers/browser-env.ts:15-37`, SHA256 `4760b0388adee9082f3bd2009be652e52648e766d329f97ac2e9359959d21638`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--width`: RP; `--height`: RP; `--scale`: O — if truthy convert Number finite >0; output deviceScaleFactor; missing/boolean/empty omitted; `--mobile`: P.

Normalized operation: browser.viewport({width,height,deviceScaleFactor?,mobile:true if present} merged with target(B))

Output: Viewport set to result.width×height plus (mobile) when returned mobile truthy

Branches/errors: No additional handler-specific branch; shared argument/helper and runtime failures still apply.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

### vm recipe doctor

Source: `src/cli/handlers/vm.ts:25-43`, SHA256 `8871c9aab3bf5e29b1b56a04ce08c513e4f6b6f66124c81269057f4fb77d2507`.

Aliases: none. Positionals bind: recipe-id. 

Shared contracts: G. Host: Local repository scripts; global runtime selection ignored by handler; no RPC.

Flags: `--recipe-id`: R — Missing/boolean/empty -> invalid_argument Missing recipe id.; `--repo-path`: O — Fallback cwd; no resolve-to-absolute in handler; `--provision`: T; `--connect`: T; `--page`: IG.

Normalized operation: doctorRecipe(repoPath,recipeId); provision OR connect true -> doctorRecipeWithProvision

Output: JSON bare DoctorResult; text recipe/repoPath/ok/check status+remediation; optional redacted capped create/destroy transcript

Branches/errors: Missing orca.yaml -> failed exists check; parse result plus shared doctor. Provision with bad baseline -> skipped FAIL; disappeared recipe -> baseline unchanged; start failure -> fail and transcript (no cleanup here); success -> warnings then cleanup; cleanup skipped WARN, failed FAIL, successful PASS. Streams redacted then first/last8000 chars when >16000 chars. Despite constant name cap is characters. Shared YAML/doctor/start/cleanup/redaction remain S2/S4.

Exit: !result.ok1; ok0 even with warnings; thrown error1.

Existing assertion bodies read: `src/cli/index-vm-recipe-doctor.test.ts:60-143`. No execution.

### wait

Source: `src/cli/handlers/browser-nav.ts:94-120`, SHA256 `b39225ef7c3e844d00b9c414f438af04ed1dd200a17ef6190193b4b128458ec8`.

Aliases: none. Positionals bind: none. 

Shared contracts: G, OUT, H, B. Host: H with command-specific target fields/contracts.

Flags: `--worktree`: O; `--page`: O; `--selector`: O; `--timeout`: PI; `--text`: O; `--url`: O; `--load`: O; `--fn`: O; `--state`: O.

Normalized operation: browser.wait({selector,timeout,text,url,load,fn,state} merged with target(B))

Output: JSON.stringify(result,null,2)

Branches/errors: No CLI enum/exclusivity check for wait predicates; timeoutMs = timeout+5000 when provided, else60000.

Exit: Fresh-process success 0; caught errors 1 (G/OUT). No extra result-based failure.

Existing assertion bodies read: none attributed to this command in this follow-up; source characterization only. No execution.

## Assertion evidence and execution debt

These are explicit assertion-body reads. They do not assert complete branch test coverage; most RPC/process calls are mocked. Source case counts and runner membership are reused, not recounted.

- `src/cli/flags.test.ts:1-11`: RE helper preserves empty string; a single helper assertion, not all rules.
- `src/cli/browser-storage-empty-value.test.ts:1-134`: Exact one-RPC payload with empty separated/equals value; empty key and missing value cause no RPC, error text, exit1.
- `src/cli/browser-cookie-credentials-empty-value.test.ts:1-117`: Empty value/password forwarded; empty name/missing password cause no RPC and exit1.
- `src/cli/handlers/core.test.ts:1-133`: Spawn and prepareLaunch env omit ELECTRON_RUN_AS_NODE; preserve marker/launch PATH. Two cases skipIf(win32); no real child launch.
- `src/cli/handlers/linear.test.ts:280-416`: Exact status RPC75000; urgent1; blocked-by->blockedBy/add; rm alias->relatedTo/remove; impossible date no RPC; repeated labels retained; missing write target no RPC/exit1.
- `src/cli/handlers/linear.test.ts:545-648`: Enriched create payload fields; explicit null clears assignee/estimate/dueDate/project; duplicate body inputs no RPC.
- `src/cli/handlers/orchestration-worker-cli.test.ts:145-165`: Returned outcome_unknown sets process.exitCode1, with mocked runtime.
- `src/cli/handlers/orchestration-worker-cli.test.ts:291-345`: Cursor0 becomes number0, opaque cursor preserved, source transcript and absent limit forwarded explicitly.
- `src/cli/handlers/computer-action-validation.test.ts:32-107`: No RPC for session/worktree conflict or missing app; app precedence; malformed key/hotkey returns invalid_argument recovery data and exit1.
- `src/cli/handlers/computer-action-validation.test.ts:339-438`: Incomplete drag/conflicting text/empty stdin text reject before RPC; set-value empty stdin calls exact value empty/noScreenshot true and no error/exitCode undefined.
- `src/cli/index-automation-schedule.test.ts:56-186`: Day7, day on daily, time on cron/hourly, bare time, modifiers without schedule all assert no RPC/message/exit1.
- `src/cli/index-project-setup.test.ts:586-647`: Runtime host awin selects paired client and Windows destination remains unchanged; objectContaining is not full payload assertion.
- `src/cli/handlers/artifacts.test.ts:36-131`: Relative HTML sourceKey/content/contentType/fileName and shareUrl output; unsupported extension no RPC; sparse oversize no share RPC; opaque cursor forwarded and next cursor printed. Test title says sanitized but assertion only checks unchanged safe fixture, not sanitizer coverage.
- `src/cli/handlers/account.test.ts:156-174`: Codex device auth args, JSON stderr login stream, sanitized env, temporary home removed, sourceHome import.
- `src/cli/handlers/account.test.ts:560-661`: Original add error survives cleanup failure; successful-add cleanup failure rejects before output; Claude cleanup restoration; bare agent no spawn; WSL active account output; refreshUsage false.
- `src/cli/handlers/agent-hooks.test.ts:129-169`: Disabled hooks passed to prepare; WSL exact single RPC50s, no host installer; unavailable WSL RPC resolves (fails open).
- `src/cli/handlers/emulator.test.ts:57-205`: Local APK absolute/reinstall; attach180s/focus false; folder and exact env worktree preserved; remote relative rejects and Windows absolute preserves; reset empty payload allowed, reset extras/grant missing permission rejected.
- `src/cli/index-vm-recipe-doctor.test.ts:60-143`: Local doctor no runtime calls and expected parse/create/destroy checks; missing cleanup warn still ok. Temporary fs fixtures, provisioning branch not read in this range.
- `src/cli/handlers/file.test.ts:204-274`: Unopened binary diff recorded in skipped with exact shape; unresolved conflict does not open normal diff, staged other entry forwarded and skip reason printed.
- `src/cli/agent-context.test.ts:1-93`: Schema1/count, aliases, global flags, ordering/default arrays; real registry rm aliases; page excluded; claude-teams passthrough flags empty.
- `src/cli/index-local-command-routing-flags.test.ts:1-184`: Local host rows/meta and null/null client; explicit remote selectors rejected; ambient environment suppressed; environment selector still identifies show/rm row.
- `src/cli/quote-stripped-json-flag.test.ts:1-53`: Bare array/object shapes detected; valid JSON and unrepairable shapes not blamed on quoting; diagnostic omits input and uses conditional shell attribution.

- Use accepted source-test-to-contract manifest and retained runner memberships; verify baseline on an authorized disposable copy of pinned source.
- Run pnpm exec vitest run --config config/vitest.config.ts src/cli with source-compatible dependencies in that authorized baseline.
- Run every adjacent path listed in source-tests.json using retained runner membership plus src/main/startup/cli-launch-redirect.test.ts and src/shared/cli-argument-boundary.test.ts.
- Characterize missing branch assertions with exact payload/ordering/output/exit oracles described per row, then port to candidate harness; setup/compile failure is not behavioral RED, skipped is not PASS.
- Native login/keychain/profile/VM/computer effects need approved isolated fixtures/platform jobs; no personal state effects authorized here.

For every command, the JSON remainingTests field requires argument boundary vectors, exact normalized payload/call ordering, text/JSON and stderr/exit branches, host selection, and relevant imported-boundary failure cases. Existing assertions must be retained; uncovered vectors are characterization debt, not passing tests.

## Remaining boundaries and proposed closure

- **E4-S2 — shared-validator-boundary**: Reconcile external shared validators and normalization constants that materially constrain CLI requests. Family rules are source-backed, but this lead has not fully reviewed every called shared function.
- **E4-S3 — transport-and-compatibility-boundary**: Client dispatch/timeout/recovery entry behavior was read; finish the transport, protocol-envelope and compatibility helper contracts reached by class methods/dynamic imports, including both version skews and loss-of-contact semantics.
- **E4-S4 — local-effect-boundary**: CLI branches for account isolation/cleanup, hooks fallback and VM provision/cleanup were read. Their imported filesystem/keychain/process implementations remain separate source acceptance boundaries, not effects exercised by this audit.
- **E4-S5 — formatter-and-result-contract-boundary**: Exact output call sites and reachable formatter expressions are retained, and unusual JSON/exit branches were manually read. Complete golden field/value semantics for imported result formatting and shared output projections without claiming lexical extraction proves all returned variants.

The JSON retains each earlier boundary’s exact dependency paths, source hashes and affected-command scope. This follow-up reads local wrappers and a few finite shared constants where needed; it does not accept the imported validators, remote envelopes, platform effect implementations or complete formatter variants by association.

**Proposed E4-S1 disposition:** source-characterized, pending root acceptance. No canonical command omitted; per-command flags, null/empty/default behavior, payload, handler-level output/error/exit branches, host path and factory values are stated. Source-test assertion coverage is deliberately incomplete and separately identified. **Overall E4 disposition remains open.**

Audit estimate remains about60%, 7/12 accepted groups, medium-low confidence, accepted delta0. Next milestone: root review of these contracts and ownership of remaining S2–S5. Full-fidelity24h deadline risk remains high; test migration/product fidelity progress is unchanged.
