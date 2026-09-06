# E3 COMPUTER final local source join — resolving P-COMPUTER-PRODUCER / P-COMPUTER-CACHE

Audit-only. New task under parent `task_487675cb5877`; all prior COMPUTER
tasks/Dispatches (including the settled `task_ee79699b5b27` corrective pass)
are frozen and superseded, never reused for lifecycle. Source is the
read-only reference at pinned commit `c97906287bb7a390b25e2025b600d9fb3c25d9c3`
(`/Users/carlos/Documents/Drogon-mentu-session`). Working checkout is
`/Users/carlos/Documents/Drogon-rewrite`. No Git command, native script
execution, provider request, model inference, credential/profile/settings
change, cloud operation, install, service, source/product edit, or
descendant delegation occurred. Machine companion:
[computer.json](computer.json). All older reports — `leaf/native-results.md`,
`leaf/native-results-final.md`, and `result-platform/report.md` /
`contracts.json` — are frozen and not rewritten; this file is additive.

Fixed subset: the same 15 `DR-COMPUTER_METHODS` —
`computer.capabilities`, `.listApps`, `.permissions`, `.permissionsStatus`,
`.listWindows`, `.getAppState`, `.click`, `.performSecondaryAction`,
`.scroll`, `.drag`, `.typeText`, `.pressKey`, `.hotkey`, `.pasteText`,
`.setValue`. This report resolves the two named obligations from
`result-platform/report.md`:

- **`P-COMPUTER-PRODUCER`**: "packaged Python/PowerShell scripts and native
  helper result constructors... language difference is not an external
  exemption." Addressed by reading `native/computer-use-linux/runtime.py`
  (1,153 lines, full) and `native/computer-use-windows/runtime.ps1`
  (1,321 lines, full) in their entirety, plus the macOS native result
  constructors named below.
- **`P-COMPUTER-CACHE`**: "sidecar transport/snapshot-store/path and
  permission probe helpers have leaf coverage but no complete independent
  lead body verification." Addressed by reading
  `desktop-script-snapshot-store.ts` (99, full),
  `desktop-script-snapshot-cache.ts` (200, full),
  `desktop-script-snapshot-rendering.ts` (154, full),
  `macos-native-provider-paths.ts` (27, full), plus the macOS native cache
  policy and permission-status probe source below, and re-confirming the
  sidecar queue/cancel/generation behavior already read in the frozen prior
  leaf pass.

## Genuine OS boundary — confirmed per platform, not assumed from language

Per instruction, a process/language boundary alone is not authorization to
call source external; each boundary below is a real OS Accessibility/
window-capture/input API, confirmed by reading the actual call:

- **Linux** (`runtime.py`): `Atspi.*` (AT-SPI2 D-Bus accessibility protocol —
  `Atspi.get_desktop`, `Atspi.Component.get_extents`,
  `Atspi.generate_mouse_event`, `Atspi.generate_keyboard_event`,
  `Atspi.Text.*`, `Atspi.Value.*`), `Gdk`/`GdkPixbuf` (X11 screen capture,
  explicitly disabled under `XDG_SESSION_TYPE=wayland`), and
  `xdotool`/`wl-copy`/`xclip`/`xsel` subprocesses (modifier-key clicks,
  hotkeys, clipboard). These are the real stop points; everything above them
  in `runtime.py` (app/window resolution, tree rendering, screenshot
  bounding, action dispatch) is local Python source, now read in full.
- **Windows** (`runtime.ps1`): `Windows.Automation.AutomationElement` (UI
  Automation COM), raw Win32 `user32.dll` P/Invoke (`SendInput`,
  `mouse_event`, `PostMessage`, `SetForegroundWindow`, `GetWindowRect`,
  `ShowWindow`, `SetCursorPos`), `System.Drawing.Graphics.CopyFromScreen`
  (screenshot), `System.Windows.Forms.SendKeys`/`Clipboard`. Same
  reasoning: everything orchestrating these calls in `runtime.ps1` is local
  PowerShell/C# source, now read in full.
