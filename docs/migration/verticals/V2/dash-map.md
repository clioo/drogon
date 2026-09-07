# V2 dash-map: dashboard / empty-state / onboarding evidence map

Purpose: characterize the WP-UI-DASH + shell empty/error/recovery + onboarding
gap and name the single smallest proven slice for the next leaf. Evidence-only;
no product behavior proposed beyond that one slice. Tier discipline inherited
from parity-ui-remaining-surface-cards.md: nothing here was executed; frozen
hashes recomputed this pass (`shasum -a 256`, all match the cards). Branch head
at mapping time: 23a961c.

## Current-candidate coverage (new shell, apps/desktop/src/renderer/src/App.tsx)

- Empty states: sidebar-empty "Open a folder..." (:569), empty-state
  "Start a session" / "A place for your next task" / "Connect to Drogon"
  (:773-780) with New terminal / Add workspace / Retry connection actions.
- Error surface: error-banner role=alert with Retry (:622); transport-loss
  recovery (unverifiable tab retry affordance, exited-session banner :744-751,
  session-recovery.ts pure helpers with 10 passing behavioral tests).
- Explicit not-connected note: migration-note (:829) "Mentum, Bots and source
  control are not connected in this build."
- No onboarding flow, no feature tips, no stats pane, no dashboard/activity
  page exists in the new renderer (absence, not deferral).

## Candidate slices

| Candidate slice | Source anchor (frozen c9790628, file:line + sha256) | Current coverage | Missing invariant | Frozen test file + assertion titles | Verdict |
|---|---|---|---|---|---|
| A. Port feature-tip startup-gate decision (pure fn, no UI) | components/feature-tips/feature-tip-startup-gate.ts:12-62 + shared/feature-tips helpers, `12e982cf...bdfe` (recomputed, matches card) | None; no tip system in new renderer | None for the gate logic itself: full priority order is test-verified (7 assertions); port must keep suppression-for-onboarding semantics shared with PUI-ONBOARD-001 | components/feature-tips/feature-tip-startup-gate.test.ts (255 lines, assertion-titles-read): "opens the CLI feature tip first for an existing user on app open"(:45), "suppresses feature tips for first-time users while onboarding is showing"(:61), "does not open later in the same session after onboarding suppressed it"(:77), "opens the CLI tip after the voice tip was marked seen"(:93), "opens the CLI tip after voice dictation is already enabled"(:109), "opens the command palette tip after the CLI tip was marked seen"(:125), "does not open after every tip was marked seen"(:141) | IMPLEMENT-NEXT (smallest: 62 pure lines + one complete test file; no DOM, no persistence plumbing beyond seen-id list) |
| B. Onboarding first-run flow + persisted no-reshow | components/onboarding/should-show-onboarding.ts:5-7 `ec72a199...ab5b`; OnboardingFlow.tsx (363 ln) `0590d7ae...f0`; OnboardingSkipConfirmationDialog.tsx:1-60 `0cb2e1a9...6e5` (all recomputed, match); app-shell/use-onboarding-and-feature-tips.ts:50-58 `6194ad0c...b08` (spot-read: suppressTours confirmed) | None | recovery: no re-show after completion and after skip-confirm across a simulated relaunch - no verifying test; storage is state.onboarding (E1-FG-14), but relaunch behavior unproven | components/onboarding/OnboardingFlow.test.tsx (titles only): "does not render the removed agent setup or tour steps"(:33), "shows the Windows terminal defaults page for Windows users after integrations"(:117), "drops the skipped integrations step from the stepper on Windows"(:132), "skips GitHub task setup when the GitHub CLI is already detected"(:159) | DEFER: 363-line modal + 5 step components; two recovery invariants untested; needs persistence slice first |
| C. Contextual-tour resume-after-restart | components/contextual-tours/ (25 files, none opened) | None | recovery: dismissed step must not re-show after restart - named in journeys S7, no test file found by the card pass | none identified (card: no test file found or read) | DEFER: 25 unopened files, zero test evidence; depends on B's gating |
| D. Stats settings pane + collector | src/main/ipc/stats.ts:1-8 `c003695d...9bb` (recomputed, matches; confirmed pure stats:summary -> getSummary() pass-through) | None | state: what the pane shows at all - pane component NOT LOCATED; collector.ts not opened | src/main/stats/stats-title-detection-independence.test.ts (titles): "has stats sources to check"(:34), "no stats source imports a title-based agent detector"(:40) - architectural isolation only, zero functional evidence | DEFER: card itself is proposal-not-dispatchable; requires locate-and-read slice before any implementation |
| E. WP-UI-DASH core: activity page + dashboard popout | 100 frozen test files (manifest census only; not opened) e.g. components/activity/ActivityPrototypePage*.test.ts; popout contract src/main/ipc/dashboard-popout.ts (PUI-DASHBOARD-001: lastSnapshot replay + clear-on-close, test-confirmed) | None | popout: valid-reopen-stale-snapshot invariant is test-confirmed frozen-side; port size uncharacterized (no file opened this pass) | dashboard-popout.test.ts titles: "opens only for the trusted main renderer while the feature is enabled"(:117), "auto-closes the popout when the feature is disabled"(:141), "caches and forwards only valid trusted snapshots"(:146), "keeps publishing the board when one card is invalid, and says so"(:163), "logs when a snapshot is rejected outright"(:183) | DEFER: 100-file wave, popout is a main-process window contract, not shell empty-state; needs its own bounded map |

## Chosen next slice (single)

A: port `feature-tip-startup-gate.ts` (and its minimal shared/feature-tips
helpers) as a pure decision module with the 7-assertion startup-gate test
ported RED->GREEN. Smallest because: pure input->decision function, no DOM, no
modal, no new persistence (seen-ids arrive as an argument), complete frozen
test to port, and it pre-wires the shared suppression condition that slices B/C
will reuse. WP note: cards allocate onboarding/tips to WP-UI-AUX (not
WP-UI-DASH); if the coordinator keeps that allocation this slice transfers
as-is.

## Honesty notes (unread / not verified this pass)

- Opened fully: should-show-onboarding.ts, feature-tip-startup-gate.ts,
  stats.ts, current App.tsx (anchored regions), plus spot-reads of
  OnboardingSkipConfirmationDialog.tsx(1-20), use-onboarding-and-feature-tips.ts(50-70),
  CmdJPaletteTipDialog.tsx(1-12), FeatureTipsModal.tsx(1-10),
  OnboardingFlow.tsx(1-12).
- NOT opened: OnboardingFlow.tsx body, FeatureTipsModal.tsx body,
  CmdJPaletteTipDialog.tsx body, VoiceDictationTipDialog, all 25
  contextual-tours files, src/main/stats/collector.ts, the two cited test
  file bodies (assertion titles inherited from the cards' read, not re-read),
  and all 100 WP-UI-DASH activity files (manifest census only - existence is
  not behavior evidence).
- No test was executed; no hash mismatch was found among recomputed files.
