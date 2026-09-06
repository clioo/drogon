# E3 result-runtime leaf — browser RPC groups (90 methods)

**Revision 3 — correction pass.** Pinned source: `c97906287bb7a390b25e2025b600d9fb3c25d9c3` (read-only, `/Users/carlos/Documents/Drogon-mentu-session`). Audit-only leaf, no delegation, no Git actions, no tests executed, no source edits. Full per-method detail, file:line anchors, and full-file SHA256 hashes (computed directly from source bytes, not Git objects) are in the companion `browser-results.json` — this file is the human-readable summary.

## Why this revision exists

The coordinator's review of revision 2 found three defects, all now fixed:

1. **Missing explicit rows.** `browser.snapshot` and the three `browser.clientHost.*` methods had lost their individually-keyed rows in revision 2's restructuring; `fileChannel.write`/`.abort` appeared only inside a shared "methods" array. `browser-results.json` now has a single flat `methodRows` array with exactly **90** entries, one per method, verified by count (`methodRowCount: 90`, cross-checked programmatically).
2. **False "no local delegate remains" claim.** Revision 2 asserted every local TypeScript delegate had been read. That was false for: `browserSessionRegistry` (backing `profileCreate`/`profileDelete`/`profileClearDefaultCookies`/`profileImportFromBrowser`) and the local cookie-import pipeline; the client-host lease registry and runtime page registry (backing the 3 `clientHost.*` methods); the contentEditable fill/clear helpers and the mobile-touch-click CDP helper (backing `fill`/`clear`/`mouseClick`); and the screencast frame-ACK/pacer/CDP-event arithmetic (backing `screencast`). All of these are now read in full — see `newlyReadThisRevision` in the JSON — and each surfaced concrete throw/false/null behavior that revision 2 either omitted or implicitly assumed away.
3. **Imprecise tabClose vs tabSetProfile timeout claim.** Corrected with the exact four throw sites named individually (see `timeoutClaimCorrection` in the JSON): both methods' *bare* timeout throws a plain `Error`; of the two *reply-error* paths, only `tabClose`'s is ever typed, and only when the renderer's reply explicitly carries `code:'browser_tab_not_found'` — `tabSetProfile` has no typed-error branch anywhere in its body.

## What the newly-read files change about the audit

- **`browser.profileCreate` can throw** (rethrows a failed `installBrowserSessionPartitionPolicies`, after best-effort retiring the partial session) and **can return `{profile: null}`** for an invalid scope/userAgentMode value — neither was documented in revision 2, which implicitly treated this as a can't-fail annotation.
- **`browser.profileDelete` returns `false`** for an unknown profile id *or* for the protected `'default'`-scope profile, and its post-delete storage cleanup (`clearStorageData`/`clearCache`) is fully swallowed on failure — a real partial-success shape, not a stand-in.
- **`browser.profileClearDefaultCookies` returns `{cleared:false}`** on any failure in its try/catch, including a failed `clearStorageData` call.
- **`browser.clientHost.pageMetadata`'s `{accepted:false}`** is an explicit, source-confirmed rejection of a stale/out-of-order metadata revision, distinct from any thrown error.
- **`browser.fill`/`browser.clear`'s contentEditable path is still `execAgentBrowser`-based** (an `['eval','--stdin']` call), not a separate boundary as revision 2's phrasing could be read to imply.
- **`browser.mouseClick` makes two separate CDP round-trips**, not one: a `Runtime.evaluate` touch-point resolution (which silently falls back to the raw coordinates on any failure) followed by the `Input.dispatchMouseEvent` pair.
- **`browser.screencast`'s frame handling is fully characterized**, not "narrowly residual" as revision 2 claimed: every `Page.screencastFrame` CDP event is dropped-with-ack (no data, stale viewport, or a decode exception) or queued into a pacer that throttles to `minFrameIntervalMs`, retries on a fixed 50ms backpressure interval, and wraps every CDP command (including the ack itself) in an 8000ms timeout.

## Test evidence — one actual assertion body read per DR group

| Group | File:lines | What the body confirms |
| --- | --- | --- |
| CORE | `agent-browser-bridge-navigation.test.ts:190-256` | exact `goto` resolved/rejected shapes, including the literal `rejects.toMatchObject({code:'browser_error', message:'Failed to navigate browser page tab-1: ERR_ABORTED (-3)'})` |
| CORE | `agent-browser-bridge-text-input.test.ts:285-310` | `fill`/`clear`'s contentEditable path calls `execCommand('insertText'|'delete', ...)`, never `dispatchEvent` |
| SCREENCAST | `browser-screencast-stream.test.ts:124-167` | a stale fallback capture is discarded once a live CDP frame lands; `Page.screencastFrameAck` is called with the exact `sessionId` |
| EXTRA | `agent-browser-bridge-command-transport.test.ts:299-319` | `browser.viewport` issues the exact two named CDP commands and never spawns the agent-browser subprocess |
| CLIENT_HOST | `browser-client-host.test.ts:449-461` | the exact `{ok:false, error:{message:'browser_client_host_authority_mismatch'}}` shape |
| CLIENT_FILE_CHANNEL | `browser-host-file-channel-admission.test.ts:46-54` | `toThrow('browser_client_file_channel_unsupported')` for an unnegotiated client |
| NETWORK_TUNNEL | `browser-network-tunnel.test.ts:504-534` | the exact `browser_tunnel_memory_admission_failed` shape and that no binary handler is registered on that path |

No test was executed in any revision. All original `WP-ENG-BROWSER`/`WP-UI-BROWSER`/`WP-ENG-REMOTE`/`WP-CAP-MOBILE` allocation references are preserved unchanged from `followup-domain-ownership.json`.

## What remains open — genuinely external, not local residuals

- The `agent-browser` CLI subprocess's own internals; Chromium's own CDP protocol implementation; ssh2's and the WSL relay binary's own protocol implementations.
- The three OS-level cookie-database importers (`browser-cookie-{chromium,firefox,safari}-import.ts`) backing `browser.profileImportFromBrowser` — their shared result contract (`BrowserCookieImportResult`) is fully characterized; their individual file-format parsing was not opened.
- `assertBrowserHostLeaseAdmission`'s own internal branch conditions inside the client-host lease registry's `attach()` — confirmed capable of throwing further, not enumerated line-by-line.
- The navigation-recapture timer's own debounce/delay arithmetic inside `browser-screencast-snapshot-capture.ts` (its callers are characterized; its internal timer values were not read out).

Full per-method rows, every file:line anchor, and every SHA256 hash are in `browser-results.json` — `methodRows` has exactly 90 entries, verified programmatically.