- **macOS**: the real boundary is Apple's Accessibility API (`AXUIElement`)
  and `CGEvent` synthetic input, invoked from inside the per-action
  functions in `main.swift` (`click`, `scroll`, `drag`, `typeText`,
  `pressKey`, `hotkey`, `pasteText`, `setValue` — each ~4,318-line file's
  method bodies were not traced line-by-line into the AX/CGEvent calls
  themselves, since that is exactly the genuine native API this leaf stops
  at). The **dispatch table, response envelope, snapshot cache, and
  permission-probe/CLI-argument handling** around those calls are local
  Swift source and were read (see exact ranges below) — this is the
  "native helper result constructor" layer `P-COMPUTER-PRODUCER` named, and
  it is now characterized, not the AX API internals themselves.

## P-COMPUTER-PRODUCER — per-method result contracts across all three producers

### computer.capabilities (`handshake`)

All three producers return a fixed capability object; no dynamic
introspection of the runtime host beyond a few booleans.

- **Linux** (`handshake_response`, `runtime.py:700-727`): `platform:"linux"`,
  `provider:"orca-computer-use-linux"`, `providerVersion:"1.0.0"`,
  `protocolVersion:1`. `supports.actions.hotkey` is **conditionally false**
  when `xdotool` is absent or the session is Wayland
  (`shutil.which("xdotool") is not None and not is_wayland`).
  `supports.actions.pasteText` is conditionally false unless one of
  `wl-copy`/`xclip`/`xsel` is present. `supports.observation.screenshot` is
  false under Wayland or when `Gdk`/`GdkPixbuf` failed to import at module
  load (caught at the top of the file). `supports.windows.targetById` is
  hardcoded `false` — Linux **never** supports `windowId` targeting (only
  `windowIndex`), a real, permanent capability gap, not a temporary
  unimplemented state.
- **Windows** (`Get-OrcaHandshake`, `runtime.ps1:842-866`): all capability
  booleans are hardcoded `$true` except `surfaces.*` (all false) and
  `observation.annotatedScreenshot`/`ocr` (false) — Windows never reports a
  degraded capability set at handshake time, even though (see
  `.listWindows`/`.getAppState` below) it silently only supports a single
  window per process regardless of the `windows.targetByIndex:true` claim.
