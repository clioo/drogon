# E3 follow-up: Bots and Mentu registration semantics

Candidate **ready for root review for this bounded 21-registration source characterization**. The overall E3 gate remains **open**. This follow-up covers all7 Bots and14 Mentu callbacks; it does not close the other Skills/66-callback, RPC/consumer or legacy-producer obligations.

Source HEAD was verified at `c97906287bb7a390b25e2025b600d9fb3c25d9c3`; the original checkout was read only. Fresh task `task_daca631a3149`, Dispatch `ctx_a6552b9aa67f`. Work stayed direct, with no children or implementation transition. The prior six candidate files are preserved, with their hashes in the new JSON.

The companion [followup-bots-mentu.json](./followup-bots-mentu.json) is the detailed contract record: **21 callbacks,76 structural schemas,18 shared semantic rules,66 assertion groups and78 source-file hashes**. `?` distinguishes omission from explicit `null`; imported Bot, Automation, run evidence, recipe, host, profile and approval structures are expanded in its schema registry. Types describe intended shapes; only the separately identified validators establish runtime checks. Assertion groups can span multiple cases or table rows and are not a pass count.

Audit acceptance remains approximately60%, inherited7/12 accepted groups, medium-low confidence and no increase from this report. Test migration and product fidelity receive no new passing claim. The next milestone is root review of this complete bounded mapping; the flexible24-hour target cannot be estimated reliably from the still-unexecuted platform and native-runner obligations.

## Findings that affect parity

- **D1:** IPC null-only explicit models and rejected responsibility.recipe differ from shared persisted model/link contracts and fixture assertions. Source discrepancy; root must preserve intended capabilities or explicitly accept source restriction, never infer parity from type alone. [src/main/bots/bot-service.ts:54](/Users/carlos/Documents/Drogon-mentu-session/src/main/bots/bot-service.ts:54)

- **D2:** Bot mutation returns can succeed after failed/frozen/quit-suppressed disk flush. Source defect for durable-ack intent; helper flush calls are not durability evidence. [src/main/persistence/loading-store/bot-persistence.ts:45](/Users/carlos/Documents/Drogon-mentu-session/src/main/persistence/loading-store/bot-persistence.ts:45)

- **D3:** Requested timezone not consumed by local occurrence computation; precheck max86400 input becomes600; responsibility create is non-atomic two-write compensation. Characterize source; scheduling zone/atomicity acknowledgment needs acceptance decision. [src/main/bots/bot-service.ts:54](/Users/carlos/Documents/Drogon-mentu-session/src/main/bots/bot-service.ts:54)

- **D4:** Manual run checks responsibility enabled, not automation enabled; same-millisecond run identity can dedup while dispatch repeats; history can fail after launch. Race/policy characterization remains explicit execution acceptance, not fabricated prevention. [src/main/automations/service.ts:131](/Users/carlos/Documents/Drogon-mentu-session/src/main/automations/service.ts:131)

- **D5:** Unknown fields merge by array index; nested verify predicate unknowns can be replaced; source size/realpath checks leave races. Editing preservation/safety intent needs targeted tests and possible source correction. [src/main/mentu/mentu-recipe-files.ts:44](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-recipe-files.ts:44)

- **D6:** Recovery binding omits state/outcomes/attempts/vars/events; missing recipe_ref accepted; foreign optional state can satisfy retry label. Partial binding is source fact; full recovery ownership and mutation resistance unproved. [src/main/mentu/mentu-session-recovery.ts:16](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-session-recovery.ts:16)

- **D7:** Run file status creates live/exited observation, optional event/state identities not checked; duplicate output labels overwrite; aggregate quarantine cap silent. Do not migrate these as proof of liveness or complete evidence; require explicit fidelity/safety decision. [src/main/mentu/mentu-run-evidence.ts:60](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-run-evidence.ts:60)

- **D8:** Mentu boundary annotations provide no comprehensive request validation; unknown intent/types can reach deeper code, error-envelope consistency not guaranteed. Full schema and malformed-request acceptance required; source enumeration does not validate runtime payloads. [src/main/ipc/bots.ts:14](/Users/carlos/Documents/Drogon-mentu-session/src/main/ipc/bots.ts:14)

- **D9:** Loose busy text can override other status; cancelled revalidation catch may omit cancelled admission; prelaunch input/executable identity races remain. Add exact precedence, cancellation and TOCTOU tests; no claim native admission protocol proven. [src/main/mentu/mentu-session-launch.ts:30](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-session-launch.ts:30)

- **D10:** Capability advertises operations while legacy calls refuse and admitted execution only supports local darwin-arm64 pinned identity; remote/WSL admission unavailable. Known source capability gap; platform engine/forwarding debt stays separate from21-registration enumeration. [src/main/mentu/mentu-host-route.ts:52](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-host-route.ts:52)


These are source characterizations and explicit parity decisions, not implemented fixes. In particular, a stored running record is not process observation; a flush call is not durable acknowledgment; a mocked resume argv assertion is not a completed recovery; and prose in a Bot prompt is not enforced coordination policy.

## Callback contract map

Schema names below resolve to the full structural registry in the JSON. Every callback includes its own missing acceptance conditions there. All have the common trust/error boundary in AUTH; result schemas are not validated by the IPC wrappers.

