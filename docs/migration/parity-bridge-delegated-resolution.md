# Bridge delegated/dynamic/disposer trace — E3 bounded slice

Coordinator-reviewed static linkage at frozen source
`c97906287bb7a390b25e2025b600d9fb3c25d9c3`.
Companion `parity-bridge-delegated-resolution.json` v2 preserves exact
original selectors, source anchors and full hashes.

**12 distinct records cover13 original facts**: 11 delegated-method
unknowns, one dynamic-channel unknown and one disposer unknown. The latter
two refer to the same runtime.subscribe method. Original census is unchanged.

| ID | Method | Source resolution |
|---|---|---|
| PBR-001 | app.awaitBeforeUnloadCheckpoint | preload-runtime-support.ts:20-27 invokes app:await-before-unload-checkpoint; requires result?.ok exactly true, not an exact one-property object. |
| PBR-002 | browser.readClientHostId | shared/browser-client-host-id-argument.ts:18-25 reads first matching process.argv argument; no IPC. |
| PBR-003 | crashReports.readHeapStatistics | renderer-heap-statistics-reader.ts:10-37 reads heap, catches failure; Blink read is independent and optional. |
| PBR-004 | crashReports.readProcessMemory | renderer-process-memory-reader.ts:10-30 awaits local process API, rejects invalid private KB, conditionally includes resident KB. |
| PBR-005 | platform.get | api/platform-bridge.ts:10-27 same-file function, lazy module memoization; Linux display choice traced to preload-runtime-support.ts:31-43. |
| PBR-006 | pty.getPtyDataListenerCount | api/pty-bridge-session-control.ts:130 calls Electron listenerCount on pty:data; local introspection, not wire traffic. |
| PBR-007 | runtime.subscribe | api/runtime-bridge.ts:20-45 uses per-call UUID channel and lexically paired listener removal; sendBinary throws. |
| PBR-008 | runtimeEnvironments.subscribe | runtime-environment-subscriptions.ts:125-162 uses shared dispatcher and per-ID map; binary input supported. |
| PBR-009 | skills.deleteSupported | api/skills-bridge.ts:91 returns Promise.resolve(true); desktop flag, not a main-process query. |
| PBR-010 | ui.onFileDrop | preload-runtime-support.ts:55-71 shared listener fans out to callback array; disposer removes first matching callback. |
| PBR-011 | ui.getZoomLevel | api/ui-bridge-clipboard-and-window-controls.ts:125 calls Electron webFrame directly. |
| PBR-012 | ui.setZoomLevel | same file:126 calls Electron webFrame directly. |

Seven delegated project functions, four built-in call sites and one
inline dynamic subscription account for all12. Three methods provide
subscriptions/disposers. Four records reference literal channels (including
listener-count introspection), seven have no channel, one has a dynamic
primary push channel. These classifications are **not test results**.

## Subscription distinctions the rewrite must characterize

- **runtime.subscribe:** on(dynamic channel) before invoke; rejected invoke
  removes the same listener. Explicit unsubscribe removes it and sends an
  unsubscribe message. Repeated unsubscribe still sends again. The body
  has no terminal-response automatic teardown. Lexical pairing is verified;
  universal lifecycle correctness is not.
- **runtimeEnvironments.subscribe:** one dispatcher per IPC object, callbacks
  mapped before invoke; mismatch/rejection removes current entry. Error is
  non-terminal. Close releases entry before onClose. Every explicit
  unsubscribe invokes the remote teardown, even if its entry was gone;
  **only removal of the shared listener waits for the last entry**.
  sendBinary is a separate fire-and-forget channel.
- **ui.onFileDrop:** callback array is copied for dispatch. Disposer removes
  first indexOf(callback), then shared listener if empty. With repeated
  registrations of the same function, repeated disposal can remove another
  matching entry; this is not a unique per-registration token or proof of
  idempotent disposal.

## Independent review and boundaries

The coordinator verified all12 census selectors/names/origin anchors and
20 hash occurrences across16 unique source files, then read delegated
bodies and corrected worker totals, anchors and overclaims. A second hash
reference to the already-verified preload-runtime-support file was added
for platform.get. Source tracked state remained clean.

The worker's claims of11 project implementations,10 delegated project
functions, three built-ins, four subscriptions, exact-object response
validation, and last-entry-only remote unsubscribe were corrected.
Speculation about the census implementation is not a diagnosed algorithm
defect; this artifact establishes actual source linkage.

No original test, source module import, app, model or daemon was executed.
Electron/JavaScript internals are not independently verified here.
The separate **54request/12send/96push main-side attribution cohort** is
still outside this artifact and assigned in subsequent flat audit tasks.