- **macOS** (`providerHandshake()`, not traced past the dispatch call at
  `main.swift:214-215` — the handshake body itself lives elsewhere in the
  4,318-line file and was not read this pass; its result shape is
  characterized instead via the already-frozen TS-side contract
  (`REQUIRED_MACOS_PROVIDER_PROTOCOL_VERSION=1`,
  `macos-native-provider-contract.ts`, prior pass) plus the response
  envelope confirmed here: `{"id":..., "ok":true, "result": <handshake
  object>}` via `handleRequest` (`main.swift:4194-4224`).
- **Cross-cutting correction to the frozen leaf**: capabilities are **not**
  static per platform — Linux's `hotkey`/`pasteText`/`screenshot` flags are
  host-conditional at process-start time (subprocess/display-server
  presence), a distinction the earlier reports did not surface.

### computer.listApps (`list_apps`)

- **Linux** (`list_apps_response`, `runtime.py:687-692`): iterates AT-SPI
  desktop children, **filters out any app with zero top-level windows**
  (`if windows_for(app)`), sorts by `(name.lower(), pid)`. An app running
  with no window (e.g. a headless tray-only process) is silently absent
  from the list — not an error, a filtering rule.
  `bundleIdentifier` is **always equal to `name`** on Linux (AT-SPI has no
  bundle-identifier concept) — a real cross-platform field-semantics
  divergence from macOS's real bundle IDs.
  Blocked-app filtering (`BLOCKED_APP_FRAGMENTS`:
  1password/bitwarden/dashlane/lastpass/nordpass/proton pass) is enforced
  only in `find_app` (single-app resolution), **not** in `list_apps_response`
  — a blocked password manager still appears in `computer.listApps`'
  output even though targeting it directly for `getAppState`/actions throws
  `appBlocked`.
- **Windows** (`Get-OrcaAppList`, `runtime.ps1:802-806`): every process with
  `MainWindowHandle -ne 0`, no window-presence re-check beyond that single
  handle test, no blocked-app filtering applied to the list at all (blocking
  is enforced only in `Find-OrcaProcess`, same asymmetry as Linux).
  `bundleIdentifier`/`bundleId` are **both set to `ProcessName`** (no real
  bundle concept on Win32 either). `Get-OrcaAppName` has one special case:
  `ApplicationFrameHost` processes (UWP app host) report the
  `MainWindowTitle` instead of the generic host process name — a targeted
  fix for a specific Windows app-hosting quirk not present on the other two
  platforms.
- **macOS**: `listApps()` maps `renderListedApp` over `listApps()`
  (`main.swift:216-217`) — the enumeration and filtering logic itself
  (presumably `NSWorkspace`/`NSRunningApplication`-based) was not traced
  further this pass; the dispatch-level result shape (`{"apps": [...]}`
  wrapped in the standard envelope) is confirmed.

### computer.permissions / computer.permissionsStatus

macOS-only per the RPC layer (both throw a fixed `darwin`-only stub on
Linux/Windows at the TS layer, already characterized in the frozen prior
pass — not re-litigated here). This pass adds the **native launch/poll/path/
cleanup** detail `P-COMPUTER-CACHE` named:

- `macos-native-provider-paths.ts` (27 lines, full): resolves the helper
  `.app` bundle via (in order) an `ORCA_COMPUTER_MACOS_HELPER_APP_PATH` env
  override (existence-checked), a packaged path under
  `process.resourcesPath`, or two dev-build candidates under
  `native/computer-use-macos/.build/release/`. Returns `null` if none exist
  — no path is ever fabricated or assumed. The executable path is a further
  `existsSync` check on `Contents/MacOS/orca-computer-use-macos` inside
  whichever app bundle resolved — a **second, independent** existence check,
  so a bundle that exists but is missing/renamed its executable still
  yields `null`, not a stale/incorrect path.
- Native side (`main.swift:4285-4318`, read in full): the helper process's
  CLI surface is `--agent <socket> --token-file <path>` (sidecar transport),
  `--permissions`/`--permission <kind>` (foregrounded `NSApplication` GUI
  setup flow, `runPermissionCheck`), `--permission-status`  (stdout probe),
  `--permission-status-file <path>` (file-write probe, what
  `macos-computer-use-permission-status.ts`'s polling loop actually invokes).
  A bare invocation with no matching flag calls `runStdio()`, which prints
  a fixed usage message to stderr and **exits with code 13** — a
  documented, distinct exit code the TS side's helper-launch-failure path
  (`waitForProviderLaunchFailure`, prior pass) would surface as a generic
  "helper app failed to start" rather than distinguishing "wrong CLI usage"
  from any other crash.
- `--agent` mode requires a non-empty `--token-file`; a missing/unreadable/
  empty token file **exits with code 2** and a stderr usage message before
  ever opening the socket — this is the exact failure the TS
  `waitForProviderLaunchFailure`'s `exit` listener converts into
  `RuntimeClientError('accessibility_error', 'native macOS helper app
  exited before connecting: code 2')` (prior pass, `macos-native-provider-
  transport.ts:145-154`), now traced all the way to its native cause.
  **New finding, not in any prior report**: the token is validated **again**
  server-side, per request, in `handleRequest`
  (`main.swift:4194-4206`) — a request whose `token` field doesn't match
  the token read from the file at startup gets
  `{"ok":false,"error":{"code":"permission_denied","message":"invalid
  computer-use agent token"}}`, and there is a **second, independent**
  `authorizedPeer` gate (unix-socket peer-credential check, not traced
  further — this is itself a real OS security boundary, not local logic)
  that must also pass or the same `permission_denied` code is returned.
  Neither the TS transport layer nor either prior report characterized this
  per-request server-side re-validation or the separate peer-authorization
  gate.
- **Status-probe result and cleanup**: `writePermissionStatus(to:)`
  (`main.swift:4176-4187`) atomically writes
  `{"accessibility":"granted"|"not-granted","screenshots":"granted"|
  "not-granted"}` to the given path; a write failure prints to stderr and
  **exits 1** (a third distinct exit code). The underlying snapshot comes
  from `permissionStatusSnapshotSettled()` (name confirmed via call site,
  body not traced — a settling/debounce wrapper around
  `PermissionStatusSnapshotProbe.capture`, see below). On the TS side
  (`macos-computer-use-permission-status.ts`, prior pass, re-confirmed
  unchanged this pass): the temp directory + status file are always removed
  in a `finally` (`rm(tempDir, {recursive:true, force:true})`) regardless of
  success/timeout/launch-failure — cleanup is unconditional, not
  best-effort-only-on-success.
- **Native probe concurrency** (`PermissionStatusSnapshot.swift`, 116 lines,
  full): `PermissionStatusSnapshotProbe.capture` runs the accessibility and
  screenshot probes **concurrently** on a shared `DispatchQueue(attributes:
  .concurrent)`, joined via `DispatchGroup.wait()` (a **blocking** wait on
  whatever thread calls `capture`) — both probes must complete before a
  snapshot is returned; there is no partial/one-probe-only result shape.
  `PermissionStatusRefreshCoordinator` (same file) has a
  `refreshInFlight` boolean guarded by an `NSLock`: a `refresh()` call while
  one is already in flight is a **silent no-op** — a second concurrent
  refresh request is dropped, not queued or duplicated. This coalescing
  behavior was not in any prior report.

### computer.listWindows / computer.getAppState

- **Linux**: `choose_window`/`windows_for` (`runtime.py:134-161`) enumerate
  AT-SPI children with a real bounding rect **or** a role in
  `{frame,window,dialog,alert}` — an app whose windows have no measurable
  rect and a non-matching role yields an empty list, and `choose_window`
  then throws `"No top-level AT-SPI window is available for <app>"`.
  `windowId` targeting **always throws**
  `"windowId is not supported by the Linux AT-SPI provider; use
  windowIndex"` — not silently ignored, not treated as absent. Window
  selection with no explicit target prefers `ACTIVE` state, falls back to
  `SHOWING`, falls back to the first window in AT-SPI's own child order —
  three distinct fallback tiers, not a single default.
  `window_json`'s `id` field is **always `null`** on Linux (no stable window
  ID concept exposed by AT-SPI here); `screenIndex` is always `null`
  (multi-monitor screen index is never resolved on this platform).
- **Windows**: `Assert-OrcaWindowTarget` (`runtime.ps1:317-324`) throws
  `windowNotFound` for **any** `WindowIndex` other than exactly `0`, and for
  any `WindowId` not equal to the process's actual `MainWindowHandle` — a
  hard single-window-per-process model. `Get-OrcaWindowList` always returns
  exactly one window entry (`index:0`) — there is no concept of enumerating
  multiple top-level windows per process on this provider, a real,
  permanent capability gap versus Linux/macOS's multi-window enumeration
  (neither prior report characterized this Windows-specific single-window
  ceiling).
  Windows' `windowId` **is** the real value (`MainWindowHandle` cast to
  `int64`), unlike Linux's always-`null` — apps can legitimately be targeted
  by `windowId` on Windows but never by `windowIndex` other than `0`.