| Callback | Positional input → result | Observed downstream behavior | Existing assertion groups |
| --- | --- | --- | --- |
| bots:list | `[]` → `BotSnapshot` | Returns sorted bots and per-bot history joins; history grouped in bot-name order, each group descending startedAt; missing linked entities are null. Available harnesses [] because registration provides no snapshot argument. Deleted bots' retained history is not in snapshot. [src/main/ipc/bots.ts:27](/Users/carlos/Documents/Drogon-mentu-session/src/main/ipc/bots.ts:27) | B-history, B-history-normalize |
| bots:create | `[BotCreateWire]` → `Bot` | Server generates UUID and timestamps, starts with no responsibilities/session, normalizes identity and writes state before best-effort flush. [src/main/ipc/bots.ts:28](/Users/carlos/Documents/Drogon-mentu-session/src/main/ipc/bots.ts:28) | B-schema-create, B-schema-reject, B-rotate, B-disk, B-type-policy |
| bots:update | `[{id:Id,updates:BotUpdateWire}]` → `Bot` | Merges selected updates, preserves id and createdAt, replaces updatedAt; nested identity/policy are whole required nested objects. Empty update allowed. Explicit undefined optional values survive Zod object parsing and normalization can reset/default fields; do not assume patch omission equivalence. [src/main/ipc/bots.ts:31](/Users/carlos/Documents/Drogon-mentu-session/src/main/ipc/bots.ts:31) | B-type-policy |
| bots:delete | `[Id]` → `{removed:boolean,id:string}` | Absent bot returns removed:false; present returns true after removing bot and stripping automation.botId. Automations, automation runs and responsibility history remain; no cancellation/stop or automation disable here. [src/main/ipc/bots.ts:35](/Users/carlos/Documents/Drogon-mentu-session/src/main/ipc/bots.ts:35) | No relevant assertion identified |
| bots:rotateSession | `[{id:Id,session:BotRotateWire}]` → `Bot` | Replaces currentSession; keeps Bot identity/instructions/memory/responsibilities. First rotation rotatedAt:null, later Date.now; supplied startedAt retained. Records arbitrary supported session metadata, does not launch/verify a terminal. [src/main/ipc/bots.ts:38](/Users/carlos/Documents/Drogon-mentu-session/src/main/ipc/bots.ts:38) | B-rotate, B-schema-reject, B-session-helper |
| bots:createResponsibility | `[{botId:Id,input:ResponsibilityCreateWire}]` → `ResponsibilityCreated` | Reactive creates responsibility with trimmed event\|null and no automation or listener. Scheduled first creates owned automation, then appends Bot responsibility, and attempts deleteAutomation compensation only if Bot update throws. UUID responsibility, now timestamps, enabled defaults true, recipe null through IPC. [src/main/ipc/bots.ts:42](/Users/carlos/Documents/Drogon-mentu-session/src/main/ipc/bots.ts:42) | B-schema-responsibility, B-scheduled, B-global-delete, B-prompt-policy, B-link-helper |
| bots:runResponsibility | `[{botId:Id,responsibilityId:Id}]` → `ResponsibilityLaunched` | Scheduled runNow creates or retrieves a manual run, checks host/dispatch target and returns dispatching/dispatched/final refusal/failure row; caller records linked responsibility history. Writer can record history earlier; nonnull automationRunId dedup preserves first id/start and previously final endedAt. Response is dispatch acknowledgment, not completion; history hostObservation:null. [src/main/ipc/bots.ts:50](/Users/carlos/Documents/Drogon-mentu-session/src/main/ipc/bots.ts:50) | B-reactive, B-writer, B-finish, B-dedup, B-dispatch-context, A-manual, A-missing-setup, A-stale-path, A-runtime-refusal, A-headless, B-history-normalize, B-prompt-policy, B-link-helper |
| mentu:capability | `[Workspace?]` → `Capability` | Default absent target uses cwd. Probes application-owned executable --version then adapters --json (5s each); exposes raw adapter object with known fields selectively parsed. Non-object adapter entries filtered; missing name 'unknown'. No install; operations advertises legacy run/resume/retry despite bypass refusal. [src/main/ipc/mentu.ts:49](/Users/carlos/Documents/Drogon-mentu-session/src/main/ipc/mentu.ts:49) | M-capability, M-missing, M-startup, M-pin |
| mentu:listRecipes | `[Workspace]` → `Catalog` | Recursively reads sorted JSON files under canonical .mentu/recipes; invalid JSON retained as invalid entry/name:null; ENOENT root gives available empty list; external symlinks excluded. WSL uses host workspace filesystem. [src/main/ipc/mentu.ts:52](/Users/carlos/Documents/Drogon-mentu-session/src/main/ipc/mentu.ts:52) | M-discover |
| mentu:loadRecipe | `[RecipeReference]` → `RecipeLoad` | Requires existing canonical file inside workspace/.mentu/recipes; appends .json case-insensitively; returns exact source string, parsed fields, raw and unknown-field maps. WSL reads host path. [src/main/ipc/mentu.ts:55](/Users/carlos/Documents/Drogon-mentu-session/src/main/ipc/mentu.ts:55) | M-save, M-save-conflict, R-roundtrip, R-malformed, R-optional, R-dependencies, R-verify |
| mentu:saveRecipe | `[RecipeSaveRequest]` → `RecipeSave` | Validates limited top-level document shape, target path equality, serializes raw plus edited known fields, reparses, bounded 1MiB. Uses expectedSource comparison and guarded hardlink publication; reloads saved document. Conflict preserves concurrent target. No new recipe creation via missing reference. [src/main/ipc/mentu.ts:58](/Users/carlos/Documents/Drogon-mentu-session/src/main/ipc/mentu.ts:58) | M-save, M-save-conflict, M-save-malformed, R-roundtrip |
| mentu:check | `[RecipeReference]` → `CommandResult` | Runs check + canonical/routed recipe path, no --workspace, 30s/8MiB; passes AbortSignal only internal review use, no cancel token for standalone route. Exit0/not timeout successful, else failed; no stdout schema needed. [src/main/ipc/mentu.ts:61](/Users/carlos/Documents/Drogon-mentu-session/src/main/ipc/mentu.ts:61) | M-argv, M-check-failed, M-wsl |
| mentu:doctor | `[{recipe:string,workspace:Workspace,strict?:boolean}]` → `CommandResult` | Runs doctor path --format json plus --strict if truthy. Parsed report appended; error/fail findings fail, warning/warn warnings fail when strict else warning; non-successful process result retains precedence. [src/main/ipc/mentu.ts:62](/Users/carlos/Documents/Drogon-mentu-session/src/main/ipc/mentu.ts:62) | M-doctor, M-doctor-invalid, M-argv, REAL-doctor |
| mentu:run | `[RunRequest]` → `CommandResult` | Always returns legacy-bypass-refused without CLI execution, record mutation or new run ID; local invalid/live, nonlocal unavailable/unverifiable. Extra run overrides are ignored. [src/main/ipc/mentu.ts:63](/Users/carlos/Documents/Drogon-mentu-session/src/main/ipc/mentu.ts:63) | M-argv, M-direct |
| mentu:resume | `[RunReference]` → `CommandResult` | Always returns legacy-bypass-refused without CLI execution, record mutation or new run ID; local invalid/live, nonlocal unavailable/unverifiable. Extra run overrides are ignored. [src/main/ipc/mentu.ts:64](/Users/carlos/Documents/Drogon-mentu-session/src/main/ipc/mentu.ts:64) | M-argv |
| mentu:retryStep | `[RetryRequest]` → `CommandResult` | Valid step label still returns legacy-bypass-refused. Invalid step regex returns invalid with no admission, hostObservation live, null exit and explicit stderr. No process launch or run evidence read. [src/main/ipc/mentu.ts:65](/Users/carlos/Documents/Drogon-mentu-session/src/main/ipc/mentu.ts:65) | M-argv |
| mentu:readRun | `[RunReference]` → `RunRead` | Reads local run.json plus optional events/state/baseline/output/hooks/quarantine under safe canonical run root; no write. Run ID matching enforced only for primary run record. Outer typed raw objects retained; outputs map by label overwrites duplicate attempts. Host observation derives stored status. [src/main/ipc/mentu.ts:66](/Users/carlos/Documents/Drogon-mentu-session/src/main/ipc/mentu.ts:66) | M-evidence, M-evidence-escape, M-evidence-invalid, M-record-liveness, R-status |
| mentu:sessionReview | `[SessionRequest]` → `ReviewResult` | Coalesces only concurrent same digest requests; generates request-UUID/review-UUID, stores review/request even invalid review with findings. Local-only chain validates fields/paths/tree, recovery binding, runner identity, capability/check/strict doctor/plan, Pi identities/skills. No worker launch; CLI probes are real process effects when executed. [src/main/ipc/mentu.ts:67](/Users/carlos/Documents/Drogon-mentu-session/src/main/ipc/mentu.ts:67) | M-review-block, M-nested, M-coalesce, M-refresh, M-recovery-vars, M-recovery, M-owner, REAL-prompt, REAL-pi, REAL-skill, REAL-compound |
| mentu:sessionApprove | `[reviewId:string]` → `ApprovalResult` | Looks up stored review by scalar ID; blocks error findings; reuses approval for same review else approval-UUID bound to review/binding digest/ISO approval time. Does not revalidate disk or execute. No caller identity is bound beyond trusted renderer wrapper. [src/main/ipc/mentu.ts:70](/Users/carlos/Documents/Drogon-mentu-session/src/main/ipc/mentu.ts:70) | M-review-block, M-coalesce, M-nested, REAL-shell |
| mentu:sessionExecute | `[approvalId:string]` → `CommandResult` | Uses stored request, reuses in-flight/completed result per approval. Revalidates same requestKey and bindingDigest; then local-only launch with --plan-digest/--request-key/--workspace. Returned process/evidence/admission precedence detailed in LAUNCH. Cache completed even invalid/unavailable; start a fresh review to obtain new attempt key. [src/main/ipc/mentu.ts:73](/Users/carlos/Documents/Drogon-mentu-session/src/main/ipc/mentu.ts:73) | M-nested, M-coalesce, M-old-evidence, M-missing-evidence, M-recovery, M-cancel-review, M-cancel-process, REAL-shell, REAL-key, REAL-invalidation |
| mentu:sessionCancel | `[approvalId:string]` → `CancelResult` | Only active execute controllers can be aborted; returned cancelled means signal requested, not tree exit. Unknown/completed/review-only ID returns not-running. Finish removes in-flight/controller; evidence remains host-owned. [src/main/ipc/mentu.ts:76](/Users/carlos/Documents/Drogon-mentu-session/src/main/ipc/mentu.ts:76) | M-cancel-review, M-cancel-process |

The listed tests exercise helpers/services, filesystem fixtures and injected CLI runners unless explicitly marked REAL. **No direct registered-IPC assertion body was identified in the scoped references.** The core registration test mocks Mentu; calling the registration function alone would not establish payload, trust or state semantics. Bots update/delete remain especially thin at the actual callback boundary.

## Downstream rules and error behavior

### AUTH

Every route uses Electron ipcMain.handle and trusted UI renderer guard. Reject destroyed/non-window sender; configured renderer ID must match; development fallback requires configured dev URL same origin, otherwise false.

Mentu removes its14 handlers before reinstall; Bots does not remove existing registrations. Bots registration is conditional on automation service presence in core registration.

