# Drogon UI state contracts — coordinator v3

Pinned original: `c97906287bb7a390b25e2025b600d9fb3c25d9c3`.
[JSON source contracts](parity-drogon-ui-state-contracts.json) carry exact paths,
line ranges, 42 file fingerprints, assertion claims and limits.
[UI-C01–C11 corrections](parity-ui-evidence-corrections.md) still apply.

**45 state IDs characterized, not45 tests passed. Zero tests executed here.**
This replaces the unaccepted leaf v2. Original tests/source are unchanged.
Three Bot state conflicts occur in two legacy tests: preserve their historical
baseline and separately map current minimalist behavior, not an old-form rollback.

## PUI-BOTS-001 (19 states)

| State ID | Existing contract | Assertion boundary |
|---|---|---|
| BOT-S-loading | Three loading skeletons; form takes precedence over load/list states. | Source characterization only; no test execution or rendered acceptance. |
| BOT-S-error | Load error offers Retry; it calls refresh. | Error heading/message and Retry button render; test does not click Retry. |
| BOT-S-empty | Empty list offers Create Bot. | Empty text and button render. |
| BOT-S-populated | Cards retain owning bot IDs for selection, responsibility, delete and launch callbacks. | Injected run callback receives bot-2 and its responsibility ID; not every card action is tested. |
| BOT-S-botform | Minimal form: optional name, purpose and character; Advanced holds Agent, model, handle/title/memories. Model starts empty, editable only for Pi. Changing Agent clears model. | Legacy assertion conflicts with current input value/labels. |
| BOT-S-charpicker | Six-character radio grid expands to seventeen. Character selection preserves user purpose, never writes persona over it. | Legacy test expects old picker/instruction controls and overwriting text. |
| BOT-S-descfallback | Description is (title ?? instructions) // Ready for a purpose; empty title does not fall through to nonempty instructions. | Three fixture rows cover title, null-title instructions and both-empty fallback; not empty-string title with nonempty instructions. |
| BOT-S-noharness | No detected Agent disables selector; submit disabled if busy/no resolved name/harness not in detected list; shows install-agent hint. | Legacy test uses old names and hint wording. |
| BOT-S-respform | Reactive event is trimmed/null. Scheduled creation passes new_per_run, local timezone, RRULE and entered date or now+1h. Success closes/resets/reloads; error shown. | UI submit boundary source-read; service tests do not establish the form/date/timezone journey. |
| BOT-S-actionerror | Action errors appear as a banner independently of load error. | Source characterization only; no test execution or rendered acceptance. |
| BOT-S-chrome | Back closes; refresh disabled while loading; New Bot disabled while its form is shown or busy. | Source characterization only; no test execution or rendered acceptance. |
| BOT-S-delete | Delete action calls service then reload, with error banner; no confirmation in this page handler. | Source characterization only; no test execution or rendered acceptance. |
| BOT-S-runlaunch | Scheduled Run routes owner IDs and reloads. Open session requires active workspace, otherwise banner. Card buttons do not all inherit busy. | Injected Run owner IDs only; actual harness launch and global single-flight not demonstrated. |
| BOT-S-identity | Catalog has17 characters. Empty/custom-whitespace name resolves to selected character; custom trimmed name wins. Initial form is arya/codex; detected harness correction/reset may choose first available. | Source characterization only; no test execution or rendered acceptance. |
| BOT-S-persist-rotate | Create/update/rotate mutate Bot state and request a flush; delete removes Bot owner fields from global automations without removing automation history. | In-memory BotPersistence create/rotate retains ID, state count and session, and invokes a flush spy; not a disk restart. |
| BOT-S-scheduled | Scheduled responsibility requires schedule; creates automation with current Bot harness/prompt, schedule fields and owner. If Bot update throws, attempts automation rollback. | Stub store sees botId, agentId and identity prompt, and linked trigger ID. RRULE is fixture input, not directly asserted. |
| BOT-S-migrate | Migration repairs automation owners, removes dangling ownership and missing/cross-Bot duplicate scheduled responsibilities. Returns original other state fields; history is a separate newest-first joined projection. | Owner repair/drop, missing responsibility and joined history are asserted; title 'run links' does not prove rewritten automationRuns. |
| BOT-S-nofake | Disabled responsibilities reject; reactive manual execution rejects before invoking scheduled runner. This rejection is not a working reactive adapter. | Reactive service call rejects with connected event adapter message; no actual event source. |
| BOT-S-hydrate | Scheduled dispatch resolves current Bot harness, instructions and memory; absent Bot/responsibility returns original automation. History writer creates/finishes linked records and catches Bot-history errors without stopping automation persistence. | Stub writer calls link IDs/end timestamps; hydration sees current prompt/harness; in-memory persistence deduplicates automationRunId and rejects nonexistent linked run. No scheduler/agent process executed. |

