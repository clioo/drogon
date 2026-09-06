# E1 web projection and navigation follow-up

Candidate disposition: **open E1; finite follow-up ready for root review**. Pinned source: `c97906287bb7a390b25e2025b600d9fb3c25d9c3` in the read-only `/Users/carlos/Documents/Drogon-mentu-session`. This report preserves the initial `report.md`, `closure.json` and generator as a snapshot. The matching [JSON](followup-web-navigation.json) contains source anchors, SHA-256 fingerprints, all 50 ID rows, all 19 invariant rows, retained obligations and exact test debt.

The concrete web projection is now mapped: **59/59 top-level keys, 50/50 production modules under `web/preload-api`, 50/50 named UI IDs and 19/19 remaining invariants**. There are 37 bounded caller/source rows and 13 rows whose deeper component semantics remain inherited. These denominators measure this reconciliation, not full E1 behavior or transitive runtime/provider completeness. The audit stays approximately **60%, unweighted 7/12 accepted groups, medium-low confidence, change 0**; root identity ratification and independent acceptance are next. The flexible 24-hour implementation target remains at risk while audit, test migration and platform execution are open.

No tests were executed by this lead or leaf. Root executed **three original Activity portal TSX assertions successfully**; I read the two source test files and retained JSON assertion results. They use React/React DOM 19.2.8, happy-dom 20.11.8 and Vitest 4.1.11 on macOS arm64. No Electron terminal/window or complete product journey was rendered. The [root review](../../activity-portal-test-review.md) supersedes its earlier preparation-only section for those three tests only.

## Consequential source findings

| Path | Actual web result and caller consequence | Exact source anchors |
| --- | --- | --- |
| PUI-BOTS-001 | Concrete list rejects desktop-only; controller catches error and clears loading. The accepted 19 desktop states remain retained. | `src/renderer/src/components/bots/use-bots-page-controller.ts:36-75`; `src/renderer/src/web/web-preload-api.ts:55-68` |
| PUI-MENTU-001 | Truthy mentu proxy passes availability guard; capability resolves undefined and listRecipes resolves []; coalesced fulfillment evaluates 'label' in undefined before state commit, risking unhandled rejection and stuck loading. | `src/renderer/src/components/mentu/recipe-pane-runtime.ts:1-12`; `src/renderer/src/components/mentu/mentu-session-request-coalescer.ts:19-49`; `src/renderer/src/components/mentu/use-mentu-session-loading.ts:42-100` |
| PUI-MEETINGS-001 | Truthy meetings proxy list resolves [] instead of null; controller stores it and snapshot?.meetings.length throws on render, with page error boundary. Desktop ten-state evidence remains retained. | `src/renderer/src/components/meetings/meetings-page-runtime.ts:1-105`; `src/renderer/src/components/meetings/use-meetings-page-controller.ts:55-74`; `src/renderer/src/components/meetings/MeetingsPage.tsx:40-64`; `src/renderer/src/app-shell/AppWorkspaceShell.tsx:208-255` |
| PUI-PLUGINCATALOG-001 | Truthy plugins proxy yields empty marketplace/panels with ready state; refresh silently empty. Forced/retained install or rollback consumes undefined.ok and is caught as action error; no real web validation/rollback. | `src/renderer/src/store/plugin-panels.ts:49-85,126-136`; `src/renderer/src/store/plugin-panels.ts:126-136`; `src/renderer/src/components/settings/PluginMarketplaceBrowser.tsx:58-87,119-215`; `src/renderer/src/components/settings/PluginMarketplaceBrowser.tsx:119-215`; `src/renderer/src/components/settings/use-plugin-marketplace-lifecycle.ts:48-97` |
| PUI-SPARSE-001 | sparsePresets list [] loads empty. Save undefined can append undefined before saved.name throws (or throw earlier on existing entry saved.id); remove can toast success after no-op. Worktree create supports raw sparse fields via RPC. | `src/renderer/src/store/slices/sparse-presets.ts:90-210` |
| PUI-PETS-001 | Import and bundle import undefined are treated like picker cancellation. Custom pet read undefined returns null before Blob creation; bundled renderer artwork is distinct. | `src/renderer/src/components/status-bar/PetStatusSegment.tsx:45-111`; `src/renderer/src/components/pet/pet-blob-cache.ts:113-159` |
| PUI-SIDEBAR-002 | workspaceSpace.getCachedAnalysis resolves undefined, which cached===null does not reject; analyze resolves undefined then result.ok throws into scan error. | `src/renderer/src/store/slices/workspace-space.ts:94-202` |
| PUI-ARTIFACTS-001 | Default unconfigured profile makes accountIdentity null and skips list RPC; the page shows auth state. With valid identity the list client uses real artifacts.list runtime RPC. | `src/renderer/src/components/artifacts/ArtifactsPage.tsx:1-125,186-221`; `src/renderer/src/components/artifacts/ArtifactsPage.tsx:186-221`; `src/renderer/src/components/artifacts/useArtifactPagination.ts:35-175` |
| PUI-AUTOMATIONS-001 | Native automation list/run/update/delete uses scoped RPC, capability/pair revision validation and view-only legacy handling. External-manager fallback list resolves [] and missing manager is silently omitted. | `src/renderer/src/components/automations/automation-host-client.ts:1-184`; `src/renderer/src/components/automations/automation-scoped-list-client.ts:1-210`; `src/renderer/src/components/automations/external-automation-scope-client.ts:45-110` |
| PUI-QUICKCMD-001 | Local commands persist in local settings; remote loads capability/generation gate and mutations serialize per environment, validate reply, ignore stale generation and retain old commands plus errors on failure. | `src/renderer/src/store/slices/terminal-quick-command-hosts.ts:1-285` |

These are source deductions, including likely composed-web defects, not newly reproduced runtime failures. `window.api` optional checks do not establish capability: the generic fallback is a truthy proxy, and a successful promise can contain `undefined` or a shape-invalid `[]`. Bots differs because its factory explicitly rejects. Implemented desktop Bots/Mentu/Meetings behavior and all 45 accepted desktop state descriptions remain retained.

## Factory semantics: complete direct web projection

All module bodies below were read; every row has hashed source evidence in JSON. Remote RPC is a real implementation boundary, but forwarding does not prove the server method or every component caller. `runtime` can implement a feature even when its desktop convenience namespace is absent. Missing namespace examples are Mentu, Meetings, Plugins, Pet, Sparse presets, Workspace Space, Automations and Projects; the fallback rule covers any absent property without pretending to enumerate an unbounded dynamic API.

### app-session — `app`, `session`

Browser reload and localStorage session save/clear are real browser effects; sync beforeunload writes sanitized host-partitioned session and merged UI state. Native probes return null/empty, flush acknowledgement is a synchronous-storage no-op, rendered evidence explicitly rejects. This is not desktop shutdown/process ownership. Persisted browser tabs may restore; no desktop checkpoint or rendered-capture success is proved.

Source: `src/renderer/src/web/preload-api/web-app-api.ts:1-57`; `src/renderer/src/web/preload-api/web-workspace-session-api.ts:1-71`.

### platform — `platform`