Bot nested payloads use strict Zod validators; outer wrapper args objects are not strict schemas and extra outer keys are ignored. Mentu forwards typed args with casts only; wrong types, null roots and cloneable non-JSON values are not globally rejected by a validator. No output validator or uniform IPC error envelope; throws become invoke rejections. No direct callback/trust assertion body found in focused registerBotHandlers/registerMentuHandlers test search; core registration test mocks modules, so not payload proof.

Source anchors: [src/main/ipc/bots.ts:14](/Users/carlos/Documents/Drogon-mentu-session/src/main/ipc/bots.ts:14), [src/main/ipc/mentu.ts:16](/Users/carlos/Documents/Drogon-mentu-session/src/main/ipc/mentu.ts:16), [src/main/ipc/ui.ts:109](/Users/carlos/Documents/Drogon-mentu-session/src/main/ipc/ui.ts:109).

### BOT-NORMALIZE

Store normalizer independently requires Bot id/display name; defaults unsupported harness to codex, unknown character to none, filters memories to strings, trims handle/removes @ and blank title/handle to null. Session model/explicitModel accept string|null in persisted type, unlike IPC null-only schema.

Responsibilities normalize invalid entries away, require matching trigger kind and a string automationId for scheduled; enabled is value !== false; recipe requires nonempty trimmed recipeRef. Timestamp normalizer accepts typeof number, without parser finite/nonnegative constraints.

Operating prompt embeds current display name/title/handle, persona guidance, trimmed instructions, nonempty memories, responsibility name/instructions and optional recipe reference. Its prose about delegation/liveness is guidance, not executable policy or proof that Mentu ran.

Session rotation only stores metadata, sets rotatedAt on replacing an existing session, never creates PTY, cancels old session or verifies submitted session ID.

Source anchors: [src/shared/drogon-bot-contract.ts:228](/Users/carlos/Documents/Drogon-mentu-session/src/shared/drogon-bot-contract.ts:228), [src/shared/drogon-bot-session.ts:3](/Users/carlos/Documents/Drogon-mentu-session/src/shared/drogon-bot-session.ts:3), [src/shared/drogon-bot-prompt.ts:47](/Users/carlos/Documents/Drogon-mentu-session/src/shared/drogon-bot-prompt.ts:47).

### BOT-PERSIST

Bot create/update/rotate/delete and responsibility history mutate runtime.state before flush. Scheduled links require matching owned automation; history validates Bot/responsibility/automation relationship and automation run existence/automationId.

Dedup only on nonnull automationRunId; preserve original ID/start on update; endedAt/recipe/hostObservation use incoming ?? existing, so explicit null cannot clear an existing value. New unlinked records get UUID and can repeat.

flush invalidates list projection cache; returns without write after quit flush started; catches/logs primary/active-view failures. Primary write can also skip when frozen/hash unchanged. Successful Bot result therefore proves memory mutation, not disk durability.

When performed, sync primary write bumps generation to fence earlier async writes; serializes state, writes/fsyncs temporary file, renames with Windows retries and syncs directory, updates durable generation/hash, rotates backups. No Bot transaction or rollback on flush failure.

DeleteBot strips botId but keeps automation/run/history. DeleteAutomation instead removes automation and automationRuns and all linked scheduled Bot responsibilities, while separate responsibility history remains. Snapshot/history null joins explain retained orphan evidence; source load migration repairs owners and drops dangling/cross-Bot scheduled responsibilities.

Load normalization requires responsibility history id/botId/responsibilityId nonempty strings, finite startedAt, explicit nullable automationId/automationRunId, endedAt finite|null and hostObservation enum|null; malformed rows filtered. It does not require nonnegative times or cross-entity existence. Bot-owner migration marks loadNeedsSave; same-Bot duplicate scheduled responsibilities sharing automation can survive (only cross-Bot duplicate ownership removed).

Source anchors: [src/main/persistence/loading-store/bot-persistence.ts:45](/Users/carlos/Documents/Drogon-mentu-session/src/main/persistence/loading-store/bot-persistence.ts:45), [src/main/persistence/loading-store/write-flush-barriers.ts:42](/Users/carlos/Documents/Drogon-mentu-session/src/main/persistence/loading-store/write-flush-barriers.ts:42), [src/main/persistence/loading-store/primary-state-writes.ts:53](/Users/carlos/Documents/Drogon-mentu-session/src/main/persistence/loading-store/primary-state-writes.ts:53), [src/main/persistence/loading-store/primary-state-writes.ts:220](/Users/carlos/Documents/Drogon-mentu-session/src/main/persistence/loading-store/primary-state-writes.ts:220), [src/main/durable-file-write.ts:190](/Users/carlos/Documents/Drogon-mentu-session/src/main/durable-file-write.ts:190), [src/main/persistence/loading-store/normalize-loaded-profile-state.ts:111](/Users/carlos/Documents/Drogon-mentu-session/src/main/persistence/loading-store/normalize-loaded-profile-state.ts:111), [src/main/persistence/loading-store/loaded-state-parsing.ts:252](/Users/carlos/Documents/Drogon-mentu-session/src/main/persistence/loading-store/loaded-state-parsing.ts:252), [src/shared/drogon-bot-run-normalization.ts:13](/Users/carlos/Documents/Drogon-mentu-session/src/shared/drogon-bot-run-normalization.ts:13).

### BOT-SCHEDULE

Responsibility creation is two writes with best-effort compensation, not atomic. Reactive responsibility merely stores configuration. Scheduled creation gets current harness and operating prompt; no explicit model field propagated.

Automation derives execution target and run/source context from repository/host setup; stored authority contexts win. Existing workspace keeps workspaceId, clears baseBranch/setupDecision; new-per-run clears workspaceId and disables reuse. setupDecision run/skip retained for new-per-run, inherit normalized to absent/undefined. Enabled defaults true; missed policy run_once_within_grace and grace720 minutes. Precheck command trimmed; blank becomes null; timeout clamped1..600 despite IPC accepting1..86400.

No destination/expected-owner fence is supplied by Bots creation route. Responsibility strict parser admits timezone and RRULE strings without semantic validation; creation then requires projectId resolve a repository, otherwise throws "This automation's project no longer exists, so its host cannot be resolved." before append. Recurrence constructor parses rule/cron and can throw before append. SSH selector derives repo.connectionId and captured target generation; a local selector can carry folder workspace SSH generation, while run/source context separately identifies runtime host.

RRULE accepts HOURLY/DAILY/WEEKLY, hour0..23/minute0..59, weekly valid day set; defaults9:00; cron five fields supports names/ranges/steps and limits expression bytes2048. Next occurrence computed from dtstart/now, throws if no bounded scan result. Stored timezone is not an argument to occurrence computation, which uses local Date/getDay/setHours; timezone metadata does not enforce requested zone. DST/zone fidelity is a source discrepancy requiring policy decision.

RecipeLink exists in shared input/service but recipe is undeclared in strict responsibility IPC parser. Non-null explicit model similarly accepted in persisted/shared type but rejected at Bot creation/update/rotation IPC. Preserve these as source discrepancies; do not silently weaken intended model/recipe capabilities.

Source anchors: [src/main/bots/bot-service.ts:54](/Users/carlos/Documents/Drogon-mentu-session/src/main/bots/bot-service.ts:54), [src/main/persistence/scheduling-automations/automation-definition-operations.ts:49](/Users/carlos/Documents/Drogon-mentu-session/src/main/persistence/scheduling-automations/automation-definition-operations.ts:49), [src/shared/automation-schedule-parsing.ts:60](/Users/carlos/Documents/Drogon-mentu-session/src/shared/automation-schedule-parsing.ts:60), [src/shared/automation-schedule-occurrences.ts:85](/Users/carlos/Documents/Drogon-mentu-session/src/shared/automation-schedule-occurrences.ts:85), [src/shared/automation-execution-target.ts:87](/Users/carlos/Documents/Drogon-mentu-session/src/shared/automation-execution-target.ts:87), [src/shared/automation-precheck.ts:7](/Users/carlos/Documents/Drogon-mentu-session/src/shared/automation-precheck.ts:7), [src/main/persistence/scheduling-automations/automation-context-migration.ts:94](/Users/carlos/Documents/Drogon-mentu-session/src/main/persistence/scheduling-automations/automation-context-migration.ts:94).

### BOT-RUN

