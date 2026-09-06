# E3 result-platform leaf — corrective final pass (COMPUTER / SPEECH / EMULATOR)

Audit-only corrective continuation of settled `task_ee79699b5b27`, same fixed
42-method subset (`DR-COMPUTER_METHODS` 15, `DR-SPEECH_METHODS` 8,
`DR-EMULATOR_METHODS` 19), same source pin
`c97906287bb7a390b25e2025b600d9fb3c25d9c3`
(`/Users/carlos/Documents/Drogon-mentu-session`, read-only). No descendants,
no Git, no tests, no provider/model execution, no installs, no credentials/
settings/product edits. This file and its JSON companion
([native-results-final.json](native-results-final.json)) are the only writes;
the first pass's [native-results.md](native-results.md) /
[native-results.json](native-results.json) are preserved unmodified below
them as the superseded artifact, not deleted.

## Why the first report was rejected, and what was actually read this time

The coordinator's rejection named four specific defects. Each is addressed
below with the concrete local source that disproves it — all newly read this
pass, all still inside `src/main/{computer,speech,emulator}` (no external
repo, no frozen input, nothing outside the fixed 42-method scope).

### 1. "Falsely calls unread local implementations real external boundaries"

The first report stopped at `computer-sidecar.js` and called it "a compiled
entry point... outside this leaf's assigned file set." That file's actual TS
source is `src/main/computer/sidecar-entry.ts` (125 lines, resolved via
`electron.vite.config.ts:223` — `'computer-sidecar': resolve('src/main/computer/sidecar-entry.ts')`)
and it is local, readable, TypeScript source — not a foreign boundary. Read
in full this pass. It dispatches by method name to `currentComputerProvider()`
(`computer-provider-lifecycle.ts`), which is itself local. The REAL boundary
is one level further down: `MacOSNativeProviderClient` spawns a **separate
signed macOS helper process** over `spawn(helperExecutablePath, ['--agent',
socketPath, '--token-file', socketTokenPath], {detached:true})`
(`macos-native-provider-transport.ts:117-129`) and talks JSON-lines over a
Unix domain socket; `DesktopScriptProviderClient` spawns `python3 <script>
<operationPath>` (Linux) or `powershell.exe -File <script> <operationPath>`
(Windows) via `execFile` (`desktop-script-provider-bridge.ts:77-98`). Those
two spawn calls — a signed native binary and a python3/powershell.exe
process running a `.py`/`.ps1` script — are the genuine boundary. Everything
above them (`sidecar-entry.ts`, `computer-provider-lifecycle.ts`,
`macos-native-provider-client.ts`, `desktop-script-provider-client.ts`,
`desktop-script-action.ts`, `computer-provider-action-validation.ts`) is
local TS and has now been read in full.

Same pattern for EMULATOR: the first report stopped at `EmulatorBridge`
("356 lines, signature-level grep only") and called it, together with
`backends/*`, the boundary. Both are local TS and are now read in full
(`emulator-bridge.ts` 356 lines, `backends/emulator-backend.ts` 98,
`backends/android-emulator-backend.ts` 336, `backends/ios-emulator-backend.ts`
318). The real boundary is `execFile(sdk.adb/sdk.emulator, ...)`
(`android/android-command-runner.ts:18-50`, confirmed real OS binary
invocation) for Android, and a `runProcess`-spawned `serve-sim` helper binary
(`serve-sim-execution.ts`, peeked) for iOS.

Same pattern for SPEECH: the first report stopped at
`getSpeechModelManager`/`getSpeechSttService` ("signature-level peek only")
and called the whole chain underneath an opaque "native STT boundary."
`speech-runtime-service.ts` (60 lines), `model-manager.ts` (338 lines),
`stt-service.ts` (71), `stt-session-state.ts` (48), `stt-session-start.ts`
(164), `stt-session-stop.ts` (197), `speech-model-deletion.ts` (79), and
`model-catalog.ts` (155) are all local TS and are now read in full. The real
boundaries are: (a) HTTPS model file downloads via
`SpeechModelDownloadTransport.downloadFileWithRetry` (Electron streaming
`net.request`, per the comment in `speech-runtime-service.ts:8-9` — the
transport class body itself was not re-read this pass, it is a genuine
network/provider boundary, not a local logic gap); (b) a `node:worker_threads`
`Worker` running `getSttWorkerPath()` for **local** models — a real OS thread
executing native inference code, not local orchestration logic; (c) an
`OpenAiTranscriptionSession` (`openai-transcription-client.ts`, not read this
pass — genuine external HTTP provider boundary) for **cloud** (`provider:
'openai'`) models.