Browser platform detection is concrete; it describes the browser OS rather than the paired execution host. Keep browser-local chrome decisions distinct from remote shell capability/owner.

Source: `src/renderer/src/web/preload-api/web-platform-api.ts:1-16`.

### onboarding — `onboarding`, `starNag`

Missing/open onboarding is stored as dismissed with a current closedAt; already-dismissed state is retained; checklist updates persist locally. Star-notice methods return skipped/no-op defaults. Web starts past desktop onboarding. Completion/skip recovery on desktop remains a distinct assertion obligation.

Source: `src/renderer/src/web/preload-api/web-onboarding-api.ts:1-56`; `src/renderer/src/web/preload-api/web-star-nag-api.ts:1-21`.

### workspace-ports — `workspacePorts`

Lists return empty with an explicit unavailableReason; kill returns ok:false and events do not publish. Unavailable scanner is not an empty successful scan and cannot prove process termination.

Source: `src/renderer/src/web/preload-api/web-workspace-ports-api.ts:1-23`.

### profiles — `orcaProfiles`

Default local profile is synthetic, multiProfile false; auth/org/cloud are unconfigured; create/switch report the already-active default and transfer duplicates without a real account operation. Artifacts normally receives no account identity and displays its signed-out path. Profile/account UI effects beyond the inspected caller remain inherited.

Source: `src/renderer/src/web/preload-api/web-orca-profiles-api.ts:1-70`.

### e2e — `e2e`

Exposure config is captured before storage initialization; query knobs require VITE_EXPOSE_STORE. Concrete bridge offers test configuration, not runtime parity evidence. No test exposure or screenshot operation was invoked.

Source: `src/renderer/src/web/preload-api/web-e2e-api.ts:1-10`; `src/renderer/src/web/preload-api/web-e2e-config.ts:1-11`.

### settings — `settings`, `agentAwake`

Local normalized settings persist. Host mirroring is limited to configured visibility/card-style/compact/MiniMax/bot override fields and selected artifact/skill sharing reads. Current-environment acknowledgement gates visibility writes; rejected visibility is propagated while unrelated local changes survive. Other best-effort remote failures can be swallowed. agentAwake returns configured mode but active:false and no events/fonts. Browser settings can change without a paired-host setting change; false or synthetic status must not be upgraded to host capability.

Source: `src/renderer/src/web/preload-api/web-settings-api.ts:1-118`; `src/renderer/src/web/preload-api/web-preferences-store.ts:1-297`; `src/renderer/src/web/preload-api/web-preference-normalization.ts:1-174`; `src/renderer/src/web/preload-api/web-storage.ts:1-43`.

### keybindings — `keybindings`

Browser-local version-1 document has common and platform overrides; unknown/malformed/conflicting overrides are diagnosed/removed on read. Set normalizes and rejects conflicts before persistence; [] disables and null resets. Local/storage listeners notify. open/reveal/ensureFile only return a snapshot, without creating or revealing an OS file. Immediate browser persistence and dispatcher updates are concrete; OS file operations and native global registration are absent.

Source: `src/renderer/src/web/preload-api/web-keybindings-api.ts:1-174`; `src/renderer/src/web/preload-api/web-keybinding-normalization.ts:1-174`.

### ui — `ui`

UI get merges remote state with local pairing-sensitive fields; get failure retains local state. set persists locally and best-effort forwards; setWithAck propagates failure. Tour markers union and feature counters merge monotonically. Browser clipboard/DOM edit commands are concrete with permission limits; image write is no-op, file clipboard unsupported. Zoom is closure state. Native menu/window push registrations and commands are no-ops. Renderer-local navigation can work; native menus, popouts and registration cannot be inferred from successful calls.

Source: `src/renderer/src/web/preload-api/web-ui-api.ts:1-256`; `src/renderer/src/web/preload-api/web-preferences-store.ts:1-297`; `src/renderer/src/web/preload-api/web-clipboard-api.ts:1-223`.

### diagnostics — `diagnostics`, `crashReports`

Diagnostics status is disabled, pending crash null and dedupe success synthetic. Collect/send/preview/delete reject, copy returns typed failure, heap is null/browser fallback. Privacy actions should report explicit unavailability; there is no bundle/upload/crash-report implementation.

Source: `src/renderer/src/web/preload-api/web-diagnostics-api.ts:1-41`.

### cache — `cache`

Cache access uses browser-local storage. Cached data is not evidence of a current provider/runtime call.

Source: `src/renderer/src/web/preload-api/web-github-cache-api.ts:1-19`.

### runtime — `runtime`

RPC envelopes, errors/codes and subscriptions are forwarded through the paired runtime. Manual-disconnect fences apply before queue, on dequeue and after response; captured owner/environment is not rebound after await. syncWindowGraph ignores its graph and returns status. Local driver/page inventory and reclaim/restore are synthetic empty/false and events no-op. Remote execution remains possible via RPC even when a same-named desktop convenience namespace is missing; no contact means unverifiable.

Source: `src/renderer/src/web/preload-api/web-runtime-api.ts:1-44`; `src/renderer/src/web/preload-api/web-runtime-calls.ts:1-122`; `src/renderer/src/web/preload-api/web-runtime-session.ts:1-145`.

### runtime-environments — `runtimeEnvironments`

One stored paired environment; verify parses, enforces loopback intent, probes with 15-second timeout, checks compatibility, always closes probe and saves a verified replacement before closing the old connection. Disconnect retains pairing and fences calls; connect clears fence. retryControlConnection is no-op. Browser placement is server-backed, and post-await subscription cancellation is handled. Pairing/connection UI has real errors and compatibility gates; a stored pair or mobile websocket Boolean is not proof of a live connection.

Source: `src/renderer/src/web/preload-api/web-runtime-environments-api.ts:1-200`.

### repos — `repos`

Runtime repo list/add/remove/reorder/update/clone/create/default-path/reference-search are real and owner-stamped. addRemote performs add then environment-fenced update. Local pickers cancel/empty. SSH remote clone/create and host forget/reorder reject; abort/progress/change events are no-ops. Remote catalog and supported mutations are real; file-picker cancellation and unsupported desktop/SSH workflows must remain distinct.

Source: `src/renderer/src/web/preload-api/web-repositories-api.ts:1-130`.

### worktrees — `worktrees`

Runtime catalog requests limit 10000, use five-second cache and preserve owner/projection. Legacy fallback applies only to method_not_found; longest path resolves ownership and cache/fallback are fenced. Create/detect/meta/lineage/remove/setup/origin operations forward; mutation invalidates cache. Retired-name lookup swallows errors to empty; adopt/forget reject; progress/events no-op. Catalog pagination ceiling and silent auxiliary-empty states remain visible limits; missing progress is not proof a mutation stopped.

Source: `src/renderer/src/web/preload-api/web-worktrees-api.ts:1-191`; `src/renderer/src/web/preload-api/web-runtime-worktree-catalog.ts:1-183`.

### filesystem — `fs`

Read/list/search/preview/stat/markdown are remote. Six mutations use a session-bound client and advertised capability, SSH generation and expected owner; cross-worktree rename/copy rejects. pathExists maps only missing-path errors to false and propagates other errors. Download/log tail reject; external drops empty; authorize/watch/cancel no-op. Editor/explorer reads and mutations can be real while OS authorization/download/drop/watch UI is unsupported.