runNow finds automation, creates manual run, then resolves target; no automation.enabled check in this method. Bot service checks responsibility.enabled, not automation.enabled. Manual precheck is skipped. Run persistence dedups automationId+scheduledFor (Date.now), so same-millisecond manual calls can share a run yet still request dispatch.

Target resolution preserves captured host/generation/orphan verdict, project setup ready state and exact host/repo/path. Runtime-owned context needs allowRemoteHostScheduling and remote_host_service; legacy branch delegates owner refusal then requires repo and cwd. No local substitute on refusal.

Pending row starts with null session/output/precheck/usage/error/start/dispatch fields. Renderer path writes dispatching then sends automations:dispatchRequested with current Bot prompt/harness and dispatch token. Headless path returns dispatched with terminal/workspace identities and watches/attaches completion; target/no-dispatch-host becomes skipped_unavailable; headless launch error dispatch_failed.

Run updates are replacements; retain workspace on nullish update, selectively clear terminal/output/precheck/usage fields with own-property semantics, error defaults null, first update sets startedAt, dispatched updates set dispatchedAt. This storage function does not enforce monotonic terminal state; status is assignment.

Writer records responsibility history before dispatch and final endedAt on final statuses; catches Bot history errors to preserve automation execution. Service's later history write is not caught and may fail after actual dispatch. No process-liveness observation is recorded (null), even for final automation status. Complete terminal execution/consumer flow is separate acceptance.

Source anchors: [src/main/automations/service.ts:131](/Users/carlos/Documents/Drogon-mentu-session/src/main/automations/service.ts:131), [src/main/automations/service.ts:295](/Users/carlos/Documents/Drogon-mentu-session/src/main/automations/service.ts:295), [src/main/automations/run-target-resolution.ts:56](/Users/carlos/Documents/Drogon-mentu-session/src/main/automations/run-target-resolution.ts:56), [src/main/automations/headless-dispatch-runner.ts:30](/Users/carlos/Documents/Drogon-mentu-session/src/main/automations/headless-dispatch-runner.ts:30), [src/main/automations/automation-run-writer.ts:18](/Users/carlos/Documents/Drogon-mentu-session/src/main/automations/automation-run-writer.ts:18), [src/main/persistence/scheduling-automations/automation-run-operations.ts:67](/Users/carlos/Documents/Drogon-mentu-session/src/main/persistence/scheduling-automations/automation-run-operations.ts:67).

### HOST

Owner is executionHostId(default local), workspace path, workspace kind (explicit else folder:key detection else worktree), optional workspace key, transport and parsed remote target/environment/distro.

SSH and paired-runtime currently return failure immediately and must be serviced by owner; no forwarder is implemented in these21 registrations. Malformed host ID also failure. Local requires absolute host workspace path. WSL guest path requires leading /, but local host file paths are used for discovery/load/save/evidence; check/doctor/probes route guest command/cwd through existing WSL runner.

Admitted session review and launch only permit local route, so WSL capability/check does not imply WSL admitted execution. PinnedRunnerIdentity currently admits only darwin-arm64 and matching approved executable SHA. Other platforms remain explicit execution gap, not tested parity.

Source anchors: [src/main/mentu/mentu-host-route.ts:52](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-host-route.ts:52), [src/main/mentu/mentu-runtime.ts:152](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-runtime.ts:152).

### CLI

Default command is lazily resolved application/resource-owned pinned path; no workspace binary/PATH fallback. Probes5s; check/doctor/plan30s; execution30min; stdout and stderr each bounded8MiB. Local process uses shell:false argv (Windows .cmd helper branch), WSL uses existing loginPath preferred and guest cwd. WSL invoke does not forward AbortSignal/barrier options.

Process result code0 and not timeout => successful; other codes/null or timeout => failed, code null=>hostObservation unverifiable else exited. Spawn exceptions handled by operation wrappers; outputTruncated true only when reported true.

Admitted launch passes AbortSignal, terminationBarrier true and detached true. Shared process runner escalates termination after2s and final unverified barrier deadline10s; deferred close/exit determines code or null. Source's command result drops separate process-tree proof and signal; do not interpret mere cancel ack or root code as proof all descendants exited.

Runner identity reads canonical file bytes/hash and lock hash/revision/version, only supports macOS ARM. Pi lookup resolves pi and node using which/where, --version, canonical file/hash, and includes node runtime identity. Lookup reads execution environment but this audit did not execute it or expose actual account/config data.

Source anchors: [src/main/mentu/mentu-cli-process.ts:46](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-cli-process.ts:46), [src/main/mentu/mentu-cli-process.ts:103](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-cli-process.ts:103), [src/main/mentu/mentu-cli-process.ts:140](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-cli-process.ts:140), [src/main/mentu/mentu-runtime-identity.ts:46](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-runtime-identity.ts:46), [src/shared/child-process/run-process.ts:56](/Users/carlos/Documents/Drogon-mentu-session/src/shared/child-process/run-process.ts:56), [src/shared/child-process/run-process.ts:114](/Users/carlos/Documents/Drogon-mentu-session/src/shared/child-process/run-process.ts:114).

### RECIPE

Safe recipe reference rejects missing/NUL/absolute native or Win32 paths; appends .json; requires canonical workspace/root/candidate containment and regular existing file. Source read stat limit1MiB but no second byte check after read, leaving file-growth race. Discovery sorts recursively, skips escaping links, does not recurse directory symlinks because dirent.isDirectory false.

Recipe validator requires JSON object, nonblank name, steps array even for compound, supported type default sequence when null/absent. Sequence/formula require step; compound/pipeline/parallel require child node. Steps require safe label regex and at least prompt or prompt_file, but both are allowed; inline prompt wins snapshot. Unique labels and known acyclic dependencies required; child label is optional unrestricted string.

Known optional strings/arrays/maps/integers generally treat null like omission. Integers must be finite integral but may be negative/zero. String types need not be nonempty except named guards. Unknown fields retained in raw and root/step/node index maps. Type definitions permitting optional steps differ from runtime parser requiring steps array.

providers is map of object; known api allowed responses/chat_completions/cli/shell/pi and known string fields validated, unknown provider content remains Json. cloud optional object with enabled/evaluate_steps optional bool|null. hooks optional object with known event command arrays; unknowns retained. verify optional object: structured file/pattern predicates and command/path arrays; no regex execution in parser; min/max finite int without range relationship enforcement.

Serialization clones raw, overlays/removes known fields according to edited recipe, merges array rows by INDEX and verify top-level unknown keys. Unknown fields inside replaced verify predicate arrays are not recursively merged. Reordering/removing rows may associate original unknown fields by index, not label; source intent decision needed.

Source anchors: [src/main/mentu/mentu-recipe-files.ts:44](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-recipe-files.ts:44), [src/main/mentu/mentu-recipe-files.ts:71](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-recipe-files.ts:71), [src/shared/mentu-recipe-validation.ts:42](/Users/carlos/Documents/Drogon-mentu-session/src/shared/mentu-recipe-validation.ts:42), [src/shared/mentu-recipe-entry-validation.ts:18](/Users/carlos/Documents/Drogon-mentu-session/src/shared/mentu-recipe-entry-validation.ts:18), [src/shared/mentu-recipe-root-validation.ts:12](/Users/carlos/Documents/Drogon-mentu-session/src/shared/mentu-recipe-root-validation.ts:12), [src/shared/mentu-recipe-verify-validation.ts:143](/Users/carlos/Documents/Drogon-mentu-session/src/shared/mentu-recipe-verify-validation.ts:143).

### SAVE

Limited guard requires recipe/expectedSource strings and document object with string path/object recipe/raw; it does not validate every nested document property or require unknownFields. Serialized edited recipe is then parsed and size checked. expectedSource max1MiB, rendered JSON newline max1MiB, document.path resolved must equal canonical selected file.

Guarded writer first recovers held .orca-guarded file without overwrite; writes unique temp, probes hardlink support, renames target to held, compares exact expected contents, and publishes temp via hardlink only if destination absent. On conflict tries restoring held without overwrite; concurrent existing target wins; removes temp in finally.

This is guarded publication with recoverable intermediates, not a transactional compare-and-swap with arbitrary uncooperative writers and not an fsync durability guarantee. Guarded path uses writeFileSync/link/rename without file/directory fsync; Windows permission paths can grant parent ACL and retry, source behavior only (not performed). Result saved follows reread; a race/reload error may return invalid after publication.

