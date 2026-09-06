# E4-S5 leaf: formatter branch contracts and original assertion-body cross-check

- Group: E4 (`e4-cli/`), obligation `E4-S5` kind `formatter-and-result-contract-boundary`
- Leaf scope (only this): the seven named formatter bodies plus their directly imported formatting helpers, the common `src/cli/format.ts` wrapper surface (`printResult`/`reportCliError`/`formatCliError`) and its directly called conflict/recovery helpers, and the original assertion bodies that pin them. No census, no handler re-mapping, no test execution. Coordinator message `msg_d0a3520de5d4` (2026-09-06T06:40:19Z) scoped `format.ts` plus conflict/recovery helpers; terminal/workspace accepted contracts are referenced only, not re-censused.
- Source revision (read-only): `/Users/carlos/Documents/Drogon-mentu-session` at `c97906287bb7a390b25e2025b600d9fb3c25d9c3`
- Parent evidence read first: `closure.json` E4-S5 block (lines 1559-1806) and `followup-command-semantics.json` (22 prior `assertionBodyReads`, none covering the format tests below). Do not redo census.
- Method: full-file reads of all seven formatter bodies + direct helper imports + `src/cli/format.ts` wrappers and their directly-called conflict/recovery helpers; full reads of every original test file that asserts on them; no runs, so **no pass/fail is implied**. `executed: false` for every test cited here.
- Hashes are identity anchors only; they do not prove behavioral equivalent.

## 0. Status summary (honest)

- S5 candidate closure is proposed **only** for the seven named formatter sources below, the `src/cli/format.ts` common wrappers (`printResult`/`reportCliError`/`formatCliError`), the directly-called conflict/recovery helpers, and the assertion cross-checks documented here. It closes less than the whole E4-S5 command list (234 rows): per-handler output call sites were mapped by the lead; this leaf verifies the shared formatter layer they print through.
- `browser-format.ts` and `project-format.ts` have **zero direct assertion coverage** in the whole original suite (`grep` across `src/**/*.test.ts`: no import, no caller). Their contracts are pure-source-obligation fixtures; a port cannot cite original goldens for them.
- `formatAutomationPrecheckTimeout` (`automation-precheck.ts`) has **zero direct or indirect** assertion coverage (all automation fixtures pass `precheck: null`).
- `artifact-format.ts` (`formatArtifactListPage`, `formatArtifactShared`), `terminal-format.ts`, `workspace-format.ts` and `src/cli/handlers/orchestration/...` other format consumers are **not** among the seven named bodies; they are S5-adjacent and remain lead-owned, not closed by this leaf.
- S1 is **not** accepted (204-row normalized field contracts still open per `closure.json` line 859-1078); S2-S4 remain lead scope. Nothing here claims acceptance of any group.

## 1. The seven formatter sources (full bodies read)

| File (original rev pinned) | sha256 (matches `closure.json` E4-S5 evidence) | lines |
| --- | --- | --- |
| `src/cli/browser-format.ts` | `b8cfb19f688f2d5dd6755a0a299ad42ba0d3dcecde44c3f00eb5d128f4b7bc2a` | 79 |
| `src/cli/computer-format.ts` | `cd26b0993398d11d489519465d17c9bab7197b39f7a214ed215907a4eec12ae3` | 321 |
| `src/cli/linear-format.ts` | `b190df9a9b1c382b40b5cc4ebe7e1e398e5afcb45d033469cab0c2e99e2cc002` | 262 |
| `src/cli/automation-format.ts` | `301cb3a49e995e0ed1883dda625cfe49c9dcaa217226156d2c543ebb762cba15` | 146 |
| `src/cli/project-format.ts` | `23283f5ccda28ee097db5f35816769f0db14282f963f7d95b0b5a2e4d7c0df9b` | 80 |
| `src/cli/handlers/orchestration/worker-output.ts` | `1dc67e59a50eba8ac5906f5111e5a43d8142498102a4fb1b6ed68866ca211712` | 68 |
| `src/shared/orchestration-check-output.ts` | `c8e6442712e4309a818711d85f6460e3d175383c0087aa36ac6043b4ce51c4fd` | 199 |

Direct helper imports read in full: `src/cli/base64-payload-byte-count.ts`, `src/cli/shell-command-quote.ts`, `src/shared/linear/list-truncation-format.ts`, `src/shared/linear/priority-label.ts`, `src/shared/linear/project-list-format.ts`, `src/shared/automation-run-identity.ts`, `src/shared/automation-precheck.ts`, `src/shared/automation-schedules.ts`. Transitive helpers of the last read too (reachable from format output): `src/shared/automation-schedule-parsing.ts` (`parseRrule`/`parseCronExpression`/`parseSchedule`/`parseAutomationRrule`), `src/shared/automation-cron-occurrence.ts` (`cronHasPossibleOccurrence`), `src/shared/orchestration-rpc-contract.ts` (`ORCHESTRATION_LEGACY_RUN_ID = 'run_legacy_local'`, line 16).