Source: `src/renderer/src/web/preload-api/web-filesystem-api.ts:1-200`.

### git — `git`

Status with abort tokens, history/conflict/abort/diff/branch compare, commit, fetch/push/pull/sync-fork and staging/mutations forward. Bulk discard is sequential. AI message/PR fields/model discovery return typed failures; huge-folder detection empty, append-ignore false; watch/cancel no-op. Source-control/PR mutations are not globally disabled in web; AI helpers and native watch-driven freshness are separate unsupported paths.

Source: `src/renderer/src/web/preload-api/web-git-api.ts:1-294`.

### github — `gh`

Explicit GitHub route table forwards provider/review/task RPCs, including capability-gated ready mutation. Viewer/null and refresh/event/diagnose-auth/star defaults are synthetic where implemented that way. Provider content can be real while account/readiness refresh helpers have empty defaults; UI-specific retry/pagination remains inherited.

Source: `src/renderer/src/web/preload-api/web-github-api.ts:1-208`; `src/renderer/src/web/preload-api/web-github-routes.ts:1-153`.

### gitlab — `gl`

Explicit GitLab routes forward RPC; closeMR/reopenMR share updateMRState. Viewer/project slug/MR-for-branch/MR/issue shortcuts return null and assignables empty. diagnoseAuth forwards; ready update is capability-gated. Do not substitute GitHub's auth behavior for GitLab; shortcut null is not proof a provider object does not exist.

Source: `src/renderer/src/web/preload-api/web-gitlab-api.ts:1-83`; `src/renderer/src/web/preload-api/web-gitlab-routes.ts:1-71`.

### review — `hostedReview`, `linear`, `hooks`

Dynamic namespace proxy forwards prefix plus terminal property using only the first argument; hostedReview prefers repo:id identity when supplied. Hooks use runtime operations. Nested proxy typing does not validate payload or establish all provider implementations. Task/review/hook callers can reach runtime without concrete per-method JavaScript members; downstream protocol/body verification belongs to bridge/provider obligations.

Source: `src/renderer/src/web/preload-api/web-review-api.ts:1-44`.

### stats-memory — `stats`, `memory`

stats.summary forwards, but any error is converted to four zero/null summary fields. Memory snapshot is synthetic empty. Stats can show the first-agent empty message for an unavailable runtime, indistinguishable from no activity; memory is not measured.

Source: `src/renderer/src/web/preload-api/web-memory-api.ts:1-24`.

### ai-vault — `aiVault`

Paired scans are host-stamped; explicit wrong local scope returns issues. Title resolution wrong-scope/failure returns []; resume preparation forwards. Cancel no-op, subagents [], prompt null; nonlocal delete rejects. Real session inventory/resume must be distinguished from silent title/subagent fallbacks and unsupported deletion.

Source: `src/renderer/src/web/preload-api/web-ai-vault-api.ts:1-93`.

### native-chat — `nativeChat`

Read and snapshot payloads are validated. Unpaired subscribe emits a Pair-host error snapshot; malformed and pending frames have explicit handling; pending does not consume initial state. Cancellation before handle acquisition and token unsubscribe are implemented. Native chat is a real remote portal, with source-tested subscription lifecycle; no transcript was generated during audit.

Source: `src/renderer/src/web/preload-api/web-native-chat-api.ts:1-164`.

### preflight-permissions — `preflight`, `developerPermissions`, `computerUsePermissions`

Preflight unpaired returns false defaults; paired check propagates errors while detect/refresh convert errors to empty/failed spawn. Developer permissions unsupported. Computer-use status forwards and propagates errors, setup failure becomes server guidance and reset returns web defaults. Mixed concrete probes and defaults require per-action UI states; false detection does not authenticate absent software.

Source: `src/renderer/src/web/preload-api/web-host-capability-api.ts:1-205`.

### skills — `skills`

Discover forwards and rejects errors. Delete checks capability then preview/delete RPC. Freshness inventory empty, updater idle/invalid names; share/install/manage reject desktop-only, distributions empty and events no-op. Discover/delete can work remotely; install dialog catches explicit rejection, while shell reveal can silently do nothing.

Source: `src/renderer/src/web/preload-api/web-host-capability-api.ts:1-205`.

### notifications — `notifications`

Delivery is false/not-supported; sound lacks path; permissions unsupported and probe nonauthoritative even if browser platform is macOS. Permission card returns its unsupported/null path; no force reprobe, OS delivery or mobile fanout is proven.

Source: `src/renderer/src/web/preload-api/web-notifications-api.ts:1-14`.

### accounts — `rateLimits`, `minimaxCredentials`, `grokAccounts`, `codexAccounts`, `claudeAccounts`, `codexConfigSync`

Rate limits return null/no-credit defaults; Claude/Codex mutation/read operations resolve empty results, Grok unsigned, MiniMax read/clear unconfigured and save rejects. codexConfigSync status is synthetic synced with no system path. An empty account list or synced label is not successful credential switching/config sync. Full provider menu consequences remain inherited.

Source: `src/renderer/src/web/preload-api/web-rate-limits-api.ts:1-36`; `src/renderer/src/web/preload-api/web-agent-accounts-api.ts:1-49`.

### cli-tcc-updater — `cli`, `macosTccPrompts`, `updater`

CLI status is unsupported with a Linux-style command hint; TCC pending empty. Updater is web-version/idle with no-op actions; Linux recovery rejects and build listing is ok:false. Installation/update/permission assistance must not be counted as desktop capabilities.

Source: `src/renderer/src/web/preload-api/web-cli-api.ts:1-27`; `src/renderer/src/web/preload-api/web-macos-tcc-api.ts:1-13`; `src/renderer/src/web/preload-api/web-updater-api.ts:1-34`.

### shell — `shell`

openPath/openUrl/openFileUri use browser window.open. openInFileManager/openInExternalEditor return ok:true with no OS effect; openFilePath returns false, pickers null and copyFile resolves without copying. shell.pathExists only resolves an owning worktree and catches every failure to false, unlike fs.pathExists stat. Reveal callers checking ok can appear successful with nothing revealed; owner membership is not file existence.

Source: `src/renderer/src/web/preload-api/web-shell-api.ts:1-30`.

### browser-emulator — `browser`, `emulator`

Native guest registration/devtools/viewport mostly false/no-op; profiles empty/create partition null, capture/hover/cookie import typed failures, SSH partition and emulator-frame start reject. Remote browser runtime creation/placement is a separate path. Do not conclude all browser tabs are absent from unsupported desktop guest methods; device streaming is not implemented by these defaults.

Source: `src/renderer/src/web/preload-api/web-browser-api.ts:1-110`.

### terminal-ssh — `pty`, `ssh`

Local PTY spawn rejects, write/resize/kill no-op or false, hasPty null, inspection rejects terminal_liveness_unavailable and snapshots/drivers empty. SSH target summaries/connect/getState forward if paired; unpaired empty/null. Add/update targets and add/update forwards reject; remove/disconnect/reset and event paths are no-op, remove-forward null, list-forwards empty and browse empty. Remote terminal execution via runtime is distinct; no contact or null inspection never proves exited. Forward add shows caller error, remove can look done without host effect.