Source anchors: [src/main/mentu/mentu-recipe-save.ts:31](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-recipe-save.ts:31), [src/main/codex-accounts/fs-utils.ts:119](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex-accounts/fs-utils.ts:119).

### DOCTOR

Doctor output JSON object requires string recipe_name and findings array; each finding object severity in info/warning/warn/error/fail and string message; code defaults unknown, optional location/recommendation strings, numeric score, raw retained.

Only successful process result is reclassified by findings; failures/nonzero/null exit/timeout retain process classification. Missing valid report changes successful to invalid only. Strict is checked by truthiness, not a boolean runtime parser; strict warnings are failed even if CLI0. Session review additionally requires doctor recipe_name matches root and status passed.

Source anchors: [src/main/mentu/mentu-cli-operations.ts:32](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-cli-operations.ts:32), [src/main/mentu/mentu-cli-operations.ts:123](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-cli-operations.ts:123).

### LEGACY

Direct run/resume/retry do not call CLI; they refuse legacy bypass. Local transport returns invalid/live/null exit with blank stdout and explanatory stderr plus admission; nonlocal changes status to unavailable and observation unverifiable.

Invalid retry label follows separate invalid/live result before bypass, even for remote owner; regexp receives unvalidated value, so coercion is actual JS behavior. This source observation does not mean remote process is live.

Source anchors: [src/main/mentu/mentu-runtime.ts:38](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-runtime.ts:38), [src/main/mentu/mentu-runtime.ts:94](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-runtime.ts:94).

### RUN-PARSE

Primary run parser requires string IDs/names/timestamps/outcome/cloud_mode and steps/hooks arrays; every step requires string label/backend/output_file/error_file, finite integer exit/duration/attempts, boolean local_complete. It does not require nonnegative duration/attempts, valid timestamp format, unique labels, matching status and exit, or safe output labels.

Optional primitive fields accepted only when matching typeof; invalid optional values often disappear. Step hooks null/absent omitted, malformed nonnull hook array rejects whole run. Tokens finite nonnegative ints; zero omitted if usage_known/usageKnown not true. Invocation alias invocation_count/invocationCount is nonnegative integer; attempts remains distinct. Trust score merely numeric.

Events require string id/run_id/timestamp/kind/recipe_name and integer sequence; optional data object values must all strings, null omitted. State requires string identifiers/times, string map vars, step records string label/state, finite integer attempts/time string. Neither parser checks referenced ID or recipe against primary record; event ordering/uniqueness and step-state key/label equality are not enforced.

Source anchors: [src/main/mentu/mentu-run-parsing.ts:85](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-run-parsing.ts:85), [src/main/mentu/mentu-run-parsing.ts:159](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-run-parsing.ts:159), [src/main/mentu/mentu-run-parsing.ts:193](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-run-parsing.ts:193), [src/main/mentu/mentu-run-parsing.ts:255](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-run-parsing.ts:255).

### EVIDENCE

Run ID regex run_[A-Za-z0-9_-]+; canonical runsRoot and runDir must remain inside canonical workspace, run.json safe and primary run_id equals requested. Missing/unsafe primary =>unavailable/unverifiable, malformed primary=>invalid/live. Raw run/events/state preserve extra JSON without claiming formal Commitment Protocol record.

Events file defaults events.jsonl; malformed lines retained verbatim in invalidEventLines, unreadable marker, unsafe-reference marker; absent events can be empty. State defaults state.json and baseline baseline.json; missing/unsafe/unparseable become null without separate error detail. Baseline accepts any JSON object.

Relative output references require within run and canonical containment. Invalid/absent canonical reference returns path:null/content:null/error reference_outside_run_directory; later read failure retains lexical path with null content/error message. Each output read first512KiB; truncation represented as error content_truncated. Per-step map keyed label means last repeated label wins; hook list preserves scope/index/step label.

Quarantine max200 regular file entries sorted recursive; each512KiB content cap and optional contentTruncated; unreadable file size0/contentnull; escaping symlinks skipped. No aggregate truncation/count flag when200 limit reached. run.json/events/state/baseline reads themselves unbounded; no TOCTOU immunity between realpath/stat/read.

Status precedence: running first, failed next, warn_bookkeeping OR step warning/quarantine/verification-warning/drift path next, ok successful, otherwise invalid. Thus future outcome with warnings becomes warning. hostObservation is synthesized running=>live and terminal=>exited, not an independent process observation. This defect is explicit in accepted evidence and cannot support real restart/liveness acceptance.

Source anchors: [src/main/mentu/mentu-run-evidence.ts:60](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-run-evidence.ts:60), [src/main/mentu/mentu-run-evidence-files.ts:24](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-run-evidence-files.ts:24), [src/shared/mentu-run-status.ts:3](/Users/carlos/Documents/Drogon-mentu-session/src/shared/mentu-run-status.ts:3).

### REVIEW

Review uses stable sorted-object SHA digest of request to coalesce concurrent calls; completed review promise removed so later identical request gets fresh request/review IDs. Stored request is same in-process object, not durable authorization state or deep clone; incoming Electron clone separates renderer memory but direct callers could mutate it.

Local route only; session/recipe trim required; new run forbids truthy runId; non-run requires run_ regex; recovery vars cannot have keys; retry step safe regex. No complete SessionRequest runtime validator: unknown intent can pass non-run checks; maxParallel type/range, backend/model/profile fields not comprehensively checked.

Inputs load root/child documents, reject cycles, >256 nodes/>32 depth and >16MiB collected inputs. Canonical recipe and prompt byte/content snapshots; prompt_file limited4MiB and allowed in workspace OR user .mentu/prompts root, each root canonical containment. This is intentionally broader than workspace-only wording of one error. Explicit Pi skill path may be outside workspace; snapshot bounds within selected root, 256 entries,4MiB/file16MiB total, escaping/cyclic symlink rejected.

Policy digest includes raw recipe policies and whole overrides, allowed/disallowed tools sorted unions, request substitutions hashed. cloud false cannot disable recipe-enabled cloud. Named Pi provider routes gather actual configured skill bytes and override caller profile snapshot; Pi profile digests config/model/default tools/max output/discovery=false/retry=false/compaction=false/thinking=off. Non-Pi explicit profile can remain caller-supplied metadata.

Identity read precedes capability, check, strict doctor and plan. Plan requires version1/digest/source/steps/children, canonical source equal reviewed node, exact lengths and ordered labels, backend string; model optional; named provider config maps responses=>openai/chat_completions=>openai-chat/cli=>codex-or-claude/pi/shell. Root plan digest accepted string (not recomputed locally); binding also includes resolved routes and source snapshots.

Blocking findings: failed/unavailable check; doctor anything except passed; plan not passed; absent/unavailable adapter; non-shell model missing; Pi provider/profile/executable missing; unavailable/unverifiable capability. Scope binding includes owner/session/intent/recovery ID/step/tree/inputs/substitutions/routes/policy/recovery digest/runner/pi/profile/plan digest/request key; excludes reviewId and diagnostic text. EffectiveSteps invocationCount is declared but not emitted by current plan parser.

Source anchors: [src/main/mentu/mentu-session-review-builder.ts:30](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-session-review-builder.ts:30), [src/main/mentu/mentu-session-inputs.ts:51](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-session-inputs.ts:51), [src/main/mentu/mentu-session-input-snapshots.ts:101](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-session-input-snapshots.ts:101), [src/main/mentu/mentu-session-plan-routes.ts:10](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-session-plan-routes.ts:10), [src/main/mentu/mentu-session-pi-profile.ts:12](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-session-pi-profile.ts:12).

### RECOVERY

Reads selected host-owned run; requires primary recipe name match. If recipe_ref exists, resolve candidate reference paths (workspace recipe root/workspace/selected recipe parent or absolute, with optional .json) and realpath equals selected recipe. Absent recipe_ref is accepted.

Retry label allowed if present in primary run steps OR optional state.steps; reader does not cross-check state.run_id/name with requested primary, so foreign state can influence retry validation. Review does not require run terminal state or prove workspace process idle; CLI admission owns conflict semantics.

recoveryEvidenceDigest contains only primary run_id, recipe_name, optional recipe_ref and each step label/backend/model. It omits outcomes, attempts, state, vars, events, output, timestamps and liveness; changing those alone does not change this binding. This is actual source characterization, not claim of complete recovery-evidence binding.