Common wrapper `src/cli/format.ts` (256 lines) read in full, plus its directly called conflict/recovery helpers read in full:
- `src/shared/computer-use-error-recovery.ts` (107 lines) — `computerUseErrorRecoveryData(code, message?)`; switch over computer-use codes; `window_not_focused` reads `message?.includes('may already have been delivered')` to pick the state-verification variant; `default` returns `undefined`.
- `src/shared/automation-owner-conflict.ts` (88 lines) — `matchAutomationOwnerConflict(error)` (single classifier across transports via `hasRuntimeRpcErrorCode`), `stripAutomationOwnerConflictCode(message)` (trailing `: <code>` trim), `automationOwnerConflictMessage`, `AutomationOwnerConflictError`, `isAutomationOwnerConflictCode`, 4 code constants.
- `src/shared/runtime-rpc-error-code.ts` (66 lines) — `hasRuntimeRpcErrorCode(error, expectedCode)` (string/object walk, token-before-message precedence, `CODE_TOKEN_BOUNDARY = /(?:: |\n)[ \t]*$/` guard, cycle-safe via `Set`). Transitive helper of `automation-owner-conflict.ts`.
- `src/cli/automation-owner-conflict-recovery.ts` (40 lines) — `automationOwnerConflictRecovery(code?) → { nextSteps } | undefined`; `automation_target_removed` deliberately offers no retry.

`format.ts` internals relevant to output contracts: `printResult` (L41-50), `formatCliError` (L67-91, precedence `runtime_unavailable → conflict recovery → RuntimeClientError nextSteps → computer invalid_argument → RuntimeRpcFailureError runtime_unavailable → RuntimeRpcFailureError nextSteps → raw message`), `reportCliError` (L92-129, JSON failure envelope id `local`, code priority conflict `?? RuntimeClientError.code ?? 'runtime_error'`, `localCliErrorData`), `hasOrchestrationRequestId` (L95-100), `withAutomationOwnerConflictRecovery` (L114-123), `formatHostList` (L150-161), `formatCliStatus`/`formatStatus` (L163-193, environment target prefix, `pid none`, `runtimeId none`, `connectionState unknown`). `formatHostList`/`formatCliStatus` ARE tested only partially (host rows/meta via `index-local-command-routing-flags.test.ts` in the inherited census; status text is not asserted in the read bodies).

### 1.1 `browser-format.ts` — expanded branch contract (no original assertions exist)

- `formatSnapshot` (L13-16): `page: <browserPageId>\n<title> — <url>\n` + raw `snapshot` (no trimming; snapshot must be pre-formatted).
- `formatScreenshot` (L18-20): `Screenshot captured (<format>, <bytes>)`; bytes via `formatBase64PayloadByteCount`.
- `formatTabList` (L22-24) delegates to `formatTabListWithProfiles(result,false)`.
- `formatTabListWithProfiles` (L26-40): empty `tabs` -> `No browser tabs open.`; per row `* ` if `t.active` else two spaces; `[<index>] <browserPageId>  <title> — <url>`; profile suffix `[<profileLabel ?? profileId ?? 'Unknown'>]` only when `showProfile`.
- `formatBrowserProfileList` (L42-54): empty -> `No browser profiles found.`; `* ` when `scope==='default'`; `source:<source?.browserFamily ?? 'none'>`; `ua:native` suffix only when `userAgentMode==='native'`.
- `formatTabShow` (L56-66): for both `BrowserTabShowResult` and `BrowserTabCurrentResult`; `worktree: <worktreeId ?? 'unknown'>`, `profile: <profileLabel ?? profileId ?? 'unknown'>`.
- `formatTabProfileShow` (L68-75): `profileId: <profileId ?? 'default'>`, `profile: <profileLabel ?? profileId ?? 'default'>`.
- `formatTabProfileClone` (L77-79): `Cloned <sourceBrowserPageId> to <browserPageId> (<profileLabel ?? profileId ?? 'default'>)`.
- Null/absent fallback obligations to keep as distinct contracts: `Unknown`, `unknown`, `default`, `none`, `native`. No test pins any of them.

### 1.2 `computer-format.ts` — expanded branch contract + local effects

