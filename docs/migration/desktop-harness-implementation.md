# Desktop harness launch slice

Implements `docs/migration/harness-contract-v1.md` in the Electron desktop app. Scope:
`apps/desktop/src/**` only. No Rust, no root manifests, no Git operations.

## What was built

**Shared contract** (`src/shared/session-contract.ts`): `Harness`, `HarnessAvailability`,
`HarnessId`, `PermissionMode`, `HarnessLaunchInput` types; `DesktopBridge.harnesses()` and
`.startHarness()`. Field names and enum values match the Rust wire shape exactly
(`crates/drogon-core/src/harness.rs`, `crates/drogon-harness/src/{discovery,launch}.rs`, read
read-only): `harnessId` ∈ `claude|pi|opencode|antigravity`, `availability` ∈
`available|missing|unsupported_launcher`, `executable: string | null`, `permissionMode` ∈
`inherit|unattended`.

**Trust-boundary validation**: `src/shared/result-validation.ts` adds `"harness.list"` (catalog
shape, nullable executable) and `"harness.start"` (reuses the existing `session` schema — the
contract's own point: "returns the existing Session," not a parallel shape). `src/shared/
bridge-validation.ts` adds `harnesses: z.undefined()` and a `startHarness` schema: `model`/
`provider`/`effort`/`prompt` are optional, control-character-free opaque strings — present-but-empty
is rejected (`.min(1)`) rather than treated as "no preference," so the normalizer (below) is the
only place a blank field is allowed to become "absent."

**Main process** (`src/main/index.ts`, `src/preload/index.ts`): two new IPC round trips,
`drogon:harnesses` → `harness.list {}` and `drogon:startHarness` → `harness.start`, wired through
the existing `registerBridge` loop and `callNative` — no new trust logic, no new socket handling.

**Renderer**:
- `harness-capability.ts` — `supportsHarnessLaunch(capabilities)` requires *both*
  `harness.catalog.v1` and `harness.launch.v1`; either missing means the older/plain path.
- `harness-launch-form.ts` — pure `normalizeHarnessLaunchInput`: trims fields, turns a blank
  field into an *absent* key (never an empty string sent as "no preference"), and drops `provider`
  for every harness except `pi` (contract: "Pi alone exposes separate `provider`").
- `HarnessLaunchMenu.tsx` — the "+" control beside session tabs. Per the source style guide's own
  primitive table (`docs/STYLEGUIDE.md` at the authorized reference checkout): a click-revealed
  *menu of actions* is a Radix `DropdownMenu`, not a hand-rolled `Popover` list; a click-revealed
  surface with *arbitrary content* (a form) is a `Popover`, not a modal `Dialog`. The trigger is one
  button serving as both `DropdownMenu.Trigger` and `Popover.Anchor`: the menu lists "New terminal"
  plus every discovered harness (including unavailable ones, disabled with an inline reason); picking
  an available harness opens the Popover form (model/prompt, and an `<details>` advanced section for
  provider — Pi only — effort, and an unattended checkbox).
- `App.tsx`: fetches the catalog once per `refresh()` (alongside `status`/`workspaces`, non-fatally —
  a harness-list failure never blocks workspace/session loading, which already succeeded by that
  point); renders `HarnessLaunchMenu` when `supportsHarnessLaunch` is true, otherwise the *original,
  unmodified* plain "New terminal" button. `launchHarness` mirrors `create()` exactly (`checked` →
  push into `sessions` → `setActive`) so the launched session enters the identical state/projection/
  `TerminalPane` path as a plain shell — no new session-handling code exists.
- CSS additions reuse only existing tokens (`--background`, `--border`, `--accent`, `--muted-
  foreground`, the same floating-shadow value already used for `.tooltip`'s spirit) — no new colors
  invented.

## How the specific instructions were satisfied

- **No invented models / no silent fallback.** The model field's placeholder reads "Harness
  default" and is otherwise empty; nothing pre-fills or suggests a value. There is no models-list
  RPC in the frozen contract, so none is called or faked.
- **Read from the execution host only.** The only source of harness data is `harness.list` via the
  native socket; nothing in the renderer or main process scans `process.env.PATH` or any local
  filesystem for executables.
- **Missing/unsupported executables visible but not launchable.** Every harness `harness.list`
  returns is rendered as a menu item; `availability !== "available"` items are `disabled` (Radix
  prevents both pointer and keyboard activation) with an inline reason ("not found on this host" /
  "unsupported launcher").
- **Missing capability leaves the ordinary terminal working.** When either `harness.catalog.v1` or
  `harness.launch.v1` is absent, `App.tsx` renders the pre-existing plain button unchanged — same
  element, same handler, same disabled condition as before this change.
- **No prompt secrets persisted.** Form state lives in `HarnessLaunchMenu`'s local `useState` only;
  nothing is written to `localStorage`/`sessionStorage`/disk. Closing the popover
  (`emptyHarnessLaunchForm()`) discards it.
- **Permission default `inherit`; explicit `unattended` only from an explicit checkbox.** No global
  setting is read or written; the checkbox is per-launch, defaulting unchecked.
- **Existing behavior preserved.** `TerminalPane.tsx`, `terminal-input-queue.ts`,
  `session-projection.ts`, the Cmd/Ctrl+Shift+N shortcut, and the close/stop flow are untouched —
  confirmed by `git status` showing no diff on those files.

## Second pass: native-client trust/ambiguity review

A follow-up review flagged real gaps in `src/main/native-client.ts` (main-process, in scope) beyond
the harness feature itself; all fixed:

- **`socket.setTimeout` is an inactivity timer, not a total deadline** — it resets on every byte
  received, so a service dribbling data forever would never trip it. Added `REQUEST_DEADLINE_MS`
  (15s), a real `setTimeout` bounding total elapsed time regardless of activity, cleared the instant
  the call settles.
- **Generic "cannot reach" was masking malformed responses.** The single outer `try/catch` mapped a
  parse/schema failure to the same `unverifiable`/"cannot reach" message as a genuine transport
  failure. Restructured into `unreachable()` (transport-level, `unverifiable`, retryable) vs.
  `malformed()` (the connection worked but the answer violates the contract — `internal_error`, not
  retryable) as distinct, never-conflated paths.
- **No verification that a returned `Session` actually matches what was requested.** Added
  `identityMismatch` (exported, pure, host id passed in rather than read from module state, so it is
  directly unit-tested): for `session.start`/`harness.start`, rejects a result whose `workspaceId`
  differs from the request, or whose `hostId` differs from the last `status` call's — never silently
  trusting a session for the wrong workspace or execution host.
- **Read/write byte consistency wasn't checked**, matching the CLI's own correction tests: extracted
  `writeByteCountMismatches`/`readCursorMismatches` (`src/main/byte-consistency.ts`) so `write`'s
  `acceptedBytes` is checked against the actual UTF-8 byte length of what was sent, and `read`'s
  `nextCursor - startCursor` against the actual decoded length of `dataBase64`.
- **Blind fresh-requestId retry could double a real launch.** `callNative` previously minted a new
  `requestId` on every call with no way for a caller to pin one. It now accepts an optional
  `requestId`, defaulting to a fresh one everywhere except harness launch. `HarnessLaunchMenu` keys
  a `{ paramsFingerprint, requestId }` pair on the exact normalized params last submitted: a
  byte-identical resubmit (the user retrying after an ambiguous failure, without editing anything)
  reuses the same id, so the service's own idempotency ledger can answer safely instead of a second
  real launch; any actual edit gets a fresh id. The form only auto-closes on a *confirmed* launch —
  an ambiguous or refused attempt leaves it open specifically so that safe retry is available.
  `startHarness`'s bridge schema now requires this `requestId`.

## Impeccable skill self-audit

`/Users/carlos/.codex/skills/electron/SKILL.md` is a CDP-automation tool for driving a running app —
exactly what "no computer-use for UI checks" rules out for this task, so it was read but not
invoked. `/Users/carlos/.agents/skills/impeccable/SKILL.md` is a full design workflow (its own setup
scripts, palette generation for brand-new projects, sub-command references); its "new projects"
color/theme steps do not apply here (existing committed tokens win per its own step 3 exception,
and `PRODUCT.md` explicitly forbids inventing a new visual system). Its **General rules** and
**Absolute bans** were read and checked against the new CSS directly, which found one real defect,
now fixed: `.harness-menu`/`.harness-launch-form` originally paired a `1px solid border` with a
`0 10px 24px` box-shadow on the same element — exactly the banned "ghost-card" combination. Since
`docs/STYLEGUIDE.md` (the authorized reference) defines that exact shadow value as this design
system's own "floating" elevation level for popovers, the shadow was kept (it is the project's own
documented choice, not an invented default) and the redundant border was dropped instead — resolving
the defect without discarding the source system's own convention. Also strengthened
`.harness-menu-item[data-highlighted]` with a 1px inset ring: `--accent` is close enough to
`--background` in light mode that a flat highlight alone is hard to see (the same contrast concern
the old app's own style guide calls out for a different component), without inventing a new token
or backporting the old app's specific `color-mix` recipe.

## Tests — Measured

`corepack pnpm typecheck`, `corepack pnpm test`, and `corepack pnpm build` all pass (no dependency
installs were run; existing `node_modules` only). Test count: 39 passing (11 pre-existing + 28 new),
across 8 files. New tests, none of which start an installed agent, open a real socket, or contact a
provider — all pure function / schema validation:

- `harness-capability.test.ts` — both capabilities required; either alone, or neither, is
  "unsupported."
- `harness-launch-form.test.ts` — blank vs. whitespace-only fields become absent, not empty
  strings; a typed value is preserved exactly (trimmed only); `provider` is dropped for every
  harness except `pi`; `unattended` maps to the exact adapter-facing `permissionMode` string.
- `harness-validation.test.ts` — trusted `harness.list`/`harness.start` payloads accepted; an
  unknown `harnessId`, an invented `availability` value, a non-string `executable`, and a
  fabricated `verdict` on the launch result are all rejected; the `startHarness` bridge schema
  accepts a minimal and a fully-populated request, and rejects an untrusted `harnessId`, an
  out-of-set `permissionMode`, an empty-string optional field (must be absent, not `""`), a NUL
  byte smuggled into `prompt`, and a missing `requestId`.
- `native-client.test.ts` (extended) — `identityMismatch` rejects a workspace or execution-host
  mismatch on `session.start`/`harness.start`, passes through an actual match, declines to check
  when no host is known yet (never a false positive before the first `status` call), and is a no-op
  for methods that don't return a session.
- `byte-consistency.test.ts` — write byte-count checks use actual UTF-8 length (not JS string
  length) for multi-byte text; read cursor-advance checks catch both an under- and over-reported
  advance, including the empty-read edge case.

## Limits / not claimed

- **No rendered/CDP acceptance was run here** — the task assigns that to the coordinator. Only
  `typecheck`/`test`/`build` were exercised; the popover's actual visual placement, focus-trap
  behavior, and keyboard flow have not been driven in a real window.
- **Menu item keyboard navigation is Radix `DropdownMenu`'s own roving-focus behavior**, not
  independently re-verified here beyond typecheck/build; the launch form's field order is native
  Tab order (no custom roving-tabindex was written for it, matching the "compact" scope).
- **Effort/provider hints are advisory text only** (e.g., nothing blocks typing an `effort` value
  for OpenCode client-side); the contract states the service itself refuses that combination, so no
  client-side duplicate validation was added.
- **No visual regression check against the pre-existing plain-button screenshot** was performed;
  only code-path equivalence (same JSX branch, untouched) is claimed for the no-capability case.
- **The retry-safe `requestId` is only pinned within one open popover instance** (via a `useRef`
  keyed on the exact submitted params); closing the popover and reopening it, or the whole window
  reloading, starts a fresh identity — an ambiguous failure that outlives that lifetime has no
  further protection here beyond the service's own crash-recovery semantics.
- **The total request deadline (15s) and idle timeout (10s) are judgment calls**, not measured
  against real service latency under load; no test exercises the actual timer firing (would require
  a slow-drip fake server), only that the identity/byte-consistency logic they gate is correct.
# Independent rendered verification — coordinator, 20:59 UTC

After the worker settled, the coordinator reproduced and fixed a real Popover anchoring/focus defect that unit tests had missed. Additional corrections preserve opaque prompt whitespace, tolerate unknown future catalog IDs without disabling known adapters, label sessions from exact executable catalog matches, and describe Pi's `--approve` as project trust rather than claiming it bypasses all permissions. Launch-form retries retain their request identity while the form stays open; persistence across closing/reloading is still outstanding.

Typecheck, 44 unit tests and production build passed. Actual Electron CDP acceptance passed nine checks, including Pi launch with no inference prompt, same session/incarnation after reload, exact stop, form alignment, light/dark/narrow screenshots and Escape. Report: `.preflight/acceptance/desktop-1788641953155-a7b35e9a-0c4a-4173-b624-5269d043e1f0/report.json`. Screenshots were viewed independently; this is runtime evidence, unlike the historical worker report below. Pi's own startup downloaded `fd` into the isolated fixture; model/authentication readiness was not tested here.