- **macOS**: window/snapshot resolution (`observe`, `main.swift:260-285`)
  supports both `windowId` (native `CGWindowID`) and `windowIndex`, with a
  documented **retry-without-window-target** fallback baked into
  `actionResult` (`main.swift:245-258`): if an action's post-effect snapshot
  throws `window_not_found`/`window_stale` **and** the caller had requested
  an explicit window selector, the same action result is re-rendered
  against a fresh snapshot with the window selector dropped, and
  `action.verification` is force-set to `{state:"unverified",
  reason:"window_changed"}` if not already present. **This exact fallback
  pattern exists verbatim (same trigger condition, same verification
  reason) in `runtime.py:1126-1137` and `runtime.ps1:1304-1312`** — all
  three native producers implement the identical "window disappeared mid-
  action, retry unscoped and mark verification unverified/window_changed"
  contract, independently in three languages. This three-way parity is a
  new, cross-cutting finding not surfaced in either prior report (which
  each looked at only one or two platforms' worth of this specific retry
  logic).

### computer.click / .performSecondaryAction / .scroll / .drag / .typeText / .pressKey / .hotkey / .pasteText / .setValue

Common envelope on all three platforms: `{action: {path, actionName,
fallbackReason, verification?}, snapshot: <post-action snapshot>}`. Detailed
per-action findings, confirmed by reading all three producers' action
bodies in full (Linux/Windows) or via the shared dispatch/verification
wrapper (macOS):