Pretty output helpers:
- `formatGetAppState` (L23-55): bundle suffix `, <bundleId>` if set; `Focused: none` vs `#<id>`; `Window: id:<id>`/`index:<index>` only when the value is not `null`/`undefined`; `@ x,y` only when **both** x and y present; `Truncated: yes (max nodes <n>, max depth <d>)` vs `no`; screenshot line via `formatComputerScreenshotStatus`; trailing tree text.
- `formatComputerScreenshotStatus` (L284-308): `captured`+screenshot -> `Screenshot captured (<format>, <bytes|saved to path>, WxH[, scale ...][, engine])`; scale text only when `Number.isFinite>0 && !==1`; `skipped` -> `Screenshot skipped (--no-screenshot)`; `failed` -> `Screenshot failed (<code>): <message>`; else `Screenshot was not captured`. `formatComputerScreenshotScale` (L310-314) trims trailing zeros/`0.500`->`0.5`.
- `formatComputerAction` (L202-217): outcome `attempted` unless `verification.state === 'verified'`; `via <path>` only when `action?.path`; `; <n> visible elements...`; screenshot failure sentence only when `screenshotStatus.state==='failed'`; two distinct inspect tails for unverified vs verified; `formatActionVerb` title-cases dashed verbs (L316-321).
- `formatActionVerification` (L263-275): no action -> `, unverified (verification metadata unavailable)`; action without verification -> per-path reason from `UNVERIFIED_ACTION_REASONS` (`accessibility`->`accessibility action unasserted`, `clipboard`->`clipboard paste`, `synthetic`->`synthetic input`); verified -> `, verified <property>`; else `, unverified (<reason with '_'->' ')>`.
- `formatComputerFollowUpCommand` (L219-255): builds `orca computer get-app-state --app <quoted bundleId ?? name>`; `--session` xor `--worktree`; window handling drops requested id/index when `window_changed`; falls back to `action.targetWindowId/Index` then snapshot window id/index; `--restore-window` when target requests.
- `formatListApps` (L157-167): empty -> `No apps found.`; `bundleId` two-space suffix when set.
- `formatListWindows` (L169-192): empty -> `No windows found for <app.name>.`; window id `none` when null/undefined; origin only when x and y; `screen:<i>` only when present; state tags ` minimized,offscreen` filtered; `[<index>] id:<id> "..." (WxH[@ x,y])[ screen:..][ minimized][,offscreen]`.

JSON/`prepareComputerCliJsonResult` (L57-98) and local screenshot-file effects (L100-155):
- Runs only under `--json` (see `printResult`, section 3). Conditions: `result` present **and** `'screenshotStatus' in result` **and** `screenshot.data` is a non-empty string; otherwise passes the response through **unchanged**.
- On success: extension `png` or `img`; `outputDir = ORCA_COMPUTER_SCREENSHOT_TMPDIR || tmpdir()/orca-computer-use`; `mkdirSync(recursive, 0o700)`; rejects symlink/non-directory (`Unsafe computer screenshot temp path`), non-owner when `process.getuid` exists; `chmodSync 0o700`; then `cleanupComputerScreenshots`; writes `join(dir, safeStem(id)+'-screenshot.'+ext)` with mode 0o600; replaces `screenshot` with `{...screenshot, data: undefined, path, dataOmitted: true, expiresAt: now+TTL}`.
- `cleanupComputerScreenshots` (L119-151): returns early when `.last-cleanup` mtime is <60 min old; deletes `*-screenshot.png|img` files with mtime older than 24h; writes `.last-cleanup` `now\n` mode 0o600. **Every fs op is in a try/catch that fails open** (returns the original response). Any throw in the whole block returns the response unchanged (L93-97).
- `safeCliFileStem` (L153-155): `[^a-zA-Z0-9._-]` -> `_`.

### 1.3 `linear-format.ts` — expanded branch contract

- `formatLinearIssue` (L27-69): `State/Assignee/Project` fallbacks `unknown`/`unassigned`/`none`; `Priority` via `linearPriorityLabel`; `Estimate: <v ?? 'none'>`; `Labels:` line only when non-empty, filter(Boolean) joins; `Due:` only when dueDate; `Comments/Children/Attachments/Relations/Activity: <returned>` only when its section present; `Inline media: <n> (use --json for URLs)` only when `inlineMedia?.length`.
- `formatLinearSearch`/`formatLinearIssueList`/`formatLinearMcpIssueList` (L71-80, L119-139): empty -> `No Linear issues found.`; row via `formatSearchRow` (L247-251: `identifier.padEnd(10) state.padEnd(14) assignee.padEnd(18) title`); `appendLinearListTruncation` with `truncated ?? meta.limitReached` / `truncated ?? meta.hasMore`.
- Team tables (L82-117): `padEnd` widths 10/24/24; workspace suffix only when `team.workspace`; empty -> `No Linear ... found for <team.key>.`; `member.id ?? ''`, `state.type ?? ''`.
- `formatLinearStatusSet`/`CommentAdd`/`Attach`/`Create`/`SaveIssue`/`TaskUpdate`/`RelationWrite` (L160-202): suffix phrase `(already set|already posted|already attached|already created|already present|already absent)` from `meta.alreadyInState|deduplicated|alreadySet`; parent `under <parent.identifier>`, project `in <project.name>` (truthy-only), verb `Added/Removed` from `operation`.
- Warnings to **stderr** (`console.error`): `printLinearMcpIssueListWarnings` (L141-154: hasMore hint `; continue with --workspace <id>` only when `nextCursor && workspaceId && workspaceId!=='all'`), `printLinearIssueWarnings` (L204-213 includeErrors + section cap lines `capped at <returned>/<cap>`), `printLinearSearchWarnings` (L215-224 limitReached + workspaceErrors), `printLinearListWarnings` (L226-239, `hasMore`/`limitReached`/`workspaceErrors`), `printLinearProjectListWarnings` (L241-245 delegates to `linearProjectListWarningLines`).
- `formatLinearProjectList` (L156-158) delegates to `formatLinearProjectListRows`.

