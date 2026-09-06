# Close/PDF current paths and unresolved push identities

Source: frozen `c97906287bb7a390b25e2025b600d9fb3c25d9c3`.
Owner: WP-ENG-IPC; coordinator-reviewed bounded source characterization.
This supplements, not replaces, parity-bridge-main-push-resolution.json.

## Keep the denominator honest

Exact-literal search in src, skill-guides and config found only subscription
and removal sites for `ui:closeSessionTab` and `export:requestPdf`.
Their producer identities remain unresolved: **94/96**, not96/96.
Dynamic/generated/external senders are not disproved. Do not delete exposed
receivers or infer missing product features from this search.

| Legacy receiver | Observed current action path | Boundary |
| --- | --- | --- |
| ui:closeSessionTab | runtime-window-lifecycle.ts:168 calls requestSessionTabCloseFromRenderer; relay sends ui:sessionTabCloseRequest and awaits ui:sessionTabCloseResponse | Different channel, not an identified legacy producer |
| export:requestPdf | EditorPanel.tsx:372 calls exportActiveMarkdownToPdf; export-bridge invokes export:html-to-pdf; main/ipc/export registers handler | Local editor action, not an identified legacy producer or global-menu shortcut |

All paths in this document are relative to the frozen source root.

## Session-close contracts to preserve

- src/preload/api/ui-bridge-terminal-and-session-tabs.ts:166-183 retains
  both subscriptions, exact listener disposers and the response send.
- src/main/window/session-tab-close-request-relay.ts:14-67 rejects unavailable
  renderers, captures target webContents/request UUID, installs listeners
  before sending, and accepts only that sender and request ID. Renderer error
  rejects; successful acknowledgement resolves. Confirmation lease is5min
  plus5s response grace. Settlement clears timeout and lifecycle/IPC listeners.
  Closed/destroyed/process-gone/reload and send failure reject as
  renderer_unavailable. This is UI availability, not proof of remote process exit.
- src/shared/session-tab-close.ts keeps expiresAt optional. Do not make it
  mandatory for old readers/callers.
- src/renderer/src/hooks/ipc-events/session-tab-ipc-bridge.ts retains the legacy
  pinned-tab guard and separate request/response flow. The latter reports
  canceled/not-found/failure/timeout, cancels an expired confirmation and checks
  expiry before close. Browser workspace IDs differ from generic tab IDs.
  Its response settlement guard alone does not prove exactly-once close effects.
- src/main/runtime/rpc/methods/session-tab-close-methods.ts keeps visibility
  projection, close intent capability and lifecycle preconditions. In-process
  callers and runtime clients advertising the intent capability require reason;
  older runtime/mobile calls keep legacy user semantics. Lifecycle close passes
  publication epoch and terminal handle separately. No wire change is proposed.

Executed evidence: original relay test,7/7 passing in the isolated capsule
documented in reference-captures/c9790628-close-relay/README.md.
Renderer routing tests and RPC compatibility were source-inspected, not run
by that capsule. No actual IPC, window close, SSH loss or version-skew proof.

## PDF contracts to preserve

- src/renderer/src/components/editor/EditorPanel.tsx:372-374 passes active
  file ID and panel root to the export helper. Toolbar availability and global
  menu/shortcut behavior are outside this bounded trace.
- src/renderer/src/components/editor/export-active-markdown.ts shows loading,
  dismisses on no payload/cancellation, reports the saved path on success,
  and catches extraction/bridge failures. It calls the existing export bridge.
- src/preload/api/export-bridge.ts invokes export:html-to-pdf with html/title
  and retains the success/cancel/error result shape.
- src/main/ipc/export.ts rejects blank HTML; generates the PDF before opening
  Save; sanitizes Windows-invalid filename characters, truncates title100chars,
  defaults to export, and attaches the dialog to the sender window when found.
  Canceled/missing path returns cancellation without writing; write completion
  precedes success. ExportTimeoutError maps to Export timed out; other failures
  preserve Error.message or the fallback.

No PDF conversion, Save dialog, file export or rendered UI was executed here.
The extraction-failure unit test was inspected, not executed, and cannot stand
in for a successful PDF export. Existing legacy PDF subscriptions remain in
scope even though their current producer/consumer linkage is not established.

## Source fingerprints

These hashes bind inspected files, not execution or complete feature coverage.

| File | SHA-256 |
| --- | --- |
| src/main/window/runtime-window-lifecycle.ts | `f0a4377c92d93c836f40b4975f9a22eb6a9f1b18825ecdb7b75400c87d1f652d` |
| src/main/window/session-tab-close-request-relay.ts | `4a86342ebbb3ac06e7feccd556ab377143daaec67a8e8931267eb8891001ff3d` |
| src/shared/session-tab-close.ts | `9d975e0ef5e7501ade215ed954c86230316aa6db48ebf7b28de94db65327239d` |
| src/renderer/src/hooks/ipc-events/session-tab-ipc-bridge.ts | `9356a4361c6ce0bbf81bedd51d073000c327c5268f627c2308de11be63c791f7` |
| src/main/runtime/rpc/methods/session-tab-close-methods.ts | `58837105ef86c420b76faa0479be7bcd78e86cd74f9d7653a0b0ea8aaabaf775` |
| src/preload/api/ui-bridge-terminal-and-session-tabs.ts | `db6d1270cf86b2a162ff1842db3c4ed420ea58c9c5f1ad0949f2f6e9eefe6588` |
| src/preload/api/ui-bridge-tab-and-browser-commands.ts | `2b4f21ccc5330fe82c72c5af1bdf1329db4a3da7c9286861eb744effec3c55b2` |
| src/renderer/src/components/editor/EditorPanel.tsx | `8d3648f52400f5d28eb8eaebfba030d7667b9a7c7795d4b0b3a30c0468a9c691` |
| src/renderer/src/components/editor/export-active-markdown.ts | `948a8a1199b187494561bd17749c919aab1216e07b665002a09015c8ea1f7edb` |
| src/preload/api/export-bridge.ts | `53ab0a7327237861063fcff217e726e0a157f3566a463e87bb7b961f2d11b0c9` |
| src/main/ipc/export.ts | `8bc77ca509efc4e7852cc7523602e348ac37324d979104e2523f1e402fccb6cc` |
