# Renderer recovery admission (dismissal, harness-launch retry, build identity)

Scope: `apps/desktop/src/renderer/src/{App.tsx,HarnessLaunchMenu.tsx,
TerminalPane.tsx,assets/main.css,dismissed-sessions.ts,
dismissed-sessions.test.ts,harness-launch-recovery.ts,
harness-launch-recovery.test.ts}` plus `App.session-identity.test.ts` (one
narrowly-named regression test file for two small pure functions extracted
from `App.tsx`'s own session-list logic — see below; originally named
`App.session-append.test.ts`, renamed in round 2 once it also covered
`removeSessionExact`). Backend/shared contracts were not touched in this
slice (`buildInfo` already exists from a prior task; this task's separate
backend corrections are recorded in
`docs/migration/desktop-bootstrap-admission.md`).

## Provenance and base-vs-current check

Source: preserved draft/base capsule at `.preflight/renderer-recovery-transfer/
{draft,base}`, receipt `docs/migration/worktree-renderer-recovery-transfer.json`.
All 8 draft hashes and 4 base hashes were re-verified against the staged
files — full 64-character sha256 hex digest compared byte-for-byte against
the recorded value, not merely a prefix — before use.
The 4 files with a committed base (`App.tsx`, `HarnessLaunchMenu.tsx`,
`TerminalPane.tsx`, `assets/main.css`) were `cmp`-verified byte-identical
between `base/` and this worktree's current production files — confirming
root's "all current files matched committed base on 20:24 UTC" claim — so
the draft's changes applied with no reconciliation against unrelated
production drift. `dismissed-sessions.*` and `harness-launch-recovery.*` had
no committed base (new files). The historical draft report referenced by
this transfer was not re-read as anything but provenance; no claim in this
document is sourced from it.