Source anchors: [src/main/mentu/mentu-session-recovery.ts:16](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-session-recovery.ts:16), [src/main/mentu/mentu-session-recovery.ts:62](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-session-recovery.ts:62).

### APPROVAL

Reviews, approvals, pending promises, completed command results and cancellation controllers are memory maps, no persistent approval ledger or TTL/eviction for review/approval/completed maps. A fresh runtime cannot approve/execute old IDs; durable run evidence is separate.

Scalar reviewId routes to approve; scalar approvalId routes execute/cancel. IDs are different namespaces from requestKey and runId, but Map lookup is runtime check, not regex/schema. Unknown IDs return domain invalid/not-running rather than throw under otherwise valid wrapper.

Approval repeats for same review; execute repeats for same approval share in-flight Promise or cached completed result, including failure/unavailable/invalid results. Fresh review gets new requestKey. In-memory coalescing is not cross-process exactly-once; native CLI plan/request reservation is separate authoritative mechanism.

Source anchors: [src/main/mentu/mentu-session-execution.ts:23](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-session-execution.ts:23).

### LAUNCH

Revalidation uses stored request and original requestKey; not-ready or different binding => plan-changed failure before launch. Resolve local route again and canonical recipe/workspace; run argv uses recipe plus backend/model/cloud/maxParallel/validated var names; recovery uses runId and retry step plus backend/model/cloud/maxParallel, never new vars. Append --workspace, --plan-digest, --request-key. Type annotations alone do not validate numeric ranges or string scalar fields.

After CLI, process code null overrides status unavailable and sets cancelled admission if signal aborted else request-conflict; code0 run with no run_ token in combined stdout/stderr becomes invalid (timedout =>failed). First matching run token may come from stderr/old text; source does not authenticate a separate structured run ID.

When run ID present, read evidence: null exit unavailable; nonzero or timedOut failed; otherwise use evidence status or missing-evidence invalid/unavailable with appended stderr. Retain nested run.status independently so successful old record cannot erase current failure.

Finally loose already-used/already-admitted/in-progress/reservation-pending/workspace-busy/lock-busy regex over result text overrides status to busy and admission busy, even after earlier failure or cancellation. Native admission is not locally parsed structured proof; busy-text precedence/false positives require acceptance.

Any exception catches to unavailable/unverifiable against reviewed owner. No dedicated catch cancelled admission on aborted revalidation. Review/launch hashing and later executable/file use leave TOCTOU windows; source code trace cannot prove race-free execution or native engine internals.

Source anchors: [src/main/mentu/mentu-session-launch.ts:30](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-session-launch.ts:30), [src/main/mentu/mentu-session-review-plan.ts:43](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-session-review-plan.ts:43).

### CANCEL

cancel controller.abort returns immediately; repeated call while still active can still return cancelled; completed/unknown returns not-running. No cancellation channel for standalone review/check/doctor and no runId cancellation in this21-set.

Revalidation checks signal at phases and passes to check/doctor/plan; input/identity reads and capability probes do not all receive signal. Prelaunch explicit abort emits cancelled admission; error catch during earlier aborted check can yield only unavailable. Actual process path signals tree and awaits bounded reporter result; a lost/unkillable tree remains unverifiable, not proved exited.

Tests in MentuSessionExecution inject runProcess promises/signals rather than real descendants. Shared child-process termination internals and native CLI reservation/cancellation acceptance remain separately executable obligations.

Source anchors: [src/main/mentu/mentu-session-execution.ts:140](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-session-execution.ts:140), [src/main/mentu/mentu-session-launch.ts:64](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-session-launch.ts:64), [src/shared/child-process/run-process.ts:208](/Users/carlos/Documents/Drogon-mentu-session/src/shared/child-process/run-process.ts:208).

## Assertion bodies and their limits

The JSON records file SHA-256, normalized source-span SHA-256, start/end lines and individual `expect` lines for each group below. These assertions were read, **not run in this follow-up**. REAL entries are existing native fixture source, not new execution evidence. Earlier accepted UI-state evidence is retained, especially its warning that restart-titled and real-run-titled fixtures can still be in-memory or cast objects.