### 1.4 `automation-format.ts` — expanded branch contract

- Guarded empty lists: `formatAutomationList` empty -> `No automations found.`; `formatAutomationRuns` empty -> `No automation runs found.`.
- `formatAutomationList` (L47-60): 2-blank-line row join; `status = enabled|disabled`; per-row `host:` block only when authority `items` has a matching `automationId`; schedule via `formatAutomationSchedule(automation.rrule)`; `next: <new Date(nextRunAt).toISOString()>`.
- `formatOwnersSelector`/`formatListItemSelector` (L32-45): `ssh:<targetId> (generation <n>)`; orphan -> label / `orphan — <issue>`; else `self`.
- `formatAutomationShow` (L62-100): `runContext` present -> six run lines incl `legacyRepoId: <getAutomationLegacyRepoId(automation)>`; absent -> only legacy line. `precheck:` -> `command (timeout <Ns>)` when present else `none`; `workspaceId/baseBranch` `null` when null; `target: <type>:<id>`; `host:` line only when `result.owner`; prompt last. Documented intent (header comment L1-9): host lines come from the authority's projection, not stored `executionTarget*` fields.
- `formatAutomationRemoved` (L102-106): `Removed automation <id>.` / `Automation <id> not removed.`
- `formatAutomationRun` (L108-120) + `formatAutomationRunPrecheck` (L122-134): `precheck: none` when no `precheckResult`; else outcome `timed out` / `error` / `exit <code ?? 'unknown'>`; appends `; <output>` only when `(stderr.trim()||stdout.trim())` is non-empty (stderr wins); `workspaceId/error` `null` handling.
- `formatAutomationRuns` (L136-146): row = `id  automationId  status  trigger  <iso>\n<title>[precheck: ...][error: ...]`.

### 1.5 `project-format.ts` — expanded branch contract (no original assertions exist)

- `formatProjectList` (L10-22): empty -> `No projects found.`; identity `provider:owner/repo` when `providerIdentity`, else `no-provider`.
- `formatProjectHostSetupList` (L24-34): empty -> `No project host setups found.`; row `id  project:<projectId>  host:<hostId>  <setupState>  <path>`.
- Result fields (L65-79) always emit `projectId/project/setupId/hostId/path/state/method/repoId`; `repoId: none` when repo id absent. Create passes `undefined` (never a repo); Update/Delete pass `repo?.id` (may be `none`).
- `formatProjectHostSetupDeleteResult` (L55-63): prepends `deleted: <setup.id>`.

### 1.6 `worker-output.ts` — expanded branch contract

- `formatWorkerRead` (L10-17): `!('source' in value) || value.source === 'terminal'` -> `value.terminal.tail.join('\n')` (preserves empty lines); else transcript -> `messages.map(formatWorkerTranscriptMessage).join('\n\n')`.
- `formatWorkerTranscriptMessage` (L19-33): text passthrough; `tool-call` -> `[tool <name>] <safeJson(input)>`; `tool-result` -> `[tool result[ error]] <output>`; any other block -> `[image] <url>` when `url` else `[image omitted]`; final `[<role>] <joined>`.trimEnd().
- `formatWorkerRelease` (L45-60): `Worker <dispatchId> terminal [<state>][ reason=<reason>] process=<processAction>`; `archive <source ?? 'none'> [<status ?? 'unknown'>]` only when archive truthy; `lastError`/`recovery` lines only when set.
- `safeJson` (L62-67): `JSON.stringify` with catch -> `[unserializable input]`.

### 1.7 `orchestration-check-output.ts` — expanded branch contract

- `isLegacyReadOnlyMessage` (L52-61): legacy when `run_id === 'run_legacy_local'` OR (`delivery_contract==='legacy_direct' && !active`) OR `delivery_contract==='audit_only'`.
- `formatMessageReadOnlyTag` (L45-50): ` [legacy, read-only]` when legacy else `''`.
- `prepareOrchestrationCheckOutput` (L111-129): returns result **unchanged** when `!formattedRequested` or no message is legacy (with active flag); else sets `formatted: formatLegacyAwareCheckMessages(...)`.
- `formatOrchestrationCheckText` (L63-109): computes `compatibilityActive = legacyCompatibility && !readOnly`; header `[LEGACY READ-ONLY]` / `[LEGACY RECOVERY REPLAY — MAY HAVE BEEN SEEN]` / `[LEGACY COMPATIBILITY]` when legacyCompatibility present; reuses `prepared.formatted` when already present; zero-count branches `Wait timed out; no messages were consumed.` / `Wait cancelled[ because the connection closed]; ...` / `No messages.`; row line `id[tag] [<type ?? 'status'>] from=<from> "<subject>"`; `Delivery <deliveryId>` prefix; `formatCurrentDeliveryNotice` suffix (`[CURRENT RUN MAIL WAITING]` + read/ack command lines) only when `currentDelivery`.
- `formatLegacyAwareCheckMessages` (L154-186): per message id+tag+priority tag, subject quoted field (control-char escaped, indented), inspection-only line when legacy, body/payload quoted fields when truthy, reply target `to_handle ?? checkedTerminal` with `--from` omitted when target starts with `run:`/`dispatch:`.
- `escapeTerminalControlCharacters` (L135-145): keeps `\n` and printable ASCII and `>0x9f`; others -> `\xHH`.
- `formatMessagePriorityTag` (L131-133): `urgent` -> ` [URGENT]`, `high` -> ` [HIGH]`, else `''`.

