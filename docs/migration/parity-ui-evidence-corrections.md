# UI evidence corrections: Bots, Mentu and Meetings

Coordinator-reviewed bounded source/assertion characterization at original
revision `c97906287bb7a390b25e2025b600d9fb3c25d9c3`.
Machine-readable evidence: [parity-ui-evidence-corrections.json](parity-ui-evidence-corrections.json).

**No tests executed. No UI changed. No rendered acceptance.**
The original tracked source is unchanged. These 11 corrections have
12 source fingerprints and 29 file-bounded anchors.
They supersede the corresponding claims in the unaccepted leaf v2
`parity-drogon-ui-state-contracts`; they do not accept all of its45 states.

## Original-test drift is not candidate failure

Three state-contract conflicts occur in **two original test cases**:
the model/preset test and the empty-discovery test in `BotsPage.test.tsx`.
Their frozen assertions must remain in the baseline, with their actual execution
result recorded when safely run. A source contradiction predicts drift but is
not a PASS/FAIL receipt, nor a behavioral RED on the rewrite.

Preserve the implemented minimalist Bot experience requested by the user.
Do not restore the old form, overwrite user-written purpose, delete original
assertions, add silent skips or call altered tests unchanged. Map an explicit
current-behavior characterization alongside the historical obligation. A
superseded assertion needs a documented disposition; it cannot disappear from
the census or be counted as proof of current behavior.

## Reviewed corrections

### UI-C01 — BOT-S-botform

Model starts empty; non-Pi input is disabled with Agent default placeholder. Pi allows an exact provider/model ID; blank uses Pi settings.

Evidence limit: The original test expects the input value Harness default. Placeholder is not value. This is a static contradiction, not an executed failure.

Next test obligation: Run unchanged original case in isolated baseline; preserve its receipt and map a separate current-form contract covering Pi/non-Pi, blank default and resetting model on agent change.

Source: `src/renderer/src/components/bots/BotCreationForm.tsx:94-107`; `src/renderer/src/components/bots/bots-page-model.ts:28-37`.
Assertion bodies read, not run: `src/renderer/src/components/bots/BotsPage.test.tsx:72-86`.

### UI-C02 — BOT-S-charpicker, BOT-S-identity

Radio picker initially shows six of seventeen characters; expand/collapse exposes the catalog. Choosing a character preserves written purpose. Name is optional and falls back to the selected character's label.

Evidence limit: Old test queries Character preset and Instructions and expects preset text to overwrite instructions. Current labels/behavior differ. Do not reinstate that overwrite to obtain green.

Next test obligation: Retain original assertions separately; characterize radio selection, 6/17 expansion, purpose preservation, whitespace/default/custom names and busy controls.

Source: `src/renderer/src/components/bots/BotCharacterPicker.tsx:10-31`; `src/renderer/src/components/bots/BotCreationForm.tsx:43-66`; `src/renderer/src/components/bots/bots-page-model.ts:49-55`; `src/shared/drogon-bot-characters.ts:3-25`.
Assertion bodies read, not run: `src/renderer/src/components/bots/BotsPage.test.tsx:82-85`.

### UI-C03 — BOT-S-noharness

Agent select is disabled when discovery is empty. Create Bot is disabled for busy, missing resolved name or a harness absent from the discovered list. Install/refresh hint refers to agent.

Evidence limit: Legacy test queries Display name, Default harness, Save Bot and supported harness. It does not establish coverage for the current Name (optional)/Agent/Create Bot controls.

Next test obligation: Keep no-invented-harness invariant while adding current-control assertions; record legacy baseline separately, never skip it silently.

Source: `src/renderer/src/components/bots/BotCreationForm.tsx:72-92`; `src/renderer/src/components/bots/BotCreationForm.tsx:136-147`.
Assertion bodies read, not run: `src/renderer/src/components/bots/BotsPage.test.tsx:88-99`.

### UI-C04 — MEN-S-tabs, MEN-S-drafteditor

Panel and native pane use per-session mode and draft state. Editor is disabled without a document or while busy; Apply also requires a draft.

Evidence limit: Assertions cover mock API calls, store isolation and cleanup/remount with retained test-store data. This is not disk persistence or a real process restart. Draft edit explicitly does not call api.run.

Next test obligation: Preserve original mocked tests; add isolated app restart and separate-session/workspace/host restoration journeys with real persisted state.

Source: `src/renderer/src/components/mentu/MentuPanel.tsx:94-117`; `src/renderer/src/components/mentu/MentuPanel.tsx:196-226`.
Assertion bodies read, not run: `src/renderer/src/components/mentu/session-mentu-surface.test.tsx:196-280`.

### UI-C05 — MEN-S-scope, MEN-S-nativetab

Open full tab is disabled without sessionKey; handler checks active workspace and navigation result and reports unavailable context.

Evidence limit: The identity test checks a helper return, not a click/navigation journey. Missing-context test checks text and disabled button; its title is not an explicit runner-spy assertion.

Next test obligation: Exercise actual panel-to-tab navigation and origin identity across session switches; verify no runner invocation for unavailable context.

Source: `src/renderer/src/components/mentu/MentuPanel.tsx:20-60`.
Assertion bodies read, not run: `src/renderer/src/components/mentu/session-mentu-surface.test.tsx:187-194`; `src/renderer/src/components/mentu/session-mentu-surface.test.tsx:282-292`.

### UI-C06 — MEN-S-runtimemsg, MEN-S-evidence