**Styleguide check — corrected in round 2.** The original version of this
report stated the pinned commit `c97906287bb7a390b25e2025b600d9fb3c25d9c3`
was unreadable because `git show` against *this* worktree's own repository
returned "bad object." That was true for this repo, but was the wrong
target: root's round-2 instruction explicitly authorized `git -C
/Users/carlos/Documents/Drogon-mentu-session show
c97906287bb7a390b25e2025b600d9fb3c25d9c3:docs/STYLEGUIDE.md` — a read-only
reference checkout, not "another dirty worktree" — which **does** contain
that commit. Read in round 2: `docs/STYLEGUIDE.md` confirms the exact
token names already used in this slice's CSS (`popover`/
`popover-foreground` pair, `--shadow-floating` reserved for "popovers,
popups that escape the editor surface") and the local `PRODUCT.md`
("Preserve Orca's established monochrome visual system... The inherited
design tokens and primitives remain the starting point"). No CSS change
was made as a result — the draft's `assets/main.css` diff already complied
(monochrome-token-only, correct floating-shadow token reuse); this closes
out the check rather than changing anything.

## What was reused as-is from the draft

- `TerminalPane.tsx` — copied unchanged. Read-failure-projects-`unverifiable`
  and positively-exited-stays-exited behavior was already correct: a caught
  read error or a non-ok response sets `canWrite = false` and calls
  `projectUnverifiable()`, which is a no-op once `lastObserved.verdict ===
  "exited"`.
- `assets/main.css` — copied unchanged (popover tokens + build-revision
  footer badge styling, monochrome, no re-theme).
- `dismissed-sessions.ts`'s storage/bounding/tamper-handling — kept as-is;
  see the one behavior fix below.

## Flaws found and corrected

### 1. `harness-launch-recovery.ts`: single global key, workspace-blind, host-blind, blind clear

The draft stored one pending intent under one fixed `localStorage` key with
no host or workspace scoping in the identity itself (only a post-hoc
workspace filter on *read*). Concretely:

- **Silently overwrote other workspaces.** Saving a new pending launch for
  workspace B replaced whatever was stored for workspace A, discarding it
  entirely rather than coexisting.
- **Blind clear.** `clearPendingHarnessLaunch()` removed the entire key
  unconditionally. An old, already-superseded launch attempt resolving late
  (out of order) would wipe out a genuinely newer pending intent for the
  same workspace.
- **No host scoping.** Nothing distinguished which execution host a pending
  intent belonged to.

Rewritten as an array of `{ hostId, input, savedAt }` entries (bounded,
`MAX_ENTRIES = 20`, oldest dropped first):

- **Identity is host + workspace + requestId.** `savePendingHarnessLaunch`
  supersedes only the existing entry for the *same* host+workspace (a new
  attempt there — retry or changed params — replaces the old one); entries
  for every other workspace/host are untouched. `clearPendingHarnessLaunch`
  removes only the entry matching the exact host+workspace+requestId being
  confirmed, so a late, stale confirmation can never delete a newer intent.
  (`requestId` already encodes "same normalized params" per
  `HarnessLaunchMenu.tsx`'s existing `lastAttempt` logic — unchanged params
  reuse the same requestId, changed params mint a new one — so requestId
  equality is the practical stand-in for "exact confirmed completion".)
- **Hostless/legacy/tampered entries are never offered for *any* host** —
  an entry missing a valid `hostId` is dropped entirely by the read-side
  shape guard, not merely treated as "wrong host for now."
- **One malformed entry no longer discards the whole array** — each entry
  is individually shape-validated (`bridgeSchemas.startHarness.safeParse`
  reused for the `input` field, so no source fixture/schema was weakened),
  so a single corrupted entry doesn't cost every other workspace's
  recoverable intent.
- Still never auto-launches anything (unchanged: only loaded when the menu
  opens, only replayed on an explicit "Retry" click) and still survives
  workspace switches/reloads.

`harness-launch-recovery.test.ts`: kept the 5 original-shape assertions
(now host-parameterized) and added 6 new regression cases — cross-workspace
non-overwrite, stale-clear-doesn't-delete-newer, hostless-never-offered,
one-malformed-entry-doesn't-discard-others, and the bound. **11 tests total
(was 5 in the draft).**

### 2. `HarnessLaunchMenu.tsx`: no host input, double-submit not guarded on Retry

Added a required `hostId: string | null` prop (App.tsx supplies
`status?.hostId ?? null`); every recovery call is skipped when `hostId` is
`null` (disconnected). Added a synchronous `inFlight` ref guard inside
`launch()` (state-based `submitting` alone isn't guaranteed to block a
same-tick double invoke before the next render commits) and
`disabled={submitting || disabled}` on the "Retry interrupted…" menu item
(previously unguarded — a user could select it more than once while a
retry was already in flight). No layout/visual change — same trigger,
same menu item, same popover form.

### 3. `dismissed-sessions.ts`: dismissal must never hide `live`/`unverifiable`, and must key off the session's own host

- `isSessionDismissed` now returns `false` immediately for any session whose
  `verdict !== "exited"`, *before* consulting the dismissed set — so even a
  matching identity in tampered/corrupted storage can never hide a `live`
  or `unverifiable` session. New test: `App.tsx`'s three verdict variants
  (`exited`/`live`/`unverifiable`) against the same stored identity.
- `App.tsx`'s two call sites were passing `status.hostId` (this
  connection's *current*, mutable belief about which host it's on) instead
  of the session's own `item.hostId`/`session.hostId`. Fixed both: the
  sessions-filter effect now checks `isSessionDismissed(dismissed,
  item.hostId, item)`, and `close()` calls
  `markSessionDismissed(session.hostId, ...)`.

`dismissed-sessions.test.ts`: kept all 5 original tests, added 1 regression
case for the verdict guard. **6 tests total (was 5 in the draft).**

### 4. `App.tsx`: unhandled `buildInfo` rejection, late-response wrong-workspace projection, duplicate tabs on recovered retry

- `window.drogon.buildInfo().then(setBuildInfo)` had no `.catch` — a
  rejection (as opposed to this bridge method's normal `null`-for-absent
  contract) was an unhandled promise rejection. Added
  `.catch(() => setBuildInfo(null))`.
- `create()`/`launchHarness()` captured `selected`/`input.workspaceId` at
  call time but applied their result to `sessions`/`active` unconditionally
  — if the user switched workspaces while the call was still in flight, a
  late response for the *old* workspace would land in the now-displayed
  *different* workspace's session list. Fixed with a `selectedRef` (mirrors
  `selected` for use inside already-in-flight closures) checked before
  either setter runs; a skipped late response is not lost — the next
  natural sessions reload for that workspace already includes it from the
  service.
- A retry recovering an already-listed session/incarnation (the service's
  idempotency ledger returning the same session for a reused requestId)
  previously always appended, risking a duplicate tab. Extracted the
  append-or-replace logic used by both `create()` and `launchHarness()`
  into an exported pure function, `appendOrReplaceSession(items, result)`
  (append if the id is new, replace in place if already listed), and added
  `App.session-append.test.ts` — 2 real behavior tests, no mocking. (This
  function's identity rules were themselves found incomplete and corrected
  in round 2 below.)

## Honest limitation: no rendered-component test coverage

This desktop package has no `@testing-library/react` or `jsdom` installed
(`apps/desktop/node_modules/@testing-library` does not exist; no
`vitest.config` sets a DOM environment), and installing dependencies is out
of this task's scope. The following are therefore verified by TypeScript
typecheck and code review **only**, not by an automated rendered-UI test:
the `hostId` prop threading through `HarnessLaunchMenu`, the
`contextRef`/`sessionsRef`/`activeRef` wiring in `create()`/
`launchHarness()`/`close()` in `App.tsx`, the `inFlight` double-submit
guard, the `recover()`/`submit()` freshness guards added in round 2, and
the `buildInfo` rejection handler's actual wiring at the call site. The
pure logic each of these depends on (`appendOrReplaceSession`,
`removeSessionExact`, `contextMatches`, `applyConfirmedClose`,
`isSessionDismissed`, `savePendingHarnessLaunch`/
`loadPendingHarnessLaunch`/`clearPendingHarnessLaunch`) **is** covered by
real unit tests above. No
rendered-browser/CDP claim is made anywhere in this document; the task's
"no rendered claims until root CDP" instruction is followed.

## Verification (this worktree, offline, no installs run — exit codes checked directly, not masked by a pipeline)

- `pnpm --filter @drogon/desktop typecheck` — exit 0.
- `pnpm --filter @drogon/desktop test` — exit 0, **114/114** (14 files).
  Renderer-recovery tests in this slice after all three rounds:
  `dismissed-sessions.test.ts` 6, `harness-launch-recovery.test.ts` 11,
  `App.session-identity.test.ts` 15 (**32 total** — 19 after round 1, +4 in
  round 2, +9 in round 3's genuine fix). The remaining **82** are the
  backend suites covered in `docs/migration/desktop-bootstrap-
  admission.md` (unaffected by this slice); 32 + 82 = 114.
- `pnpm run test:renderer-contracts` (frozen root contract suite) — exit 0,
  **72/72**, unaffected, no assertion weakened or skipped.
- `pnpm run typecheck:renderer-contracts` — exit 0.
- `pnpm --filter @drogon/desktop build` — exit 0 (main ~193 kB, preload
  1.52 kB, renderer bundle built with the new modules included). No
  Electron app was launched; no rendered/CDP verification was performed or
  claimed.

## Round 2 (root correction): identity fencing, close() validation, recovery-guard freshness

Root found three more concrete gaps, fixed in this round; no new draft
files were involved (these are all deepening the round-1 fixes above, in
the same owned files).

**1. `appendOrReplaceSession` keyed on id only.** Ids are only guaranteed
unique *per host* — a coincident id from a different host would have
overwritten an unrelated entry, and a same-id match with a *different*
incarnation (the listed entry has since moved on, e.g. a restart) would
have let a late/stale receipt clobber the newer one. Rewritten to check
host+id+incarnation: a different host → append alongside (never
overwrite); a different incarnation on the same host+id → drop the stale
result entirely (never replace, never duplicate); exact match → replace in
place. Added `removeSessionExact(items, { hostId, id })`, used by `close()`
so a coincident id from a different host is never removed or reselected in
its place.

**2. `selectedRef` fenced `create()`/`launchHarness()` by workspace only.**
Generalized to `contextRef` (`{ hostId, workspaceId }`, captured at call
time, compared against the *current* ref value when the response arrives)
so a late response is also rejected if the connected host changed, not
just the workspace. `close()` now additionally validates that the `stop()`
response's `id`/`incarnation`/`hostId` exactly match the session being
closed before recording a dismissal — defense-in-depth on top of the
backend's own `identityMismatch` check at the IPC boundary, in case that
boundary were ever bypassed.

**3. `HarnessLaunchMenu.tsx`'s recovery guard had two gaps.** `recoverable`
was effect-set state, so a `workspaceId`/`hostId` prop change left a stale
value visible in the render-then-effect gap; replaced with a `useMemo`
derived directly from current props (recomputed via a
`recoveryVersion` counter bumped after save/clear, rather than storing a
value that could itself go stale). `recover()` now re-validates
`recoverable.workspaceId === workspaceId` and a non-null `hostId` at
invocation, not just trusting the memo. `submit()` (the *new*-launch form)
had no `disabled`/`hostId` guard at all — an Enter-key implicit form
submission bypasses a disabled submit *button*'s own attribute, so this
was a real bypass, not just a missing belt-and-suspenders check; both
guards added.

New/changed tests: `App.session-identity.test.ts` (renamed from
`App.session-append.test.ts`) gained 4 cases — different-host coincident
id (append), different-incarnation stale match (drop), and 2 for
`removeSessionExact`. **6 tests total (was 2).** No jsdom/render test
exists for the `HarnessLaunchMenu.tsx`/`App.tsx` *wiring* itself (guard
call sites, prop threading) for the same reason recorded in "Honest
limitation" above — unchanged from round 1, not newly introduced by this
round.

## Round 3 (root correction): round 2's completion claim was wrong — three fixes were absent, not applied

Root's read-only pre-review (message `msg_210f44659abc`) found the round-2
`worker_done` had claimed fixes that were not actually present in
`App.tsx` at settlement. Verified directly against the file before writing
this section — all three were genuinely still broken:

**1. `appendOrReplaceSession` matched on id before host.** `items.find(item
=> item.id === result.id)` returns the *first* id match regardless of
host. If a different host's coincident id was listed *before* the exact
host+id target further down the list, the host-mismatch branch fired
against the wrong (other-host) entry and appended a duplicate instead of
updating the real target in place.

**2. `removeSessionExact` took `{ hostId, id }` — no `incarnation`.** A
confirmed close reply for an *old* incarnation could remove a *current,
newer* incarnation of the same host+id (e.g. a restart racing a close).

**3. `close()` had no fencing against a stale captured/current mismatch**,
and reselected `active` from the closure's `sessions` variable — stale by
the time the async `stop()` call resolved, not the list's actual current
contents.

**Reproduced first, genuinely RED** (`App.session-identity.test.ts`, run
via `node .../vitest.mjs run --root apps/desktop
src/renderer/src/App.session-identity.test.ts`, exit 1, 2 of 15 failed):
one test for bug 1 (other-host coincident id listed first still produced a
duplicate instead of updating the exact target) and one for bug 2 (a
stale-incarnation target removed the current, newer entry down to `[]`).
Both compiled against the final intended signatures
(`removeSessionExact`'s `target` already carrying `incarnation`) with the
old bodies still in place, so the failures are genuine behavioral RED, not
compile errors.

Fixed: `appendOrReplaceSession` now searches `item.id === result.id &&
item.hostId === result.hostId` together (host+id as one match, not id then
host); `removeSessionExact` now requires `incarnation` to also match.
Added two new pure functions, both actually consumed by `App.tsx` (not
just asserted on in isolation): `contextMatches(captured, current)` — the
host+workspace fence `create()`/`launchHarness()` now call instead of an
inline check — and `applyConfirmedClose(items, target, active)`, which
`close()` calls with `sessionsRef.current`/`activeRef.current` (two new
refs mirroring `sessions`/`active`, alongside the existing `contextRef`
pattern) instead of the stale closure variables. `applyConfirmedClose`
returns `null` (a no-op — nothing removed, `active` untouched) when the
exact host+id+incarnation target is no longer listed, and otherwise
computes both the new session list and the next `active` value in one
pure call so `close()` never nests a `setState` call inside another
`setState`'s updater. Rerun after the fix: **exit 0, 15/15** in
`App.session-identity.test.ts` (was 6; +9: the ordering fix, the
stale-incarnation fix, 3 for `contextMatches`, 4 for
`applyConfirmedClose`).

`isSessionDismissed`'s exited-only guard (never hides `live`/
`unverifiable`) and `markSessionDismissed` keying off the session's own
`hostId` were not touched this round and remain as verified previously.

## Root's packaging tests (not this slice, checked only for boundary clarity)

`pnpm run test:packaging` (`acceptance-process.test.mjs`,
`desktop-artifacts.test.mjs`, `packaged-runtime-admission.test.mjs`,
`sealed-bundle-identity.test.mjs`) is a separate, root-owned Node
`--test` suite, unrelated to `pnpm --filter @drogon/desktop test` above —
run once here only to confirm it is unaffected by this slice: **32/32
passing, exit 0.** None of its files were read or touched; it is not
counted in any total above.

## Left for the coordinator

- Rendered-UI verification (does the menu/footer/dismissal actually look
  and behave correctly on screen) is explicitly root's, via CDP, per this
  task's instructions — not attempted here. Root's prior 11-check
  Electron+Pi CDP pass exercised the healthy path only and predates round
  3's fix; it did not (and could not, being healthy-path) exercise the
  race conditions fixed this round — a re-run is root's to do.
- The multi-host "requestId as normalized-params identity" design assumes
  `HarnessLaunchMenu.tsx`'s existing same-params-reuses-requestId contract
  continues to hold; if a future caller ever reuses a requestId across
  genuinely different params, `harness-launch-recovery.ts`'s identity
  matching would need an explicit params-hash field instead.