Source: `src/renderer/src/web/preload-api/web-terminal-api.ts:1-180`.

### windows-shells — `wsl`, `pwsh`, `gitBash`

Availability and distro RPCs forward to the host but catch all errors as false/empty. Shell menu resolves auto PowerShell to pwsh only when available; explicit PowerShell choice remains explicit even if capability false. Both static and keyboard-driven create menus use the same helper. Browser OS controls chrome, paired host controls shells; no Windows launch was executed.

Source: `src/renderer/src/web/web-preload-api.ts:1-155,55-68`.

### agent-mobile-telemetry — `agentStatus`, `mobile`, `telemetryTrack`, `telemetrySetOptIn`, `telemetryGetConsentState`, `telemetryAcknowledgeBanner`

Agent-status snapshot empty and signals no-op. Mobile devices/interfaces/grants empty, pairing URL ok:false, relay offline and websocket readiness only Boolean(stored pairing). Telemetry opt-out/default/no-op. Pairing generator clears URL and shows unavailable; cached pairing must not be promoted to connection health or agent liveness.

Source: `src/renderer/src/web/preload-api/web-agent-status-api.ts:1-26`; `src/renderer/src/web/preload-api/web-mobile-api.ts:1-26`; `src/renderer/src/web/preload-api/web-telemetry-api.ts:1-11`.

### fallback — `$fallback`

withFallback wraps concrete objects recursively and leaves functions untouched; missing properties yield truthy callable proxies. then is undefined; on* returns unsubscribe; is*/has*/pathExists resolves false; list*/detect* resolves []; preview* resolves found:false,diff:{},unsupportedKeys:[]; get*Status resolves []; write/resize/reportGeometry return undefined; zero-argument getZoomLevel/declarePendingPaneSerializer return 0; all other calls resolve undefined. Missing optional namespace guards are bypassed by truthy proxies. Empty values, successful promises and shape-invalid data are not capabilities.

Source: `src/renderer/src/web/preload-api/web-fallback-api.ts:1-63`.

### bots — `bots`

All seven concrete Bots methods reject with the desktop-only message, including list and responsibility operations. useBotsPageController catches list rejection, records error and clears loading; this does not erase implemented desktop Bots behavior.

Source: `src/renderer/src/web/web-preload-api.ts:1-155`.

Two external helpers were also read: `src/renderer/src/web/web-file-mutation-methods.ts:1-130` (session/capability/generation/owner fences and cross-worktree mutation rejection) and `src/renderer/src/runtime/web-session-browser-placement.ts:1-245` (bounded pending reservations, adoption and cleanup ownership). This does not close the whole browser creation/stream/reconnect graph.

## All 50 named surfaces reconciled

`Inherited` means the direct factory projection is characterized but a deeper component chain is still open; its original tests/rendered obligations are retained in JSON. A bounded caller row is source characterization, not product acceptance.

