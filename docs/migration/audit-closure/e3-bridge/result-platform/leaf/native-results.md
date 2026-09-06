# E3 result-platform leaf — COMPUTER / SPEECH / EMULATOR result contracts

Audit-only, fresh Task (not an E5 continuation), no descendants. Source is the
read-only pinned reference at `c97906287bb7a390b25e2025b600d9fb3c25d9c3`
(`/Users/carlos/Documents/Drogon-mentu-session`). Machine companion:
[native-results.json](native-results.json). No Git commands were run, no
tests were run, no product/source edits were made, no credentials/settings/
services/external operations occurred, and no descendant delegation happened.

Fixed 42-method subset from the coordinator's 3-group assignment:
`DR-COMPUTER_METHODS` (15), `DR-SPEECH_METHODS` (8), `DR-EMULATOR_METHODS` (19).
Root audit index is 10/12 = 83.3% — this is a candidate leaf contribution, not
parity and not a closure claim. The lead covers the other 84 methods in the
same partition and integrates/reviews this leaf's 42.

## Inputs read

- `docs/migration/e3-result-audit-partition.json` — confirms `platform`
  assignment owns `DR-COMPUTER_METHODS`, `DR-SPEECH_METHODS`,
  `DR-EMULATOR_METHODS` among 21 platform-group contracts.