| Group and source | What the assertions establish |
| --- | --- |
| [B-history](/Users/carlos/Documents/Drogon-mentu-session/src/main/bots/bot-responsibility-owner.test.ts:68) (68–93) | Automation remains in global administration; history maps exact automation/run and recipe run ID. |
| [B-rotate](/Users/carlos/Documents/Drogon-mentu-session/src/main/bots/bot-responsibility-owner.test.ts:130) (130–162) | Bot create/rotate retains Bot ID, one state row, currentSession session ID, and flush spy called; no disk restart. |
| [B-scheduled](/Users/carlos/Documents/Drogon-mentu-session/src/main/bots/bot-responsibility-owner.test.ts:164) (164–203) | Mock store createAutomation receives Bot owner, codex agent and identity prompt; response responsibility trigger automation ID. |
| [B-writer](/Users/carlos/Documents/Drogon-mentu-session/src/main/bots/bot-responsibility-owner.test.ts:205) (205–228) | Writer creates Bot history containing actual returned automation run ID and hostObservation:null. |
| [B-finish](/Users/carlos/Documents/Drogon-mentu-session/src/main/bots/bot-responsibility-owner.test.ts:230) (230–257) | Writer update completed records endedAt:any Number; no observed child exit. |
| [B-reactive](/Users/carlos/Documents/Drogon-mentu-session/src/main/bots/bot-responsibility-owner.test.ts:259) (259–277) | Reactive manual responsibility rejects with connected event adapter text. |
| [B-dispatch-context](/Users/carlos/Documents/Drogon-mentu-session/src/main/bots/bot-responsibility-owner.test.ts:279) (279–294) | Current Bot instructions/memory and codex harness hydrated into dispatched automation prompt. |
| [B-dedup](/Users/carlos/Documents/Drogon-mentu-session/src/main/bots/bot-responsibility-owner.test.ts:296) (296–324) | Same automationRunId update returns same history ID, one record; invented automation run rejected. |
| [B-schema-create](/Users/carlos/Documents/Drogon-mentu-session/src/main/ipc/bot-schemas.test.ts:5) (5–19) | Bounded create accepts character samwell/defaultHarness codex/explicitModel null. |
| [B-schema-reject](/Users/carlos/Documents/Drogon-mentu-session/src/main/ipc/bot-schemas.test.ts:20) (20–49) | Unsupported session harness, undeclared privileged create field and injected responsibilities rejected. |
| [B-schema-responsibility](/Users/carlos/Documents/Drogon-mentu-session/src/main/ipc/bot-schemas.test.ts:51) (51–79) | Scheduled input accepted with expected project ID; reactive schedule rejected. |
| [B-disk](/Users/carlos/Documents/Drogon-mentu-session/src/main/persistence-bot-automation.test.ts:30) (30–57) | Actual temp datafile read after store.flush retains automation.botId; does not prove all Bot fields/restart/crash durability. |
| [B-global-delete](/Users/carlos/Documents/Drogon-mentu-session/src/main/persistence-bot-automation.test.ts:59) (59–100) | After deleting global automation, stored Bot responsibility projection length0; no post-delete disk assertion. |
| [A-manual](/Users/carlos/Documents/Drogon-mentu-session/src/main/automations/service.test.ts:100) (100–133) | runNow returns dispatching; stored run dispatching and send spy receives same ID/status. |
| [A-missing-setup](/Users/carlos/Documents/Drogon-mentu-session/src/main/automations/service.test.ts:135) (135–173) | Reloaded stale setup target yields skipped_unavailable/exact error and zero send calls. |
| [A-stale-path](/Users/carlos/Documents/Drogon-mentu-session/src/main/automations/service.test.ts:175) (175–214) | Reloaded stale path target yields skipped_unavailable/exact error and zero send calls. |
| [A-runtime-refusal](/Users/carlos/Documents/Drogon-mentu-session/src/main/automations/service.test.ts:216) (216–253) | Runtime-owned automation desktop path is skipped_unavailable with remote scheduling error and no send. |
| [A-headless](/Users/carlos/Documents/Drogon-mentu-session/src/main/automations/service.test.ts:302) (302–366) | Mock headless dispatcher terminal/workspace IDs reach returned dispatched row; awaited stored completion/output observed; no remote process launched. |
| [M-capability](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-runtime.test.ts:28) (28–69) | Version/status/install policy, retained raw future adapter and declared flag values; exact --version and adapters argv. |
| [M-missing](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-runtime.test.ts:71) (71–85) | Injected ENOENT -> unavailable/not-installed/no network installation. |
| [M-discover](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-runtime.test.ts:87) (87–120) | Recursively sorted broken/hidden/valid JSON entries, valid status; escaping symlink and YAML excluded. |
| [M-save](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-runtime.test.ts:122) (122–154) | Loaded source equals exact bytes; edit and save returns saved; disk JSON preserves future root/step fields. |
| [M-save-conflict](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-runtime.test.ts:156) (156–199) | Cyclic edited recipe invalid and source unchanged; externally edited source makes conflict and remains unchanged. |
| [M-save-malformed](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-runtime.test.ts:201) (201–211) | Document:null inside otherwise shaped save request returns invalid. |
| [M-evidence](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-runtime.test.ts:213) (213–324) | Running/local-only descriptor, one parsed event, invalid line, output/hook text, quarantine metadata and raw future fields retained; state/baseline populated fixture but not directly asserted. |
| [M-evidence-escape](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-runtime.test.ts:326) (326–372) | Escaping output/quarantine symlinks return failed run with null output/error and empty quarantine. |
| [M-evidence-invalid](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-runtime.test.ts:374) (374–399) | Missing required step fields yields invalid/live and exact schema error. |
| [M-argv](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-runtime.test.ts:401) (401–464) | Direct run/resume/retry refused, SSH and paired runs unavailable/unverifiable with owners; only check and doctor process calls, all argv strings. |
| [M-check-failed](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-runtime.test.ts:466) (466–476) | Injected check exit2 -> failed/exited/exitCode2. |
| [M-wsl](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-runtime.test.ts:478) (478–529) | Only WSL check invocation occurs, guest recipe/cwd, Ubuntu/login preferred, application pinned program; direct run/resume do not launch. |
| [M-doctor](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-doctor.test.ts:41) (41–61) | Strict nonzero stays failed, strict0 warning failed, nonstrict warning retained; otherwise-passing report cannot erase process1; --strict and <=30s asserted. |
| [M-doctor-invalid](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-doctor.test.ts:63) (63–71) | Four malformed/unknown-severity report fixtures yield invalid with exit0 strict. |
| [M-startup](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-cli-process.test.ts:13) (13–37) | Mock executable resolver deferred until context.command; runtime identity sees post-startup command; explicit injection preserved. |
| [M-pin](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-runtime-identity.test.ts:7) (7–19) | Runtime exported pin and lock digest equal lock data; does not actually test hashing/validating executable. |
| [M-direct](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-session-execution.test.ts:124) (124–132) | Direct run invalid/review-and-approve stderr and zero calls. |
| [M-review-block](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-session-execution.test.ts:134) (134–154) | Check failure appears as blocking finding; exact probe/check/doctor/plan call order; approval invalid when review exists. |
| [M-nested](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-session-execution.test.ts:156) (156–248) | Nested child route/recipe inputs match expected; editing child content invalidates previously approved execute before any run call. |
| [M-coalesce](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-session-execution.test.ts:250) (250–284) | Concurrent reviews same ID/one plan; approvals approved; execute outputs equal and one run call with plan digest and requestKey; no disk evidence fixture so not success proof. |
| [M-refresh](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-session-execution.test.ts:286) (286–296) | New review after recipe edit ready with changed treeDigest. |
| [M-old-evidence](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-session-execution.test.ts:298) (298–345) | Two injected exit1/null cases keep outer failed/unavailable while older nested run.status successful. |
| [M-missing-evidence](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-session-execution.test.ts:347) (347–370) | Current exit2 plus missing record -> failed/exited/exit2, no nested run, appended evidence error. |
| [M-recovery-vars](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-session-execution.test.ts:372) (372–386) | Resume request with new vars invalid before process calls. |
| [M-cancel-review](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-session-execution.test.ts:388) (388–429) | Cancel in mocked revalidation check -> cancelled, eventual unavailable, no extra doctor/run, then not-running. |
| [M-recovery](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-session-execution.test.ts:431) (431–484) | Resume review has recovery digest; execute returns selected record and exact mocked resume argv; not an actually resumed native worker and no retry-step execution. |
| [M-cancel-process](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-session-execution.test.ts:486) (486–516) | Mock runProcess abort promise -> cancel acknowledged and result observation unverifiable; no actual tree kill. |
| [M-owner](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-session-execution.test.ts:518) (518–532) | Folder scope preserved and SSH review unavailable/ssh owner; does not assert observation field (ReviewResult has none). |
| [M-record-liveness](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-session-execution.test.ts:534) (534–569) | New runtime reads stored running record as running/live and distinguishes attempts2/invocation_count1; no real restart or live child. |
| [R-roundtrip](/Users/carlos/Documents/Drogon-mentu-session/src/shared/mentu-recipe-contract.test.ts:27) (27–76) | Unknown root/step/verify-top-level fields preserved in edited serialization and stringifier. |
| [R-optional](/Users/carlos/Documents/Drogon-mentu-session/src/shared/mentu-recipe-contract.test.ts:78) (78–106) | Compound accepted and absent default sequence type remains omitted on serialize. |
| [R-malformed](/Users/carlos/Documents/Drogon-mentu-session/src/shared/mentu-recipe-contract.test.ts:108) (108–138) | Malformed known fields retain raw description42 with expected string/provider-api/hook-array/integer issues. |
| [R-dependencies](/Users/carlos/Documents/Drogon-mentu-session/src/shared/mentu-recipe-contract.test.ts:140) (140–155) | Unsafe label/dependency fixture rejected with broad regex over joined issue text; not independent exhaustive assertion for every condition named in title. |
| [R-verify](/Users/carlos/Documents/Drogon-mentu-session/src/shared/mentu-recipe-contract.test.ts:157) (157–186) | Valid object verify accepted; array verify rejected with exact issue. |
| [R-status](/Users/carlos/Documents/Drogon-mentu-session/src/shared/mentu-recipe-contract.test.ts:188) (188–200) | Local evidence not formal, running/warn/ok/failed and unknown outcome classifications. |
| [REAL-shell](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-session-real-cli.test.ts:115) (115–140) | Ready review/approved/exit0/warning/nested evidence and actual temp result.txt content contract-proof. |
| [REAL-doctor](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-session-real-cli.test.ts:142) (142–168) | Native strict warning nonzero/failed, blocks review and approval, zero run argv. |
| [REAL-prompt](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-session-real-cli.test.ts:170) (170–179) | Prompt file fixture from actual workspace .mentu/prompts produces ready review; no execution asserted. |
| [REAL-key](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-session-real-cli.test.ts:181) (181–206) | Fresh review after execute gets a new requestKey; completion success itself not asserted here. |
| [REAL-invalidation](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-session-real-cli.test.ts:208) (208–236) | Content change invalidates approval with plan-changed, new review ready/bindingDigest changes. |
| [REAL-pi](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-session-real-cli.test.ts:238) (238–268) | Named Pi provider review ready, no adapter-unavailable finding, Pi and node path truthy; no inference or execute. |
| [REAL-skill](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-session-real-cli.test.ts:270) (270–320) | Actual skill bytes override caller digest, edit skill invalidates execute, no run call. |
| [REAL-compound](/Users/carlos/Documents/Drogon-mentu-session/src/main/mentu/mentu-session-real-cli.test.ts:322) (322–338) | Real compound review ready and child.exercise in effective steps. |
| [B-type-policy](/Users/carlos/Documents/Drogon-mentu-session/src/shared/drogon-bot-contract.test.ts:31) (31–36) | Shared normalization retains explicitModel gpt-5.5 with codex harness, contrasting with null-only strict IPC policy. |
| [B-session-helper](/Users/carlos/Documents/Drogon-mentu-session/src/shared/drogon-bot-contract.test.ts:53) (53–63) | Pure rotation retains Bot ID and supplied session/harness; fixture passes non-null model, which actual IPC parser rejects. |
| [B-link-helper](/Users/carlos/Documents/Drogon-mentu-session/src/shared/drogon-bot-contract.test.ts:91) (91–119) | Recipe link strings preserved; minimal cast run fixture produces link, unavailable result gives null. Test title says real run but body injects a partial cast object, not actual evidence. |
| [B-history-normalize](/Users/carlos/Documents/Drogon-mentu-session/src/shared/drogon-bot-contract.test.ts:121) (121–143) | Persisted responsibility row with explicit nulls accepted; missing required nullable fields rejected. |
| [B-prompt-policy](/Users/carlos/Documents/Drogon-mentu-session/src/shared/drogon-bot-prompt.test.ts:14) (14–39) | Ordinary chat omits responsibility block; reactive/scheduled table checks delegation/liveness/task-data prose and kind-specific instructions. These are string assertions, not policy enforcement. |