## 2. Original assertion bodies read (exact ranges + what they assert)

### 2.1 `src/cli/format.test.ts` — sha `08051f144d39aa4c0a56fe2fba3952b256f4b6943026453c0ea7454b3a7a6700`, 23 cases, executed false (not yet run)
Covers the output path shared by several formatters plus computer effects:
- L65-152 `formatCliError`/`reportCliError`: structured `nextSteps` recovery lines on **stdout** (`reportCliError` JSON) vs **stderr** (`formatCliError` text); `RuntimeRpcFailureError` preserves `nextCommandArgs`; non-string nextStep filtered; generic computer fallback.
- L154-177 `formatWorktreeList` (workspace-format, not in the seven) — noted for context only.
- L179-230 `formatAutomationShow`: runContext six-field output + `legacyRepoId`; asserts `not.toContain('projectId: repo-legacy')` (projectId must never show).
- L232-359 `formatTerminalList`, L361-444 `formatTerminalRead` (terminal-format, not in the seven) — context only.
- L446-691 `formatComputerAction` (9 cases): routed worktree + target window in follow-up command; explicit window-index preserved; failed-screenshot sentence; clipboard unverified without verification metadata; verified synthetic type-text (`Type Text completed via synthetic, verified focusedText`); window-changed drops stale requested selectors; snapshot window index fallback; action target window index precedence.
- L693-858 `printResult` + `prepareComputerCliJsonResult` effects: captured screenshot dims/scale line; **expired temp file removed + `.last-cleanup` created**; **fresh `.last-cleanup` marker skips cleanup** and JSON shows `dataOmitted:true`,`path:.../req_1-screenshot.png`; **temp export failure keeps inline data** (no path/dataOmitted keys); **non-computer nested screenshot payload untouched**.

### 2.2 `src/cli/computer-format.test.ts` — sha `8961f05977a66ad87daf510052a529bef84e87e474d1652f06bcecc7cc300212`, 2 cases
L5-56: `formatComputerAction` with **no** `action` -> `Click attempted, unverified (verification metadata unavailable)` + `Inspect with the command above` + `not.toContain('Click completed')`; with `action.path==='accessibility'` (no verification) -> `Click attempted via accessibility, unverified (accessibility action unasserted)`.

### 2.3 `src/cli/linear-format.test.ts` — sha `5037e1db59792332e2c9f97e36754e7488905f977c3a6f03b6e6f6ed12274d9e`, 7 cases (source-tests.json says 7)
L18-194:
- printLinearSearchWarnings: empty `workspaceErrors`/no limit -> no console.error.
- printLinearMcpIssueListWarnings: exact `warning: more results available; next cursor: next-page; continue with --workspace workspace-1`.
- formatLinearMcpIssueList partial: contains `ENG-1` and `truncated: showing 1`, never ` of `.
- formatLinearMcpIssueList complete: contains `ENG-1`, never `truncated:`.
- formatLinearIssue: `Priority: high` (priority 2), `Estimate: 5`, `Due: 2026-06-30`.
- formatLinearProjectList: contains launch name, project id, team key `ENG`, team-with-empty-key falls back to team name `Product`, workspace `Acme`.
- formatLinearCreate: exact `Created ENG-123 in Launch: Follow up.` (project present, no parent, dedup false).

### 2.4 `src/cli/automation-format.test.ts` — sha `7a23802e9b010d5ad1676863663f134fec2968d3cdaacadac8417cfc5855bbfc`, 6 cases (source-tests.json says 6)
L38-109:
- formatAutomationShow ssh owner: live vs replaced incarnation -> distinct generation text; `host: ssh:box-1 (generation 4|9)`.
- orphan owner -> `host: orphan (no host can run this automation)` while stored `target: ssh:box-1` stays.
- self owner -> `host: self`.
- no owner -> **no `host:` at all**, `target: ssh:box-1` still present.
- formatAutomationList with items: `host: ssh:box-1 (generation 4)` and `host: orphan — <AUTOMATION_ORPHAN_ISSUES.targetMissing>`.
- formatAutomationList without items: no `host:` substring.