| Existing ID | Web domain group(s) | Caller outcome / limit |
| --- | --- | --- |
| PUI-SIDEBAR-001 | repos, worktrees, settings, ui, runtime | Navigation is renderer-local; paired repo/worktree catalogs forward, while local file selection cancels and SSH management has unavailable mutations. |
| PUI-SETTINGS-000 | settings, ui, keybindings, profiles, preflight-permissions, accounts, skills, notifications, stats-memory, cli-tcc-updater, runtime-environments, terminal-ssh, agent-mobile-telemetry, fallback | 35 literal pane identities plus dynamic repo instances and three intents; provider controls retain per-domain defaults/unsupported behavior. |
| PUI-SETTINGS-002 | settings, ui | **Inherited deeper caller gap.** Control search remains renderer-local over settings metadata; no generic fallback makes controls supported. |
| PUI-SHELL-002 | app-session, ui, runtime | **Inherited deeper caller gap.** Web beforeunload saves a browser-local sanitized session; flush no-op cannot establish desktop process checkpoint/restore. |
| PUI-SIDEBAR-002 | fallback | workspaceSpace.getCachedAnalysis resolves undefined, which cached===null does not reject; analyze resolves undefined then result.ok throws into scan error. |
| PUI-TABS-001 | ui, runtime, browser-emulator, terminal-ssh, windows-shells | Both shell-create menu callers share explicit-vs-auto PowerShell resolution; runtime creation is separate from rejected local pty.spawn. |
| PUI-TERM-001 | runtime, terminal-ssh | **Inherited deeper caller gap.** Local PTY spawn rejects; inspection rejects liveness-unavailable and hasPty is null. Remote terminal RPC is a separate path; renderer liveness overlay behavior remains inherited. |
| PUI-TERM-002 | ui, keybindings | Search is a renderer/xterm interaction; keybindings persist locally and global dispatcher has terminal-find exclusions. |
| PUI-TERM-004 | ui, runtime | Native floating-window commands are no-ops; global dispatcher handles local empty-floating close/max cases. Actual detach and pointer geometry remain inherited. |
| PUI-TABS-002 | ui, runtime | **Inherited deeper caller gap.** Local layout persists through ui; runtime graph sync does not itself apply the passed graph. Full split/layout projection remains inherited. |
| PUI-EDITOR-001 | filesystem, git, shell, ui | **Inherited deeper caller gap.** Remote file reads and capability-fenced mutations are real; download/drop/native reveal helpers are unsupported or synthetic. Rich editor caller details remain inherited. |
| PUI-SC-001 | git, filesystem, review | **Inherited deeper caller gap.** Git mutations forward but AI-message/model helpers explicitly fail; watch registration is no-op. Full staging/recovery caller semantics remain inherited. |
| PUI-SC-002 | git, github, gitlab, review | **Inherited deeper caller gap.** Review/check routes forward while selected viewer/refresh/event shortcuts synthesize null/false. Polling/failure component states remain inherited. |
| PUI-PR-001 | github, gitlab, review, git, filesystem | **Inherited deeper caller gap.** Remote PR/MR routes and readiness capability gates are real; shortcut null/defaults and unsupported AI fields differ by provider. |
| PUI-BROWSER-001 | browser-emulator, runtime, runtime-environments | **Inherited deeper caller gap.** Native guest facade is mostly unavailable; runtime client-hosted/server browser placement remains separately implemented. Full remote creation/stream reconnect caller graph remains open. |
| PUI-NATIVECHAT-001 | native-chat, runtime | Pair-host and malformed snapshot errors, pending initial state and unsubscribe cancellation are concrete web subscription semantics. |
| PUI-DASHBOARD-001 | agent-mobile-telemetry, ui, runtime, fallback | **Inherited deeper caller gap.** Native popout callbacks and agent-status snapshots do not establish a live dashboard; exact popout renderer consequence remains inherited. |
| PUI-AIVAULT-001 | ai-vault, runtime, filesystem | Inventory/resume uses paired RPC and owner stamping; wrong local scope gives explicit issues, title failures become empty, nonlocal delete rejects. |
| PUI-ACCOUNTS-001 | accounts, profiles | **Inherited deeper caller gap.** Provider credentials/default lists are synthetic; MiniMax save rejects and config-sync synced is not a real write. All menu aftermaths remain inherited. |
| PUI-SKILLS-001 | skills, shell, profiles | Discover/delete can forward; install/share/manage explicitly reject. Install catches failure; reveal checking ok receives synthetic success without an OS action. |
| PUI-ARTIFACTS-001 | profiles, runtime, settings | Default unconfigured profile makes accountIdentity null and skips list RPC; the page shows auth state. With valid identity the list client uses real artifacts.list runtime RPC. |
| PUI-TASKS-001 | github, gitlab, review, runtime, fallback | **Inherited deeper caller gap.** GitHub/GitLab/Linear/hook remote routes are concrete. Missing direct provider namespaces use fallback; complete Jira/provider caller routing has not been closed by this web projection review. |
| PUI-AUTOMATIONS-001 | runtime, fallback | Native automation list/run/update/delete uses scoped RPC, capability/pair revision validation and view-only legacy handling. External-manager fallback list resolves [] and missing manager is silently omitted. |
| PUI-BOTS-001 | bots, preflight-permissions, runtime | Concrete list rejects desktop-only; controller catches error and clears loading. The accepted 19 desktop states remain retained. |
| PUI-MENTU-001 | fallback, runtime | Truthy mentu proxy passes availability guard; capability resolves undefined and listRecipes resolves []; coalesced fulfillment evaluates 'label' in undefined before state commit, risking unhandled rejection and stuck loading. |
| PUI-MEETINGS-001 | fallback, filesystem, shell, runtime | Truthy meetings proxy list resolves [] instead of null; controller stores it and snapshot?.meetings.length throws on render, with page error boundary. Desktop ten-state evidence remains retained. |
| PUI-CONN-003 | agent-mobile-telemetry, browser-emulator, runtime | Web mobile interfaces/grants/devices empty and pairing URL unavailable; emulator frame rejects. Separate remote stream implementation remains unclosed. |
| PUI-DIAG-001 | diagnostics, shell | **Inherited deeper caller gap.** Synthetic disabled status and explicit collect/preview/send/delete failures; actual privacy control render evidence still owed. |
| PUI-ONBOARD-001 | onboarding, preflight-permissions, settings, notifications | Web stores a dismissed closed state and suppresses desktop first-run flow; desktop close/skip persistence and explicit reopen remain distinct. |
| PUI-FEATURETIPS-001 | ui, settings, onboarding | Web UI merge unions seen tour IDs and preserves monotonic counters; it does not add arbitrary mid-tour resume. |
| PUI-PLUGINCATALOG-001 | fallback | Truthy plugins proxy yields empty marketplace/panels with ready state; refresh silently empty. Forced/retained install or rollback consumes undefined.ok and is caught as action error; no real web validation/rollback. |
| PUI-NOTIF-001 | notifications, settings, agent-mobile-telemetry | Unsupported permission status exits the mac card with null state; dispatch false/not-supported. Force probing and fanout remain desktop-only source obligations. |
| PUI-WEBMODE-001 | all groups | Every concrete top-level factory plus generic fallback is mapped; domain labels cannot substitute for caller shape validation or rendered acceptance. |
| PUI-PETS-001 | fallback, ui, settings | Import and bundle import undefined are treated like picker cancellation. Custom pet read undefined returns null before Blob creation; bundled renderer artwork is distinct. |
| PUI-STATS-001 | stats-memory, accounts | Remote summary failure becomes zero totals, selecting first-agent empty messaging; three summary cards only for nonzero totals. Separate usage providers retain inherited gaps. |
| PUI-SPARSE-001 | fallback, worktrees, settings | sparsePresets list [] loads empty. Save undefined can append undefined before saved.name throws (or throw earlier on existing entry saved.id); remove can toast success after no-op. Worktree create supports raw sparse fields via RPC. |
| PUI-QUICKCMD-001 | settings, runtime | Local commands persist in local settings; remote loads capability/generation gate and mutations serialize per environment, validate reply, ignore stale generation and retain old commands plus errors on failure. |
| PUI-CONN-001 | terminal-ssh, runtime-environments, runtime | Target summaries/connect/getState can forward with generation; management mutations mostly unsupported. Persisted startup timeouts and loss of contact remain unverifiable. |
| PUI-CONN-002 | runtime-environments, agent-mobile-telemetry | Consumer pairing verification/disconnect/reconnect is real; web producer getRuntimePairingUrl ok:false clears generated URLs and shows unavailable, so no QR is produced. |
| PUI-KEYS-001 | keybindings, ui | Normalized conflict-checked browser persistence is real. No native file reveal/global registration; recorder and dispatcher boundaries are distinct. |
| PUI-FILEEXP-001 | filesystem, shell, runtime | Remote read/filter and six owner/capability-fenced mutations exist. Reveal may report success without effect; name-filter auto-expansion remains an inherited independent assertion obligation. |
| PUI-PORTS-001 | workspace-ports, terminal-ssh | Scanner has explicit unavailable reason, forward add/update rejection becomes inline dialog error; remove null may look successful without host mutation or event refresh. |
| PUI-SHELL-001 | platform, ui | Windows AND Linux desktop chrome uses 138x36 controls, browser web excluded; mac gutter 80. Constants do not prove rendered insets/fullscreen behavior. |
| PUI-SHELL-003 | keybindings, ui, runtime | App installs capture-phase keyboard dispatcher with recorder/defaultPrevented/editable/terminal/floating guards, plugin ordering, double-tap and blur cleanup. |
| PUI-TERM-003 | windows-shells, platform, terminal-ssh, runtime | Static menu and controller call the same helper: auto selects pwsh only if available; explicit selection stays explicit; other shells unchanged. |
| PUI-SETTINGS-001 | settings, ui | Preserve ambiguous numeric range head as a legacy aggregate alias; propose explicit PANE-literal IDs rather than reusing 002/003 or silently retiring the old ID. |
| PUI-SETTINGS-003 | settings, ui, runtime | Validated pane/repo/host target selects host before scrolling, mounts pane, handles three intents and retries delayed subsection DOM via observer; five-second expiry remains untested. |
| PUI-KEYS-002 | keybindings, ui | Shortcut settings remains separate from catalog identity; save/disable/reset has real browser-local persistence and conflict validation, file operations synthetic. |
| PUI-DROGON-001 | bots, fallback, runtime | Generic DrogonProductSectionPage is not the active Bots/Meetings implementation. Retain implemented desktop state evidence and web-specific differences instead of calling all three placeholders. |
| PUI-CONN-004 | agent-mobile-telemetry, runtime-environments, terminal-ssh, windows-shells | Host/network access and stored-pair defaults are separate from socket health; desktop/native remote control outcomes remain inherited and E5-owned. |

## All 19 remaining invariants

The initial desktop characterization and exact prior remaining tests are retained per invariant in JSON. None is silently replaced by a desired behavior inferred from its title.