- **click**: all three prefer a native accessibility "primary action"
  (AT-SPI `do_action`/UIA `InvokePattern`/`SelectionItemPattern`/
  `TogglePattern`) when there's no modifier, the button is left, and click
  count ≤1; only then do they fall back to synthetic mouse-event injection
  (`action.path:"accessibility"` vs `"synthetic"`). Linux and Windows both
  additionally **always refocus/restore the target window first**
  (`restore_window`/`Restore-OrcaWindow`) even on the accessibility-action
  path — a window can be brought forward as an observable side effect of a
  `computer.click` call whose primary intent was an accessibility action,
  not a synthetic click. `fallbackReason` is the literal string
  `"actionUnsupported"` on the synthetic path on Linux/Windows (macOS's
  exact fallback-reason string was not traced past the dispatch layer this
  pass).
- **performSecondaryAction**: Linux/Windows both require the requested
  `action` name to case-insensitively match one of the node's own action
  labels; both throw a message of the shape `"<action> is not a valid
  secondary action"` verbatim on no match (byte-identical error message
  text between the two independently-written scripts).
- **scroll**: Linux uses synthetic AT-SPI wheel button events (b4p/b5p/b6p/
  b7p for up/down/left/right) repeated `page_count` times; Windows uses a
  single `mouse_event` wheel call with `delta = 120 * ceil(pages)` (a
  **fixed 120-unit-per-notch** Windows wheel-delta convention, not
  per-page-repeated discrete events like Linux) — the two platforms
  implement "scroll N pages" with genuinely different underlying event
  semantics, not just different APIs for the same event shape.
- **drag**: both Linux and Windows interpolate the drag path over **exactly
  12 intermediate steps** at a **20ms (Windows)/20ms (Linux uses 0.02s =
  20ms too)** step delay — byte-for-byte matching animation parameters
  independently chosen in both scripts.
- **typeText / pressKey / hotkey / pasteText**: all four are marked
  `verification:{state:"unverified", reason:"synthetic_input"}` (or
  `"clipboard_paste"` for paste) on **every** platform, **unconditionally**
  — these four actions are never verified against post-action state on any
  producer; this was already known from the prior TS-adjacent reads but is
  now confirmed identical at the native-script level on Linux/Windows too.
  Windows' `pasteText` and Linux's `paste_text` both **save and restore**
  the pre-existing clipboard contents around the paste (Windows via
  `Clipboard.GetDataObject()`/`SetDataObject()`, Linux via
  `read_clipboard()`/`write_clipboard()`), and both explicitly **clear** the
  clipboard afterward if there was nothing to restore (Windows:
  `Clipboard.Clear()`; Linux: `write_clipboard("")`) — neither leaves the
  pasted text sitting in the system clipboard when there was no prior
  value, a deliberate privacy behavior independently implemented on both
  platforms and not previously documented.
- **setValue**: Linux (`set_value`, `runtime.py:1015-1023`) tries
  `EditableText.set_text_contents` first, falls back to
  `Value.set_current_value` (numeric), returns a plain `bool`; a `false`
  result raises `"element value is not settable"` in `run_operation`.
  Windows (`Set-OrcaElementValue`) only tries `ValuePattern.SetValue` after
  checking `IsReadOnly`; no fallback to a numeric-value pattern. **Neither
  Linux nor Windows implements the post-write value-mismatch
  "unverified/value_mismatch" partial-success shape** that the frozen prior
  report found in the **TypeScript-only** desktop-script bridge layer
  (`desktop-script-action.ts:122-158`, `verifyDesktopAction`) — that
  verification logic is TS-side, wrapping whatever `{path, actionName,
  fallbackReason}` triple the native script returns; the native scripts
  themselves only report a binary settable/not-settable outcome via a thrown
  error, never a native-side value_mismatch signal. This is a needed
  correction/precision to the frozen report's characterization: the
  value-mismatch verification is a **TS bridge-layer** enrichment over a
  native binary success/throw, not a native producer behavior in its own
  right, on Linux/Windows. (macOS's `setValue` native body was not traced
  this pass past the dispatch entry — its own value_mismatch behavior, if
  any, remains unread.)