### 2.5 `src/cli/handlers/orchestration-module-boundaries.test.ts` — sha `457be69f8a81098e45ad565a02e5ccc75831c095ac59c8fa6730abb2853fbf8e`, 8 cases (worker-output portion)
L46-101:
- `formatWorkerRead` terminal → `first\n\nthird` (empty line preserved; cast via `as never`, shape is a `LegacyWorkerReadResult`).
- `formatWorkerRead` transcript → `[assistant] working\n[tool inspect] [unserializable input]\n[tool result error] failed\n[image] https://example.test/proof.png` (circular tool input; tool-result isError tag; image-url block).
- `formatWorkerRelease` full receipt → exact ordered lines incl `archive transcript [saved]`, lastError, recovery.

### 2.6 `src/shared/orchestration-check-output.test.ts` — sha `51b6c06cc807b41d63920a1ae237ab33a673adff2814b8ee9df28f41091b47b2`, 1 case
L4-41 `prepareOrchestrationCheckOutput` (formattedRequested true): current-run `to_handle: run:run_adopted` reply line has no `--from run:...`; legacy (`audit_only`) mail gets `[Inspection only: reply and acknowledgment are unavailable.]`; pre-supplied stale `formatted` is replaced (assert `not.toContain('unsafe stale formatter output')`).

### 2.7 Direct helper assertion bodies
- `src/shared/computer-use-error-recovery.test.ts` — sha `3e8a81b8b1b13cec06c7f60fafe67a63727346bc2f718a6ba46e7a8589412df4`; key assertions recorded in section 2.9.
- `src/cli/format.ts` — sha `a4ba264d88340fc580c35c691f7f04ffdc7a72e1a3095432340aa49745d9fe43`; assertion coverage via `format.test.ts` L65-152 (recorded in section 2.1) plus inherited `index-local-command-routing-flags.test.ts` host rows/meta. Conflict-recovery path through `formatCliError` is **not** CLI-layer asserted.
- `src/shared/automation-schedules.test.ts` — sha `573a3392f0c9a8423d9fdde33a23fb4d87ae1e9d86bf9e4759590572f3ddcb72`, 23 cases. Relevant to `formatAutomationSchedule`/`classifyAutomationCronSchedule`/`describeAutomationSchedule`: invalid fallback `Invalid schedule` (L109), `Hourly at :05` (L113, L194), daily/weekdays/weekly labels via locale-aware `formatTimeForTest` (L155-160, L195-200), English-only weekday names regardless of OS + no `weekday` option requested from `Intl.DateTimeFormat` (L146-163), custom labels (L238-243), DOM/DOW unrestricted handling, no-possible-run -> `Invalid schedule` (L261-264), leap-day custom cron (L272-279). Uses `formatTimeForTest` (local copy of the same `Intl` call) so goldens are region-normalized, not fixed strings — hidden assumption documented in section 4.
- `src/cli/base64-payload-byte-count.test.ts` — sha `8735ecf9ce0c147f2c29f6db7d9317751156b25195045ba85dc96c3bbdbdbd9e`, 1 case: `formatBase64PayloadByteCount(Buffer.from('png-data').toString('base64')) === '8 bytes'`.
- `src/cli/shell-command-quote.test.ts` — sha `baf4756c1bd68033ffc3492b6444a78827398b993f7883c13f903d8963cf20f1`, 2 cases: simple selector unquoted; `Text Editor` -> `'Text Editor'` (darwin) and `"Text Editor"` (win32).
- `src/shared/automation-run-identity.test.ts` — sha `d8ab1bab4508c205335ce6ca3dc048cb7e2411f1149a2f1c1ba75e14631127bd`, 2 cases: `getAutomationLegacyRepoId(value)==='legacy-repo'` in both runContext-present and absent cases; run repo/project id precedence also asserted.
- `src/shared/computer-use-error-recovery.test.ts` — sha `3e8a81b8b1b13cec06c7f60fafe67a63727346bc2f718a6ba46e7a8589412df4`, 6 cases: (L6-12) every `COMPUTER_ERROR_CODES` value returns recovery `nextSteps` containing a string; (L14-22) `screenshot_failed` steps contain `--no-screenshot`, `--id screenshots`, `payload cap`; (L24-31) `permission_denied` steps contain `--id accessibility` and `graphical desktop session`; (L33-41) `window_not_found` steps contain `list-windows`, `--restore-window`, `does not launch closed desktop apps`; (L43-54) `window_not_focused` with the delivered-press message switches to state-verification steps and **excludes** `Retry once with --restore-window`; (L56-66) `app_not_found` web-app variant contains `list-apps`, `desktop browser app/window`, `--app <web app>`, `list-windows --app <browser>` and **excludes** `orca goto`.

### 2.9 Common wrapper consortium summary (`format.ts` + conflict/recovery helpers)