| ID / invariant index | Existing obligation | Web interpretation |
| --- | --- | --- |
| PUI-ONBOARD-001 / 0 | recovery (no re-show after completion) | Web stores a dismissed closed state and suppresses desktop first-run flow; desktop close/skip persistence and explicit reopen remain distinct. |
| PUI-ONBOARD-001 / 1 | recovery (no re-show after skip) | Web stores a dismissed closed state and suppresses desktop first-run flow; desktop close/skip persistence and explicit reopen remain distinct. |
| PUI-FEATURETIPS-001 / 0 | recovery (tour resume-after-restart) | Web UI merge unions seen tour IDs and preserves monotonic counters; it does not add arbitrary mid-tour resume. |
| PUI-PLUGINCATALOG-001 / 0 | error (malformed capability fail-closed) | Truthy plugins proxy yields empty marketplace/panels with ready state; refresh silently empty. Forced/retained install or rollback consumes undefined.ok and is caught as action error; no real web validation/rollback. |
| PUI-PLUGINCATALOG-001 / 1 | recovery (rollback restores without full reinstall) | Truthy plugins proxy yields empty marketplace/panels with ready state; refresh silently empty. Forced/retained install or rollback consumes undefined.ok and is caught as action error; no real web validation/rollback. |
| PUI-NOTIF-001 / 0 | recovery (force reprobe corrects prior failed state) | Unsupported permission status exits the mac card with null state; dispatch false/not-supported. Force probing and fanout remain desktop-only source obligations. |
| PUI-WEBMODE-001 / 0 | error (honest degradation, never silent no-op) | Every concrete top-level factory plus generic fallback is mapped; domain labels cannot substitute for caller shape validation or rendered acceptance. |
| PUI-WEBMODE-001 / 1 | state (per-domain web projection completeness) | Every concrete top-level factory plus generic fallback is mapped; domain labels cannot substitute for caller shape validation or rendered acceptance. |
| PUI-PETS-001 / 0 | recovery (malicious bundle rejection) | Import and bundle import undefined are treated like picker cancellation. Custom pet read undefined returns null before Blob creation; bundled renderer artwork is distinct. |
| PUI-STATS-001 / 0 | state (what the stats pane actually shows) | Remote summary failure becomes zero totals, selecting first-agent empty messaging; three summary cards only for nonzero totals. Separate usage providers retain inherited gaps. |
| PUI-SPARSE-001 / 0 | recovery (settings-time/creation-time consistency) | sparsePresets list [] loads empty. Save undefined can append undefined before saved.name throws (or throw earlier on existing entry saved.id); remove can toast success after no-op. Worktree create supports raw sparse fields via RPC. |
| PUI-SPARSE-001 / 1 | action (add/edit/delete flows) | sparsePresets list [] loads empty. Save undefined can append undefined before saved.name throws (or throw earlier on existing entry saved.id); remove can toast success after no-op. Worktree create supports raw sparse fields via RPC. |
| PUI-QUICKCMD-001 / 0 | recovery (cross-surface scope-visibility contract) | Local commands persist in local settings; remote loads capability/generation gate and mutations serialize per environment, validate reply, ignore stale generation and retain old commands plus errors on failure. |
| PUI-CONN-001 / 0 | recovery (startup reconnect / degrade to unverifiable) | Target summaries/connect/getState can forward with generation; management mutations mostly unsupported. Persisted startup timeouts and loss of contact remain unverifiable. |
| PUI-CONN-002 / 0 | action (pairing URL/QR generation) | Consumer pairing verification/disconnect/reconnect is real; web producer getRuntimePairingUrl ok:false clears generated URLs and shows unavailable, so no QR is produced. |
| PUI-KEYS-001 / 0 | action (rebind persists immediately) | Normalized conflict-checked browser persistence is real. No native file reveal/global registration; recorder and dispatcher boundaries are distinct. |
| PUI-FILEEXP-001 / 0 | action (row context menu: rename/delete/reveal) | Remote read/filter and six owner/capability-fenced mutations exist. Reveal may report success without effect; name-filter auto-expansion remains an inherited independent assertion obligation. |
| PUI-FILEEXP-001 / 1 | action (name filter auto-expands matching tree nodes) | Remote read/filter and six owner/capability-fenced mutations exist. Reveal may report success without effect; name-filter auto-expansion remains an inherited independent assertion obligation. |
| PUI-PORTS-001 / 0 | action (SSH forward add/remove) | Scanner has explicit unavailable reason, forward add/update rejection becomes inline dialog error; remove null may look successful without host mutation or event refresh. |

The universal expectation “honest degradation, never silent no-op” is **not true of the pinned source**. Concrete synthetic-success helpers, swallowed failures and absent-namespace proxies establish counterexamples. Migration must record the source state and obtain root's behavioral contract before treating a correction as required parity; it cannot count the synthetic state as an implemented capability.

## Navigation identity and reachability

Activity is **restore-reachable**, with a source mount and close path but no current direct non-test `openActivityPage` caller found. `src/shared/top-level-view.ts:5-23` explicitly accepts `activity`; hydration at `ui-slice-hydration-actions.ts:285-287` invokes the sanitizer at `ui-slice-hydration-sanitizers.ts:174-180`. The existing assertion at `ui-hydration-view-layout.test.ts:167-175` restores persisted Activity on startup. `ui-page-navigation.test.ts:301-311` opens it programmatically and checks return from Settings; it does not prove a fresh UI opener.

The Sidebar bell changes `sidebarBody=agents`, independently of `activeView=activity`. Proposed root-owned IDs are **PUI-ACTIVITY-001** for the legacy full page and **PUI-SIDEBAR-003** for the Agents sidebar body; neither is added to the accepted 50-ID denominator here. The Activity branch suppresses **showSidebar**, while retaining its Activity titlebar controls. Activity open/close stashes and restores the prior view without history rewind; Space and Mobile also omit rewind, so the leaf's “every sibling” comparison was incorrect. This alone is not a defect.

For Settings, retain **PUI-SETTINGS-000** taxonomy, **001** legacy aggregate alias, **002** control search and **003** navigation/deep links. Propose these literal pane IDs, pending root ratification:

`PUI-SETTINGS-PANE-general`, `PUI-SETTINGS-PANE-integrations`, `PUI-SETTINGS-PANE-accounts`, `PUI-SETTINGS-PANE-browser`, `PUI-SETTINGS-PANE-git`, `PUI-SETTINGS-PANE-tasks`, `PUI-SETTINGS-PANE-appearance`, `PUI-SETTINGS-PANE-input`, `PUI-SETTINGS-PANE-floating-workspace`, `PUI-SETTINGS-PANE-terminal`, `PUI-SETTINGS-PANE-quick-commands`, `PUI-SETTINGS-PANE-notifications`, `PUI-SETTINGS-PANE-computer-use`, `PUI-SETTINGS-PANE-developer-permissions`, `PUI-SETTINGS-PANE-privacy`, `PUI-SETTINGS-PANE-advanced`, `PUI-SETTINGS-PANE-dev`, `PUI-SETTINGS-PANE-voice`, `PUI-SETTINGS-PANE-shortcuts`, `PUI-SETTINGS-PANE-stats`, `PUI-SETTINGS-PANE-ssh`, `PUI-SETTINGS-PANE-experimental`, `PUI-SETTINGS-PANE-plugins`, `PUI-SETTINGS-PANE-agents`, `PUI-SETTINGS-PANE-orchestration`, `PUI-SETTINGS-PANE-artifacts`, `PUI-SETTINGS-PANE-share-skills`, `PUI-SETTINGS-PANE-automations`, `PUI-SETTINGS-PANE-orca-account`, `PUI-SETTINGS-PANE-linear`, `PUI-SETTINGS-PANE-setup-guide`, `PUI-SETTINGS-PANE-servers`, `PUI-SETTINGS-PANE-mobile`, `PUI-SETTINGS-PANE-mobile-emulator`, `PUI-SETTINGS-PANE-repo`.