## PUI-MENTU-001 (16 states)

| State ID | Existing contract | Assertion boundary |
|---|---|---|
| MEN-S-scope | Scope labels workspace kind/path/session; unavailable context disables full-tab access. | Checks unavailable text and disabled button, not explicit runner-spy assertion. |
| MEN-S-recipeselect | Select displays valid entries and is disabled while discovery/busy or empty. | Source characterization only; no test execution or rendered acceptance. |
| MEN-S-tabs | Plan/Evidence mode and source draft are session-keyed and shared by panel/native pane. | Mocked API/store sharing, isolated keys and cleanup/remount restoration. Not application/disk restart. |
| MEN-S-runtimemsg | Invalid or execution-failed uses alert; other messages status; failed execution offers evidence navigation. | Injected failure checked in panel/native pane; evidence click changes store mode and no api.run. No recipe executed. |
| MEN-S-loading | Loading/discovering recipe takes precedence over evidence and graph. | Source characterization only; no test execution or rendered acceptance. |
| MEN-S-evidence | Evidence distinguishes local run records from absent formal protocol. Groups attempts, shows latest summary and prior verification history; prior outputs are unavailable. Hook restores scoped reads and discards stale/unmounted responses. | Six restoration tests mock readRun and UI state; retry rendering uses fixture evidence. Host request IDs verified, not real SSH or process liveness. |
| MEN-S-graph | Graph maps steps/child dependencies, detects duplicate/unknown references and cycles. Current node status uses highest lifetime attempt count with array-order tie break; labels group in first-seen order. | Attempt fixtures are already ordered; tests do not prove every unsorted/tie case. Separate cycle test rejects graph and empties nodes. Unknown-field preservation is a source-editing obligation, not proved by retry rendering. |
| MEN-S-review | Review binds requested scope and effective plan; hard check/strict doctor/plan findings can block approval. Reviews coalesce while pending, not forever; later edited input is reviewed anew. | Runtime tests use temporary recipe files with stubbed process/identity; they test blocking findings, child-edit binding, pending coalescing and refreshing reviewed inputs. |
| MEN-S-execute | Run/Resume/Retry are review-then-approve controls. Execution revalidates binding, routes only admitted local host, passes workspace/plan-digest/request-key. Resume needs runId; Retry needs existing reviewed step. Current process failure cannot be hidden by older successful evidence. | One run invocation is asserted for coalesced approvals. Recovery test proves resume argv against temporary record; not retry-step execution or negative foreign-source cases. Nonzero/null process receipts and missing evidence tested with stubs. |
| MEN-S-diagnostic | Check/strict Doctor/Refresh evidence share disable gate. Read-run needs runId; missing API/root or rejected request becomes unavailable; diagnostics release operation in finally. | Source characterization only; no test execution or rendered acceptance. |
| MEN-S-cancel | Cancel visible only during operation with approvalId. Service requests AbortSignal and cleanup removes active approval cancellation handle; no exit is inferred from request alone. | Stubbed revalidation abort prevents remaining doctor/run calls; second cancel not-running. Stubbed process abort result remains unverifiable. No actual OS child termination proved. |
| MEN-S-clearreview | Dismiss visible with review and disabled while running. | Source characterization only; no test execution or rendered acceptance. |
| MEN-S-blockednotes | RunControls has draft/invalid-graph/unavailable messages, but panel mounts it only inside valid graph with document/catalog; parent invalid state instead prompts valid recipe. | Source characterization only; no test execution or rendered acceptance. |
| MEN-S-drafteditor | Editor disabled without document or busy; Apply additionally requires draft. Editing does not execute. | Draft stored by path and api.run untouched. Save/unknown-field behavior has a separate runtime test, not evidence from editing alone. |
| MEN-S-nativetab | Full-tab handler checks active workspace/navigation result; button needs sessionKey. | Identity helper returns originating session; not a navigation click journey. |
| MEN-S-badge | Review-required badge is explanatory copy, not an authorization mechanism. | Source characterization only; no test execution or rendered acceptance. |

## PUI-MEETINGS-001 (10 states)

