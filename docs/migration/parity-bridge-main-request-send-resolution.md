# Main-side request/send resolution — 66-record bounded slice (corrected)

Machine-readable record: `docs/migration/parity-bridge-main-request-send-resolution.json`
(schema `drogon.audit.parity-bridge-main-request-send-resolution.v2`).

**Coordinator accepted static linkage after correction, not runtime behavior.** All 66 original
channels/directions are unchanged; the accepted, read-only
`docs/migration/parity-source-bridges.json` was not touched by either
version. Source: `/Users/carlos/Documents/Drogon-mentu-session` at pinned
`c97906287bb7a390b25e2025b600d9fb3c25d9c3` (HEAD verified). Branch
`codex/rewrite-foundation`, base `a9cc888`.

## What was wrong in v1, and the fix

1. **Inaccurate registration anchors for all 7 `bots:*` channels.** v1 used
   approximate/off-by-several-lines numbers (e.g. `bots:list` marked line
   23, which is actually inside the wrapper's `throw` statement). Fixed by
   `grep -n "'<exact-literal>'"` against `bots.ts` for every channel:
   `bots:list`→27, `create`→28, `update`→32, `delete`→35,
   `rotateSession`→39, `createResponsibility`→43, `runResponsibility`→50.
2. **Semantic error: `macosTccPrompts:*` disposal.** v1 said these 4
   channels have only a re-registration guard. Direct re-read of
   `attach-main-window-services.ts:160-215` shows a real
   `mainWindow.on('closed', ...)` handler (line 204) that, gated by an
   **exact `handlerToken` match** (lines 205-207 — not the monotonic
   counter alone), calls `ipcMain.removeHandler` for all 4 channels
   (lines 209-212). **Both** mechanisms are real and now tracked as two
   independent booleans per record, never one mutually-exclusive bucket.
3. **Vague anchors** (`~30-38 lines later`, `a few lines later`,
   `1-2 lines later`) replaced everywhere with exact line numbers, split
   into three distinct fields: `declarationAnchor` (a local const/array
   binding, or `null` if the literal is passed inline), `registrationAnchor`
   (call-start OR first-channel-argument line, sometimes an identifier rather
   than an inline literal), `disposalAnchor` (removal line(s), if any).
4. **Headline overclaim.** "Unconditional" read as proof of live-app
   registration. Every classification is now suffixed
   `-at-traced-call-depth`, with an explicit caveat (below) that this is
   source call-chain shape only, never a running process.
5. **Test-pointer count bug.** v1's "41 with / 25 without" silently counted
   one record (`window:isMaximized`) as a bare prose "classification note"
   instead of the concrete channel it was. Recomputed directly from each
   record's own `testPointerFiles` array: **63 have ≥1 pointer, 3 have
   none.** Every cited path was independently filesystem-checked to exist;
   one previously-cited path, `src/main/bots/bot-service.test.ts`, was
   found **not to exist** and has been removed from the pointer list.

## Call-depth caveat (applies to every classification below)

`active-registration-at-traced-call-depth` / `conditional-registration`
describe **only** whether a runtime conditional exists between the app's
traced entrypoint and the `ipcMain.handle/on` call for that channel. **This
is not proof the channel is registered in any given running app instance**
— an untraced caller further up the chain, a build/platform flag, or a
startup failure could still prevent it. No app/daemon/test was executed.

## Result: 66 of 66 trace to a real registration; 0 not-found, 0 dynamic

| Classification | Count | Channels |
| --- | --- | --- |
| active-at-traced-depth | 39 | mentu:\* (14), skills core-6, skills:previewDelete/delete (2), macosTccPrompts:\* (4), window:isMaximized (1), 7 window-close-lifecycle FAF, 4 window-focus-lifecycle `ui:*` FAF, browser:reportViewportScrollState (1) |
| conditional-registration | 27 | bots:\* (7, behind `if (automations)`), skills:\* share/install group (20, behind ONE `if (runtime)`) |
| no-handler-found-after-bounded-search | 0 | — |
| genuinely-dynamic-identity | 0 | — |

## Disposal: two independent booleans, never conflated

| | Count |
| --- | --- |
| re-registration guard observed | 19 |
| explicit event-driven disposer observed | 16 |
| **both** (macosTccPrompts:\*, all 4) | 4 |
| neither | 35 |

- **Explicit disposer (16):** `window:isMaximized` + 7 window-close-lifecycle
  FAF + 4 window-focus-lifecycle `ui:*` FAF (all via a returned `dispose()`
  invoked from `createMainWindow.ts`'s `mainWindow.on('closed', ...)` at
  line 188 — confirmed at both the definition and call site) **plus all 4
  macosTccPrompts:\*** (via `mainWindow.on('closed', ...)` at
  `attach-main-window-services.ts:204`, token-gated).
- **Guard only (15):** `mentu:*` (14, unconditional
  `ipcMain.removeHandler` loop at `mentu.ts:45-47` before re-registering)
  and `browser:reportViewportScrollState` (1, `removeAllListeners?.()` at
  `browser-guest-view-ipc.ts:20`).
- **Neither (35):** `bots:*` (7), skills core-6, skills:previewDelete/delete
  (2), skills share/install group (20) — no removal call site found.

`macosTccPrompts:*`'s monotonic `handlerToken` counter by itself proves
nothing about sender authorization — the actual per-call gate is
`ownsNotice` (`attach-main-window-services.ts:183-184`), requiring **both**
`event.sender === mainWebContents` (exact identity) **and**
`!mainWindow.isDestroyed() && !mainWebContents.isDestroyed()`. The token
only gates whether a *later* `closed` firing from a superseded registration
generation is allowed to tear down the *current* generation's handlers.

## Test pointers: verified present, never a coverage claim

**63 of 66 records have ≥1 test-pointer file; 3 have none**
(`skills:previewDelete`, `skills:delete` and
`browser:reportViewportScrollState`; this is not proof of test absence).16 distinct pointer
files cited, **every one independently confirmed to exist on disk** by a
direct filesystem check (not assumed). No pointer file's body was opened
for assertion content; a pointer is a plausible-adjacency fact, never a
coverage claim, and is explicitly distinguished from "body read" in every
record's `testPointerNote`.

## Source-hash cross-validation

15 files hashed (SHA-256). **6 matched byte-for-byte against the census's
own `fileHashesSha256` map**: `bots.ts`, `mentu.ts`,
`main-window-close-lifecycle.ts`, `main-window-focus-lifecycle.ts`,
`skills.ts`, `browser-guest-view-ipc.ts`. The remaining 9 were hashed for
the first time by this document. Full map in the JSON.

## What this document does not claim

Coordinator independently reran `scripts/check-parity-main-bridge-traces.mjs`:
all66 exact census records/directions and registration anchors resolve to
call syntax (including local channel constants),15 hashes match and16 test
pointers exist. Wrapper/gating bodies and window/TCC cleanup call sites were
read separately. The checker verifies disposal-count arithmetic, not control
flow; neither activity executes an original test or proves runtime behavior.
`browser:reportViewportScrollState` uses optional `ipcMain.on?.`; even at the
traced call depth, this individual registration depends on API presence.

- Source classification only — what registers, where (exact line), under
  what condition, with what disposal. Not behavioral/runtime validation.
- Not proof of live-app registration beyond the traced call depth (see
  caveat above).
- Nothing about the 96-record push cohort or the already-resolved
  12-record delegated/dynamic cohort (untouched by this correction).