Three intent IDs: `PUI-SETTINGS-INTENT-add-quick-command`, `PUI-SETTINGS-INTENT-add-remote-orca-server`, `PUI-SETTINGS-INTENT-add-ssh-host`. Five named subtarget IDs: `PUI-SETTINGS-SUBTARGET-developer-permissions-full-disk-access`, `PUI-SETTINGS-SUBTARGET-browser-terminal-link-actions`, `PUI-SETTINGS-SUBTARGET-browser-client-hosted-remote`, `PUI-SETTINGS-SUBTARGET-browser-ssh-workspace-routing`, `PUI-SETTINGS-SUBTARGET-general-global-worktree-visibility`.

Use PUI-SETTINGS-PANE-repo with separate structured instance fields repoId, hostId, optional setupId and representativeSectionId. getSettingsSectionId resolves repo to repo-<representative or repoId>; do not concatenate arbitrary repo IDs into new canonical acceptance IDs. Target validator rejects unknown pane/intent/host (dev action throws; production ignores). openSettingsTarget records a target, not page opening; callers separately openSettingsPage. Page effects select requested repo host before subsection scrolling, open Appearance accordion when needed, increment one of three intent signals, mount the pane, then clear the stored target. Scroll effect clears search for subsection, activates visible pane and watches delayed DOM; section scroll has 16px inset. Watcher cancels and expires at five seconds.

Source: `settings-navigation-types.ts:15-91`, `settings-navigation-foundations.ts:10-137`, `ui-slice-settings-actions.ts:1-60`, `use-settings-page-effects.ts:159-238`, `use-settings-repo-scroll-effects.ts:127-209`, and `settings-deep-link-target-watcher.ts:1-54`, all under their full renderer paths in JSON. E2 still owns field routing and visibility; 35 pane IDs do not prove 35 always-visible physical sections.

Supplemental linkage: App installs `use-global-keybindings`; its capture dispatcher observes recorder/defaultPrevented/editable/terminal/floating/plugin/double-tap boundaries and blur cleanup. `app-command-handlers.ts:85-269` gates history, workspace actions, board/tasks and right-sidebar views. This is not the complete static/dynamic shortcut census. Both `use-tab-bar-create-menu-controller.ts:150-167` and `tab-bar-static-create-menu.tsx:63-89` use `windows-shell-launch.ts:1-17`: auto uses pwsh when available, explicit choices stay explicit, other shells are unchanged. Windows/Linux custom chrome is 138×36, excluded in web; mac traffic-light gutter is 80. No platform launch or chrome rendering was performed.

## Assertion-body evidence and exact execution debt

| Existing test file / reviewed range | Actual assertions read | Execution status |
| --- | --- | --- |
| `src/renderer/src/web/web-preload-api-composition.test.ts:15-84,86-118` | Exact 59 concrete top-level keys plus nonenumerable fallback/then; E2E config before storage. Does not verify every fallback caller. | Not executed in this follow-up |
| `src/renderer/src/web/web-preload-api-agent-providers.test.ts:19-146,158-164,177-262` | Native chat field/lifecycle and pending-before-initial assertions; MiniMax unconfigured/reject; vault owner/scope RPC and mismatch. | Not executed in this follow-up |
| `src/renderer/src/web/web-preload-api-ssh.test.ts:18-70` | Forwarded target summaries/connect/getState preserve provider epoch/generation and do not invent generation for partial state. | Not executed in this follow-up |
| `src/renderer/src/web/web-preload-api-runtime-calls.test.ts:19-207` | Success/failure envelope metadata, domain error code, queue overflow/concurrency and queued timeout budget. | Not executed in this follow-up |
| `src/renderer/src/web/web-preload-api-keybindings.test.ts:14-79` | Browser set/disable/reset persisted; conflicts reject retaining old state; listeners notified. | Not executed in this follow-up |
| `src/renderer/src/web/web-preload-api-ui.test.ts:24-69,498-536,788-879` | Partitioned session save/native defaults; stale tour union; set versus setWithAck; discovery and computer permission errors propagate. | Not executed in this follow-up |
| `src/renderer/src/web/web-preload-api-settings.test.ts:479-553` | Visibility acknowledgement failure rejects while local font persists; old host omits unsupported additive field and write. | Not executed in this follow-up |
| `src/renderer/src/web/web-preload-api-filesystem.test.ts:1-112` | Download and remote SSH clone reject; missing-path stat resolves false with exact runtime path. | Not executed in this follow-up |
| `src/renderer/src/web/web-preload-api-workspace-catalog.test.ts:20-28,41-46,49-84` | Explicit scanner-unavailable, host reorder rejection and owner-stamped repo catalog. | Not executed in this follow-up |
| `src/renderer/src/web/web-preload-api-runtime-environment.test.ts:174-245` | Disconnect retains pair, fences passive request/subscription, and connect creates a fresh client. | Not executed in this follow-up |
| `src/renderer/src/web/web-preload-api-github.test.ts:517-585` | Ready mutation advertises required capability; older capability omits write. | Not executed in this follow-up |
| `src/renderer/src/web/web-preload-api-gitlab.test.ts:247-269` | Aggregate route call/key assertions read; not every preceding table case body reviewed. | Not executed in this follow-up |
| `src/renderer/src/components/tab-bar/windows-shell-launch.test.ts:1-28` | Auto pwsh true/false, explicit choices retained, three other shell values unchanged. | Not executed in this follow-up |
| `src/renderer/src/store/slices/ui-page-navigation.test.ts:301-311` | openActivity then settings-close restores activity; does not prove actual page opener or Activity-close history behavior. | Not executed in this follow-up |
| `src/renderer/src/store/slices/ui-hydration-view-layout.test.ts:145-176` | Persisted activity is restored on startup; distinguishes hydrated state from fresh click reachability. | Not executed in this follow-up |
| `src/renderer/src/components/settings/settings-deep-link-target-watcher.test.ts:1-108` | Late target, unrelated mutations, at-most-once callback, cancellation and body fallback; no timeout expiry assertion. | Not executed in this follow-up |
| `src/renderer/src/components/activity/activity-terminal-portal.test.tsx:35-70` | Original two React assertions: identical descriptor does not rerender; changed pane key causes one additional render. | 2 original cases passed by root; retained JSON reviewed |
| `src/renderer/src/components/activity/activity-terminal-portal-publication-loop.react185.test.tsx:26-57` | Original React feedback loop settles without throw and fewer than ten renders. | 1 original cases passed by root; retained JSON reviewed |