| State ID | Existing contract | Assertion boundary |
|---|---|---|
| MEE-S-loading | Load state shows skeleton ahead of rows/empty. | Source characterization only; no test execution or rendered acceptance. |
| MEE-S-empty | Empty state explains default transcript root and date-folder Markdown convention. | Test waits for empty heading before body Escape; not a parser/discovery test. |
| MEE-S-populated | Rows expose statuses, excerpt and open/ask actions. All rows disabled for another busy operation; failed artifact can still Open but cannot Ask. | Fixture statuses and injected mount/open/ask callbacks; no actual harness delegation. |
| MEE-S-availability | Capture/platform availability is presented independently of transcript list/model readiness. | Linux fixture explains unsupported capture and contains no Record button; not execution on Linux. |
| MEE-S-companionsetup | View setup shown for not-installed reason, invokes setup callback. | Button and compatible-transcript copy only; actual safe discovery asserted separately in bridge fixtures. |
| MEE-S-modelnotice | Speech model notice remains separate from saved/recording/failed transcript statuses. | Fixture unavailable model and all three transcript statuses render. |
| MEE-S-error | Read/action error appears as alert; snapshot load guards stale updates with generation count; Open/Ask do not use that guard. | Source characterization only; no test execution or rendered acceptance. |
| MEE-S-askbox | Question maxlength4000; input itself not busy-disabled. Ask trims input; success clears it, error retains it and clears busy. | Injected callback gets selected meeting/question; not failure, trim, limit or default runtime-path execution. |
| MEE-S-escape | Capture Escape closes unless visible overlay or input/textarea/select/contenteditable target; cleanup removes listener. | Body Escape calls close once; protected targets and overlay remain separate test obligations. |
| MEE-S-source | Transcript override requires absolute root; ENOENT yields null and other read failures throw. Date/calendar, file-time/duration and Markdown header agreement determine convention; ownership is read-only metadata. | Temporary-filesystem bridge fixtures cover statuses, exclusions, missing install, platform override, in-memory folder mounting, malformed/oversized config and non-reuse of another runtime's same path. Read-only metadata is not proof of filesystem write prevention; malformed-config test has no download-spy assertion. |

## Corrections that affect acceptance

- Bot persistence tests use in-memory state and a flush spy; disk restart is not
  proved. Migration repairs owner links; it does not rewrite automationRuns just
  because a test title mentions run links. Schedule RRULE is source-passed but
  not directly asserted in the createResponsibility test.
- Eleven Bot ownership tests, fourteen retry-view tests, six restore-hook tests
  and fourteen session-execution cases were read completely. AST inspection
  counts43 direct declarations plus2 literal table cases. That45-case count is
  unrelated to the45 state IDs and adds nothing to the executed baseline.
- Retry ordering is by lifetime attempts count, array position as tie breaker;
  ordered fixtures do not prove all ties/unsorted cases. Prior attempt outputs
  remain unavailable. Token totals include every record, keeping missing values
  unknown; no inference-budget feature is required.
- Restore hooks discard stale responses and share pending reads under mocked
  StrictMode. Backend execution tests use temporary files but stub the process
  runner. Cancellation proves AbortSignal routing, not real OS termination.
- The recovery assertion checks **resume** argv. Retry-step source guards exist,
  but that same test cannot establish executed retry or negative ownership cases.
- Run reader maps stored running outcome to hostObservation live. The test named
  restart constructs a runtime over a prepared file; it does not restart the app
  or observe a child. Keep stored run status distinct from authoritative process
  liveness in acceptance. Remote test asserts unavailable and ssh transport, not
  an explicit unverifiable property or a real SSH disconnect.
- The child-input test verifies a changed child prompt blocks launch after
  approval; source review also checks binding revalidation. A success fixture
  does not justify narrowing the full approved scope.
- Meeting bridge fixtures do read temporary Markdown and test missing-install
  discovery, unlike the UI setup-copy assertion. Folder store is in-memory;
  platform is injected. Read-only metadata is not proof of write protection.
- Source unknown-field save has a separate temporary-file assertion; neither the
  retry suite nor the word atomically in its title proves interruption recovery.

## Remaining obligations

- Original Bots two legacy cases conflict with current form; preserve unchanged historical baseline and explicit current-behavior characterization.
- Run full original/candidate UI and service tests under isolated execution. Fixtures, process doubles, platform overrides, helper returns and remounts are not end-to-end proof.
- Recovery test resolves resume, not retry-step execution or every foreign-source/step rejection. Real approval/cancellation, process restart/liveness, mixed-version SSH/folder ownership and token receipts remain execution obligations.
- Read-only meeting ownership label is not filesystem access enforcement; existing mount/runtime contracts require separate integration proof.
- No claim of globally absent tests from this bounded slice. Broader E1 surfaces and E2-E5 remain independent of this45-state enumeration.

No worker was launched and no product source, personal profile, installation,
remote branch or PR was modified. E1 is not globally closed by this bounded
contract set. Worktree/PR dispatch and Sol hierarchy remain after audit closure.
