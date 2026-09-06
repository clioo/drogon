# Main push linkage — coordinator-reviewed static slice

The companion JSON retains the exact96 previously unresolved push channels
from `parity-source-bridges.json`:94 now link to source send calls;2 remain
unresolved. This is source linkage, not a runtime or behavioral acceptance.
The frozen reference is `c97906287bb7a390b25e2025b600d9fb3c25d9c3`.

`scripts/check-parity-main-bridge-traces.mjs` independently checks52 complete source
hashes, the exact96-channel cohort, producer call syntax/ranges and three
imported channel constants. It emits exact call starts and sender expressions.
Tests, comments and constant declarations alone are not producer evidence.
It imports no inspected source modules and executes no original tests.

## Routing groups

| Group | Channels | Scope |
|---|---:|---|
| Guest renderer |32| Browser/shortcut event sends; guest target resolver rejects missing/destroyed targets |
| Runtime notifier |20| Main-window notification helper, suspended on reload/failure and permanently closed on disposal |
| Runtime method |13| Direct per-service sends; no universal lifetime/permission guarantee |
| Subscriber/reply |8| Primarily invoking/subscribing renderer; dashboard snapshot also publishes to popout |
| Main window |7| Optional or guarded main-window sends; selected agent statuses mirror to popout |
| Trusted UI |7| Exact registered renderer ID; optional sender exclusion only when passed |
| Owner stream |5| Worker-attributed stream-owner sends; full lifetime/backpressure semantics still require verification |
| Watch fan-out |1| `fs:changed`, six recorded send sites; remote retry/install surrounding logic not reviewed |
| Request relay |1| Session-tab close: sender+requestId fence,5-minute confirmation plus5-second grace, cleanup on settlement |
| Unresolved |2| Subscriber found; no producer proven |

## Coordinator corrections

- Removed an agent-status mock order tracker from producers; retained it only
  as an unexecuted test pointer.
- Three document/Markdown constants now point to actual send calls and their
  imports, not only string declarations. Emulator callers are separate from
  the actual helper definitions and sends.
- `updater:status` is **not forced-only**. A pending-check branch publishes
  only if forced; the normal branch publishes changed status or any forced
  status, suppressing identical non-forced status (`updater-status.ts:165-177`).
- `ui:openSkillShare` and `ui:toggleStatusBar` use optional chaining, not an
  explicit destroyed guard at these send sites. Do not infer a shared guard.
- `gh:prRefreshEvent` passes no sender exclusion; `gh:workItemMutated` does.
- Trusted outgoing targeting does not use the separate incoming validator's
  development-URL fallback (`ipc/ui.ts:18-40` versus `isTrustedUIRenderer`).

## Unknowns and acceptance limits

Bounded exact-literal search in main/preload/shared/renderer/relay/cli found
only preload on/removeListener pairs for `ui:closeSessionTab` and
`export:requestPdf`. That does **not** prove absence of computed, generated or
external senders. `ui:sessionTabCloseRequest` and `export:html-to-pdf` are
different channels, not established replacements.

Sender/caller prose remains worker trace except the coordinator-reviewed
helpers, close relay and corrections above. AST verification proves call
syntax, not sender type, successful delivery, active registration, complete
payload structure or exhaustive recovery. Those obligations remain open.
This slice does not close the audit or authorize the feature wave.