- `format.test.ts` L65-152 is the sole CLI-layer assertion on `formatCliError`/`reportCliError`: structured nextSteps rendering, non-string step filtering, migration-recovery JSON `data.nextCommandArgs` preservation, and the JSON failure envelope written via `console.log`. It does **not** exercise the automation-owner-conflict branch, `RuntimeClientError` runtime_unavailable precedence, or the computer `invalid_argument` generic fallback through `formatCliError` (those are asserted elsewhere only at runtime/main-side in `src/main/runtime/rpc/errors.test.ts`, `src/main/automations/external-manager-scoped.test.ts`, `external-automation-owner-guard.test.ts` — outside this CLI leaf's read set).
- `computerUseErrorRecoveryData`: fully covered by `computer-use-error-recovery.test.ts` (every declared code + targeted variants); `default -> undefined` is not explicitly asserted but is implied by the exhaustive-code loop only if `COMPUTER_ERROR_CODES` matches the switch — treat code-set parity as a fixture obligation.
- `matchAutomationOwnerConflict`/`stripAutomationOwnerConflictCode`/`automationOwnerConflictRecovery`: no CLI/format-layer test read; only main/runtime-layer usages exist (see above). The `formatCliError` conflict-priority branch is an unasserted CLI obligation.

## 3. stdout/stderr/JSON / local-file effect matrix

- `printResult` (`src/cli/format.ts` L41-50): `json` -> `console.log(JSON.stringify(prepareComputerCliJsonResult(response), null, 2))`; else `console.log(formatter(response.result))`. **stdout** in both modes; **JSON mode re-runs the computer screenshot temp-export transform** for the whole response. Non-computer payloads pass through untouched.
- `reportCliError` (L92-129): `json` -> `console.log` of failure envelope (origin preserved/rebuilt); else `console.error(formatCliError(...))` (**stderr**).
- Warnings all **stderr** via `console.error`: `printLinearIssueWarnings`, `printLinearSearchWarnings`, `printLinearListWarnings`, `printLinearMcpIssueListWarnings`, `printLinearProjectListWarnings`.
- `browser-format`, `project-format`, `linear-format` (non-warning), `automation-format`, `worker-output` return strings; handlers route them through `printResult` so text lands on stdout (handler call sites: browser-nav.ts L32/L41, browser-tab.ts L33-44, browser-profile.ts L34/L88/L105, computer.ts L39-211, project.ts L96-214, automations.ts L164-247, worker-terminal-handlers.ts L65/L78, worker-observation-handlers.ts L59).
- `orchestration-check-output`: `message-check-handler.ts` L71 calls `prepareOrchestrationCheckOutput(result.result, terminal, flags.has('format'))` then L73 `formatOrchestrationCheckText` through `printResult` (stdout); `message-inbox-handlers.ts` L48 uses `formatMessageReadOnlyTag` inline (stdout head line).
- Local screenshot-file effects only where documented in 1.2 (JSON mode; temp dir under `ORCA_COMPUTER_SCREENSHOT_TMPDIR` or `os.tmpdir()/orca-computer-use`; 0600 files; 24h TTL cleanup; `.last-cleanup` marker; fails open on every fs error). **No other formatter writes files.**

## 4. Hidden assumptions and partial reads (honest)

1. `formatAutomationSchedule` time labels depend on `Intl.DateTimeFormat(undefined, {hour:'numeric', minute:'2-digit'})` (automation-schedules.ts L42-49), i.e. the process locale/region — golden fixtures are exactly that: golden-then, region-sensitive. Original tests normalize with an identical local helper.
2. `formatBase64PayloadByteCount` fallback branch (catch) is only reachable if `Buffer.byteLength(base64,'base64')` throws, which it does not in a normal Node/Buffer build; treat it as a practically-dead branch, not an exercised contract.
3. `quoteCliCommandArgument` win32 path escapes `"` as `\"`; posix path wraps in single quotes and escapes `'` as `'\''`. Only the space case is asserted for quoting; embedded-quote behavior is unasserted.
4. `browser-format`/`project-format` have **no** assertion coverage anywhere in the suite; the empty/absent fallback strings and `no-provider`/`none`/`Unknown`/`default` inputs are fixture obligations, not proven behaviors.
5. `formatAutomationPrecheckTimeout` and the `precheck:` ternary branch of `formatAutomationShow` are unasserted (all fixtures use `precheck: null`); `formatAutomationRun`/`formatAutomationRuns` and the `formatAutomationRunPrecheck` tree (`timed out`/`error`/`exit unknown`/stderr-vs-stdout output selection) are also unasserted.
6. `formatWorkerRelease`/`formatWorkerRead` partial variants (no reason, null archive, `[image omitted]`, empty transcript) are unasserted; only the full receipt and one terminal/one transcript path are asserted.
7. `orchestration-check-output` assertions cover only `prepareOrchestrationCheckOutput`; `formatOrchestrationCheckText` (legacy headers, timeout/cancelled/zero-count/`Delivery` prefix/delivery notice/priority tags/control-char escaping/`--from` run+dispatch suppression) is unasserted in the unit suite except indirectly through that one test.
8. Handler-level integration of these formatters through `printResult` is only exercised in `format.test.ts` for computer (`prepareComputerCliJsonResult`), plus the two orchestration module-boundary cases; the linear warnings handlers and `message-check-handler` are not covered by the read assertion bodies.
9. `formatCliError` precedence branches beyond structured nextSteps (automation-owner-conflict, `RuntimeClientError` runtime_unavailable, computer `invalid_argument` fallback, `RuntimeRpcFailureError` runtime_unavailable) have no CLI-layer assertion in the read set; only main/runtime-layer tests exercise the conflict classifier.
10. Partial reads: none within the seven bodies/helpers (all full-file); `automation-schedule-parsing.ts`, `automation-cron-occurrence.ts`, `runtime-rpc-error-code.ts` were read as transitive reachable helpers (not "directly imported" by the named files); artifact/terminal/workspace format bodies are excluded by this leaf's file whitelist; `COMPUTER_ERROR_CODES` parity with the recovery switch should be verified at port time.

## 5. Fixture obligations for port tests (exact inputs to build)

Enumeration for behavioral RED/GREEN later; nothing was executed here.
- browser: empty tabs/profiles; active default profile; profileLabel/id/‘Unknown’ matrix; showProfile true/false; focused profile show/clone; screenshot with png data.
- computer: no-action result; accessibility/clipboard/synthetic without verification; verified synthetic property; window_changed; snapshot id vs index fallbacks; screenshot scale 0.5/integral/absent; failed screenshot code/message; JSON screenshots forcing temp export, fresh-marker skip, blocked-tmpdir fails-open, non-computer nested payload passthrough; unsafe-tmpdir rejection.
- linear: issue with all section counts, labels empty/non-empty, inlineMedia; search truncated both ways; team lists empty/members/states/labels; status/comment/attach/task-update/relation dedup + already-state suffixes, dedup false; create with/without parent/project; save-issue created vs updated; warning funcs with workspaceErrors.
- automation: show with runContext + precheck (command/timeout), no runContext, owner none; list with/without items; removed true/false; run with precheckResult none/timedOut/error/exit/empty-output; runs empty/one/multi.
- project: empty lists; providerIdentity present/absent; create (repo none) vs update vs delete (repo present/absent).
- worker-output: terminal tail with empty lines; transcript with text/tool-call circular/tool-result error/image-ref; image without url; release with/without reason/archive/lastError/recovery.
- check-output: formattedRequested true/false; legacy run_id/legacy_direct/audit_only; active-readOnly/recovery/currentDelivery; timedOut/cancelled/connectionLost/count 0; deliveryId; urgent/high priority; body/payload fields; to_handle run:/dispatch:/term_; control chars embedded.
- common wrapper: `formatCliError` precedence chain (automation-owner-conflict via flattened `runtime_error` message tail, `RuntimeClientError` runtime_unavailable, computer invalid_argument, `RuntimeRpcFailureError`); `reportCliError` JSON envelope id `local`/code priority; `formatHostList` rows; `formatCliStatus` env-target prefix; conflict `targetRemoved` no-retry wording; `hasRuntimeRpcErrorCode` token-boundary `: `/newline cases and cycle-safe cause walk.

## 6. S5 candidate vs S1 / S2-S4

- **S5 candidate (this leaf only)**: formatter branch contracts + common wrapper (`format.ts`) + cross-checked original assertions for the seven named files, their direct helpers and the directly-called conflict/recovery helpers, as enumerated above. Proposed disposition for the formatter/result boundary evidence: `ready_for_review` (evidence complete for this whitelist) but the E4-S5 obligation row stays **open** until the lead folds artifact-format/terminal/workspace formatters and root accepts.
- **S1**: still **not accepted** (204-row normalized per-command field contracts, `closure.json` L859-1078). This leaf does not touch it.
- **S2-S4**: lead scope (shared validators, transport/version-skew compatibility, local-effect boundaries). This leaf lists no validation read; the local screenshot-file effect is documented as a computer-formatter effect but the filesystem/keychain boundaries are not re-audited here.

## 7. Confirmations for the coordinator

- All seven formatter hashes at the pinned revision equal `closure.json` E4-S5 `sourceEvidence` hashes (verified by `shasum -a 256`).
- `source-tests.json` lists all eleven assertion files above (`bodyRead: false`→now full-body-read by this leaf; `executed: false` preserved). Case counts reconcile: format 23, computer-format 2, linear-format 7, automation-format 6, orchestration-module-boundaries 8, orchestration-check-output 1, automation-schedules 23, base64 1, shell-command-quote 2, automation-run-identity 2, computer-use-error-recovery 6. (`format.ts`, conflict/recovery helpers and all formatter sources are additional full-body reads, not test files.)
- Coordinator `msg_d0a3520de5d4` scope honored: `src/cli/format.ts` (`printResult`/`reportCliError`/`formatCliError`) + directly called `computer-use-error-recovery.ts`, `automation-owner-conflict.ts`, `automation-owner-conflict-recovery.ts` (and its transitive `runtime-rpc-error-code.ts`) read; terminal/workspace formatters referenced only.
- No product edits, installs, Git mutations, runtime/config/account effects, or test executions were performed for this audit leaf. Only `docs/migration/audit-closure/e4-cli/leaf/s5-formatter-assertions.md` and `.json` were written.