- `docs/migration/audit-closure/e3-bridge/followup-domain-ownership.json` —
  `rpcOwnershipContracts` (3 entries matching this leaf's IDs) and `rpcRows`
  (42 matching entries, indices 281-295, 524-531, 576-594) supplying exact
  `definition.file`/`line`/`endLine` per method plus `cliConsumerRefs`.
- `docs/migration/audit-closure/e3-bridge/followup-final-boundaries.json` —
  `rpcRows` at the same 42 indices supplying `handler` (literal handler source
  text), `namedSchemaRefs`, `originalTests.sharedRouteAssertionFiles`,
  `remainingAcceptance`, and `receiverFixture` receiver evidence.

Owning-contract evidence read first (not re-derived): `S5-computer` /
`E4-F07` (computer), `RP-M2` (speech + emulator), `PUI-CONN-003` (emulator UI
connection). These are cited, not re-litigated — this leaf adds the
implementation-level result-contract layer underneath them.

## Method definition locations (exact, from `rpcRows`)

All 15 `computer.*` methods are defined in
`src/main/runtime/rpc/methods/computer.ts` (lines 32-140, one `defineMethod`
block per method, contiguous). All 8 `speech.*` methods are in
`src/main/runtime/rpc/methods/speech.ts` (lines 52-100). All 19 `emulator.*`
methods are in `src/main/runtime/rpc/methods/emulator.ts` (lines 159-253).
Exact per-method line ranges and range SHA256 (raw byte hash of the inclusive
line span, **not** `git hash-object`/blob hash) are in the JSON companion's
`methods[].source.rangeSha256`.

## Immediate callees read (one hop past the RPC method, stopping at the real boundary)

### COMPUTER_METHODS

- `src/main/computer/sidecar-client.ts` (325 lines, full read) — `computer.click`,
  `.performSecondaryAction`, `.scroll`, `.drag`, `.typeText`, `.pressKey`,
  `.hotkey`, `.pasteText`, `.setValue` all route through
  `callComputerSidecarAction(method, params)`; `.capabilities`, `.listApps`,
  `.listWindows`, `.getAppState` route through their own
  `callComputerSidecar*` wrappers. All of these ultimately call
  `ComputerSidecarProcess.call()`, which forks a **separate Node child
  process** (`out/main/computer-sidecar.js`, `ELECTRON_RUN_AS_NODE=1`) and
  talks to it over `child.send`/`message` IPC with a 60s per-call timeout,
  a FIFO request queue keyed by an incrementing generation counter, and a
  `Map<id, PendingRequest>` for in-flight correlation. **This is the real
  native/provider boundary for the 9 action-shaped methods plus capabilities/
  listApps/listWindows/getAppState**: the actual OS-level computer-use
  execution happens inside `computer-sidecar.js` (a separate compiled entry
  point, not in this leaf's assigned file set) — not read further, no
  recursive import census performed. Exact remaining owner: the
  `computer-sidecar.js` entry point and whatever OS automation library it
  wraps (macOS Accessibility API per the permissions surface below).
- `src/main/computer/computer-action-verification-normalization.ts` (26 lines,
  full read) — `normalizeComputerActionResult` is a pure post-processing step
  applied to every `callComputerSidecarAction` result: if `result.action.path`
  is `'synthetic'`/`'clipboard'`/`'accessibility'` and `result.action.verification`
  is absent, it **injects** `verification: { state: 'unverified', reason: <mapped> }`
  before returning. If `result.action` is falsy, or a `verification` field is
  already present, the result passes through unchanged. This is a state-shape
  mutation contract independent of the sidecar boundary and fully covered by
  reading its source (no residual).
- `src/main/computer/computer-sidecar-paste-validation.ts` (15 lines, full
  read) — only `pasteText` triggers a validation side-effect
  (`validateComputerClipboardPasteTextWithBoundedYield`, not in this leaf's
  file set) when `params.text` is a string; every other action method and any
  non-string `text` is a no-op pass-through. This delegates to a clipboard
  validator outside the assigned set — flagged as a residual, not read.
- `src/main/computer/runtime-client-error.ts` (9 lines, full read) —
  `RuntimeClientError extends Error` with a `code: string` field. All sidecar
  IPC failures (timeout, child exit, child spawn error, unavailable IPC
  channel, queue invalidation) throw this with a fixed code from the set
  `{'action_timeout', 'accessibility_error'}` observed in `sidecar-client.ts`.
- `src/main/computer/macos-computer-use-permissions.ts` (175 lines, full
  read) — `computer.permissions` (→ `openComputerUsePermissions`) and
  `computer.permissionsStatus` (→ `getComputerUsePermissionStatus`, actually
  defined in the sibling file below) are the two methods with an **explicit
  platform branch**: both return a fixed `unsupported`-status stub
  immediately when `process.platform !== 'darwin'`, no sidecar/child process
  involved at all on non-macOS hosts. On macOS, both call real OS binaries
  directly via `node:child_process` (`spawn('/usr/bin/open', ...)`,
  `spawnSync('/usr/bin/pkill', ...)`, `execFileSync('/usr/libexec/PlistBuddy', ...)`,
  `spawnSync('/usr/bin/tccutil', ...)`) — **this is the real OS/provider
  boundary for the permissions surface**, distinct from the sidecar-IPC
  boundary above. `openComputerUsePermissions` throws
  `RuntimeClientError('accessibility_error', 'Orca Computer Use.app was not found')`
  if `resolveMacOSComputerUseAppPath()` (outside this leaf's file set)
  returns falsy, and re-throws the same code with the status helper's
  `helperUnavailableReason` if present.
- `src/main/computer/macos-computer-use-permission-status.ts` (194 lines, full
  read) — the actual `getComputerUsePermissionStatus` implementation backing
  `computer.permissionsStatus`. Same darwin-only branch (non-darwin returns
  both permissions as `'unsupported'` with `helperUnavailableReason: null`).
  On macOS it spawns `/usr/bin/open -n <helperApp> --args --permission-status-file <tmp>`,
  polls a temp status file up to 50×100ms (5s), and parses it as JSON on
  success; times out with `RuntimeClientError('accessibility_error', 'Timed out checking permissions')`
  after the poll budget, and separately enforces a 5s **launch** timeout
  (`PERMISSION_STATUS_HELPER_LAUNCH_TIMEOUT_MS`) via `setTimeout(onTimeout, ...).unref()`
  that kills the helper process and rejects with
  `'Timed out launching permission helper'` if `/usr/bin/open` itself wedges
  before even exiting. A non-zero helper exit yields
  `'Could not check permissions: <stderr|stdout|exit code>'`. `helperAppPath`/
  `executablePath` resolution (`resolveMacOSComputerUseAppPath`/
  `resolveMacOSComputerUseExecutablePath`, `macos-native-provider-paths.ts`) is
  outside this leaf's file set and not read — real filesystem/bundle-lookup
  boundary, flagged as residual.

### SPEECH_METHODS

- `src/main/runtime/runtime-service-command-surface.ts` (144 lines, full
  read) — all 8 speech RPC handlers call `runtime.<method>` where `runtime`
  is the composed `OrcaRuntimeService`; this file's `bind()`-wiring
  (lines 130-137) shows the 8 methods are bound 1:1 to two collaborator
  classes: `RuntimeMobileSpeechCatalog` (`speech.list/download/delete/configure`)
  and `RuntimeMobileDictationController` (`dictation.start/feed/finish/cancel`).
  Confirms no additional indirection layer between the RPC dispatch table and
  the two controller classes below.
- `src/main/runtime/runtime-mobile-speech-catalog.ts` (107 lines, full read)
  — backs `speech.models.list`, `speech.models.download`, `speech.models.delete`,
  `speech.dictation.setup`.
- `src/main/runtime/runtime-mobile-dictation-controller.ts` (220 lines, full
  read) — backs `speech.dictation.start`, `speech.dictation.chunk`,
  `speech.dictation.finish`, `speech.dictation.cancel`.
- Both controllers call `getSpeechModelManager(store)` /
  `getSpeechSttService(store)` from `src/main/speech/speech-runtime-service.ts`
  (peeked at signature level only, 60 lines — `setSpeechServiceFactories`/
  `getSpeechModelManager`/`getSpeechSttService` resolve **factory-injected**
  `ModelManager`/`SttService` instances). **This is the real native/provider
  boundary for the whole speech group**: the actual STT engine (audio
  decode/inference) and the actual model download/deletion I/O happen inside
  those factory-resolved services, not read further — no recursive import
  census performed. Exact remaining owner: `ModelManager`/`SttService`
  implementations and whatever native STT binary/model-format they wrap
  (outside this leaf's assigned file set).

### EMULATOR_METHODS

- `src/main/runtime/orca-runtime-emulator.ts` (351 lines, full read) — backs
  all 19 `emulator.*` methods via `RuntimeEmulatorCommands`, one method per
  RPC name with a 1:1 name match (`emulatorTap`, `emulatorGesture`, ... ,
  `emulatorUnregisterActive`). Every method (except `emulatorList`,
  `emulatorListSimulators`, `emulatorAvailability`, `emulatorListDevices`,
  which take a bridge with no host guard) calls
  `requireEmulatorBridge()`, which throws
  `EmulatorError('emulator_no_active', 'No emulator session is active')`
  synchronously if `host.getEmulatorBridge()` is null — the one universal
  "absent" branch across the whole group.
- `src/main/emulator/emulator-errors.ts` (19 lines, full read) —
  `EmulatorError extends Error` with a closed 8-value `code` union
  (`emulator_no_active`, `emulator_device_not_found`, `emulator_helper_failed`,
  `emulator_simctl_unavailable`, `emulator_not_macos`, `emulator_disabled`,
  `emulator_unsupported`, `emulator_error`). Only 3 of these codes
  (`emulator_no_active`, `emulator_device_not_found`, `emulator_disabled`) are
  actually thrown from `orca-runtime-emulator.ts` itself; the remaining 5 are
  thrown by the `EmulatorBridge`/backend layer below (not read — residual).
- `EmulatorBridge` (`src/main/emulator/emulator-bridge.ts`, 356 lines) is
  referenced by type only and is where every method bottoms out
  (`bridge.tap`/`.gesture`/`.type`/`.button`/`.rotate`/`.exec`/`.kill`/
  `.shutdown`/`.listRunningHelpers`/`.listSimulators`/`.listAllDevices`/
  `.runCapability`/`.accessibilityTree`/`.acquireHelperForDevice`/
  `.getReusableActiveForWorktree`/`.stopActiveForSwitch`/
  `.registerActiveEmulator`/`.unregisterActiveEmulator`). A signature-level
  grep confirms `EmulatorBridge.exec()` (line 196) delegates to a `backend`
  object's own `.exec()`, and `emulatorInstall`/`emulatorLaunch`/
  `emulatorPermissions`/`emulatorLogcat` pass explicit backend-callback
  closures (`backend.installApp!`, `backend.launchApp!`, `backend.setPermission!`,
  `backend.logcat!`) through `bridge.runCapability(...)`. **This is the real
  native/provider boundary for the whole emulator group**: the actual
  `adb`/`simctl`/Android-AVD-tooling process execution happens inside
  `EmulatorBridge` and its per-platform `backends/emulator-backend.ts`
  implementations, neither of which is in this leaf's assigned file set —
  not read further, no recursive import census performed. Exact remaining
  owner: `src/main/emulator/emulator-bridge.ts` and
  `src/main/emulator/backends/*` (adb/simctl process execution, device
  discovery, install/launch/permission/logcat native calls).

## Result shapes / state / errors / partial success / host branches (per method)

Full per-method detail (result shape incl. absent/null/undefined/coercion,
state changes, thrown vs. returned errors, partial success, host/version/
platform branches) is in the JSON companion's `methods[]` array. Summary of
the notable cross-cutting patterns:

- **Absent/null/undefined handling**: `computer.permissions` accepts an
  `undefined` `id` and returns `permissionId: undefined` verbatim in the
  success/no-op shape (no coercion) — `openComputerUsePermissions(params.id)`
  where `ComputerPermissions` params allow `id` optional (schema not read
  this pass — pointer only, `computer-schemas.ts` outside assigned set).
  `emulator.list`/`.listSimulators`/`.availability`/`.listDevices` all accept
  `{}` (empty object, `worktree` optional) with **no default substitution** —
  absent `worktree` simply skips the `resolveWorktreeId` call and passes
  `undefined` through to the bridge.
- **Coercion**: none observed at the RPC-method or immediate-callee layer for
  any of the 42 methods — all "coercion" in this leaf's file set is Zod
  schema-level (`z.object(...)`, not read for `computer-schemas.ts`, which is
  outside the assigned set) or bridge-layer (outside assigned set, e.g.
  `params.device ?? params.emulator` fallback, which is precedence not type
  coercion).
- **State changes**: `speech.dictation.start`/`.chunk`/`.finish`/`.cancel` are
  the only methods in this leaf's 42 with in-process mutable state — a single
  module-level `RuntimeMobileDictationController.session` field (not a map;
  **only one dictation session can be active at a time**, confirmed by the
  explicit `dictation_already_active` throw in `.start`). `emulator.attach`
  mutates the emulator bridge's per-worktree active-session registry
  (`bridge.registerActiveEmulator`) and can emit two side-channel renderer
  IPC sends (`ui:emulatorAutoAttach`, `emulator:pane-focus`) that are not
  part of the RPC return value — a caller awaiting only the RPC response
  cannot observe whether the renderer notification actually delivered
  (`sendToRenderer` swallows failures with a bare `catch`).
- **Thrown vs. returned errors**: every COMPUTER and EMULATOR method that can
  fail does so by **throwing** (`RuntimeClientError`/`EmulatorError`), never
  by returning an `{ ok: false }`-shaped value — confirmed by reading every
  handler body in the 3 method-definition files plus their immediate
  callees; the RPC dispatcher-level envelope (`ok`/`error` wrapping) is
  outside this leaf (owned by `RPC-RESULT`/`RPC-HOST` contracts cited in
  `followup-final-boundaries.json`). SPEECH methods likewise throw plain
  `Error` (not `RuntimeClientError`) with string codes like
  `voice_dictation_disabled`, `voice_model_not_selected`,
  `voice_model_not_ready:<status>` (this one **interpolates runtime state
  into the error message itself**, not a separate field), `dictation_already_active`,
  `dictation_requires_mobile_client`, `dictation_stream_not_started`,
  `dictation_owner_mismatch`, `dictation_stream_closing`,
  `voice_model_not_downloadable`, `voice_model_unknown`,
  `voice_dictation_unavailable`, `voice_model_delete_failed` (or a
  `getSpeechModelDeletionErrorCode`-mapped code, function not read — outside
  assigned set).
- **Partial success**: `speech.models.download` is fire-and-forget — it
  returns `{ started: true }` **before** the actual download completes; a
  download failure is only `console.error`-logged
  (`'[runtime] mobile speech model download failed'`) and never surfaces to
  the RPC caller at all — this is a genuine partial-success/silent-failure
  shape, not a defect assessment (no test-body read yet to confirm whether
  this is asserted). `speech.dictation.finish` mutates `session.state` to
  `'closing'` before awaiting `stopDictation`, and — even on the
  `session.errors.length > 0` throw path — the `finally` block still clears
  `this.session`, so a failed finish still terminates the session (this is a
  real behavioral branch, not a coercion). `emulator.attach`'s worktree-changed
  race (lines 163-182) is the one explicit partial-success/rollback path in
  this leaf: if the workspace resolves to a different worktree while a slow
  Android boot is in flight, it releases the just-acquired helper lease
  (`lease.release({ cleanupIfUnused: true })`, errors swallowed) before
  re-throwing — an explicit compensating action on a detected race, not a
  silent partial state.
- **Host/version/platform branches**: `computer.permissions` and
  `computer.permissionsStatus` are the only two methods (of all 42) with an
  explicit `process.platform !== 'darwin'` branch returning a fixed
  `'unsupported'` stub. No emulator or speech method branches on
  `process.platform` at this leaf's read depth (the darwin-only simctl vs.
  Android-adb split is presumed to live inside the unread `EmulatorBridge`/
  backend layer). No method in this leaf's 42 branches on app/Electron
  version.

## Test associations — original suite allocation preserved, body-read vs. pointer-only

Per `followup-final-boundaries.json`'s `rpcRows[].originalTests.sharedRouteAssertionFiles`,
every one of these 42 methods shares the same 5 route-level assertion files
(`src/main/ipc/runtime.test.ts`, `src/main/ipc/runtime-subscribe-lifecycle.test.ts`,
`src/main/runtime/rpc/dispatcher-request-parsing.test.ts`,
`src/main/ipc/runtime-environments-call-routing.test.ts`,
`src/renderer/src/runtime/runtime-rpc-client.test.ts`) — this is **route
evidence only** (per the cited `limit` field), not method-specific behavior
coverage, and was not body-read this pass (pointer-only, inherited from the
cited contract). No `directMethodAssertionRefs` were populated for any of the
42 rows at the `followup-domain-ownership.json`/`followup-final-boundaries.json`
layer — meaning method-specific behavioral test files (e.g.
`src/main/runtime/rpc/methods/speech.test.ts`, confirmed to exist by this
leaf's own grep) are **not yet cross-referenced into this contract chain**
and remain an explicit residual, not a claim of untested code.

No test file was opened or executed this pass. This leaf inherits and does
not relax the BM/R/F baseline/port/behavioral RED-GREEN obligations recorded
upstream (`F-RPC-SCHEMA`, `F-RPC-ROUTE`, `F-RPC-HOST`, `F-RPC-RESULT`,
`F-EXTERNAL` per the `remainingAcceptance` arrays cited above) and the
`WP-ENG-NATIVE` / `WP-CAP-MOBILE` / `WP-CAP-DEVICE` original source test
work-package allocations already recorded in `followup-domain-ownership.json`'s
`rpcOwnershipContracts` (`parity-test-work-packages.json` packages 17, 7, 2 —
referenced, not re-derived or re-scoped here).

## Exact remaining test/owner obligations (residuals, separate from unrun execution)

1. `computer-sidecar.js` (compiled entry point) and whatever OS automation
   library it wraps — real native boundary, outside this leaf's file set,
   never read.
2. `src/main/computer/computer-clipboard-paste-validation.ts` (
   `validateComputerClipboardPasteTextWithBoundedYield`) — outside assigned
   set, not read; gates `computer.pasteText` only.
3. `src/main/computer/macos-native-provider-paths.ts`
   (`resolveMacOSComputerUseAppPath`/`resolveMacOSComputerUseExecutablePath`)
   — outside assigned set, not read; real filesystem/bundle-resolution
   boundary for both `computer.permissions*` methods.
4. `src/main/computer/computer-schemas.ts` — outside assigned set, not read;
   the actual Zod param shapes for all 15 computer methods live here
   (referenced by name only from `computer.ts`'s imports).
5. `src/main/speech/speech-runtime-service.ts` (peeked at signature level
   only) and its factory-resolved `ModelManager`/`SttService`
   implementations, plus `src/main/speech/model-catalog.ts` and
   `src/main/speech/speech-model-deletion.ts` (referenced by name, not read)
   — real native STT/model-download boundary for the whole SPEECH group.
6. `src/main/emulator/emulator-bridge.ts` (356 lines) and
   `src/main/emulator/backends/*` — real adb/simctl native-process boundary
   for the whole EMULATOR group; only the class/method signature was
   confirmed via targeted grep, not a full read.
7. `src/main/emulator/emulator-availability.ts`,
   `emulator-default-attach-device.ts`,
   `android/android-sdk-host-discovery.ts`, `simctl-simulator-devices.ts` —
   referenced by `orca-runtime-emulator.ts`'s imports, not read.
8. Method-specific behavioral test files
   (`src/main/runtime/rpc/methods/speech.test.ts`,
   `src/main/runtime/rpc/methods/computer.test.ts` if it exists,
   `src/main/runtime/rpc/methods/emulator.test.ts` if it exists, and
   controller-level tests for `runtime-mobile-dictation-controller.ts`/
   `runtime-mobile-speech-catalog.ts`/`orca-runtime-emulator.ts`) — existence
   not yet confirmed by this pass (no directory listing of
   `src/main/runtime/rpc/methods/*.test.ts` or `src/main/runtime/*.test.ts`
   was run); this is the single highest-value next step to close the
   body-read gap noted above.

## Precedence

Candidate leaf contribution for lead review/integration alongside the lead's
other 84 methods in this partition — not E3 closure, not parity, not a claim
that provider-side (sidecar/STT/adb/simctl) behavior was verified. Source
counts and hashes above are provenance, not behavior proof. No tests were
run and no model inference was used to fill any gap identified above.