The Bots owner-disk fixture reads an actual temporary data file and verifies the optional owner; its separate delete fixture checks in-memory responsibility removal. Neither proves an interrupted multi-write transaction. The native Mentu suite uses a real pinned executable and temp workspaces when run, but its source skip gate excludes missing binaries and non-darwin-arm64 platforms; Pi cases inspect identities/provider routing without inference. The reviewed native suite contains no actual admitted resume/retry-step or descendant-cancellation case.

## Exact remaining acceptance

- **BM-AUTH** (missing_direct_boundary_tests): Exercise each real registered IPC callback with trusted, wrong-ID, destroyed/non-window and development-origin senders; verify exact argument arity/scalars/object roots, null/undefined/unknown keys, output serialization and invoke rejection. Mentu remove/re-register and Bots conditional/duplicate registration behavior must be characterized.

- **BM-BOT-WRITES** (partial_helper_and_one_owner_disk_fixture): Create/update/delete/first+second rotation through IPC and reload actual temp persistence. Include undefined patch values, field bounds/models/session IDs, retained enabled automation/history after Bot deletion, quit/frozen/error flush and disk failures. Decide durable acknowledgment and model/session validation intent before implementing correction.

- **BM-RESPONSIBILITY** (partial_service_mocks): Create reactive and scheduled via IPC; prove no reactive adapter activates on creation; exact schedule/default/clamp/zone/recipe semantics; missing project and recurrence fail-before-write; second-write/compensation failures; runNow true dispatch/refusal/failure and completion/history joins; disabled responsibility versus automation; same-millisecond duplicates; Bot/history errors after launch and owner deletion races.

- **BM-HOST** (partial_local_mocks_and_arch_gated_real_source_suite): Owner/folder/worktree/SSH captured generation/paired runtime/WSL host-mirror contracts through boundary. Verify no local fallback, actual remote forwarding requirements and host loss unverifiable. Establish explicit Windows/Linux/WSL admitted-runtime support versus current local darwin-arm64 pin; source only gates those out.

- **BM-FILES** (partial_temp_file_fixtures): Path/native+Win absolute/NUL/symlink/size/malformed matrix; row reorder and verify predicate unknown-field preservation policy; load-growth race. Guarded save crash at temp/held/compare/link/cleanup, concurrent target writer, filesystems without hardlink, Windows retries/ACL effects, fsync/durability decision and post-save reread race.

- **BM-PROBES** (partial_mocked_process_and_one_native_suite): Exact argv, no installation, late executable resolution, version/adapters malformed/nonzero/null exit/timeouts/truncation, strict doctor warning and recipe-name mismatch, unexpected report schemas and all host routes; available capability must not promise execution on unsupported pin/platform.

- **BM-ADMISSION** (partial_mocked_and_native_shell_source_assertions): Prove legacy routes launch zero commands; run/review/approval/request IDs distinct, unknown/wrong namespace/scalar/restart IDs fail, concurrent and repeated approval execution once per key. Validate complete request schema before launch; mutate every bound recipe/tree/prompt/skill/profile/model/provider/vars/policy/runner/Pi/node/lock/host/plan field, including during revalidation-to-spawn window.

- **BM-RECOVERY** (resume_argv_mock_only_for_recovery_in_reviewed_suite): Actual admitted native resume and retry-step of failed/running/terminal targets, wrong recipe/ref/step, missing recipe_ref, foreign state/event IDs, outcomes/attempts/vars/state changes omitted from recovery digest; demonstrate native reservation/request conflicts across processes and restart rather than infer them from cached promises.

- **BM-RESULTS-CANCEL** (mocked_abort_contract_only): Native child/descendant cancellation during each review/launch stage, deferred capability probes, repeated cancel, confirmed exit versus unverified tree. Cross product current0/nonzero/null/timedOut and prior evidence statuses/missing run IDs/busy text/cancel; do not let loose busy-text matching or old terminal record mask current failure.

- **BM-EVIDENCE** (partial_temp_json_evidence): Primary ID and optional cross-record identity/ordering/duplicate labels, permissive numerics/timestamps/nulls and future outcomes; unbounded primary file policy, 512KiB output limits and200 quarantine reporting; filesystem race/error matrix. Real restart/contact-loss liveness and formal Commitment Protocol records require separate authoritative evidence; a local run file never proves either.


Every callback's `stillMissingAcceptance` adds its precise malformed/null/error/ordering branches to these shared obligations. Source enumeration is proposed complete for the21 boundaries; these execution obligations remain open and must not be converted into a passing claim merely by porting assertions or mocking the missing behavior.

Run the existing source assertion suites only from a coordinator-provisioned disposable writable checkout of the pin, after its normal dependency/native prerequisites are verified. Do not run them in the read-only original or install anything as part of this audit. The exact existing commands are:

```sh
pnpm exec vitest run --config config/vitest.config.ts src/main/bots/bot-responsibility-owner.test.ts src/main/ipc/bot-schemas.test.ts src/main/persistence-bot-automation.test.ts src/main/automations/service.test.ts src/main/mentu/mentu-runtime.test.ts src/main/mentu/mentu-doctor.test.ts src/main/mentu/mentu-cli-process.test.ts src/main/mentu/mentu-runtime-identity.test.ts src/main/mentu/mentu-session-execution.test.ts src/shared/mentu-recipe-contract.test.ts src/shared/drogon-bot-contract.test.ts src/shared/drogon-bot-prompt.test.ts
```
Record every executed case/pass/fail/skip and exact revision/environment; no passing claim made here.

```sh
pnpm exec vitest run --config config/vitest.config.ts src/main/mentu/mentu-session-real-cli.test.ts
```
Existing suite skips outside darwin-arm64 or missing pin; skip is not pass. Pi review-only cases also require real pi/node identities. This suite lacks actual admitted resume/retry-step and real descendant cancellation coverage.

No complete executable suite exists for BM-AUTH through BM-EVIDENCE. Root must assign those missing boundary/native fixtures or ports, establish the source baseline and genuine behavioral RED, and then validate the candidate without weakened assertions. Setup failure and skipped cases are separate from behavioral results.

## Completeness, omissions and verification

All21 callback identities, payload/result structures, direct parser/runtime/service/persistence branches, optional/null/error distinctions and relevant imported output types are represented. This is one complete reconciliation of the assigned boundaries, not a recensus or a sample of channels. The source manifest hashes identify complete files; they do not imply review of every unrelated function in those files. Relevant called bodies and declaration spans were read; peripheral shared files were read only in the named ranges.

- Native Mentu runner internal reservation/transaction/step execution semantics beyond called CLI arguments and reviewed assertion bodies.

- Actual renderer/headless provider launch, process/SSH ownership and remote mixed-version round trips beyond called AutomationService boundary; accepted platform/RPC work remains separate.

- Full persistence secret serialization/backup migration subsystem and global scheduling calendar semantics; directly relevant flush, occurrence, context and Bot load paths inspected.

- Every internal function in each hashed source file: hashes identify files; only relevant called bodies/declarations were reviewed.

- No complete new malformed21-IPC boundary suite, cross-platform live runner matrix, actual recovery/cancel fixture execution or packaged UI acceptance.


The native engine's internal transaction/admission and all real provider/renderer/remote round trips remain explicit unknowns. For Bots, the characterized service boundary reaches renderer dispatch or the injected headless dispatcher contract; its physical terminal/provider implementation remains separate execution/consumer work. For persistence, Bot write/load/flush behavior is characterized; this follow-up does not re-audit the complete secret serializer, backup system or unrelated migrations.

Prior report, closure, map, notes and verification scripts remain unchanged. Their retained hashes, accepted starting evidence hashes and all new source/assertion hashes are in the JSON. No product/runtime/config/account effect, provider request, installation, commit, push or PR was performed. The final integrity check passed for JSON counts/references, all78 source-file and66 assertion-group hashes, exact21 callback registration equality and all6 preserved candidate hashes. Both prior verification scripts also passed, retaining the174-record E3 candidate as open; these are document checks, not product tests.