Root's retained `audit-activity-publication-QWdNFk` results: SHA-256 `efe85671c32de053e9d40847e2399e0924c782b4ed5cfc274bb9076caf43c493`, two passed. `audit-activity-feedback-uOSGIu`: `537d946fb4286ac70defd646d29a07c0f48ab0b47d1f643b38cf4d6e983b832f`, one passed. Manifests, stage-receipt hashes, environment and paths are recorded in JSON. Root's 78 infrastructure tests are separate and do not expand these three source assertions.

- **WEB-COMPOSED-MENTU** — Install actual web preload, select valid workspace/recipe scope, run unmocked Mentu discovery through coalescer and loader; assert the current undefined capability failure/stuck-loading behavior explicitly before any product fix, then define honest unavailable-state candidate contract.
- **WEB-COMPOSED-MEETINGS** — Install actual web preload, mount MeetingsPage with its real controller/runtime; assert list [] produces invalid snapshot and page-boundary behavior, then characterize intended unavailable snapshot separately. Include mount and Q&A fallback paths.
- **WEB-COMPOSED-BOTS** — Actual web preload plus real Bots controller: list rejection text, error rendering, loading finally cleared and retry; preserve all desktop Bots tests.
- **WEB-SYNTHETIC-MUTATIONS** — Actual composed proxy with Plugins marketplace/panels, Sparse preset empty and nonempty save/delete, Pet import/bundle/read and workspaceSpace cached/analyze/cancel; assert no success label is mistaken for host mutation and capture current caught/unhandled/empty states.
- **WEB-REAL-VS-EMPTY** — Paired/unpaired/disconnected/timeout/stale-environment cases for stats zero fallback, vault title [] fallback, SSH summary null, retired names [], provider viewer null and account/config synthetic defaults; distinguish a legitimate empty result from failure in rendered callers.
- **WEB-FILES-AND-REVEAL** — Exercise capability+generation+owner guarded write/create/rename/copy/delete, cross-worktree rejection and fs.pathExists missing versus transport error; compare shell.pathExists on absent in-worktree file and synthetic file-manager/editor ok with exact UI notices.
- **WEB-REMOTE-FEATURE-ROUTING** — Composed web caller journeys for native automation scoped RPC/external-manager absence, artifact signed-out versus valid-account list, remote browser creation and terminal liveness; preserve environment fencing and do not mock missing product behavior.
- **WEB-LOCAL-PERSISTENCE** — Reload isolated browser storage after onboarding dismissed, feature-tour seen union, keybinding set/disable/reset and local quick-command edits; storage failure/conflict and two-client stale merges must preserve source behavior.
- **WEB-HOST-QUICKCOMMANDS** — Remote read/update replies validated; serialized upsert/delete, stale connection generation ignored, malformed reply and unavailable capability retain prior commands/errors; cross-host menus only show intended normalized scope.
- **WEB-PAIRING-PORTS-NOTIFICATIONS** — Real web projection into pairing form clears generated URL/QR on ok:false; disconnect/reconnect retains pair with RPC fence; forward add/update inline errors and remove-no-op characterization; unsupported mac permission card never claims authoritative permission.
- **ACTIVITY-NAV-RESTORE** — Run existing startup activity and settings-back assertions; add direct close prior-view/history characterization, sidebar agents toggle independent of activeView, no-fresh-opener reachability regression if root elects preserving legacy restore-only behavior.
- **ACTIVITY-PORTAL-REMAINDER** — Preserve root-passed three original TSX assertions; add every routing-field permutation, enabled->disabled unsubscribe and retained state, exact-match/active/singleton/null precedence; execute real Electron terminal portal render/race journey.
- **SETTINGS-NAV-MATRIX** — All 35 pane target identities, dynamic representative repo/host/setup selection, three intent increments, five named subtargets, unknown input rejection, pending target/hidden pane, Appearance accordion and observer five-second expiry/cancel.
- **SHELL-SHORTCUT-WINDOWS** — Execute capture/recorder/editable/terminal/plugin/double-tap/floating/blur shortcut arbitration; both create menus choose same auto/explicit Windows shell; actual Windows/Linux/macOS and web chrome, narrow/fullscreen, keyboard focus and deep links need rendered platform evidence.
- **INHERITED-E1-REMAINDER** — Retain every per-card semantic/rendered/test obligation from initial closure.json, including search control metadata, provider menu/pagination/retry, rich editors, split/drag layout, session shutdown, dashboard and full remote streaming. This follow-up does not close these non-Drogon gaps.

Exact existing test selections and source-compatible invocation are in `futureAcceptanceCommands` in JSON. They are proposed, not run: root must use an approved isolated checkout/capsule with source-compatible dependencies and configuration, preserving assertions and source bytes. The source `test` script invokes native-runtime setup, so it must not be blindly run in the frozen reference. New test locations require root allocation to the existing WP/card ownership; no invented executable command is presented as passing evidence.

## Leaf review, lifecycle and limits

- Correct leaf parentLead from settled task_671da369fc93 / ctx_2b1bbe519b1c to task_37a4a186978f / ctx_473e529ccc25; snapshot preserved.
- Correct global Activity-unreachable inference with actual startup hydration and assertion body.
- Correct mount/titlebar source branches from 'rendered' to source-backed; no Electron window or terminal was rendered by leaf/lead.
- Correct no-portal-tests claim: original activity-terminal-portal.test.tsx has two assertions; activity-terminal-portal-publication-loop.react185.test.tsx has one. Lead read all bodies and root result JSON; all three passed in root capsules.
- Correct every-sibling history claim: Space and Mobile also lack rewind; do not call this a defect without a behavioral contract.
- Correct chrome predicate specifically to showSidebar.
- Correct settings retirement/edit ownership: root alone ratifies central IDs and no old ID is retired here.
- Correct watcher test anchors to actual 1-108 file; five existing cases do not exercise five-second expiry.
- Leaf model command is launch evidence; custom attached receipt model fields were null, not server authentication.

Fresh parent: `task_37a4a186978f` / `ctx_473e529ccc25`. Root's fresh authorization permitted the one actual depth-2 smoke: child Run `run_3d1c0573e82c`, task `task_9cfdb3d5d545`, dispatch `ctx_840482929375`, Claude command `claude --model claude-sonnet-5 --effort medium --dangerously-skip-permissions`. The leaf completed successfully, its evidence was read and corrected above, and it was released. Exact release receipt: **requestId `26298d3b-52c6-454c-9a19-c4fa7584b299`; verdict `retained`; reason `external_terminal`; processAction `none`**. This respects the returned external-resource ownership; no terminal was force-closed. No further child, identity rebind or depth reset occurred. Parent inbox routing was fenced after child-Run binding; root supplied current-task terminal guidance.

Proposed closure is deliberately split: direct web-factory enumeration and this finite navigation reconciliation are ready for independent review; **E1 remains open**. Thirteen deeper caller chains, dynamic runtime/provider server semantics, all retained non-Drogon gaps and central identity ratification remain source-enumeration obligations. The separate execution debt includes composed-web regression tests, complete source-test migration and rendered/integrated platform journeys. Initial snapshot fingerprints and every source hash are in the matching JSON; accepted M1–M7 evidence was not re-enumerated.