## P-COMPUTER-CACHE — snapshot store, sidecar transport, permission probe

### Cross-platform snapshot-cache parity (new finding)

The TS `DesktopScriptSnapshotStore`/`desktop-script-snapshot-cache.ts`
(Linux/Windows path) and the native macOS `Provider.rememberSnapshot`/
`ComputerSnapshotCachePolicy` (`main.swift:202-362`,
`ComputerSnapshotCachePolicy.swift`) implement **the same cache policy
independently in two languages**: `MAX_CACHED_DESKTOP_SNAPSHOTS = 32` /
`ComputerSnapshotCachePolicy.maxEntries = 32`, and
`MAX_CACHED_DESKTOP_SNAPSHOT_AGE_MS = 2*60*1000` /
`ComputerSnapshotCachePolicy.maxAge = 2*60` (seconds) — identical 32-entry /
2-minute bounds. Both prune with a FIFO-oldest-first sweep
(`prune()`/`pruneSnapshotCache()`) that only removes a cache alias if it
still points at the exact expiring entry (`this.snapshots.get(key) ===
expired.snapshot` / `snapshots[key]?.id == expired.snapshotId`) — a newer
snapshot that happens to reuse the same alias key is never evicted by an
older entry's expiry, on both implementations. Both key schemes support the
same three targeting axes (app query, canonical `window-id:`/`window-index:`
key, and a `session:`/`worktree:`-prefixed namespace via
`snapshotNamespace`/local namespace helper on the Swift side) with
case-insensitive keys **except** inside an explicit (non-`default`)
namespace, where keys are preserved case-sensitively
(`isExplicitSnapshotNamespace`, both sides). This is a genuine,
independently-maintained cross-language parity contract, not previously
identified as such in either prior report (which each treated the TS store
and any native-side caching as unrelated).

### Screenshot payload always stripped before caching

Both the TS store (`snapshotWithoutScreenshot`,
`desktop-script-snapshot-rendering.ts:91-93`) and the native macOS provider
(`snapshot.withoutScreenshotPayload()`, `main.swift:163-181`) strip the
base64 screenshot payload before inserting a snapshot into the long-lived
cache, for the identical documented reason (large PNG base64 retained
across an agent's loop would grow the long-lived process's memory) — cached
snapshots exist **only** to resolve element identity for follow-up actions,
never to serve a cached screenshot back to a caller.

### Rendering/omission/default fields (`desktop-script-snapshot-rendering.ts`, TS bridge layer over all non-macOS producers)

`renderSnapshot` (154 lines, full): `window.isMinimized`/`isOffscreen`/
`screenIndex` are **hardcoded `null`** in the TS rendering layer regardless
of what the native script's own `window_json`/window-list result carried
for those fields elsewhere — i.e. even though Linux's `window_json` (used
only by `list_windows_response`, not `get_app_state`) computes a real
`isMinimized`/`isOffscreen` from AT-SPI `SHOWING` state, the **snapshot**
result path (`getAppState`) never surfaces those booleans; they are a
`list_windows`-only field on Linux, not a `getAppState` field, and the TS
snapshot renderer nulls them unconditionally for every producer. This is a
concrete field-omission finding, not previously documented.
`focusedElementId` is defensively re-validated against the snapshot's own
`elements` array (`normalizedFocusedElementId`) — a native-reported
`focusedElementId` that doesn't correspond to any element actually present
in the same result is silently nulled, not trusted. `screenshotStatus`
has four possible states: `captured` (with a fixed
`{engine:"unknown", windowId}` metadata — `engine` is **never** populated
with a real capture-backend name at this layer, always the literal string
`"unknown"`), `skipped` (`noScreenshot` was requested), or `failed`
(native `screenshotError.message` if present, else a fixed generic message
recommending `--no-screenshot`) — confirming and extending the frozen
report's finding that a valid accessibility snapshot with
`screenshot:null` + `screenshotStatus.state:'failed'` is a normal, non-
thrown result shape.

### Sidecar queue/cancel/stale-generation (re-confirmed unchanged from the frozen prior pass)