Invalid/execution-failed messages use alert, other kinds status. Failed execution offers evidence access instead of claiming runtime unavailability.

Evidence limit: The test injects execution-failed runtime state, checks both surfaces, clicks View evidence and checks mode and no api.run. It does not execute a failing recipe or establish record parsing, stale-host discard or retry correctness.

Next test obligation: Keep mock assertions; exercise controlled real failure, record reading and recovery without duplicate execution.

Source: `src/renderer/src/components/mentu/MentuPanel.tsx:121-144`.
Assertion bodies read, not run: `src/renderer/src/components/mentu/session-mentu-surface.test.tsx:294-328`.

### UI-C07 — MEN-S-graph, MEN-S-blockednotes

Panel shows loading before evidence/plan; invalid graph shows the select-valid-recipe prompt. RunControls mounts only within valid graph and with document/catalog.

Evidence limit: An invalid-graph helper message exists in RunControls but this panel's parent branch cannot mount it with invalid graph. Do not assume that message is visible in every surface. Native pane composition remains separately owed.

Next test obligation: Test parent-level loading/evidence/invalid/valid branches, not only RunControls in isolation.

Source: `src/renderer/src/components/mentu/MentuPanel.tsx:138-192`; `src/renderer/src/components/mentu/recipe-pane-run-controls.tsx:280-294`.
No assertion-body coverage accepted for this correction.

### UI-C08 — MEN-S-review, MEN-S-execute, MEN-S-diagnostic, MEN-S-cancel, MEN-S-clearreview

Review switches to Approve for matching intent/step. Matching error findings and draft block execution; runtime, graph, running and diagnostic states share a disable gate. Resume needs runId; retry also needs a selected step. Doctor is strict. Cancel renders while running with approvalId; Dismiss requires review and is disabled while running.

Evidence limit: These are visible component branches/callbacks, not proof of host authorization or cancellation. Vague mentu-session-execution test pointers from leaf v2 are not accepted evidence here.

Next test obligation: Resolve exact admission/cancellation test bodies and independently prove host-owned scope/revalidation. Exercise Run/Resume/Retry, diagnostics, blocking, cancel and recovery paths.

Source: `src/renderer/src/components/mentu/recipe-pane-run-controls.tsx:160-278`.
No assertion-body coverage accepted for this correction.

### UI-C09 — MEE-S-companionsetup, MEE-S-populated, MEE-S-askbox

Open mounts with selected policy and calls open callback; Ask trims the question, delegates via override or runtime, clears on success and retains on error. Ask is disabled for busy/blank/no-agent/failed; Open is disabled only while busy.

Evidence limit: Setup test checks copy/button, not real artifact discovery. Q&A test uses injected mount/open/ask callbacks, not the default real harness path. Failed artifacts may still be opened; do not disable both actions by assumption.

Next test obligation: Add runtime delegation and no-companion discovery journeys. Cover failure/success question retention and action-specific eligibility.

Source: `src/renderer/src/components/meetings/use-meetings-page-controller.ts:83-131`; `src/renderer/src/components/meetings/MeetingTranscriptRow.tsx:57-71`.
Assertion bodies read, not run: `src/renderer/src/components/meetings/MeetingsPage.test.tsx:120-135`; `src/renderer/src/components/meetings/MeetingsPage.test.tsx:157-204`.

### UI-C10 — MEE-S-escape

Escape closes from unprotected targets; visible overlay or input, textarea, select and contenteditable true/empty suppress close. Listener uses capture and is removed on cleanup.

Evidence limit: The original test only dispatches Escape on document.body and checks close once. Its title does not prove focused-field or overlay negative cases.

Next test obligation: Preserve body assertion and add each protected target, visible overlay and listener cleanup cases.

Source: `src/renderer/src/components/meetings/use-meetings-page-escape.ts:4-23`.
Assertion bodies read, not run: `src/renderer/src/components/meetings/MeetingsPage.test.tsx:206-215`.

### UI-C11 — MEE-S-loading, MEE-S-error, MEE-S-populated

Snapshot load uses a generation counter to ignore stale success/error/finally and increments it on effect cleanup. Open/Ask use busy state and finally clear it; those action callbacks do not use the generation guard.

Evidence limit: Load protection is not universal cancellation for every async operation, nor proof of an atomic single-flight mutex. Race behavior and post-unmount action completion are unexecuted.

Next test obligation: Characterize overlapping loads and unmount, rejected mount/ask, busy action gating and action completion separately.

Source: `src/renderer/src/components/meetings/use-meetings-page-controller.ts:48-131`.
No assertion-body coverage accepted for this correction.

## Remaining scope and dispatch

The subsequent [coordinator v3 state contracts](parity-drogon-ui-state-contracts.md)
reconcile the leaf's backend ownership, retry/admission/restore and meeting
discovery pointers. That is bounded enumeration, not execution acceptance.
Claims based only on a test title, fixture, helper or callback override are not
end-to-end proof. No claim here establishes that matching tests do not exist
elsewhere.

E1 remains open. All previously required Orca and implemented Drogon behavior
is retained; missing proof is recorded rather than scoped out.
No worker is active. The stale Muse terminal is not to be reused.

After audit closure, use the authorized Astra → Sol lead → leaf hierarchy.
Give each feature area an isolated worktree from the accepted common base and
a scoped PR containing source-to-test mapping, implementation, rendered
evidence where applicable and independent integration review. Shared contracts
remain coordinator-owned. Do not move dirty writers, mix personal profile
data into fixtures, or install an unaccepted build merely to show progress.