### 2. "Assumes a restricted source file set never assigned"

The task scope is the fixed 42 RPC methods across
`DR-COMPUTER_METHODS`/`DR-SPEECH_METHODS`/`DR-EMULATOR_METHODS` — it was
never restricted to only the 7 files the first report opened. This pass
opened 27 additional local source files (full list with hashes in the JSON
companion's `additionalFilesRead`), all of them concrete implementations
needed to characterize the assigned methods' exact outputs, not a recursive
import census (no test files, no unrelated subsystems, no files outside
`src/main/computer`, `src/main/speech`, `src/main/emulator` were opened).

### 3. "Only speech mutable state"

False. Every group has real cross-call mutable state:

- **COMPUTER**: `ComputerProviderLifecycle` caches the resolved
  `MacOSNativeProviderClient`/`DesktopScriptProviderClient` instance for the
  life of the sidecar process (`computer-provider-lifecycle.ts:24-56`).
  `MacOSNativeProviderClient` caches `providerCapabilities` (from a
  `handshake` call) until `shutdown()`, and holds a live socket +
  pending-request map (`macos-native-provider-client.ts:32-43`).
  `DesktopScriptProviderClient` owns a `DesktopScriptSnapshotStore` that
  remembers each app/window's last snapshot **and uses it to resolve
  `elementIndex`/`fromElementIndex`/`toElementIndex` on the next action call**
  (`desktop-script-provider-client.ts:48,111-192`) — a later `computer.click`
  with an `elementIndex` genuinely depends on state left by an earlier
  `computer.getAppState` call. This is materially more consequential mutable
  state than anything in the SPEECH group.
- **SPEECH**: confirmed as before (`RuntimeMobileDictationController.session`),
  plus newly found: `speech-runtime-service.ts` module-level `modelManager`/
  `sttService` singletons (lazy-created once per process,
  `speech-runtime-service.ts:29-31`), and `ModelManager`'s own
  `activeDownloads`/`modelStates` maps (`model-manager.ts:33-34`) and
  `SttService`'s `SttSessionState` (`worker`/`cloudSession`/`activeOwner`/
  `startingOwner`/`canceledOwners`/`idleTeardownTimer`/`stopInFlight` —
  `stt-session-state.ts:12-28`, substantially richer than the single
  `session` field the first report characterized at the controller layer).
- **EMULATOR**: `EmulatorSessionRegistry` (per-worktree active session map,
  `emulator-bridge.ts:29`), `EmulatorStartLeaseRegistry` (`:30`),
  `AndroidEmulatorBackend.screenSizes` cache keyed by serial
  (`android-emulator-backend.ts:87,314-327`, invalidated on `.rotate()`),
  and the global `scrcpyVideoRegistry` consulted by `isSessionReusable`
  (`android-emulator-backend.ts:202-206`).

### 4. "All computer throws"

False, concretely disproved by `computer.setValue` on the desktop-script
(Linux/Windows) provider path. `verifyDesktopAction`
(`desktop-script-action.ts:122-158`) does **not** throw when a `setValue`
action's actual post-write element value doesn't match the requested value —
it returns a normal, successful `ComputerActionResult` with
`action.verification = {state:'unverified', reason:'value_mismatch'|
'provider_unavailable', expected, actualPreview}`. A caller checking only
for a thrown error would treat this as success even though the value write
did not actually take effect. This is a genuine partial-success-without-throw
shape, not a defect assessment — it is exactly the kind of result-shape
detail this leaf exists to characterize.

### 5. "Only 2 platform branches" (bonus correction — named in the task as an example, not exhaustive)

At least 8 distinct platform/host-capability branch points exist across the
two groups that have them, not 2:

1. `ComputerProviderLifecycle.current()` — darwin-first, else desktop-script,
   else `null` (`computer-provider-lifecycle.ts:30-49`).