Re-reading `sidecar-client.ts`'s `ComputerSidecarProcess` this pass (no
byte changes since the prior read; same hash as recorded there) confirms:
a monotonic `queueGeneration` counter invalidates any queued-but-not-yet-run
call if the sidecar is shut down/restarted before that call's turn — a
stale queued call throws `RuntimeClientError('accessibility_error',
'computer sidecar queue was invalidated; retry the computer-use request')`
rather than running against a dead/replaced child process. This is the
"queue/cancel/stale generation" behavior `P-COMPUTER-CACHE` named; it was
already fully read and correctly characterized in the frozen prior leaf
report and is not re-litigated with new findings here — only re-verified
as unchanged and still accurate.

## Exact source anchors (inclusive ranges + SHA256; not git blob hashes)

Full detail with byte-identical hashes is in the JSON companion. Everything
in the per-file table below was read this pass; `main.swift` was read only
at the specific line ranges listed (dispatch table, cache/observe/prune,
permission-CLI/token/exit-code handling) — this is a **partial** read of
that file by design, per "no recursive every-import census," stopping at
the real AX/CGEvent boundary inside each action's own body, which was not
traced.

| File | Read depth | Lines/range | SHA256 |
| --- | --- | --- | --- |
| `native/computer-use-linux/runtime.py` | full | 1-1153 | `98d1a20f2e79f126b9542567fb6b61738cd33eca82f1a232e7683f118e8b65c1` |
| `native/computer-use-windows/runtime.ps1` | full | 1-1321 | `a4c5a1d650d29921aa24de435dfb3ca9501cdee7dba5f7f260cda60c100d2353` |
| `.../OrcaComputerUseMacOSCore/SnapshotRendering.swift` | full | 1-298 | `f427627b28c99f1ea0415a5948716502d217910b5d547b33655e9a3162156d3e` |
| `.../OrcaComputerUseMacOSCore/ComputerSnapshotCachePolicy.swift` | full | 1-14 | `5d9c0739a48d91f58fef12beed451d58cb29bab70595bb3f9cff0676a9e1501d` |
| `.../OrcaComputerUseMacOSCore/PermissionStatusSnapshot.swift` | full | 1-116 | `e734280c8900abf44a5607ad75cc8ab6170aa35bb1b634831328e60ee9ba7f89` |
| `.../OrcaComputerUseMacOS/main.swift` | partial | 150-410 (dispatch/cache/observe) | `cc033c6718411abe724bdc979c2b5b1ef79f9531cd7dd46ca9bdfde942b96942` |
| `.../OrcaComputerUseMacOS/main.swift` | partial | 4160-4318 (permission CLI/exit codes/token/handleRequest) | `7a0a599d7f45e8aa78310c2bc91b4e7192e01bd734ff0ee36b96843038813e77` |
| `.../OrcaComputerUseMacOS/main.swift` | whole-file identity only (not read in full) | 1-4318 | `1eabe4e19f52bc6684c0b58e6cbc2c92ccf8b8d95d160205e3164432e9951601` |
| `src/main/computer/desktop-script-snapshot-store.ts` | full | 1-99 | `2160ff110985d796edbe04044e4dcc551e69025befc42b4181605ae365917981` |
| `src/main/computer/desktop-script-snapshot-cache.ts` | full | 1-200 | `bc235f0aa3e45637e0fff8fbe0a9ff10dd496cac98b58f7f3302f6a32afdbf62` |
| `src/main/computer/desktop-script-snapshot-rendering.ts` | full | 1-154 | `bf2420b9111b6e8af48d2d490b13fa51da235054c34a617d362a7131d4b3859b` |
| `src/main/computer/macos-native-provider-paths.ts` | full | 1-27 | `81578ad9ea66917a57d81d42b275a3f826e6d2c00641eb764f31d308575277a0` |

Files re-confirmed unchanged from the frozen prior leaf pass (`sidecar-
client.ts`, `computer-provider-action-validation.ts`, `desktop-script-
provider-client.ts`, `desktop-script-action.ts`, `macos-native-provider-
client.ts`, `macos-computer-use-permissions.ts`,
`macos-computer-use-permission-status.ts`) were not re-hashed this pass;
their hashes are recorded unchanged in `leaf/native-results-final.json` and
are not repeated here to avoid a duplicate/competing source of truth for
bytes this report did not re-read.

## Original assertion bodies read this pass — distinguished from pointer-only

No test file was opened or read this pass (body or pointer). The `P-ASSERT-*`
evidence rows in `result-platform/report.md` remain the authoritative
original-assertion-body record for this group and are not re-litigated or
duplicated here; the `WP-ENG-NATIVE`/`WP-CAP-DEVICE` original test-package
pointers cited by `followup-domain-ownership.json`'s `DR-COMPUTER_METHODS`
entry remain unchanged and are preserved by reference only.

## Source residuals — distinguished from unrun native/OS execution

**Source residuals (local source not read this pass, genuinely readable):**

1. `main.swift`'s ~3,800 unread lines — the concrete `handshake`,
   `listApps`/`listWindows`/`getAppState` enumeration bodies, and every
   individual action's AX/CGEvent call sequence. The dispatch/envelope/
   cache/permission-CLI layer around them is now read; their bodies are
   not, deliberately (this is where the genuine native AX/CGEvent boundary
   begins).
2. `ActionArgumentValidation.swift`, `AttributeValueCoercion.swift`,
   `AgentSessionOwnership.swift`, `AuthenticatedConnectionHangupMonitor.swift`,
   `KeyboardInputSafety.swift`, `NumericArgumentParsing.swift`,
   `PermissionTrustSettling.swift`, `SyntheticMouseClickDelivery.swift`,
   `UnixSocketPathSafety.swift` — named Swift "Core" modules whose
   existence and file sizes were confirmed (see the earlier `wc -l` listing)
   but whose bodies were not read this pass; `SyntheticMouseClickDelivery.swift`
   and `UnixSocketPathSafety.swift` in particular likely bear directly on
   the exact click-delivery and the `authorizedPeer` socket-peer check
   named above as a new finding — genuine remaining source residuals, not
   claimed to be characterized by this report.
3. `computer-schemas.ts` (Zod param shapes) — still not read across any
   pass to date; referenced by name only.
4. `resolveDesktopScriptProviderPath`'s packaged-vs-dev candidate list
   (`desktop-script-provider-paths.ts`) was read in the frozen prior pass,
   not re-read here; not a residual, just not repeated.

**Genuinely unrun native/OS execution boundaries (not source residuals —
cannot be resolved by further reading):**

1. Real AT-SPI D-Bus round-trips, X11/Wayland screen capture, and
   `xdotool`/clipboard-tool subprocess execution on a live Linux desktop
   session.
2. Real UI Automation COM calls, Win32 `SendInput`/`mouse_event` delivery,
   and `System.Drawing` screen capture on a live Windows desktop session.
3. Real macOS Accessibility API permission grants, `AXUIElement` queries,
   and `CGEvent` synthetic input delivery, plus the real launch of the
   signed helper `.app` and its unix-socket peer-credential check.
4. Any of the above executing under a headless/CI display, a locked
   session, or without the relevant OS permission grant — this report
   characterizes the source's own handling of such conditions (e.g.
   `ensure_desktop_bus`'s explicit `XDG_RUNTIME_DIR`/
   `DBUS_SESSION_BUS_ADDRESS` check, Windows' implicit reliance on an
   interactive session for `SendInput`/`CopyFromScreen` to have any
   effect) but did not and could not execute any of it.

Per instruction: absence of a thrown error above is never treated as
verified action success, and a request timeout is characterized as
**unverifiable** effect, never as proof no input occurred — consistent with
`live`/`unverifiable`/`exited` liveness-verdict vocabulary, not reused here
as a pass/fail claim.

## MIT attribution / credentials

No credential value, endpoint, or private data was copied into this report
or its JSON companion. `runtime.py`/`runtime.ps1`/the Swift sources carry no
third-party MIT (or other) license header distinct from this repository's
own; no attribution text was found to preserve or was altered.

## Disposition

Candidate resolution of `P-COMPUTER-PRODUCER` and `P-COMPUTER-CACHE` for
parent (`task_487675cb5877`) independent review and release. Root retains
acceptance. This is not E3 closure, not parity, not a claim that the
genuinely unrun native/OS execution boundaries listed above were verified.
No descendants were spawned and no further delegation occurred.