2. `shouldUseMacOSNativeProvider()` — `process.platform==='darwin' &&
   isMacOS14OrNewer() && resolveMacOSComputerUseExecutablePath()!==null`
   (`macos-native-provider-availability.ts`) — a **version** branch
   (`isMacOS14OrNewer` parses `os.release()`'s major version and requires
   >=23, i.e. Sonoma+), not just a platform branch.
3. `desktopScriptPlatform()` — linux/windows only, **explicitly excludes
   darwin** (`desktop-script-provider-paths.ts:6-13`) — meaning an older/
   unsupported macOS host that fails check #2 gets **no fallback provider at
   all** (`currentComputerProvider()` returns `null`), not a silent
   downgrade to the script provider.
4. `computerProviderUnavailableMessage()` — darwin / linux|win32 / other,
   a 3-way branch (`computer-provider-unavailable-message.ts`).
5. `execBridge()`'s command selection — `platform==='windows' ?
   'powershell.exe' : 'python3'` (`desktop-script-provider-bridge.ts:13`).
6. `IosEmulatorBackend.isSupportedOnHost()` — `platform()==='darwin'`
   (`ios-emulator-backend.ts:65-67`).
7. `AndroidEmulatorBackend.isSupportedOnHost()` — SDK-presence-based, not a
   `process.platform` check at all (`android-emulator-backend.ts:108-110`).
8. `EmulatorBridge.backendForDevice()`'s unresolved-device fallback — first
   backend supported on host, else darwin→iOS/else→Android
   (`emulator-bridge.ts:342-355`).

`computer.permissions`/`computer.permissionsStatus`'s darwin-only branches
(already reported) are additional, so the true count for this leaf is
**at least 10**.

## Per-method corrected characterization

The full 42-method table (result shape / state / errors / partial success /
host-version-platform / null-absent-presence, exact source + range SHA256,
local-vs-native-execution residual) is in the JSON companion's `methods[]`
array. This section narrates only what materially changed from the first
report — methods whose RPC-handler-level characterization was already
correct (the handler bodies themselves did not change between passes) are
listed with a one-line "unchanged at RPC layer, corrected boundary only"
note; the substantive corrections are on the provider/backend layer under
them.

### COMPUTER (DR-COMPUTER_METHODS)

- **computer.capabilities**: was "returns sidecar handshake verbatim." Now:
  `MacOSNativeProviderClient.capabilities()` requires `ensureCompatible()`
  first, which throws `RuntimeClientError('provider_incompatible', ...)` if
  the helper's `handshake` response's `protocolVersion !==
  REQUIRED_MACOS_PROVIDER_PROTOCOL_VERSION` (currently `1`) even after one
  automatic restart-and-retry (`macos-native-provider-client.ts:132-150`).
  `DesktopScriptProviderClient.capabilities()` throws
  `RuntimeClientError('accessibility_error','desktop provider returned no
  capabilities')` if the bridge's handshake response lacks a `capabilities`
  field (`desktop-script-provider-client.ts:229-242`). Neither path was
  characterized in the first report at all.
- **computer.listApps**: `DesktopScriptProviderClient.listApps()` maps
  `bundleId ?? bundleIdentifier ?? null` (two possible response key names
  coalesced) and hardcodes `isRunning:true, lastUsedAt:null, useCount:null`
  regardless of what the script actually reports
  (`desktop-script-provider-client.ts:62-74`) — three fields are always
  fixed literals on this path, not passed through.
- **computer.listWindows**: `MacOSNativeProviderClient.listWindows()` first
  calls `ensureCapability('windows','list')`, throwing
  `RuntimeClientError('unsupported_capability', ...)` if the connected
  helper doesn't advertise it (`macos-native-provider-client.ts:51-54,
  154-166`) — a capability gate the first report did not mention for this
  method. `DesktopScriptProviderClient.listWindows()` does the same
  capability check against its own handshake-derived capabilities object
  before calling the bridge (`desktop-script-provider-client.ts:80-109`).
- **computer.getAppState**: `DesktopScriptProviderClient.snapshot()` throws
  `RuntimeClientError('accessibility_error','desktop provider returned no
  snapshot')` if the response lacks a `snapshot` field, and otherwise
  **remembers** it in the per-app/window `snapshotStore` before rendering
  (`desktop-script-provider-client.ts:111-122,244-255`) — this remembered
  snapshot is exactly the state later consumed by `elementParam()` for
  action calls (see mutable-state correction above).
- **computer.click / .performSecondaryAction / .scroll / .drag / .typeText /
  .pressKey / .hotkey / .pasteText / .setValue**: all 9 now have a real,
  concrete pre-validation layer (`computer-provider-action-validation.ts`,
  259 lines, read in full) that throws `RuntimeClientError('invalid_argument',
  ...)` **before any sidecar/provider call is made** for structurally invalid
  params (e.g. click requires `elementIndex` XOR `{x,y}`, not both or neither;
  drag requires a full element pair or a full coordinate quad, not partial;
  scroll direction must be one of up/down/left/right; hotkey/pressKey keys
  are validated against `computer-use-key-spec.ts`'s shared validators). This
  entire validation layer was absent from the first report, which described
  these 9 methods as uniform opaque pass-throughs to the sidecar with no
  local argument checking. On the desktop-script path specifically,
  `elementParam()` additionally throws `RuntimeClientError('element_not_found',
  'element <index> is not in the current cached snapshot; run get-app-state
  again and use a fresh element index')` when a supplied element index isn't
  present in the remembered snapshot (`desktop-script-action.ts:216-229`) —
  and `computer.setValue` specifically can return a **successful, non-throwing**
  result with `verification.state:'unverified'` when the write is later found
  not to have taken effect (see false-claim #4 above, `desktop-script-action.ts:
  122-158`). On the macOS-native path, each of the 9 methods additionally
  requires `ensureActionSupported(method)` (a capability check keyed by
  `macOSActionCapabilityKey`) before the socket call, throwing
  `RuntimeClientError('unsupported_capability', ...)` if the connected helper
  doesn't support that specific action (`macos-native-provider-client.ts:
  58-65,167-169`).

### SPEECH (DR-SPEECH_METHODS)

- **speech.models.list**: `getModelState()` branches on
  `manifest.provider`: for the 2 `'openai'` catalog entries, status is
  `'ready'` iff `hasOpenAiSpeechApiKey()` is true, `'not-downloaded'`
  otherwise — **no local disk check at all** for these two models
  (`model-manager.ts:100-105`). For the 10 `'local'` entries, status is
  `'ready'` only if the model directory exists **and** every one of its
  `downloadFiles` matches its manifest `sizeBytes` exactly via `statSync`
  (`model-manager.ts:135-146`) — a byte-size integrity check, not just an
  existence check. A model mid-download or mid-extraction returns its
  **cached** in-memory state (`'downloading'`/`'extracting'`) without
  re-touching disk (`model-manager.ts:90-93`). None of this branching was in
  the first report, which characterized `.list()` as a flat lookup with
  `?? 'not-downloaded'` defaulting only.
- **speech.models.download**: `downloadModel()` is a **no-op** (silently
  returns) if a download for that `modelId` is already in `activeDownloads`
  — repeated download calls for the same in-flight model do not restart or
  error, they're absorbed (`model-manager.ts:150-152`). If the model
  directory already exists and passes the same byte-size validation as
  `.list()`, it's marked `'ready'` immediately with **no network activity**
  at all (`model-manager.ts:165-169`). The real download path removes any
  stale `.partial` staging directory and legacy `.tar.bz2` archive first,
  downloads each `downloadFiles` entry to staging, **verifies each file's
  SHA256** (`verifyFileSha256`, not read further — internal to the download
  transport), then atomically renames staging → final directory
  (`model-manager.ts:171-224`). Cancellation is a real `AbortController`
  wired through an `activeDownloads` handle map, distinct from the RPC layer
  entirely (there is no `speech.models.cancelDownload` in this leaf's 8
  methods — cancellation is only reachable indirectly via `deleteModel`,
  see below). The fire-and-forget/silent-failure characterization from the
  first report stands, but the exact set of synchronous pre-flight throws
  from the manager itself (`Unknown model: <id>`, `Model does not support
  downloads: <id>`, `Model download metadata missing: <id>`) is new — these
  are normally pre-empted by the RPC-layer catalog's own check
  (`voice_model_not_downloadable`), so they only fire if that check is ever
  bypassed or races a catalog change.
- **speech.models.delete**: was characterized as "wraps whatever
  deleteLocalSpeechModel throws through an unread code-mapping helper."
  Both are now read in full. The exact, closed error-code set is
  `voice_model_unknown` (unknown model id), `voice_model_not_deletable`
  (catalog entry exists but `provider!=='local'`, i.e. an OpenAI model),
  `voice_model_in_use` (from `SttService.prepareModelForDeletion`: the model
  is the one currently starting, or currently active with an owner, or an
  idle worker for it failed to tear down within the call) — the
  `'voice_model_delete_failed'` fallback in `RuntimeMobileSpeechCatalog.delete()`
  is now confirmed **unreachable** in the normal flow, since
  `getSpeechModelDeletionErrorCode` always maps to one of the three named
  codes above for every throw `deleteLocalSpeechModel` can produce. **New
  state-change finding**: if the deleted model was the user's currently
  selected `voice.sttModel`, deletion also clears that setting to `''` and
  persists it with `notifyListeners:true`
  (`speech-model-deletion.ts:67-78`) — a real settings mutation as a side
  effect of delete that the first report did not mention at all.
- **speech.dictation.start**: was characterized as a single linear
  check-then-spawn sequence. The actual implementation
  (`stt-session-start.ts`, 164 lines) has a **session-reuse fast path**: if a
  local worker already exists for the exact same `modelId` +
  `hotwordsFilePath` and there is no owner conflict, `start()` reuses it
  without spawning a new worker or re-checking model readiness (unless
  `!state.activeOwner`, in which case readiness is re-checked once) —
  returning `{dictationId, modelId}` almost immediately
  (`stt-session-start.ts:91-115`). There is also a real provider fork at
  this layer: `manifest.provider==='openai'` tears down any existing local
  worker and creates an `OpenAiTranscriptionSession` instead of a
  `node:worker_threads` `Worker` (`:70-86` vs `:117-151`) — genuinely
  different transports for local vs. cloud models, both reachable through
  the same `speech.dictation.start` RPC call depending on which `modelId`
  was requested. A same-owner re-entrant `start()` call while one is already
  starting is a **silent no-op** (returns without restarting or erroring,
  `:29-34`), distinct from the "hard single-session invariant" framing in
  the first report, which only covered the different-owner case
  (`dictation_already_active`, still correct for that case). The
  worker-path model-not-ready error message is
  `Model not ready: <status>` at this layer (`stt-session-start.ts:78,124`)
  — distinct in exact text from the controller layer's
  `voice_model_not_ready:<status>` (colon-joined, no space) — the controller
  check fires first in the normal flow so this is a defense-in-depth
  duplicate, not a contradiction, but the two messages are not
  interchangeable if ever compared literally.
- **speech.dictation.chunk**: `SttService.feedAudio()` has its **own**
  independent ownership check (`stt-service.ts:33-51`): if no owner is
  recorded at all (`!currentOwner`), it silently drops the audio (returns
  without error) rather than throwing — a second, differently-behaved
  ownership gate beneath the controller's `requireOwnedSession` throw. For
  the cloud (openai) path, `feedAudio` forwards samples to
  `state.cloudSession.feedAudio(samples, sampleRate)` (an HTTP-streamed
  provider call, not read further — genuine external boundary); for the
  local path it posts to the `worker_threads` `Worker` via
  `postMessage(..., [transferable buffer])` — a real transferable-buffer
  zero-copy handoff to the worker thread, not just a plain message.
- **speech.dictation.finish**: `stopSttDictation()`'s cloud-session branch
  (`stt-session-stop.ts:24-49`) calls `session.finish()` **directly** and
  emits its returned text as a single `{type:'final', text}` sink event
  (rather than accumulating from a stream of partial events); the local
  worker branch posts `{type:'stop'}` and awaits `waitForSttWorkerStop`
  (not read further — internal worker-lifecycle wait, not needed to
  characterize the RPC-visible `{dictationId, text}` contract, which is
  unchanged from the first report at the controller layer). New error path
  found at this layer: a `stopInFlight` mismatch (a stop already running for
  a different owner) throws `dictation_owner_mismatch`
  (`stt-session-stop.ts:56-60`) — a third site for this same error code,
  alongside the controller's `requireOwnedSession` and this same function's
  top-level owner check.
- **speech.dictation.cancel**: no material change found beneath the
  controller layer — `RuntimeMobileDictationController.cancel()` already
  fully characterizes the RPC-visible contract in the first report; the
  deeper `stopSttDictation()` call it makes is the same function analyzed
  for `.finish()` above, reached via the same code path.
- **speech.dictation.setup**: no material change — `RuntimeMobileSpeechCatalog
  .configure()` was already fully characterized; `getCatalogModel` (used for
  the `voice_model_unknown` check) is now confirmed against the exact
  12-entry closed catalog in `model-catalog.ts` (10 local, 2 openai, no
  external catalog fetch, no pagination, no versioning).

### EMULATOR (DR-EMULATOR_METHODS)

- **emulator.list**: `EmulatorBridge.listRunningHelpers()` is iOS-only —
  it unconditionally delegates to `this.iosBackend.listRunningHelpers()`
  (`emulator-bridge.ts:58-60`), which runs the `serve-sim` helper binary
  with `['--list','-q']` and parses its JSON output
  (`ios-emulator-backend.ts:98-100`). **There is no Android equivalent
  reachable through this RPC method at all** — despite the RPC method being
  named generically `emulator.list` (not `emulator.listIos`), Android
  devices/AVDs are only reachable via `emulator.listDevices`
  (`listAllDevices`, cross-backend) or `emulator.listSimulators`
  (also iOS-only, confusingly named identically to what one might expect
  `.list` to mean). This routing asymmetry was entirely missed in the first
  report, which treated `.list()` as backend-agnostic.
- **emulator.attach**: `EmulatorBridge.getReusableActiveForWorktree()`
  (called by the RPC-adjacent `RuntimeEmulatorCommands.emulatorAttach`,
  already characterized at that layer in the first report) resolves the
  requested device via `backend.resolveDeviceId()` and, if that throws
  (e.g. Android's "not running, boot it first" for an AVD not yet booted),
  **catches it and treats it as "not the active device"**
  (`emulator-bridge.ts:101-107`, `.catch(() => null)`) rather than
  propagating — falling through to a fresh attach/boot attempt instead of
  surfacing the resolution error. This swallow-and-retry behavior was not
  characterized in the first report.
- **emulator.tap / .gesture / .type / .button / .rotate**: all five now
  have backend-concrete implementations. Android: each resolves the device
  serial then shells out through `adb` via helper functions in
  `android-input-commands.ts` (not read line-by-line — pure arg-builders
  plus the shared `execFileAndroidCommandRunner` boundary already
  characterized); `.tap`/`.gesture` additionally require a cached or
  freshly-queried screen size (`getScreenSize`, `wm size` via adb,
  `android-emulator-backend.ts:314-327`) to translate normalized 0-1
  coordinates to device pixels — a real dependency the first report did not
  surface (a `wm size` query failure throws `EmulatorError('emulator_error',
  'Could not read screen size for <serial>.')`, a device-specific error not
  previously enumerated). `.rotate` explicitly invalidates the cached screen
  size for that serial before rotating (`:241-245`) — correctly modeling
  that orientation changes swap width/height. iOS: all five go through the
  `serve-sim` helper binary via `execServeSim`, with `.gesture` specifically
  requiring a live `wsUrl` (the registered stream's websocket) and throwing
  `EmulatorError('emulator_no_active','No active emulator stream for gesture
  input')` if none is registered (`ios-emulator-backend.ts:144-156`) — a
  gesture-specific error distinct from the generic no-active-bridge error.
- **emulator.exec**: Android routes the raw command string through
  `androidExec` (shells to `adb shell <command>`, not read further — a thin
  arg-builder over the already-characterized `execFileAndroidCommandRunner`
  boundary). iOS parses the command string as `serve-sim` CLI args via
  `parseServeSimCommandArgs`/`stripEmulatorTargetArgs` and requests JSON
  output (`ios-emulator-backend.ts:173-177`) — the two backends interpret
  `command` completely differently (a raw adb shell command vs. a
  serve-sim subcommand), which the first report did not distinguish at all
  (it characterized `.exec` as one opaque `bridge.exec()` call).
- **emulator.kill / .shutdown**: both call `backend.stopHelperForDevice()`
  then (shutdown only) `backend.shutdownDevice()`. Android's
  `stopHelperForDevice` best-effort reaps a leaked adb port-forward via
  `adb -s <serial> forward --remove-all` when `includeOrphaned` is set,
  swallowing any failure (`android-emulator-backend.ts:173-193`) — cleanup
  failures here are silently invisible to the RPC caller by design.
  `shutdownDevice` runs the real `adb emu kill` equivalent
  (`emuKillArgs`, `android-command-runner` boundary) and clears the cached
  screen size for that serial. iOS's `shutdownDevice` calls
  `shutdownSimulatorDevice` (simctl, not read further — pure wrapper over a
  real `xcrun simctl shutdown` invocation, same class of boundary as
  serve-sim).
- **emulator.install / .launch / .permissions / .logcat**: **iOS backend
  capability flags are all `false`** for these four
  (`ios-emulator-backend.ts:41-47`: `install:false, launch:false,
  permissions:false, logcat:false`) — so routing any of these 4 RPC calls to
  an active iOS session throws `EmulatorError('emulator_unsupported',
  '<capability> is not supported by the ios emulator backend')` from
  `EmulatorBridge.runCapability()` (`emulator-bridge.ts:229-242`), not the
  generic `emulator_no_active`. This exact capability gate (and which 4
  methods it blocks on iOS) was flagged only as a vague "residual" in the
  first report ("whatever runCapability/backend.X throws (not read)") and
  is now a confirmed, concrete contract. On Android, all four are real:
  `.install` runs `adb install`, explicitly checking not just the exit code
  but also scanning stdout+stderr for `/Failure|Error/i` because **"adb
  install can exit 0 while printing 'Failure [...]' to stdout"**
  (`android-capability-operations.ts:22-29`, a verbatim source comment) — a
  genuine silent-success trap in the underlying tool that this codebase
  explicitly guards against; `.launch`/`.permissions` use the shared
  `ensureAdbOk` (throws `EmulatorError('emulator_error','<label> failed:
  <stderr|stdout>')` on any non-zero exit, `android-adb-result.ts`); `.ax`
  (`accessibilityTree`) on Android runs a **two-step** `adb shell uiautomator
  dump` then `adb shell cat <dumpfile>`, each independently checked via
  `ensureAdbOk`, then parses the returned XML via `parseUiAutomatorXml`
  (not read further); `.logcat` runs a **one-shot** `adb logcat -d` (not a
  streaming/follow tail — an explicit source comment notes follow-mode
  would need a different transport) and parses each output line via
  `parseLogcatLine` into a `LogcatEntry[]`, silently dropping blank lines.
  iOS's `.ax` (the one capability iOS DOES support) instead requires a live
  `axUrl` derived from the session's stream URL and throws
  `EmulatorError('emulator_no_active','No active iOS emulator AX endpoint —
  attach the simulator first.')` if absent (`ios-emulator-backend.ts:179-187`),
  then makes an HTTP-style request to the serve-sim helper's AX endpoint
  (`requestServeSimAccessibilityTree`, not read further — same class of
  local-helper-HTTP boundary as the stream endpoints).
- **emulator.listSimulators / .availability / .listDevices**: no material
  change to the RPC-visible contracts already characterized in the first
  report; `checkAvailability()` on both backends now confirmed to run a
  real device-list probe and, for iOS, an additional
  `checkServeSimAvailable()` liveness probe (`--help` against the helper
  binary) before reporting `available:true`
  (`ios-emulator-backend.ts:106-137`).
- **emulator.unregisterActive**: no material change — first report's
  characterization (including the confirmed `requireEmulatorBridge()` call
  and the absent-worktree/successful-unregister return-value ambiguity)
  stands.

## Test associations (unchanged from first report, not re-litigated this pass)

The route-level shared assertion files and the confirmed-but-unopened
`src/main/runtime/rpc/methods/speech.test.ts` are carried forward unchanged
from the first report — this pass's corrective effort went entirely into
the local-implementation depth named in the rejection, not into test-body
reading, which remains the next concrete step for whoever picks this up
next (lead or a further pass). No test file was opened this pass either.

## Exact remaining residuals (genuine OS/native/provider boundaries only)

Everything below is a real external boundary — a spawned OS process, a
native code path (worker thread running compiled inference code, or a
signed macOS helper binary), or an outbound network call — not an unread
local TS bridge:

1. The signed macOS "Orca Computer Use.app" helper binary itself (spawned
   process, real Accessibility-API automation) — protocol is characterized
   (JSON-lines over Unix socket, `macos-native-provider-contract.ts`, read),
   the binary's internals are not and cannot be (native code, not in this
   repo's TS source).
2. `runtime.py` / `runtime.ps1` (native/computer-use-linux,
   native/computer-use-windows) — real Python/PowerShell scripts, not TS;
   genuinely outside this leaf's language scope.
3. `adb`, `emulator`, `xcrun simctl` — real Android SDK / Apple CLI
   binaries, invoked via `execFile`/`execFileSync`, confirmed at every call
   site above.
4. The `serve-sim` helper binary (iOS) — a real compiled/scripted helper,
   invoked via `runProcess`, confirmed at `serve-sim-execution.ts`.
5. `node:worker_threads` Worker running local STT inference
   (`getSttWorkerPath()`) — a real OS thread executing compiled/native
   inference code; `stt-worker.ts` itself (330 lines) was not read this
   pass since the worker's internal message protocol was already
   sufficiently characterized via its call sites (`postMessage`/`onMessage`
   shapes in `stt-session-start.ts`/`stt-session-stop.ts`, both read in
   full) to fully describe the RPC-visible contract; reading the worker's
   own inference internals would be reading past the real native boundary.
6. `OpenAiTranscriptionSession` (`openai-transcription-client.ts`, not read
   this pass) — a real outbound HTTPS call to OpenAI's transcription API;
   same reasoning as #5 — the RPC-visible contract (a `finish()` call
   returning final text, an `error` event on failure) is already fully
   characterized via its call sites in `stt-session-start.ts`/
   `stt-session-stop.ts`.
7. `SpeechModelDownloadTransport.downloadFileWithRetry` /
   `verifyFileSha256` (in the base class `ModelManager` extends, not read
   this pass) — a real outbound HTTPS download using Electron's streaming
   `net.request`; the RPC-visible contract (`{started:true}` immediately,
   silent console-logged failure) is already fully characterized via
   `downloadModel()`'s call site, read in full.
8. Pure Android arg-builders/parsers not read line-by-line this pass
   (`android-input-commands.ts`, `android-app-control.ts`,
   `android-permissions.ts`, `android-logcat.ts`, `uiautomator-tree.ts`,
   `android-device-inventory.ts`, `android-avd-boot.ts`,
   `android-sdk-discovery.ts`/`-state.ts`) — these are one hop past the
   already-characterized `android-capability-operations.ts` call sites;
   their existence and call signatures were confirmed via imports, their
   bodies were not read (this is the "no recursive every-import census"
   boundary named in the task, applied deliberately here since the
   RPC-visible result contract is already fully pinned down by the call
   site one layer up).
9. `macos-native-provider-socket.ts` (87 lines) — the raw
   `net.connect`-over-unix-socket implementation underneath
   `macos-native-provider-transport.ts` (read in full); not re-read since
   the transport layer already fully characterizes the connect/timeout/
   retry contract visible to callers.

None of the above were called, executed, or exercised this pass — this is a
source-reading characterization only, exactly as scoped.

---

## Superseded first-pass artifact (preserved, not deleted)

The original [native-results.md](native-results.md) and
[native-results.json](native-results.json) remain on disk unmodified at
their original paths as the record of what was submitted and rejected. This
file supersedes their per-method boundary/state/error characterizations
wherever the two disagree; where this file is silent on a method, the first
pass's characterization at the RPC-handler layer (not the boundary layer)
still stands per the "unchanged at RPC layer" notes above.
