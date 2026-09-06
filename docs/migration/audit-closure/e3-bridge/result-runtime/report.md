# Runtime result-completeness audit

All **16 assigned DR groups / 211 exact methods** are reconciled through concrete immediate-owner result contracts. The five recorded runtime-local source joins are now characterized, including the additional WSL transcript gate/process chain. This is **ready for root source review**, with three explicitly bounded shared-service joins owned by other DR assignments; it does not accept those owners or the whole E3 area.

Source: `c97906287bb7a390b25e2025b600d9fb3c25d9c3`, read-only `/Users/carlos/Documents/Drogon-mentu-session`. Task `task_c8c718dc586c`, Dispatch `ctx_73644d3d0ebf`. The supplied pin was not independently authenticated with Git; actual source bytes and inclusive ranges have SHA256 evidence. No Git command, source edit, install, product action, baseline test, candidate test or model-inference test was run. Only the two assigned parent artifacts and the owned leaf artifacts were written; previous reports and leaf delivery remain unchanged.

Overall audit remains **10/12 = 83.3%, unchanged, medium-low confidence**. Root owns acceptance, and tests and product fidelity remain separate gates. Next milestone: root's independent source samples and cross-owner reconciliation. The 24-hour deadline risk remains elevated.

[contracts.json](contracts.json) contains the exact method table,27 shared runtime contracts,39 method-specific browser contracts plus the explicitly reused51-method raw translator contract,6 additional service contracts,382 parent-read source/assertion ranges,90 reviewed leaf method anchor sets, original allocations and all inherited test queues. Every range records full-file and range SHA256. Compact SRC links refer to the exact `sourceEvidence` record in JSON. A type annotation, callback registration, admission receipt or CLI formatter is never treated as service-outcome proof.

## Assigned methods and ownership

| ID | Method count | Source disposition |
| --- | ---: | --- |
| DR-STATUS_METHODS | 1 | Characterized at assigned boundary; root review pending |
| DR-AGENT_SESSION_METHODS | 2 | Characterized at assigned boundary; root review pending |
| DR-STRUCTURED_AGENT_SESSION_METHODS | 16 | Characterized at assigned boundary; root review pending |
| DR-TERMINAL_METHODS | 34 | Characterized at assigned boundary; root review pending |
| DR-TERMINAL_ORPHAN_METHODS | 1 | Characterized at assigned boundary; root review pending |
| DR-BROWSER_CORE_METHODS | 53 | Characterized at assigned boundary; root review pending |
| DR-BROWSER_SCREENCAST_METHODS | 2 | Characterized at assigned boundary; root review pending |
| DR-BROWSER_EXTRA_METHODS | 28 | Characterized at assigned boundary; root review pending |
| DR-BROWSER_CLIENT_HOST_METHODS | 3 | Characterized at assigned boundary; root review pending |
| DR-BROWSER_CLIENT_FILE_CHANNEL_METHODS | 3 | Characterized at assigned boundary; root review pending |
| DR-BROWSER_NETWORK_TUNNEL_METHODS | 1 | Characterized at assigned boundary; root review pending |
| DR-ORCHESTRATION_METHODS | 39 | Characterized at assigned boundary; root review pending |
| DR-SESSION_TAB_METHODS | 15 | Characterized at assigned boundary; root review pending |
| DR-NATIVE_CHAT_METHODS | 3 | Characterized at assigned boundary; root review pending |
| DR-CLIENT_EVENT_METHODS | 2 | Characterized at assigned boundary; root review pending |
| DR-CLIENT_UI_METHODS | 8 | Characterized at assigned boundary; root review pending |

The following shared service seams are preserved without claiming their result bodies accepted here:

- **DR-UPDATER_METHODS** — `status.get`: Configured remote-server-updater snapshot; default adapter and status projection read here. Concrete configured updater outcomes owned by concurrent result partition, not certified here.
- **DR-WORKTREE_METHODS** — `orchestration.workerStart`, `orchestration.federationAttachStart`: createManagedWorktree; topology caller records worktree before validating startup terminal. Exact create service result remains its assigned owner.
- **DR-FILE_METHODS** — `browser.clientHost.fileChannel.read`, `browser.clientHost.fileChannel.write`, `browser.clientHost.fileChannel.abort`, `markdown.readTab`, `markdown.saveTab`: Runtime file range/write/commit and remote owning filesystem results. Wrapper/source E1 editor contract reused only to its declared boundary; native filesystem/provider tests remain.

## Result distinctions and correction obligations

### RRT-D01

Local reattach omits incarnationId while stable-owner reuse compares it when persisted; an existing same-process PTY can be refused as owner changed. Actual reachability depends on owner/provider branch, so this is source evidence, not a reproduced incident.

Characterization owed: Reuse local live PTY with persisted incarnation through real stable-owner path and assert current refusal/result fields.

Intended correction, only after root ratification: After root ratifies correction, retain exact incarnation on reattach and accept only matching owner; mismatch/unknown must never spawn over a live owner.

Evidence: [SRC-278](contracts.json); [SRC-313](contracts.json).

### RRT-D02

Exit helper trusts successful wait; runtime wait can resolve for disconnected/missing PTY. That success can be used by handoff without a host-authoritative process-death probe.

Characterization owed: Compose actual runtime wait and helper with disconnected PTY and matched/indeterminate process; distinguish from unit test's trusted exact-exit stub.

Intended correction, only after root ratification: Unknown/lost host contact must retain writer ownership; only exact exit or host-authoritative identity absence permits takeover.

Evidence: [SRC-323](contracts.json); [SRC-327](contracts.json); [SRC-365](contracts.json).

### RRT-D03

Native subprocess handle swallows write/resize failures and marks private dead flag, Session remains alive until real exit; emulator size updates first and later native kill may no-op. Current receipts cannot prove native effect.

Characterization owed: Inject native write/resize throw, inspect Session state/size and subsequent kill; assert successful admission differs from effect.

Intended correction, only after root ratification: Root-ratified propagation/recovery must retain unverifiable state and prevent false applied/exited claims.

Evidence: [SRC-304](contracts.json); [SRC-339](contracts.json); [SRC-342](contracts.json).

### RRT-D04

Daemon hasPty tests getSize.size !== null, so malformed missing size passes; raw host replies are not universal validated results.

Characterization owed: Mixed-version or malformed getSize object with absent size versus null and valid size.

Intended correction, only after root ratification: Root-ratified validation returns unverifiable on absent/malformed result, never fabricated live/exited.

Evidence: [SRC-304](contracts.json).

The source also contains intentional or historical synthetic success/no-op behavior: layout `moved/updated` does not necessarily prove persistence; close can report `closed:true,refused:true`; tmux compatibility commands can return empty success without native action; browser metadata save and storage cleanup can fail after registry mutation. The exact method and family contracts below preserve these results and their correction tests, alongside all inherited obligations.

## Previously open local joins: final disposition

| Prior join | Final evidence | Remaining assigned local source work | Tests |
| --- | --- | --- | --- |
| RRT-S01 | RRT-J01 | None in the named join; cross-owner seams above remain explicit | Exact owner/incarnation replay versus duplicate spawn, partial binding save/shutdown, WSL/default shell/SSH nested runtime and folder workspaces, process created then lost response, no fabricated absent from unreachable host. |
| RRT-S02 | RRT-J02 | None in the named join; cross-owner seams above remain explicit | Full attach/mutation/history suite; backup/corruption/future schema, stale fence, processless reservation, provider response timeout, cancel false, question delivery failure, restart handoff unknown owner, compaction-after-append rejection and no duplicate provider turn. |
| RRT-S03 | RRT-J03 | None in the named join; cross-owner seams above remain explicit | Host-authoritative live/unverifiable/exited with disconnect, stale inventory and restart; partial stop and shared deadline; write false/void/throw and delayed failure; resize negative acknowledgement; hidden/headless terminal inspection. |
| RRT-S04 | RRT-J04 | None in the named join; cross-owner seams above remain explicit | All allocated terminal/mobile streams; source generation replacement, encoded byte versus source unit boundaries, stale/over ACK, empty versus unavailable snapshot, resize+alternate screen, initial and late renderer handoff, fragmented Unicode/control queries, disconnect exit unknown. |
| RRT-S05 | RRT-J05 | None in the named join; cross-owner seams above remain explicit | Jar unchanged on unrepresentable partition refusal; old-client skip disclosure refusal; family-atomic partition skip; replacement removal/write rollback including rollback failure; staged versus memory-only degraded Chromium import and restart replay. |

The additional WSL filesystem result chain is RRT-J06. No unread implementation in these six contracts has been reclassified as an external provider. The stop points are actual native/OS/library calls or the three separately assigned DR services above; their execution and compatibility obligations remain mandatory.

## Additional concrete service contracts

### RRT-J01 — Concrete local/daemon/SSH spawn, restore and ownership

Methods: `terminal.createAgentSession`, `terminal.ensureAgentSession`, `terminal.create`, `terminal.split`, `terminal.recoverPane`, `session.tabs.createTerminal`.

Local fresh spawn returns id, incarnationId, pid only if finite positive (otherwise null), and WSL metadata only when supplied. Local reattach returns id,pid,isReattach:true and optional wslDistro but omits incarnationId. Daemon create/attach constructs isNew,snapshot,pid,shellState,incarnationId,wslDistro and optional launch/history/claim/cwdReadable; admission strips the internal attach token. Provider conversion may instead return exitedBeforeSpawnReply:true, optionally incarnation/claim/reattach, when an exit wins publication. Normal reattach adds sequence-bound snapshot/rehydration/frame/geometry/alternate-screen/kitty/owner/title/tail fields; the outer runtime spawn commit projects its narrower RPC result. WSL null means native host, undefined permits legacy fallback. SSH create-operation replies require a nonempty id of at most512 characters and incarnation; ordinary spawn/reattach preserve arbitrary remote fields and have different object validation, not a universal runtime schema.

Preflight validates workspace and startup cwd, account-switch gates before/after managed-auth preparation, WSL/account-home compatibility and optional pinned launch args; ingress expires after5s. Preflight may materialize hooks/history before physical spawn. Stable-owner reuse requires exact host,id,reattach and incarnation and never overwrites an uncertain owner. Claim capability false refuses; create-operation capability is required rather than downgraded. Native spawn occurs before callback, activation maps and pane binding publication, so later errors can follow a real process. Startup command may be delivered asynchronously after local result; daemon command delivery can fail after process creation. Claimed registry serializes/adopts exact generation, limits1024 owners, promotes a validated owner and checks liveness; failure releases logical promotion but does not itself kill the native process. Daemon per-id creation fences cancellation; cancellation/client-identity changes after spawn can detach and reject. Attach detaches prior clients and replaces token. Cwd readability probe reports false only for EACCES/EPERM, not ENOENT.

Local attachOnly missing is SessionNotFound. Stable-owner absence retirement clears runtime state before persistence CAS/flush and can fail partially; absence classification and proven physical exit are distinct. Daemon routes known sessions to legacy owners and fresh sessions to current host; all-adapter inventory failure aborts rather than fabricating absence. History restore prefers validated log/checkpoint, protects unreadable/corrupt state, falls back to checkpoint on replay failure and serializes scratch-emulator restore; legacy or failed large-seed transfer can create without history and disclose historySeeded:false. Local native spawn retries precomputed platform shell fallbacks, preserving the primary failure diagnostic if all fail. POSIX daemon preflight can repair deleted daemon cwd and helper permissions; Windows explicit native paths receive cwd validation, WSL branch carries distro/env compatibility. SSH restoreRequired is positive live/unknown-delivery evidence, with at most2 rollback-confirmed attempts; uncertain rollback prevents retry, and some error cleanup is not awaited. None of these audit reads spawned a PTY or changed cwd/settings.

Boundary: node-pty/ConPTY, OS filesystem/process calls and the version-negotiated owning SSH host. Remote response schemas are only validated where the named wrappers do so. Host process execution, packaged helper availability and actual restored screen require fixture/host tests.

Owed tests:

- Fresh/adopt/replay exact id+incarnation versus duplicate creation; capability false/undefined and mixed daemon/SSH versions; create then lost response and post-spawn registration/claim/persistence failure; no spawn while ownership is unverifiable.
- Local/folder/SSH namespace, Windows native/WSL distro/account home/default shell, unavailable preferred shell/fallback, abort during cwd validation; history absent/corrupt/protected/checkpoint-only/truncated log/failed large transfer, disclose historySeeded:false and preserve future retry.
- Characterize local reattach missing incarnation and stable-owner rejection, then separately ratify a correction preserving incarnation; retain original full allocation.

Source bodies: [SRC-248](contracts.json); [SRC-260](contracts.json); [SRC-261](contracts.json); [SRC-274](contracts.json); [SRC-275](contracts.json); [SRC-276](contracts.json); [SRC-277](contracts.json); [SRC-278](contracts.json); [SRC-279](contracts.json); [SRC-280](contracts.json); [SRC-281](contracts.json); [SRC-282](contracts.json); [SRC-295](contracts.json); [SRC-299](contracts.json); [SRC-308](contracts.json); [SRC-312](contracts.json); [SRC-313](contracts.json); [SRC-314](contracts.json); [SRC-316](contracts.json); [SRC-317](contracts.json); [SRC-318](contracts.json); [SRC-320](contracts.json); [SRC-321](contracts.json); [SRC-333](contracts.json); [SRC-338](contracts.json); [SRC-347](contracts.json); [SRC-351](contracts.json); [SRC-352](contracts.json); [SRC-355](contracts.json); [SRC-357](contracts.json); [SRC-360](contracts.json); [SRC-361](contracts.json).

### RRT-J02 — Structured lease, handoff, transcript and process-proof outcomes

Methods: `agentSession.send`, `agentSession.cancel`, `agentSession.respondToApproval`, `agentSession.respondToQuestion`, `agentSession.setOption`, `agentSession.create`, `agentSession.ensure`, `agentSession.close`, `agentSession.handoffStatus`, `agentSession.options`, `agentSession.history`, `agentSession.subscribe`, `agentSession.unsubscribe`, `agentSession.hold`, `agentSession.release`.

Reservation discriminates created/reserved/retry-reservation/replayed and returns the stored record/operation; first fence1, process/provider link null, claim reserved. Immutable location/provider/account and once-pinned launch args reject conflicting reuse; absent replay record is ownership_unknown. Reserved+spawn-token match permits process commit; provider/fence match then grants live writer. Expiry alone cannot grant it. Journal reducer returns sessionId,cursor{epoch,sequence},items,submissions; highest revision and tombstone rules preserve original order, accepted/rejected settlement never reopens, provider user echoes alias queued submissions, and settlement dedupe is bounded4096.

Handoff records operation/fence before suspending old writer. Old-owner stopped advances fence and clears owner; new reservation/proof persists process identity before provider link/live transition. Failed acquisition with unproven exit retains recovering/manual-recovery; proven absence/processless reservation may advance/release. Forward native cleanup failure can leave manual recovery; reverse reproves TUI, requires durable Codex rollout, closes/waits, retires old owner, imports history then acquires native. Failures can occur after old owner retirement or new owner activation; reveal/history publication can fail after effect. TUI launch records pid/pane/tab/pty identity and onSpawned before idle wait/provider proof/focus; cleanup failure preserves unknown ownership.

The generic exit helper trusts any successful waitForExit without a process probe. The runtime wait implementation resolves when a PTY is missing or disconnected, so that composition can admit false exit proof; this is a characterized source defect, not a claim of the required no-takeover-on-disconnect behavior. Only terminal_handle_stale triggers bounded exact identity reprobes; other wait errors propagate. Identity probing treats ESRCH as absence, EPERM as present, contradictory token/start as indeterminate, and requires matching start (2s tolerance) or token. Linux uses /proc start ticks with100Hz assumption, macOS ps and Windows native creation time; no creation-time support means unavailable rather than invented PID proof. Structured stop probes before TERM, waits15s then KILL5s, rejects unknown identity.

Claude proof parses every JSONL object, rejects conflicting ancestry/session/marker, permits incomplete final line only via typed retry, requires marker leaf in same session and previous cursor same/ancestor; traversal bounds10000, rejects cycles/sibling/missing ancestors. Codex pinned rollout requires an in-root YYYY/MM/DD rollout JSONL filename containing exact thread segment and matching first session_meta id. Metadata reads64KiB, failures become null unless caller aborts; id uses payload aliases before top-level aliases, only nonempty string accepted. Incremental listing skips directory errors after warning and does not traverse symlink entries. Proof writes bracketed /status plus kitty-aware Enter, waits within15s, can Tab+Enter retry, requires fresh output and exact thread, writes Escape before success; live conversation resolution may return threadId without transcriptPath after5 visibility attempts. WSL slice helper returns only bytesRead, closes native handles awaited and process-owned handles fire-and-forget; filesystem failure/timeout behavior is characterized in RRT-J06.

Boundary: Provider subprocess/Claude-Codex transcript contract and OS process identity. WSL local gate/process/operation chain is characterized separately in RRT-J06 through actual Node filesystem and child-process calls.

Owed tests:

- Full attach/mutation/history/holds/eviction source allocations, stale fence, processless reservation/replay, corrupt/future records, provider timeout and lost reply, cancel false, answer delivery failure, compaction-after-append failure; no duplicate turns.
- Integrate real runtime wait with disconnected or absent PTY and matched/indeterminate process; characterize current unsafe success, then correction must keep writer blocked until host-authoritative exit. Unit stub success alone does not prove that precondition.
- TUI cleanup/reveal failure after activation; PID reuse/token contradiction/EPERM/OS probe unavailable; Claude incomplete tail/sibling/cycle/bounded ancestry; Codex wrong or stale thread, missing rollout, write false, kitty modes, WSL timeout/cancel, partial metadata and restart continuity.

Source bodies: [SRC-283](contracts.json); [SRC-284](contracts.json); [SRC-285](contracts.json); [SRC-286](contracts.json); [SRC-287](contracts.json); [SRC-288](contracts.json); [SRC-300](contracts.json); [SRC-301](contracts.json); [SRC-302](contracts.json); [SRC-310](contracts.json); [SRC-323](contracts.json); [SRC-324](contracts.json); [SRC-326](contracts.json); [SRC-327](contracts.json); [SRC-362](contracts.json); [SRC-363](contracts.json); [SRC-364](contracts.json); [SRC-365](contracts.json); [SRC-367](contracts.json); [SRC-368](contracts.json).

### RRT-J03 — Concrete stop, input, resize, inventory and foreground outcomes

Methods: `terminal.stop`, `terminal.closeAll`, `terminal.close`, `terminal.closeTab`, `terminal.stopExact`, `terminal.sleep`, `terminal.list`, `terminal.resolveActive`, `terminal.resolvePane`, `terminal.recoverPane`, `terminal.show`, `terminal.read`, `terminal.inspectProcess`, `terminal.isRunningAgent`, `terminal.agentStatus`, `terminal.rename`, `terminal.clearBuffer`, `terminal.focus`, `terminal.wait`, `terminal.send`, `terminal.resizeForClient`, `terminal.setDisplayMode`, `terminal.restoreFit`, `terminal.getDisplayMode`, `terminal.updateViewport`, `terminal.getAutoRestoreFit`, `terminal.setAutoRestoreFit`.

Local write returns false if absent, true if startup-query consumption or native write returns; missing resize is void and missing/invalid applied size is null. Local list emits current ids/incarnations/workspace handles, initial cwd or empty string, native process title or shell fallback. Shutdown coalesces byid and waits physical exit up to8s; source maps survive unproved exit. Daemon graceful host kill can return void after signaling rather than exit. Daemon Session.isAlive is state-not-exited; native handle write/resize catches and marks an internal dead flag without setting Session exited. Thus successful controller/daemon acknowledgment and emulator-applied geometry do not establish process consumption or native geometry. SSH write true means mux admission; later settlement timeout disposes the connection, and notify resize has no return acknowledgment.

Daemon write dirties history before notification, recoverable failure starts repair and throws; legacy failure can return false. Shutdown awaits final checkpoint under shared deadline when retaining history, then kill request and cache cleanup; failed checkpoint prevents kill, remove-history errors are logged. Local graceful TERM escalates5s later, force retries2 times250ms and tracks physical exit8s; Windows owned job tree differs from POSIX process group. Clear native failures can be swallowed while renderer/local clear succeeds. Native handle failures can make later write/resize/kill no-ops until real exit event; force kill fallback preserves final error. Session resize applies emulator before native, so reported size can overstate native convergence.

Daemon hasPty compares getSize result.size against null; undefined malformed result therefore passes that check. Unknown request falls back to inventory, any catch returns null. List filters isAlive and maps createdAt:0 in host inventory, cwd and shell defaults, validates binding metadata; failed legacy adapter inventory rejects aggregate. Known retired exact incarnation can yield exited for2s; missing/mismatched identity yields unverifiable. Old hosts may report no inspection support (unverifiable), intermediate hosts compose foreground/children, current host reply may be unvalidated. SSH hasChild/cwd/inspection are cast passthrough; no connection is not absence. Stop receipts must retain all live/unverifiable and partial post-stop inventory outcomes.

Cache/projection is not process proof. Recognized startup agent can seed5s; cache1s, idle refresh5s POSIX/15s Windows and output10s; ambiguous/failing probes retain or return null rather than exited. POSIX needs root/TTY/start/foreground-group consistency; SSH Windows remains unverifiable. Windows native reader loads package or staged addon, falls back to CIM only when missing (not when wedged), rejects empty/self-missing snapshots and bounds native query3s; one wedged callback blocks re-entry until it returns. Native commandLine nullishly becomes empty; creation time only if number. CIM runs noninteractive PowerShell with3s/8MiB, rejects timeout/nonzero/no rows, coerces numeric strings with parseInt and null strings to empty. Shared snapshot cache TTL500ms; fresh call queues a scan started after request, ignores prior scan failure, and does not accept cached proof. Linux snapshot removes unstable start times when /proc cannot supply them.

Boundary: Actual native module/ConPTY/node-pty, OS ps/proc/PowerShell and host RPC. No process enumeration or signals executed in this audit. Baseline/port tests plus real packaged Windows, macOS, Linux and SSH-host fixtures remain mandatory.

Owed tests:

- Disconnect/restart/PID reuse/mixed host versions must preserve live/unverifiable/exited; exact retired incarnation proof versus absent unknown; malformed undefined getSize, raw SSH result, partial all-host inventory.
- Native write/resize throw and swallowed error with Session still alive; later kill no-op, emulator/native geometry divergence, request acknowledgment before physical exit; characterize and separately ratify correction behavior.
- Cache stale versus fresh, unavailable native addon versus loaded/wedged, missing self process, CIM truncation/policy block, Windows command-line ambiguity/WSL context, partial stops/shared deadline/history checkpoint failure.

Source bodies: [SRC-274](contracts.json); [SRC-275](contracts.json); [SRC-279](contracts.json); [SRC-280](contracts.json); [SRC-281](contracts.json); [SRC-282](contracts.json); [SRC-295](contracts.json); [SRC-299](contracts.json); [SRC-304](contracts.json); [SRC-305](contracts.json); [SRC-306](contracts.json); [SRC-308](contracts.json); [SRC-309](contracts.json); [SRC-312](contracts.json); [SRC-313](contracts.json); [SRC-318](contracts.json); [SRC-320](contracts.json); [SRC-321](contracts.json); [SRC-334](contracts.json); [SRC-335](contracts.json); [SRC-336](contracts.json); [SRC-337](contracts.json); [SRC-339](contracts.json); [SRC-340](contracts.json); [SRC-342](contracts.json); [SRC-348](contracts.json); [SRC-349](contracts.json); [SRC-353](contracts.json); [SRC-354](contracts.json); [SRC-358](contracts.json); [SRC-359](contracts.json); [SRC-369](contracts.json); [SRC-370](contracts.json); [SRC-371](contracts.json).

### RRT-J04 — Authoritative stream snapshot, replacement, settlement and ACK

Methods: `terminal.multiplex`, `terminal.subscribe`.

Actual headless emulator serializes snapshot/rehydrate/frame, normal/alternate split, modes,cwd/title,cols/rows,scrollback count and optional pending tail; outer snapshot waits writes/ownership, returns null absent or empty unless includeEmpty, attaches current sequence/source/owner and preserves kitty flags0. Empty serialization does not fabricate a cursor sequence. Absolute cursor clamps coordinates, avoids CUP for wrap-pending final column, restores origin/scroll region and saved position only, not saved SGR/charset. Alternate split uses last1049h. Source validation accepts empty mappings but otherwise requires safe lengths, common source identity and contiguous source/display offsets.

Remote consumer attach is idempotent only same generation, tracks safe model sequences, ignores stale settlements, advances partial exact source spans and invokes progress after state mutation. Replacement reserves only open spans covered by required model seq; transfer failure rolls back earlier transfers. Commit needs same reservation object, generation/source identity, adequate snapshot seq and exact obligation objects; mismatch returns false, a later error can follow earlier span transfers. Rollback deletes reservation first and combines results, stale object false. Ledger maintains open/settled/transferring/transferred/canceled consumers and256 closed tombstones; only wholly terminal contiguous prefixes become ACK-eligible. Committed rollback requires last range and no ACK progress.

ACK publication carries generation-token identity; only successful publication advances ackPublished and reclaims spans, failure is not credited. Exit seals exact received end and waits both exit publication and ACK end; cancellation/generation close is not process exit. Coalescer batches8ms or eager64KiB source units, one flight, highest per source, bounded1024 watermarks; cancellation/disposal invokes false callbacks and thrown publish is caught. Snapshot replacement, scalar transport send success and native source process consumption are different stages. Serializer geometry is emulator geometry and can precede native resize success.

Boundary: xterm/headless serialization library, native terminal output and versioned host/mux transport. Local range ownership and actual ACK-publication state are characterized; physical host consumption and rendered terminal fidelity require their allocated tests.

Owed tests:

- Exact source-generation replacement and failed/partial commit rollback, gap/overlap/source-unit versus UTF8 bytes, stale/duplicate/excess ACK, failed publication/retry and connection closure.
- Empty versus absent snapshot, writes racing snapshot, alt screen/kitty0/wrap-pending/saved cursor and intentionally unpreserved saved SGR, geometry divergence, late renderer transfer and same-seq recovery, fragmented Unicode/control tail.
- Full allocated runtime/daemon/terminal/mobile/remote stream suites and rendered/host cases; registration alone never proves output fidelity.

Source bodies: [SRC-231](contracts.json); [SRC-269](contracts.json); [SRC-289](contracts.json); [SRC-290](contracts.json); [SRC-297](contracts.json); [SRC-298](contracts.json); [SRC-311](contracts.json); [SRC-315](contracts.json); [SRC-319](contracts.json); [SRC-325](contracts.json); [SRC-330](contracts.json); [SRC-331](contracts.json); [SRC-332](contracts.json); [SRC-343](contracts.json); [SRC-344](contracts.json); [SRC-345](contracts.json); [SRC-346](contracts.json); [SRC-350](contracts.json); [SRC-356](contracts.json).

### RRT-J05 — Actual cookie import clear, replacement and rollback

Methods: `browser.profileImportFromBrowser`.

All Chromium/Firefox/Safari owning bodies plus pipeline/staging and clear/store policy are now read. The outer union remains ok:false/reason or ok:true/profileId/summary, possibly zero imported or warning. Domains canonicalize through URL/registrable-family rules; Google/source-bound and unrepresentable partition families remain skipped/disclosed. Empty replacement plan returns removed:[],identities:[]. Clear locks by real Session identity, freezes removal plan before snapshot, then snapshots every URL/name removal identity before mutation. Cookies arriving on new coordinates are not widened into the plan.

Replacement removes sequential coordinates and records even the failing attempted identity for reverse restore. Full clear processes at most8 groups concurrently but serializes same coordinate; failure restores all captured identities, including partition twins, and still rejects if restoration succeeds. The store obtains a debugger lease on an existing webContents or uses hidden window when unavailable/conflicting; coalesces attach and checks disposal. CDP getAllCookies malformed result becomes an empty list, then identity coverage refuses mutation. Snapshot rejects opaque/null/invalid partition keys; captures hostOnly/domain/path/sameSite/session/expiry and partition twins. Writes omit domain for host-only and omit expires when falsy (including0); restore aggregates all failures. CDP Network.setCookie rejects only explicit success:false; null/scalar/absent success is accepted by source wrapper.

Clear snapshot/coverage refusal leaves jar unchanged. Remove failure with successful restore throws an aggregate original-error result stating restored; rollback failure reports partially cleared and preserves both errors. Native get/remove and debugger/SQLite/crypto can fail; disposal can reject after cookie mutation. Chromium success may reflect staging or memory-only degraded import requiring restart replay; it is not universal atomic durable replacement. Parent correction supersedes leaf's unread-import/return-type shorthand while frozen leaf bytes remain intact.

Boundary: Electron cookie store/CDP/debugger, OS browser SQLite databases/keychain/native crypto and restart persistence. These wrappers' actual projections and rollback are read; no browser profile, cookie or account operation was executed.

Owed tests:

- Existing clear atomicity assertions81–280 discriminate restored/unchanged/partially-cleared, partition identities, frozen arrival plan/same-coordinate rollback, session lock; full file must port.
- Native Electron partition fidelity, snapshot refusal jar unchanged, Google/source-bound family skip disclosure, same-coordinate partition twins, clear and restore both fail, native CDP explicitfalse versus missing field.
- All three import families: inaccessible/decrypt failure/empty source, staged versus memory-only warning, restart replay, and full baseline/port/behavioral RED-GREEN allocations.

Source bodies: [SRC-163](contracts.json); [SRC-164](contracts.json); [SRC-165](contracts.json); [SRC-169](contracts.json); [SRC-170](contracts.json); [SRC-171](contracts.json); [SRC-172](contracts.json); [SRC-221](contracts.json); [SRC-291](contracts.json); [SRC-292](contracts.json); [SRC-293](contracts.json); [SRC-366](contracts.json).

### RRT-J06 — WSL transcript filesystem result, deadline and process ownership

Methods: `agentSession.send`, `agentSession.cancel`, `agentSession.respondToApproval`, `agentSession.respondToQuestion`, `agentSession.setOption`, `agentSession.create`, `agentSession.ensure`, `agentSession.close`, `agentSession.handoffStatus`, `agentSession.options`, `agentSession.history`, `agentSession.subscribe`, `agentSession.unsubscribe`, `agentSession.hold`, `agentSession.release`, `nativeChat.readSession`, `nativeChat.subscribe`, `nativeChat.unsubscribe`.

Actual child operations return access:true, stat/lstat native Stats, readdir projected entries, readfile native string/Buffer, open monotonic numeric handle, read Buffer sliced to bytesRead, close:true even missing handle after deleting its map entry. IPC decoder restores Stats prototype and Dirent functions, otherwise returns raw value; it does not validate every schema. Parent exposes frozen opaque process-owned handle, maps ownership in WeakMaps, returns bytesRead from decoded body and close void. Unknown operation falls through undefined in child; request correlation is by active id. No subprocess, filesystem request or WSL operation was executed.

Gate permits2 tasks, at most1 scan, one per lane; exact priority precedes scan. Queue/waiter bounds64 each, exact deadline30s/scan60s, dedupe only byte-identical operation+path+priority except open/read intentionally undeduped. Caller abort removes waiter; running I/O keeps permit until settlement/deadline, with abandoned resource disposal. Task deadline aborts process, quarantines route and rejects queued route tasks unavailable. Backoff starts5s, doubles up to2*deadline, shared incident does not escalate and strikes decay after5min; real timely filesystem result can clear quarantine, late result or transport fault cannot.

One child per lane, one active request, close prioritized ahead of later work; close deadline30s and idle reap60s. Abort/send error/disconnect/exit rejects active request and retires slot, marks handles faulted, attempts SIGKILL without claiming process death. Missing/faulted handle is classified failure; unknown close is idempotent. Child close deletes handle before native close, so rejection can follow ownership retirement. Open racing child exit refuses handle publication. Corrupt decodable-response failure retires slot, late nonmatching ids ignored; message shape itself is not comprehensively validated. Child serializes name/message plus typed errno/code/syscall/path, send failure is swallowed on dying channel. Access helper native close can override read outcome; process-owned close errors are deliberately swallowed/fire-and-forget. Vitest in-process route requires BOTH VITEST=true and worker global, so those tests alone cannot prove production IPC.

Boundary: Source chain now reaches actual node:fs/promises and node:child_process.fork/send/kill. Fork uses staged/unpacked entry discovery, allowlisted environment with ELECTRON_RUN_AS_NODE, empty execArgv, advanced serialization and hidden Windows child; missing entry rejects. Packaging/env allowlist remains inherited E5 configuration obligation, not a fabricated model/service result.

Owed tests:

- Port original native-chat/runtime/remote allocation without weakening; actual helper-process fixture for open/read/close, IPC false/throw/disconnect, malformed response and late id, close rejection after deletion, open exit race, production versus Vitest route.
- Deadline/quarantine and recovery, queued and running abort with last waiter, abandoned handle disposal,2-task/1-scan/64queue/64waiter limits, priority/dedupe and lane ownership; WSL timeout must not become EOF or process-exit proof.
- Packaged Windows/WSL helper and UTF8 chunk boundary, partial read/final close, missing entry/allowlist compatibility and stalled mount; no unit stub can stand in for native execution.

Source bodies: [SRC-367](contracts.json); [SRC-372](contracts.json); [SRC-373](contracts.json); [SRC-374](contracts.json); [SRC-375](contracts.json); [SRC-376](contracts.json); [SRC-377](contracts.json); [SRC-378](contracts.json); [SRC-379](contracts.json); [SRC-380](contracts.json); [SRC-381](contracts.json); [SRC-382](contracts.json).

## Shared runtime contracts

Each method below references one of these exact shared contracts and any applicable additional service contracts. Receiver-specific envelopes remain in the method table; sharing does not replace those envelopes.

### RRT-01 — runtime-status

`status.get`.

Object runtimeId,rendererGraphEpoch,graphStatus,authoritativeWindowId,desktopWindowStatus,liveTabCount/liveLeafCount,protocol/min-compatible aliases,capabilities,optional nonempty degradations,worktreeCreateIdempotency.dedupeTtlMs,hostPlatform,terminalWindowsShell(null fallback),floatingWorkspaceEnabled(default true); RPC adds pairedDeviceId only truthy and overrides appVersion/remoteUpdateSupport with updater snapshot.

Read projection only; renderer availability/offscreen and headless command factory differ. Screencast requires renderer/offscreen; headless capability also accepts command factory; certificate requires renderer/offscreen. Three E2E env switches remove capabilities; terminal degradation appended. Default updater projection is appVersion env nullishly falling back 0.0.0-dev, support unsupported-headless-serve/automatic:false/reason updater-unavailable; status idle is not forwarded by status.get. Configured adapter snapshot is unvalidated; status.get copies only its appVersion/support.

Errors/partial effects: No fabricated fallback on thrown runtime/window/store read; graph ready, transport connected and native capability are distinct.

Owed: Missing store/settings, renderer absent/offscreen/headless-only, each protocol downgrade flag, terminal/browser degradation and paired/unpaired projection.

Evidence: [SRC-001](contracts.json); [SRC-006](contracts.json); [SRC-240](contracts.json).

### RRT-02 — client-settings

`settings.get`, `settings.update`, `settings.getTerminalQuickCommands`, `settings.updateTerminalQuickCommands`, `settings.updatePRBotAuthorOverride`.

settings.get/update/PR override wrap safe host settings in {settings}; exact get() fields/defaults runtime-client-settings:87–114, githubProjects remains undefined when absent. Quick commands separate {terminalQuickCommands}, absent→[]. get omits command bodies/private host defaults; labels only.

update persists/notifies first, then optional repo notification and serialized latest-generation hook reconciliation; returned value is fresh get(). Quick upsert rejects new command at max but allows updating existing; applies mutation and returns current list. PR override applies helper and returns safe projection.

Errors/partial effects: Missing required store methods throws runtime_unavailable. Hook/repo-notification failure can reject after settings changed; reconciliation tail recovers for later call. Return is not durable flush; E2 SP01/02/09/11 retained.

Owed: Assert every projected default/undefined/host-private exclusion, update→hook failure partial success, overlapping generations, limit upsert versus replacement, scope-preserving delete and normalized PR-author collision; entire existing allocation retained.

Evidence: [SRC-002](contracts.json); [SRC-007](contracts.json); [SRC-008](contracts.json).

### RRT-03 — client-ui

`ui.get`, `ui.set`, `ui.recordFeatureInteraction`.

{ui:omitPairingLocalUiFields(current state)}. ui.set removes local fields before update and from reread result. recordFeatureInteraction delegates store return then removes same fields.

Accepted RP-U2/SP persistence merge, scheduling and trust whole-map replacement reused; no durable disk barrier or authorization stronger than actual schema.

Errors/partial effects: Missing getUI/updateUI/recordFeatureInteraction throws runtime_unavailable; store errors propagate; generic paired trust map is not recursively validated.

Owed: Old clients sending pairing-local fields retained schema but no mutation; nested trust malformed input/concurrent replacement, feature count/timestamps/idempotency and failed save/restart.

Evidence: [SRC-002](contracts.json); [SRC-007](contracts.json).

### RRT-04 — agent-create

`terminal.createAgentSession`.

{terminal,disposition:'created'|'replayed'}; same caller+operation+fingerprint shares promise; successful replay forces replayed, failed replay may adoption-only reclaim exact handle, otherwise rethrows. Preflight validates folder usability before launch; resolves Windows project shell/WSL, blocks managed Claude auth switching or conflicting explicit env, pins compatible Codex home, and strips/deletes requested inherited env. Runtime resume can start fresh without a renderer notice. Concurrent pane reservations return the winner only after handle/PTY/incarnation proof; identity changes refuse. Stable-owner attach clears command/startup/create claims, requires exact id/isReattach/incarnation, and retires a persisted binding only after host-reported absence with CAS/flush; host loss stays unverified. Local spawn reattaches around asynchronous preflight, refuses missing attachOnly, calls node-pty spawn then reports commit before activation, so later activation failure can follow a physical effect.

Reject invalid/future/expired/capacity/conflicting operation before launch; reserve promise before async preflight, deterministic tab/leaf/handle and execution ID, captured namespace/owner. Explicit null agentArgs differs from undefined host default. Workspace trust may be written before final aborted check. Commit/unknown spawn retains replay fence until age expiry; precommit definite failure removes it.

Errors/partial effects: Unavailable route is not legacy proof; capability probe missing local allowed/SSH legacy, throwing probe false. Agent disabled, startup identity, client_disconnected and createTerminal errors propagate. Reclaim cannot spawn/kill and ambiguity means null, not exit.

Owed: Same-ID concurrent/replay/changed-payload, lost reply+reclaim, retained unknown/expiry/capacity, pre-abort/after trust/spawn races, SSH legacy and folder/WSL/default-args/account/env ownership.

Evidence: [SRC-005](contracts.json); [SRC-009](contracts.json); [SRC-010](contracts.json); [SRC-276](contracts.json); [SRC-277](contracts.json); [SRC-278](contracts.json); [SRC-279](contracts.json).

### RRT-05 — agent-ensure

`terminal.ensureAgentSession`.

{terminal,disposition:terminal.agentSessionDisposition??'created'}; automatic request always throws agent_session_resume_not_authorized; explicit SSH namespace returns legacy_required before local canonicalization. Preflight validates folder usability before launch; resolves Windows project shell/WSL, blocks managed Claude auth switching or conflicting explicit env, pins compatible Codex home, and strips/deletes requested inherited env. Runtime resume can start fresh without a renderer notice. Concurrent pane reservations return the winner only after handle/PTY/incarnation proof; identity changes refuse. Stable-owner attach clears command/startup/create claims, requires exact id/isReattach/incarnation, and retires a persisted binding only after host-reported absence with CAS/flush; host loss stays unverified. Local spawn reattaches around asynchronous preflight, refuses missing attachOnly, calls node-pty spawn then reports commit before activation, so later activation failure can follow a physical effect.

Local/WSL machine+principal/container+provider-root scope, signed canonical session claim, disabled-agent checks, host launch defaults with null-v-undefined args; createTerminal owns actual launch result. Remote paired focused presentation is coerced background.

Errors/partial effects: No store→runtime_unavailable; missing namespace/probe failure→legacy_required; invalid identity/startup and canceled caller propagate; trust step precedes abort check.

Owed: Automatic checkpoint refused; same session two hosts/WSL roots, agent disabled/legacy capability, exact creation disposition and no second owner after unknown response.

Evidence: [SRC-005](contracts.json); [SRC-010](contracts.json); [SRC-276](contracts.json); [SRC-277](contracts.json); [SRC-278](contracts.json); [SRC-279](contracts.json).

### RRT-06 — structured-mutating

`agentSession.send`, `agentSession.cancel`, `agentSession.respondToApproval`, `agentSession.respondToQuestion`, `agentSession.setOption`.

Shared {ok:false,refusal} or {ok:true,replayed,fence,cursor,value}. send value {clientMessageId,submission}, whose dispatchState can accepted/rejected/unknown despite ok:true. cancel value {turnId,cancelled}, false includes provider already finished AND unconfirmed exception; replay always false. Prompt value {itemId,revision,resolution}; option value {key,value,options?}. Reservation returns created/reserved/retry-reservation/replayed with record and operation row; first lease fence is 1, process/link are null, claim reserved. Location/provider/account are immutable; current launch env is validated but never persisted and launch args pin only once. Retry requires the same persisted reservation; missing replay record is ownership_unknown. Process commit demands reserved status and exact spawn token; proving the provider link grants live writer only with provider/fence compatibility. Expiry alone never grants ownership; unknown probe retains recovering/manual-recovery. Failed acquisition with unproven exit clears operation id but retains the owner/reservation; proven absence advances fence and releases. Handoff to TUI suspends native and relies on the stop result before advancing, persists process identity before provider proof, and retains manual recovery on unproved cleanup; reverse requires durable Codex rollout, waits for TUI exit, imports history then acquires native, with failures able to occur after owner retirement. Journal projection is actual reducer output: {sessionId,cursor:{epoch,sequence},items,submissions}; highest revision wins, tombstone blocks equal/lower, creation sequence/timestamp remain stable, accepted/rejected dispatch never reopens, provider echoes alias to queued submissions, and settlement dedupe retains 4096 ids.

Per-session serialization, durable caller operation ledger/fingerprint/lease/fence; missing attached journal/record is ownership_unknown. Journal before adapter send/answer; accepted send capacity transfers, rejected releases, unknown retained. Explicit retryUnknown redispatch only matching durable unknown. Prompt resolution committed before adapter answer; adapter error appends status but returns recorded resolution. Option applies adapter then persists returned map or singleton; persistence failure can follow real provider change. Journal mutations serialize; row built then fence/quota/lifecycle admission, blobs before append, append+file fsync before in-memory fold. Append uncertainty latches read-only; preappend blob failure may leave cleanup failure; compaction can reject AFTER committed row and lifecycle state. Store transaction reloads under local lock, snapshots maps, skips unchanged writes, restores memory on save error; backup recovery raises fences. This is distinct from provider delivery.

Errors/partial effects: Stale prompt revision/already resolved/invalid options are typed refusal with currentRevision/resolution. Adapter send throw becomes unknown; journal/result-settlement errors throw and ledger unknown; option rejected class becomes invalid refusal, others throw.

Owed: All admission/replay/fence cases plus every per-method discriminant, provider reject/unknown/cancel exception, resolution persisted but delivery failed, option applied but disk failure, exhausted lifecycle capacity and failed outcome settlement.

Evidence: [SRC-015](contracts.json); [SRC-017](contracts.json); [SRC-018](contracts.json); [SRC-023](contracts.json); [SRC-024](contracts.json); [SRC-027](contracts.json); [SRC-028](contracts.json); [SRC-238](contracts.json); [SRC-283](contracts.json); [SRC-284](contracts.json); [SRC-285](contracts.json); [SRC-286](contracts.json); [SRC-287](contracts.json); [SRC-288](contracts.json); [SRC-300](contracts.json); [SRC-301](contracts.json); [SRC-302](contracts.json).

### RRT-07 — structured-attach

`agentSession.create`, `agentSession.ensure`, `agentSession.createSupport`.

createSupport {supported:true} else {supported:false,reason:'remote'|'wsl'|'agent'} priority by location. create/ensure attach success {ok:true,replayed,fence,cursor,value:{sessionId,fence,page,unconfirmedClientMessageIds}}; typed refusal or thrown settlement/journal failures. Codex create may return operation_unknown after committed attach when tab publication fails. Reservation returns created/reserved/retry-reservation/replayed with record and operation row; first lease fence is 1, process/link are null, claim reserved. Location/provider/account are immutable; current launch env is validated but never persisted and launch args pin only once. Retry requires the same persisted reservation; missing replay record is ownership_unknown. Process commit demands reserved status and exact spawn token; proving the provider link grants live writer only with provider/fence compatibility. Expiry alone never grants ownership; unknown probe retains recovering/manual-recovery. Failed acquisition with unproven exit clears operation id but retains the owner/reservation; proven absence advances fence and releases. Handoff to TUI suspends native and relies on the stop result before advancing, persists process identity before provider proof, and retains manual recovery on unproved cleanup; reverse requires durable Codex rollout, waits for TUI exit, imports history then acquires native, with failures able to occur after owner retirement. Journal projection is actual reducer output: {sessionId,cursor:{epoch,sequence},items,submissions}; highest revision wins, tombstone blocks equal/lower, creation sequence/timestamp remain stable, accepted/rejected dispatch never reopens, provider echoes alias to queued submissions, and settlement dedupe retains 4096 ids.

Negotiated structured capability/settings gate before host installation. Create requires expectedRuntimeFence null; worktree intent fingerprints then host-resolved location/provider/account/root fingerprint. Restore/reconcile leases, resolve recovery and pending settlement before owner reservation/acquisition; publish attached journal before operation success. Folder kind/WSL local mapping explicit. Codex acquire starts/resumes concrete thread, retries excludeTurns ONLY -32602 unsupported-excludeTurns and remembers per connection; enforces record byte cap and exact resumed ID, optional nonempty model/effort and nullable historyPath. Connection request defaults30s and returns arbitrary provider result; timeout deletes pending but cannot undo provider work. Transport failure makes closed immediately but only exit/close emits death proof; close waits1500ms then process-tree proof+1000ms, false if unproved. Publication of acquired session precedes buffered event drain.

Errors/partial effects: Fingerprint conflict returns refusal; unsupported throws. Failed acquisition distinguishes processless/exit-proven/unproven; postacquisition failure attempts cleanup+durable settlement then throws, AggregateError if settlement also fails; no rollback proof of spawned child.

Owed: All createSupport location/provider branches; exact envelope/fingerprint outcomes, acquisition cleanup unproven, journal/publication/ledger failure after spawn and Codex tab publication partial success; actual adapter results must be verified separately.

Evidence: [SRC-011](contracts.json); [SRC-013](contracts.json); [SRC-014](contracts.json); [SRC-019](contracts.json); [SRC-025](contracts.json); [SRC-031](contracts.json); [SRC-225](contracts.json); [SRC-283](contracts.json); [SRC-284](contracts.json); [SRC-285](contracts.json); [SRC-286](contracts.json); [SRC-287](contracts.json); [SRC-288](contracts.json); [SRC-300](contracts.json); [SRC-301](contracts.json); [SRC-302](contracts.json).

### RRT-08 — structured-read-lifetime

`agentSession.close`, `agentSession.handoffStatus`, `agentSession.options`, `agentSession.history`, `agentSession.subscribe`, `agentSession.unsubscribe`, `agentSession.hold`, `agentSession.release`.

close {ok:true} after visibility false+eviction; hold/release {held:true}/{released:true}. options adapter snapshot or unsupported error. history {ok:true,page} or {ok:false,reset,page,fence?}, optional providerSession; page includes sessionId,epoch,direction,items,removedItemIds,submissions,window(oldest/newest nullable,nextCursor),liveCursor,hasOlder/hasNewer,fence?. Stream snapshot/reset/batch/end, including empty catchup batch and handoff; unsubscribe always true even missing token. Reservation returns created/reserved/retry-reservation/replayed with record and operation row; first lease fence is 1, process/link are null, claim reserved. Location/provider/account are immutable; current launch env is validated but never persisted and launch args pin only once. Retry requires the same persisted reservation; missing replay record is ownership_unknown. Process commit demands reserved status and exact spawn token; proving the provider link grants live writer only with provider/fence compatibility. Expiry alone never grants ownership; unknown probe retains recovering/manual-recovery. Failed acquisition with unproven exit clears operation id but retains the owner/reservation; proven absence advances fence and releases. Handoff to TUI suspends native and relies on the stop result before advancing, persists process identity before provider proof, and retains manual recovery on unproved cleanup; reverse requires durable Codex rollout, waits for TUI exit, imports history then acquires native, with failures able to occur after owner retirement. Journal projection is actual reducer output: {sessionId,cursor:{epoch,sequence},items,submissions}; highest revision wins, tombstone blocks equal/lower, creation sequence/timestamp remain stable, accepted/rejected dispatch never reopens, provider echoes alias to queued submissions, and settlement dedupe retains 4096 ids.

Close stops child before draining/unbinding/discarding/releasing lease/forget; failure retains session/holds for retry but visibility can already be false. Hold scopes connection/client/holder, cancels release clock; first resume-capable hold resumes provider; stream hold resume:false never starts one. Release arms grace only if child exists and holder removed. History pages reduced tail/before and journal-row after, handles epoch/ahead/compaction/unreadable resets, count/byte bounds. Stream per-cursor catchup, ownership cleanup, emit exceptions drop subscriber. Status refresh may restore TUI owner, reproving and persisting identity and starting catchup; restore retries three times with100/200ms delay, then persists manual-recovery and failed operation rather than throwing original error if settlement succeeds. A dead probe can continue native handoff; unknown never certifies death. Journal read-only resets schema_unreadable; epoch/ahead/older-than-floor resets; exact floor is replayable.

Errors/partial effects: Unknown session throws ownership_unknown. Failed resume removes newly acquired holder; failed eviction aborts later steps. host release doesn't mean provider exit. Handoff-status can restore recoverable TUI owner and mutate state.

Owed: Unknown/session absent, held versus readable-only streams, same session multiplex and stale cleanup, abort before setup, hold race/failed resume/release grace/active turn/eviction step failures, history resets/limits/removed-ID byte cap, handoff recovery and full options projection.

Evidence: [SRC-011](contracts.json); [SRC-012](contracts.json); [SRC-014](contracts.json); [SRC-016](contracts.json); [SRC-020](contracts.json); [SRC-021](contracts.json); [SRC-022](contracts.json); [SRC-026](contracts.json); [SRC-029](contracts.json); [SRC-030](contracts.json); [SRC-236](contracts.json); [SRC-283](contracts.json); [SRC-284](contracts.json); [SRC-285](contracts.json); [SRC-286](contracts.json); [SRC-287](contracts.json); [SRC-288](contracts.json); [SRC-300](contracts.json); [SRC-301](contracts.json); [SRC-302](contracts.json).

### RRT-09 — terminal-create-split

`terminal.create`, `terminal.split`.

Create returns handle/tabId/worktreeId/title(nullable) and host metadata; PTY path additionally paneKey,ptyId,surface background|visible, truthy pid processId, optional agentSessionDisposition,isReattach,warning. Desktop path waits IPC reply from exact authoritative webContents/requestId then terminal handle; returns visible, unknown worktree ''. Split returns handle/tabId/paneRuntimeId/leafId; PTY paneRuntimeId -1, graph branch copies original paneRuntimeId. Preflight validates folder usability before launch; resolves Windows project shell/WSL, blocks managed Claude auth switching or conflicting explicit env, pins compatible Codex home, and strips/deletes requested inherited env. Runtime resume can start fresh without a renderer notice. Concurrent pane reservations return the winner only after handle/PTY/incarnation proof; identity changes refuse. Stable-owner attach clears command/startup/create claims, requires exact id/isReattach/incarnation, and retires a persisted binding only after host-reported absence with CAS/flush; host loss stays unverified. Local spawn reattaches around asynchronous preflight, refuses missing attachOnly, calls node-pty spawn then reports commit before activation, so later activation failure can follow a physical effect.

Background chosen for selected workspace with agent claim, nonfocused nonrenderer request or unavailable renderer. Stable-pane claim released in finally, adopt before spawn, canonical identity from agentSessionEnsure or stablePaneOwner supersedes allocation. Spawn can commit before registration/reveal; reveal failure returns warning without killing PTY. Split fences source before and after spawn/reveal, persists then publishes; postcommit renderer reveal is best effort. Controller spawn returns only id, truthy incarnation/stablePaneOwner/agentSessionEnsure and string WSL when upstream reply retains it; no promise that provider pid/snapshot/isReattach survive this narrow return. It records physical spawn commitment before admission. Commit persists stable pane first; failure marks operation unknown. Fresh spawn binding persistence failure attempts shutdown then clears local state even if shutdown failed; reattach failure preserves process. Later registration, lease, account or notification errors can follow effect. Source must retain exact host fence and no second spawn after unknown.

Errors/partial effects: Create startupAgent withoutworkspace, runtime unavailable, client_disconnected, exited-before-registration; desktop IPC10s timeout/error then handle wait. Split unavailable/exited/stale/source missing; failed source revalidation best-effort stop/kill/retire retains original error.

Owed: Create reveal rejection retains live background handle; deterministic agent replay after spawncommit; canonical adopted pane; malformed/stale IPC reply and timeout; split source replaced during spawn/reveal; persistence failure cleanup unverified exit; SSH/WSL/folder hostmetadata.

Evidence: [SRC-044](contracts.json); [SRC-045](contracts.json); [SRC-047](contracts.json); [SRC-048](contracts.json); [SRC-261](contracts.json); [SRC-276](contracts.json); [SRC-277](contracts.json); [SRC-278](contracts.json); [SRC-279](contracts.json).

### RRT-10 — terminal-close-stop

`terminal.stop`, `terminal.closeAll`, `terminal.close`, `terminal.closeTab`, `terminal.stopExact`, `terminal.sleep`.

stop {stopped} counts positive provider acknowledgment per host-owned PTY; best effort failures do not count. close {handle,tabId,ptyKilled, optionalptyStopVerdict live|unverifiable,reason}; closeTab always {handle,tabId,closeMode:'tab',ptyKilled:false} after surface transaction, not proof no PTY died. closeAll {closed,stopped,retiredSurfaces:true,...stopVerdict}; exact/sleep {stopped,stoppedPtyIds,livePtyIds,postStopVerified, optionalpostStopFailure,remainingLivePtyIds}. Concrete local write returns false without process, true for a consumed startup reply or after native write; native throw escapes to the controller. Resize missing process is a void no-op. Local list constructs id, optional incarnation/worktree/handle/WSL, startup cwd or empty string, and native process title/shell fallback. Local shutdown coalesces by id, supports escalation, preserves physical-exit tracking, waits up to 8 seconds, and keeps ownership if exit is unproven; POSIX TERM escalates after 5 seconds, Windows root/job semantics differ. Foreground errors retain cached recognized agent; complete absence removes it, and stale async identity returns null. SSH write true only proves transport admission, settlement callback is not remote process consumption, and settlement timeout disposes the mux; resize is a notification. SSH inspection/cwd/child-process replies are raw casts, not validated result schemas. Daemon write marks dirty; recoverable disconnect throws PtyWriteUnavailableError and starts recovery, legacy delivery failure returns false. Daemon shutdown awaits checkpoint under keepHistory before kill request, refuses expired checkpoint wait without killing, then clears caches; history removal errors are logged and tombstones cap at 1000. Daemon list filters isAlive, validates owner bindings, maps title to shell and cwd fallback, prunes only pre-request cached ids, and propagates inventory errors. Old daemon inspection yields unverifiable, intermediate versions compose foreground+children, modern versions pass inspection through; ordinary foreground read catches to null.

closeAll retires each parent tab, clears resume/incarnation records with flush+rollback, then stops, partial prior tab closures remain if later failure. Close uses persisted topology and exact incarnation/worktree authority; sibling pane avoids whole-tab close. sleep exclusive lock coalesces perworkspace, started/committed/cancelled events; persisted partial state retained across retry; spawns wake prior sleeping/partial. Parallel stop allSettled, then inventory verification decides terminal sleeping. Synchronous kill returns true once asynchronous shutdown/startup continuation scheduled; false on unavailable provider, with SSH tombstone/synthetic -1 plus explicit unverifiable. Delayed failure may preserve ownership and queue undelivered stop. stopAndWait bounds startup, observes incarnation-matched exit, requires fresh provider inventory absence; keepHistory polls until shared absolute deadline. No undelivered-kill order on reversible stop. Async success is not process exit.

Errors/partial effects: Graph epoch/workspace errors before mutation. stop catches each provider error; stopAndWait false kill fallback can remain unverifiable. exact requires one nonempty unique PTY, fresh inventory, exactset or targetonly inclusion; failed physical stop throws; missing postinventory/stilllive yields verifiedfalse receipt. sleep missinginventory throws; successful physical stops may be committed before failed sibling throws; missingpostinventory with allack returns false, never exited.

Owed: SSH stale/disconnected inventory remains unverifiable; closeAll partial surface retirement and flushrollback; closeTab receipt false independent teardown; exact targetOnly siblings; sleep concurrent stop failure, unknownpostinventory, partialretry/wake events, folderinstance+host fence.

Evidence: [SRC-049](contracts.json); [SRC-050](contracts.json); [SRC-051](contracts.json); [SRC-056](contracts.json); [SRC-247](contracts.json); [SRC-280](contracts.json); [SRC-281](contracts.json); [SRC-282](contracts.json); [SRC-295](contracts.json); [SRC-299](contracts.json); [SRC-304](contracts.json); [SRC-305](contracts.json); [SRC-306](contracts.json); [SRC-308](contracts.json); [SRC-309](contracts.json).

### RRT-11 — terminal-list-read-status

`terminal.list`, `terminal.resolveActive`, `terminal.resolvePane`, `terminal.recoverPane`, `terminal.show`, `terminal.read`, `terminal.inspectProcess`, `terminal.isRunningAgent`, `terminal.agentStatus`, `terminal.rename`, `terminal.clearBuffer`, `terminal.focus`, `terminal.wait`.

List {terminals,hostScope,optionalvisualLayouts,topologyRevisions,totalCount,truncated}; count/scope overmatching beforelimit. Tail cursors stringified; cursor-ahead empty resets next/latest; oldcursor truncated, page limits; previewcharbudget/partial handling; source stream/screen. wait {handle,condition,satisfied,status running|exited|unknown,exitCode:null|number,optionalexitCause,blockedReason}; blocked permission satisfiedfalse. Focus returns identity with navigatedfalse for missingnotifier, supersededrequest or navigateHostfalse. Concrete local write returns false without process, true for a consumed startup reply or after native write; native throw escapes to the controller. Resize missing process is a void no-op. Local list constructs id, optional incarnation/worktree/handle/WSL, startup cwd or empty string, and native process title/shell fallback. Local shutdown coalesces by id, supports escalation, preserves physical-exit tracking, waits up to 8 seconds, and keeps ownership if exit is unproven; POSIX TERM escalates after 5 seconds, Windows root/job semantics differ. Foreground errors retain cached recognized agent; complete absence removes it, and stale async identity returns null. SSH write true only proves transport admission, settlement callback is not remote process consumption, and settlement timeout disposes the mux; resize is a notification. SSH inspection/cwd/child-process replies are raw casts, not validated result schemas. Daemon write marks dirty; recoverable disconnect throws PtyWriteUnavailableError and starts recovery, legacy delivery failure returns false. Daemon shutdown awaits checkpoint under keepHistory before kill request, refuses expired checkpoint wait without killing, then clears caches; history removal errors are logged and tombstones cap at 1000. Daemon list filters isAlive, validates owner bindings, maps title to shell and cwd fallback, prunes only pre-request cached ids, and propagates inventory errors. Old daemon inspection yields unverifiable, intermediate versions compose foreground+children, modern versions pass inspection through; ordinary foreground read catches to null.

List refreshes PTYs, filters freshrequired before dedupe leaf/PTYS; noinventory onlyerrors ifrequirefresh. Wait idle titles/prompts vs permission discriminated, timeout default onlytui-idle, exit can wait indefinitely, abortrequest; registrations recheck binding. Agentstatus coalesced byhandle, explicit/lifecycle/title/permission precedence with async bindingrecheck. Rename persists headless and broadcasts; clear optionalnativeclear thenlocalbuffer success. recover coalesces pane+workspace after lease expired and liveness notlive/unverifiable. Controller foreground/cwd errors→null (empty cwd→null), child-process errors→false, probe remote: or startup/route failures→null; only sole LocalPtyProvider may authoritatively answer missing absent a probe. Inspect uses provider inspect if present else {foregroundProcess,hasChildProcesses}; known hasPty false throws terminal_gone. Clear emits renderer request then swallows provider clear failure. Inventory all-host excludes failed SSH hosts and marks them unverifiable; local failure rejects whole call. Summary synthesizes orphan pty: IDs, empty path/branch without worktree, connected==writable and optional exit cause/host/agent identity.

Errors/partial effects: Invalidlimit; freshinventory unavailable. Tail preview empty doesn't fall back; blanksubstantialtail mayuse screen. Focus graphready/exited and notifiererrors; rename optionalnotification maystillreturn success. Wait permission is returnedblock not timeout; getPty disconnected with noexitcode yields unknown. Recover return lacks connected field; null liveness can proceed (source behavior to characterize).

Owed: Cursor gaps/partiallongline/sourcefallback; list stale leafhostscope/topologylimit; wait aborted/race/permission/unknownexit; status staleasync foreground and titlehook precedence; recover unknownlease vs null liveness and returnedshape; clear missingcontroller.

Evidence: [SRC-039](contracts.json); [SRC-040](contracts.json); [SRC-041](contracts.json); [SRC-042](contracts.json); [SRC-046](contracts.json); [SRC-052](contracts.json); [SRC-053](contracts.json); [SRC-054](contracts.json); [SRC-057](contracts.json); [SRC-058](contracts.json); [SRC-246](contracts.json); [SRC-280](contracts.json); [SRC-281](contracts.json); [SRC-282](contracts.json); [SRC-295](contracts.json); [SRC-299](contracts.json); [SRC-304](contracts.json); [SRC-305](contracts.json); [SRC-306](contracts.json); [SRC-308](contracts.json); [SRC-309](contracts.json).

### RRT-12 — terminal-orphan

`terminal.adoptOrphans`.

{adopted:false,topologyRevision:current,snapshot} exactpersisted replay even stale expectedrevision; otherwise {adopted:true,topologyRevision:persistedRepoRevision??current+1,snapshot}.

Fresh scoped inventory, canonical workspace/host, validate allclaims before writes, check existing persisted/graph/snapshot/tombstone ownership. Persist/flushearly then mutate PTY paneidentity, hydrate+notify andreturn snapshot; flushfailure CASstyle rollback preserves newerconcurrentstate. Topology merge first prunes/mends existing/proposed group sets; one shared group grafts recovered subtree there, otherwise appends only new subtree preserving proposal split orientation/ratio. Missing groups appended horizontal ratio0.5; empty result undefined; exactness requires no duplicates, exact count and membership.

Errors/partial effects: duplicate claims, stalehandle/incarnation/noinventory, host/WSL mismatch, alreadyvisual/competingowner/occupied/retired, revisionconflict. Postflush hydrate/notify errors can surface after durable adoption.

Owed: Replay before revisiongate; allclaim atomicvalidation, Windows unknown WSL refuses, duplicate/occupied/tombstone, flushfail rollback with concurrentmutation, postcommitnotificationfailure.

Evidence: [SRC-039](contracts.json); [SRC-055](contracts.json); [SRC-214](contracts.json).

### RRT-13 — session-tabs-query

`session.tabs.list`, `session.tabs.listAll`, `session.tabs.subscribe`, `session.tabs.unsubscribe`, `session.tabs.subscribeAll`, `session.tabs.unsubscribeAll`.

list returns projected workspace tabs result; listAll {snapshots,authoritative?:true} only complete PTYhost inventory and client capability can assertauthoritative. subscribe snapshot thenupdated/end; subscribeAll snapshots then sorted newerupdated/end; unsubscribe always {unsubscribed:true}, lookup maythrow beforecleanup.

List hydrates/refreshes/publishes runtime-owned PTYs beforeprojection (not purecache). Runtime-ownedremotehosts are not falselyqueriedlocally; legacySSH evidence projection unsupported=>inventorynull. listAll waits stable rendererpublicationepoch, completecensus check excludes runtimehosts; incompleteretry returns noauthoritative. subscribeAll listenersregistered beforecensus,256 buffer cap/3retries, coalesce same membership/navigation, sequence/dedup. One-workspace subscribe initial read precedeslistener registration (race needscharacterization). Actual projection drops browser pages not in live bridge; title/url use live truthy fallback; file/markdown/agent-session pass through. Terminal claims each live PTY once, prefers connected leaf then matched PTY; headless disallows worktree-only fallback. Handles mint only live; pending terminal:null otherwise. Owner-normalized title/status, hook identity recency, finite turnCompletedAt; color null omitted/pinfalse omitted; stale working under confirmed shell becomes done retaining agent identity. Finalization selects active, normalizes only if none marked, prunes groups and filters retired surfaces still present.

Errors/partial effects: client_disconnected, session_tabs_inventory_unstable after3 bufferedoverflows; runtime/workspace errors; closebeforeinitialized omitsend.

Owed: First-snapshot handoff race, sameconnection distinctrequest teardown, missing vs trueauthoritative, remotehostunknown inventory, buffer256overflow/3retry, changedmembership/removal/order/navigation intent; full E1tabprojection obligations remain.

Evidence: [SRC-088](contracts.json); [SRC-095](contracts.json); [SRC-096](contracts.json); [SRC-104](contracts.json); [SRC-223](contracts.json).

### RRT-14 — session-tabs-mutate

`session.tabs.activate`, `session.tabs.move`, `session.tabs.updatePaneLayout`, `session.tabs.setTabProps`, `session.tabs.close`, `session.tabs.closeLifecycle`, `session.tabs.createTerminal`.

activate returns projected snapshot; move {moved:true}; updatePaneLayout/setTabProps {updated:true}, including authoritativewindow NOOP branch. Close committed/delegated both {closed:true}; refusal ALSO closedtrue withrefused:true/refusalReason and snapshotRepublishedtrue onlywhenactuallysent. createTerminal returns surface result, not bareterminal.create receipt. Preflight validates folder usability before launch; resolves Windows project shell/WSL, blocks managed Claude auth switching or conflicting explicit env, pins compatible Codex home, and strips/deletes requested inherited env. Runtime resume can start fresh without a renderer notice. Concurrent pane reservations return the winner only after handle/PTY/incarnation proof; identity changes refuse. Stable-owner attach clears command/startup/create claims, requires exact id/isReattach/incarnation, and retires a persisted binding only after host-reported absence with CAS/flush; host loss stays unverified. Local spawn reattaches around asynchronous preflight, refuses missing attachOnly, calls node-pty spawn then reports commit before activation, so later activation failure can follow a physical effect.

Visibility guards beforepairedmutations; browser placements translated, terminalpublicleaf ID→parent. Activate can wakependingtab, disabledagent resolver fallsbackplain shell; automatic activation doesn'twakeparked. Reorder purepermutation with hiddenstructuredIDs reinserted. headless props/layoutpersist+snapshot; rendererhost optimisticNOOP. Close committedalone tombstonesselection; delegateddoesnot. Headlessclose persistretire beforekill, dormantlocalPTY notkillauthority;SSHdurableID eligible. Create coalesces caller+selector+mutationID successesTTL/failuresevict, nofingerprintcomparison atthislevel; graph+workspace+startup preflight, rendererIPCthenPTYS rescue/materialization, abortdoesnotkilllivecreatedtab. Headless props silently no-op absent session/setter; null color differs undefined, unified viewMode not written. Layout root:null retains old root; rereads persisted rebased layout, fallback candidate. Snapshots increment version and headless epoch then notify. Reorder preserves other groups; split/move-to-group helper null STILL returns moved:true; split builds0.5 oriented tree, moves active tab, drops empty group. Source defect: split helper does not check target group exists although comment claims missing-group no-op; possible group not represented in existing layout needs correction test.

Errors/partial effects: tab/group/order notfound/duplicate; stale publication/terminal, missing-intent, live-host-pty, unknown-liveness andretirement-owner are typedclose refusals. Ordinaryoldmobile/runtimeclient close preserveslegacyuserbehavior; capabilityenabledruntime/inprocess requiresreason. Renderererror/timeout afterrealcreate cankeepterminalalive orrescue; onlyno-live-shell truefailure rollsbackghost.

Owed: Optimistic updatedtrue withnoeffect; reordercompletevisible/hidden IDs; close closedtrue/refusedtrue vsdelegated no tombstone; deadleaf underlive sibling no republish; actualuser vslifecycle mixedversions; create reusedid changedpayload, abort/live rescue, pending group placement, SSHexpiredrestore.

Evidence: [SRC-089](contracts.json); [SRC-090](contracts.json); [SRC-094](contracts.json); [SRC-096](contracts.json); [SRC-098](contracts.json); [SRC-099](contracts.json); [SRC-101](contracts.json); [SRC-102](contracts.json); [SRC-103](contracts.json); [SRC-222](contracts.json); [SRC-276](contracts.json); [SRC-277](contracts.json); [SRC-278](contracts.json); [SRC-279](contracts.json).

### RRT-15 — session-markdown

`markdown.readTab`, `markdown.saveTab`.

read {tabId,filePath,relativePath,content,isDirty,version hash,source draft|file,editable,optionalreadOnlyReason}; save {tabId,version,isDirty:false,content:verified}. Alreadyidentical content onbaseVersionmismatch returns success evenifsourcewasdraft (sourcecaveat).

Resolveopenmarkdown editor/preview; flushdebouncedchanges; draftwins. save perfilequeue, re-resolvetarget, injectdraft+dirty, waitspositivesaveevent exactfile+content20s, readbackequality; failureCASrestores previousdraft/dirty unlessneweruserdraft present.

Errors/partial effects: renderer_unavailable,tab_not_found,binary_file,readlimit512KiB,editlimitsharedconstant,unsupported_preview/untitled,file_too_large,conflict,save_timeout,save_verification_failed. Editor quiesce/save and routedfilecontent contracts reuseacceptedE1editor source to its exactboundary; mustkeepnativeFS/SSH tests.

Owed: Staleversion identicaldirtydraft false-successcharacterization and intendedcorrection; pendingflush/currentdraftread; concurrentqueue, saveeventwrongcontent/timeouts andreadback mismatch; newerdesktopdraft preserved; SSH/runtimeowner/preview/untitled/byte limits.

Evidence: [SRC-097](contracts.json); [SRC-100](contracts.json).

### RRT-16 — native-transcript

`nativeChat.readSession`, `nativeChat.subscribe`, `nativeChat.unsubscribe`.

Read returns {messages,hasMore,beforeOffset,lifecycle?} or {error,notFound?:true}; unsupportedagenterror hasnotFoundomitted; resolver transientrefusal errorwithoutnotFound; absent/ENOENTnotFoundtrue. RPC boundslimitdefault40max2000/mobiletext-toolbudget andallclientimagesanitize. Subscribe initial snapshot/replace/append andend; pendingframeonlyfeature1; unsubalways true.

Tail walksbackbytes, skipsmalformed/oversized>2MiBrecords, incompletefinalJSONignored, shrinkempty; paginationlifecycleomitted whenbeforeOffsetpresent. Watch installsifreadable; watchdrain tracks identity,size,version,boundaryfingerprint; rotationreset+replaceboundedinitialwindow, appendsnotwindowed; WSLrunningguard andlocalretry25ms exponentialcap2s, oneinitialerror thenrecovery, idempotentunsubscribe abortsgatedIO/disposeswatch+poll. Resolver supported-agent routes first, readable hook JSONL first; WSL refusals stay unavailable and nohit does not imply local missing. Explicit Codex roots disable WSLfallback. Incremental reader retains incomplete LF prefix, drops overlarge record to next newline, emits40-message batches and returns remainder. RPC image metadata is dropped rather than truncated over512 chars, data:URL case/leading controls excluded; type stays image-ref even with no labels.

Errors/partial effects: Abort propagates ratherthan notFound; tailreadcloseshandleinfinally; watchdrainerrors emitinitialunavailableonlyoncethenretry; callbackerrorscaughtbydrain, closedguards. AcceptedE1FG06actualfourdecoders reused.

Owed: PartialUTF8/recordboundary, 2MiBskip, malformed/endoffset/shrink; notFound vsWSLtransient; rotate/truncate/samesizerewrite,rebind/cancel; paginationno lifecycle rewind; pendingframes/mobile sanitization/toolbudget; full fourdecoderoriginaltests.

Evidence: [SRC-004](contracts.json); [SRC-092](contracts.json); [SRC-093](contracts.json); [SRC-186](contracts.json).

### RRT-17 — orchestration-run-task-gate

`orchestration.runCreate`, `orchestration.runUse`, `orchestration.runCurrent`, `orchestration.runList`, `orchestration.runShow`, `orchestration.taskCreate`, `orchestration.taskList`, `orchestration.taskUpdate`, `orchestration.gateCreate`, `orchestration.gateResolve`, `orchestration.gateList`, `orchestration.reset`.

runCreate/use {run,binding:{consumerGeneration}}, current {run:null|row}, show {run} missingthrows; list {runs,nextCursor:null|string}, unparameterized returnsall. Taskcreate/update {task:rawSQLrow}; list {runId,legacyReadOnly,tasks,count}, dispatchassignee/id onlydispatched; briefexplicittransform. gatecreate/resolve {gate:rawSQLrow}, list {runId,gates,count}. reset {reset:all|tasks|messages}.

Run create BEGIN IMMEDIATE unbindotherpaneruns/fence deliveries,newgeneration1 nonlegacy; bind equivalentpane+samehandle unchangedgeneration elseinc/fence, routeunreaddirect, retainedlegacyproof/takeover checks. Task nullmetadata, depsJSONstring; pendingifanydepnotcompleted else ready; savepointstatusupdate refusesactive supervised worker, terminalstatus settleactive andpromote deps. Gatecreate refusesactive supervised, settlescontextonly dispatch+taskblocked; resolvereadyandresolvedsavepoint (canreresolve). Resettransaction neverprocesskill; all retainsmutationreceipts/recreateslegacyrun; tasks retainsmessages/closespendingquestions; messages retainsfederationrelaycursors.

Errors/partial effects: Scope/consumer/legacy/taskforeign errors; transactionrollback onfailure; task completed_at COALESCE preserveshistoricalcompletion whenreturningready (sourcebehavior). Reset all/tasks stoprelayBEFOREDBtransaction sofailedreset canleave relaystopped. Native SQLite IO errors not convertedto success.

Owed: Bindingsgeneration/replay/unreadroute+fencing; runpagecursor ties/invalidcursor; taskdeps crossrun/current dispatch guard/atomicpromotion; gateactive refusal/reresolve/transactionrollback; reset failure and receipts/cursors preserved; exactoriginalWP allocation.

Evidence: [SRC-059](contracts.json); [SRC-060](contracts.json); [SRC-061](contracts.json); [SRC-062](contracts.json); [SRC-075](contracts.json); [SRC-076](contracts.json); [SRC-077](contracts.json); [SRC-078](contracts.json); [SRC-079](contracts.json); [SRC-080](contracts.json); [SRC-081](contracts.json).

### RRT-18 — orchestration-mail

`orchestration.send`, `orchestration.check`, `orchestration.reply`, `orchestration.inbox`, `orchestration.ask`.

send point {message,lifecycle? rejected/completed/failed...,warnings?}; group {messages,recipients,warnings?}; remote {relay:{messageId,sequence,dispatchId,destination,accepted:true},lifecycle?}. check run actionable {runId,deliveryId:null|id,messages,count,replayed?,acknowledged:null|id,timedOut,cancelled,connectionLost,formatted?}; history/peek and worker/direct smaller shapes. reply question {message,question,duplicate}; generic {message}; inbox{messages,count}. Ask finalanswer nullable withIDs/timedOut/cancelled/connectionLost/timeoutMs; earlydurablereceiptacceptedtrue isnotanswer.

Messageinsertprecedescapability/lifecyclereconciliation; rejection becomesdurablemessage notthrow. Group filters unavailable recipients+deduplicates mailboxes/excludessender, transactionalinsert thenreceiptbeforenotify. Runcheck boundpane priority overworkerdispatch (child-Run routingbehavior), routeoldhandles,revalidategeneration, ACKthenget/replay outstandingdelivery; ackreceipt surviveswaiterror. Worker/direct consume marksread; workerpostwait pathmarksread evenpeek (sourcequirk). Ask requiresactiveowneddispatch, optionalresume exactquestion, persistsbeforewait; timeout/abortleavependingresumable question. Remote worker_done >=settlementversion waits30s Runhome elselegacyworkerlocalsettlement. Message insert defaults body empty/type status/priority normal/thread,payload,pane null with current_delivery and UTC projection; batch rollback all. Unread ordered sequence ASC/current only, history/inbox DESC and all contracts; batched500 read bits savepoint. Lifecycle rejects retained auditable; escalation/gate converted status, worker_done/heartbeat keep type with rejection marker. Report settlement exact task+dispatch/status and active-worker guard returns rejected code or settled duplicate; stalled-prompt failed report can correct prior failed record; first success promotes dependencies and closes questions, duplicate does not overwrite result. Question creation/answer transaction returns real stored rows, same answer duplicate true/different answer_conflict, closes pending on dispatch settlement; answer message already read to prevent double delivery.

Errors/partial effects: No recipient/groupempty/taskaddress reject; invalidoutcome reject; remote authority/version/queuedunconfirmedoperation_unknown aftersideeffect; runwaitconsumer_fenced/waiter_exists withACKpreservedreceipt; workerinactive reroutespendingmail torun thenerror; direct legacyinspectonly. replygeneric marksoriginalreadbeforeinsert; question reply is transactional.

Owed: Acceptedmail vsrejectedlifecycle; lostresponse replay andlateoldDispatch; group partialrouting; boundchildRun checkrouting; durableACK timeout/cancel/generationfence; workerpeek-afterwaitmarkread characterization/correction; askresume/firstanswerconflict/remoteunknown; exactprocesscapability andSSHmixedversion.

Evidence: [SRC-060](contracts.json); [SRC-068](contracts.json); [SRC-069](contracts.json); [SRC-070](contracts.json); [SRC-120](contracts.json); [SRC-121](contracts.json); [SRC-122](contracts.json); [SRC-123](contracts.json); [SRC-124](contracts.json); [SRC-125](contracts.json); [SRC-126](contracts.json); [SRC-127](contracts.json); [SRC-192](contracts.json); [SRC-193](contracts.json); [SRC-197](contracts.json); [SRC-198](contracts.json); [SRC-199](contracts.json).

### RRT-19 — orchestration-dispatch-start

`orchestration.dispatch`, `orchestration.dispatchShow`, `orchestration.workerStart`, `orchestration.federationAttachStart`.

dispatch dryrun {dispatch:null,injected:false,dryRun:true,preamble}; actual{dispatch,injected,preamble?}; show{dispatch:null|row,preamble?} regeneratecurrentTask withoutsecretcapability. Workerstart {runId,taskId,dispatchId,state,stage,setup,launch,timeoutMs,effects,residualResources,warning?}; attachment similar runtimeEpoch/worktreeId/terminalHandle; failureafteradmission returnsfailure receipt helper ratherthanthrow.

Run/task/caller+depth checked beforeeffects; exactexistingterminalworktree+recognizedagent. DBstartingrecord beforetopology; create/reuse resources, setup/readiness, exactpane/incarnation authority+capability theninject thenmarkready. This proves inputaccepted only, not taskresults. remoteattachdurablecallerfingerprint; onlyexactexisting ornewtop-level placement, remotedepthemitted againstworkerhostcap. Stagefailure preservesownedresources asreceipt; postcreatewarningbackgroundterminal allowed. DB claims require ready task and unique active pane, SAVEPOINT guarded claim with prior max failure count; concurrent failure rolls back task and row. Starting composed dispatch BEGIN IMMEDIATE atomically inserts pending mutation receipt and starting/accepted worker, task dispatched; conflicting request fingerprint mismatch versus existing identical receipt operation_unknown. Ready marks dispatched/ready/input_accepted. Known start failure marks failed task/worker and closes questions; stalled prompt retains capability for first-hand report correction. Unknown start revokes capability, blocks task, retains pending context/resources. Effects/residual/startOptions remain JSON strings in raw DB rows and are parsed in public receipt; stage field null-coalescing cannot clear prior optional fields. Current-worktree terminal create uses explicit startupAgent, background surface ownership; new-worktree returns committed worktree then validates startup terminal, so missing terminal retains worktree. Setup observe mode returns before completion; later nonzero/unknown exit emits status failure. Immediate createManagedWorktree is another assigned DR owner and not accepted by this report.

Errors/partial effects: Preflightthrowsinvalidargument/consumerfenced/tasknotfound/terminalmismatch/unconfigured; injectfailurefailscontextandthrows. Retriedremoteunknown mustnotduplicateresources. Scheduler source behavior isdifferentfromliveCLI retiredcommands.

Owed: Denieddepth noRunresetbypass; exactincarnationreuse; setupstart/waitfailure; blockedpermissionvsidle; promptacceptedthenreportfailure; remote unknownstart/retryreceipts; foldernoGit andplacement+launchargv flags.

Evidence: [SRC-063](contracts.json); [SRC-064](contracts.json); [SRC-073](contracts.json); [SRC-131](contracts.json); [SRC-132](contracts.json); [SRC-155](contracts.json); [SRC-156](contracts.json); [SRC-157](contracts.json); [SRC-191](contracts.json); [SRC-207](contracts.json).

### RRT-20 — orchestration-worker-control

`orchestration.workerShow`, `orchestration.workerRead`, `orchestration.workerAbandon`, `orchestration.workerStop`, `orchestration.workerRelease`, `orchestration.workerRetain`, `orchestration.workerList`, `orchestration.workerTerminalUserInput`, `orchestration.federationShow`, `orchestration.federationRead`, `orchestration.federationReadOutput`, `orchestration.federationStop`.

Show dispatch+worker(parsedJSONeffects/startoptions),terminal:null unlessexact, observation status/exactWorker and optionalagentWait (nullmeanslooked;undefinednotlooked),resource:null|object; read actualoutputhelper, archivedafterrelease, remoteoutput withserver/runtimeEpoch. Abandon/stop receipts state/alreadySettled/processAction pluswarning/residuals/close/lastError bybranch. Release state retained/already_released/released/release_unknown etc reason/archive; retain mayreturnreleasepending/unknown ifcommitstarted. list counts overALLrows despite filteredworkers; userinput {changed:boolean}.

Show reconciles staleepochstarting/stopping to unknown; remoteshowreconcilesready/terminalreport/setup andstartrelay. Read fencesidentitybothbeforeandafter; legacyremote fallback ONLYmethod_not_found; federationRead excludesexited, readOutputpermits exactexited. Stop contextonly no processaction; owned exactlive/unverifiable mayattemptclose, onlyptyKilledtrue settlesstopped; false yields stopunknown thoughsurfacemaybeclosed. Release federated unsupported retained; retaineddeadprocess proof canreconcile withoutkill. Durable stop begins only ready/start_unknown, closes questions/revokes capability and blocks/reconciles task; terminal settled statuses idempotent. stop_unknown retains uncertainty; later federated exact proof can settle. Abandon stale dispatch is no-op, rejects stopping/succeeded; never kills. Release requires settled worker, external/user/transferred/stopped identity retains; archive transaction commits requested->releasing before close. Missing identity interactive release_unknown versus recovery release_pending; lost endpoint after close attempt retained pending, false kill ack unknown. Exact current host/pane/incarnation checked again after archive. Retain cannot undo committed release; user input changes owned->user_owned except stopping/releasing, discards archive. workerList includes unsupervised contexts and nullable resource/terminalState; filter counts are global to selected Run, not only output rows. Transcript output resolves provider file then bounded backward/forward JSONL; initialtail2MiB, forward8MiB, overlarge/malformed records skipped/disclosed. Cursor owr1_ validates exact dispatch/source identity; numeric legacy accepted. Payload limits50messages,6blocks,1200chars text,20tool entries/depth5/100nodes/512KiB response after first message; local image paths omitted, file-derived IDs hashed, only dispatch capability pattern redacted (not a general secret scrubber). Archive transcript_pin v2 stores messages, fallback terminal tail262144 chars; archive capture before final identity reproof and close.

Errors/partial effects: Missingdispatch, pinnedserver mismatch, readidentitychange, invalidrawJSON exposed; transport loss neverexit. stop catchesunknown, oldserverwithoutverdictcap returnunknownnone; ownerunproven/refusalnone; nohandleunknown. Userinput permanentlyforfeitsownership viaDB.

Owed: Usertakeover/transfer/releasearchive collisions; unknownclose receipt; restartstages; exactprocessbefore/afterread; nullvsomittedagentWait; legacyremoteread/capabilitymissing; countfilter; live/unverifiable/exited strictseparation.

Evidence: [SRC-065](contracts.json); [SRC-066](contracts.json); [SRC-067](contracts.json); [SRC-074](contracts.json); [SRC-128](contracts.json); [SRC-129](contracts.json); [SRC-130](contracts.json); [SRC-158](contracts.json); [SRC-159](contracts.json); [SRC-160](contracts.json); [SRC-161](contracts.json); [SRC-162](contracts.json); [SRC-195](contracts.json); [SRC-196](contracts.json); [SRC-233](contracts.json).

### RRT-21 — orchestration-federation-relay

`orchestration.federationPull`, `orchestration.federationAck`, `orchestration.federationImport`, `orchestration.requestShow`.

pull{dispatchId,runtimeEpoch,items}; ack{dispatchId,acknowledgedThrough}; import{dispatchId,acknowledgedThrough:cursor,imported} importedcountcontrolmail onlynotreplies. requestShow absent{requestId,state,interpretation};existing additionallymethod,createdAt,updatedAt,receipt? parsedunknown; invalidstoredreceipt createsundefinedpropertyomittedonJSONwire.

Fingerprintattachmentfence; pullallafterseq orpendingunack. ACKdropssettlementsbeyondthrough, dedupeidentical/rejectconflicts andopposedterminaloutcomes thenDBacksettlebeforepublish. Importcontiguouscursor, duplicate<=cursor skip; item-bydurableitemreply/controlmessage+notify+cursor; laterfailure retainsprioritems. requestShow usescallerreceipt key; localreadcancreatecallerfingerprintmetadata despiteclaimread-onlyreceipt. DB enqueue bounds payload64KiB,256pending/1MiB and coalesces heartbeat; duplicate worker_done reused. Pull≤50. ACK current protocol requires every terminal report settlement before atomically ack/settle; import durable per item and monotonic cursor, duplicate agreement checks run/to/type not body/from. Completed mutation receipt JSON can be arbitrary/invalid; local fingerprint may be first persisted during lookup.

Errors/partial effects: dispatchnotfound/fingerprint; importgapoperation_unknown, inactive/versionunsupported/invalidkind/JSONbad; noallbatchrollback implied. requestShow absentdoesnotprovenoeffect.

Owed: Partialimportfailure/retrydedupe; conflictingACKsettlements noadvance; oldprotocolcontrolmail; losthomeconfirmation; callerisolation receiptinvalidJSON/absent/pending/completed andrestart.

Evidence: [SRC-071](contracts.json); [SRC-072](contracts.json); [SRC-205](contracts.json).

### RRT-22 — terminal-input

`terminal.send`.

Returns accepted:true and UTF-8 byte count only after provider writes; prompt path additionally returns submit count 1 after activity verification. This is neither application completion nor a process-exit verdict. Concrete local write returns false without process, true for a consumed startup reply or after native write; native throw escapes to the controller. Resize missing process is a void no-op. Local list constructs id, optional incarnation/worktree/handle/WSL, startup cwd or empty string, and native process title/shell fallback. Local shutdown coalesces by id, supports escalation, preserves physical-exit tracking, waits up to 8 seconds, and keeps ownership if exit is unproven; POSIX TERM escalates after 5 seconds, Windows root/job semantics differ. Foreground errors retain cached recognized agent; complete absence removes it, and stale async identity returns null. SSH write true only proves transport admission, settlement callback is not remote process consumption, and settlement timeout disposes the mux; resize is a notification. SSH inspection/cwd/child-process replies are raw casts, not validated result schemas. Daemon write marks dirty; recoverable disconnect throws PtyWriteUnavailableError and starts recovery, legacy delivery failure returns false. Daemon shutdown awaits checkpoint under keepHistory before kill request, refuses expired checkpoint wait without killing, then clears caches; history removal errors are logged and tombstones cap at 1000. Daemon list filters isAlive, validates owner bindings, maps title to shell and cwd fallback, prunes only pre-request cached ids, and propagates inventory errors. Old daemon inspection yields unverifiable, intermediate versions compose foreground+children, modern versions pass inspection through; ordinary foreground read catches to null.

Raw text is chunked with yield and admission-fence rechecks, then delayed CR/Ctrl-C suffix; agent paste is one bracketed write, render/delay gate then separately submitted, preserving generation and permission baseline. Verification polls50ms; success on workingSequence rise, later explicitWorkingStartedAt, or baseline already working plus outputSequence increase. New permission or changed generation rejects; deadline rechecks once then agent_prompt_stalled, abort request_aborted. Byte delivery precedes all verification. Provider write false/throw maps false at controller; undefined means success.

Errors/partial effects: Missing/wrong/stale/unwritable handles reject; any later write, abort, fence, permission or post-submit verification failure can reject after bytes already reached PTY. Host write platform uses relay remotePlatform else path flavor; local WSL pays Windows ingest delays.

Owed: Chunk Unicode/big paste, provider refusal after prefix, abort between text and suffix, fence rollover, concurrent prompt serialization, permission prompt race, Windows/WSL/SSH delay, unobserved versus confirmed prompt submit.

Evidence: [SRC-133](contracts.json); [SRC-138](contracts.json); [SRC-139](contracts.json); [SRC-213](contracts.json); [SRC-280](contracts.json); [SRC-281](contracts.json); [SRC-282](contracts.json); [SRC-295](contracts.json); [SRC-299](contracts.json); [SRC-304](contracts.json); [SRC-305](contracts.json); [SRC-306](contracts.json); [SRC-308](contracts.json); [SRC-309](contracts.json).

### RRT-23 — terminal-viewport

`terminal.resizeForClient`, `terminal.setDisplayMode`, `terminal.restoreFit`, `terminal.getDisplayMode`, `terminal.updateViewport`, `terminal.getAutoRestoreFit`, `terminal.setAutoRestoreFit`.

resizeForClient returns clamped dimensions, nullable previous dimensions and display mode after ok layout; setDisplayMode returns mode/optional seq and can ignore failed restore; getDisplayMode defaults auto/false for missing leaf. updateViewport returns updated/applied independently with optional seq. restoreFit returns whether lock existed, not guaranteed geometry convergence. AutoRestore get/set returns {ms:number|null}, clamp finite range; no store setter returns existing value. Concrete local write returns false without process, true for a consumed startup reply or after native write; native throw escapes to the controller. Resize missing process is a void no-op. Local list constructs id, optional incarnation/worktree/handle/WSL, startup cwd or empty string, and native process title/shell fallback. Local shutdown coalesces by id, supports escalation, preserves physical-exit tracking, waits up to 8 seconds, and keeps ownership if exit is unproven; POSIX TERM escalates after 5 seconds, Windows root/job semantics differ. Foreground errors retain cached recognized agent; complete absence removes it, and stale async identity returns null. SSH write true only proves transport admission, settlement callback is not remote process consumption, and settlement timeout disposes the mux; resize is a notification. SSH inspection/cwd/child-process replies are raw casts, not validated result schemas. Daemon write marks dirty; recoverable disconnect throws PtyWriteUnavailableError and starts recovery, legacy delivery failure returns false. Daemon shutdown awaits checkpoint under keepHistory before kill request, refuses expired checkpoint wait without killing, then clears caches; history removal errors are logged and tombstones cap at 1000. Daemon list filters isAlive, validates owner bindings, maps title to shell and cwd fallback, prunes only pre-request cached ids, and propagates inventory errors. Old daemon inspection yields unverifiable, intermediate versions compose foreground+children, modern versions pass inspection through; ordinary foreground read catches to null.

Phone latest-actor and desktop earliest-baseline selection; per-PTY queue coalesces only same mode+owner, absent exited layout resolves not-ok. Explicit take-back clears lock best-effort and resets auto; mode restore failure rearms fit flags. Null auto-restore clears pending timers; finite update does not schedule already-held PTYs. Tentative state/override written before resize. Controller resize ignores provider return, records dimensions if no synchronous throw; applyLayout additionally treats absent controller/undefined result as true. False/throw rolls back prior layout/override; headless resize/notifier failure AFTER provider effect can cause queue failure despite committed geometry. Success emits layout seq after notifications; mode/driver updates at equal geometry still emit.

Errors/partial effects: No subscription update=>false/false; desktop mode/driver=>true/false; resize failure=>updated true/applied false. Layout queue catches synchronous failures; provider success can precede notifier failure.

Owed: Failed resize rollback versus optimistic reclaim, latest owner races, stale seq, queued exited PTY, first subscribe, indefinite hold, finite clamp, setting absent store, Windows/SSH provider resize acknowledgement.

Evidence: [SRC-035](contracts.json); [SRC-084](contracts.json); [SRC-136](contracts.json); [SRC-137](contracts.json); [SRC-142](contracts.json); [SRC-143](contracts.json); [SRC-212](contracts.json); [SRC-280](contracts.json); [SRC-281](contracts.json); [SRC-282](contracts.json); [SRC-295](contracts.json); [SRC-299](contracts.json); [SRC-304](contracts.json); [SRC-305](contracts.json); [SRC-306](contracts.json); [SRC-308](contracts.json); [SRC-309](contracts.json).

### RRT-24 — terminal-agent-teams

`agentTeams.tmuxCompat`, `agentTeams.prepareLaunch`.

prepareLaunch resolves Orca pane, creates shim then registers team; runtime result actually includes {teamId,token,leaderPane,env}, although annotation only advertises env. tmux response always {ok,stdout,stderr,exitCode}; catch maps any error to false/empty/std-error newline/1, success true/output/empty/0. Shim preparation is now read: mkdir and write-if-changed use temporary write/chmod/rename with cleanup on failure; identical bytes do not repair mode. Absolute CLI override is accepted without existence proof, bare names search absolute PATH entries, and unavailable CLI/Windows/inprocess selection returns inprocess plan. This audit did not execute shim preparation.

Fresh random team/token, platform PATH delimiter/case and optional propagated launch variables. Split increments fake ID before awaited terminal spawn; successful pane persists. Respawn closes then recreates preserving fake ID, removes on failed recreate; unconfirmed close blocks respawn without forgetting pane. Kill refuses leader and removes only confirmed kill. List/capture/focus map existing terminal contracts. Resize and set/hook/attach/wait/has commands return empty success without real action; select-layout only updates future split policy. Nested response is RPC {tmux:{ok,stdout,stderr,exitCode}} and {launch:{teamId,token,leaderPane,env}}. Shim preparation is characterized in the result contract; no shim was installed by this audit.

Errors/partial effects: Unauthorized/stale team/pane, unsupported command/option caught response rather than RPC reject; prepare shim IO can reject before team. Split failure may consume fake ID; selected previous-focus recorded before actual focus. These source no-ops require characterization plus root-ratified intended corrections.

Owed: All compatibility command cases, Windows Path casing, no cwd-relative CLI shim, lost leader cleanup, fake-ID gaps, respawn close-unverifiable and spawn-failed partial state.

Evidence: [SRC-134](contracts.json); [SRC-140](contracts.json); [SRC-141](contracts.json); [SRC-271](contracts.json).

### RRT-25 — terminal-streams

`terminal.multiplex`, `terminal.subscribe`, `terminal.unsubscribe`.

Multiplex emits ready then per-slot subscribed metadata/binary snapshots, output, metadata, resized, error/end verdict; no scalar completion result. Legacy noPTY emits subscribed(streamId:null,lines,truncated) then end; mobile requires binary; lease-only emits empty subscribed without terminal view/fit. JSON emits scrollback with optional serialized/dims/seq then data/fit events/end. Unsubscribe scoped ownership permits missing true, foreign false. Frame validation requires safe nonnegative display length, valid ranges with common source identity and contiguous source/display offsets; unmapped empty ranges are allowed. Snapshot replacement clears only ranges whose numeric outputSeq is at most snapshotSeq and requires every mapped frame be covered. Headless snapshot waits for write/ownership settlement, returns null on absent state or empty data unless includeEmpty, and constructs sequence-bound data/geometry/source/OSC links/alternate screen/kitty flags/pending escape tail from the emulator; the source-range hooks interface itself proves no settlement.

Per-connection registry, live handle resolution, bounded pending/active slots, stream-ID replacement cleanup. Register live buffering before mobile fit; initial overflow retries once then flags truncated, trims snapshot-covered bytes; capability-negotiated ACK windows/source ledgers/output pause. Source settlement only after transport send+ledger commit, false/throw transport closes connection. ACK excess clamps, duplicate generations ignored, round-robin fairness. Snapshot unavailable explicitly differs empty. Cleanup releases only owned floor/listeners and cancels waits; exit end only confirmed wait, otherwise unverifiable. Legacy initial mount waits bounded3s then keeps late recovery watcher; stale late snapshot only applies when its output sequence exactly equals current. Initial overflow retries and may drop buffered middle, truncated true; up to2 recovery attempts require output seq. Snapshot start conditionally includes kitty flags/owner only numeric seq, alternateScreen additionally owner; data chunk false yields publishedfalse/partial bytes, void accepted. Requested snapshot2MiB, mobile descending row budgets, zero-row may still exceed budget marked truncated. Geometry restream requires apply-layout and nonalternate screen, failure sends geometry-only frame; helper returns true even after an ignored publicationfalse result.

Errors/partial effects: Stale/noPTY=>error and slot end; async snapshot failures detach only own generation; recovery failure error+unverifiable; pause drops pending/live output requiring requested snapshot to restore.

Owed: Read all allocated stream tests; preserve ACK overflow/source-range replay/initial snapshot race/slot reuse/abort cleanup, legacy JSON gap, capability negotiation, send false versus void, confirmed exit versus SSH disconnect, desktop claim denial/mobile input.

Evidence: [SRC-035](contracts.json); [SRC-085](contracts.json); [SRC-086](contracts.json); [SRC-144](contracts.json); [SRC-145](contracts.json); [SRC-146](contracts.json); [SRC-147](contracts.json); [SRC-148](contracts.json); [SRC-149](contracts.json); [SRC-150](contracts.json); [SRC-151](contracts.json); [SRC-152](contracts.json); [SRC-153](contracts.json); [SRC-154](contracts.json); [SRC-228](contracts.json); [SRC-229](contracts.json); [SRC-230](contracts.json); [SRC-231](contracts.json); [SRC-290](contracts.json); [SRC-297](contracts.json).

### RRT-26 — client-events

`runtime.clientEvents.subscribe`, `runtime.clientEvents.unsubscribe`.

Ready event carries subscription ID plus sshStates snapshot after sorted current sleep/create/native-draft events; listener is installed first. Unsubscribe own-prefix scoped ID returns false if foreign, true when owned even already gone. No scalar subscribe result.

Per-client mobile presence counters, connection-owned cleanup; draft resolution snapshot bounded200 with identity/text/time fencing and retire reconciliation. Callback errors logged independently. Loss of SSH contact remains state update, no process-exit proof.

Errors/partial effects: Abort/connection cleanup unregister; event producer's callback throw isolated. Source snapshot and live event interleave requires replay/coalescing contract tests.

Owed: Subscribe snapshot/live race, cancellation before ready, duplicate/foreign unsubscribe, draft eviction/stale tombstone, multiple mobile clients, SSH state replay.

Evidence: [SRC-003](contracts.json); [SRC-032](contracts.json); [SRC-114](contracts.json); [SRC-115](contracts.json).

### RRT-27 — orchestration-legacy-loop

`orchestration.run`, `orchestration.runStop`.

Pinned RPC run returns {runId,status:'running'} immediately after a DB coordinator row and starts loop without awaiting completion. runStop returns {stopped:true,runId} after active-row lookup and optional in-memory stop signal; no active row throws. The live installed CLI retiring this command does not remove the pinned RPC contract.

Loop requires precreated tasks (no AI decomposition), ticks default2s/default4concurrent, marks final completed only not stopped/no failed/incomplete tasks; otherwise failed. Stop flips boolean and is not immediate child process cleanup. DB update retains completed_at through COALESCE; active lookup latest running. Creation/scheduling can happen after admission receipt and failure updates DB later.

Errors/partial effects: Missing tasks asynchronously fail after returned running. Runtime create-terminal errors logged and retry next tick; existing active DB row with missing in-memory coordinator can yield stopped:true without a stop effect. Must characterize and separately ratify intended correction.

Owed: Running receipt before later failure, stop during sleep/decompose, DB/in-memory divergence, task scoping, partial dispatch and convergence, preserve legacy versus current CLI version matrix.

Evidence: [SRC-059](contracts.json); [SRC-060](contracts.json); [SRC-061](contracts.json); [SRC-062](contracts.json); [SRC-182](contracts.json); [SRC-183](contracts.json).

## Exact ID + method reconciliation

Each row retains its receiver envelope and actual result in `methods` in JSON; the full shared and additional contracts above are reused explicitly. This table preserves the complete identity set without repeating the same multi-branch service contract for every method.

| Group | Method | Receiver source | Result contract references |
| --- | --- | --- | --- |
| DR-STATUS_METHODS | `status.get` | src/main/runtime/rpc/methods/status.ts:5–17 | RRT-01 |
| DR-AGENT_SESSION_METHODS | `terminal.ensureAgentSession` | src/main/runtime/rpc/methods/agent-session.ts:237–245 | RRT-05, RRT-J01 |
| DR-AGENT_SESSION_METHODS | `terminal.createAgentSession` | src/main/runtime/rpc/methods/agent-session.ts:246–256 | RRT-04, RRT-J01 |
| DR-STRUCTURED_AGENT_SESSION_METHODS | `agentSession.createSupport` | src/main/runtime/rpc/methods/structured-agent-session.ts:47–56 | RRT-07 |
| DR-STRUCTURED_AGENT_SESSION_METHODS | `agentSession.create` | src/main/runtime/rpc/methods/structured-agent-session.ts:57–117 | RRT-07, RRT-J02, RRT-J06 |
| DR-STRUCTURED_AGENT_SESSION_METHODS | `agentSession.ensure` | src/main/runtime/rpc/methods/structured-agent-session.ts:118–125 | RRT-07, RRT-J02, RRT-J06 |
| DR-STRUCTURED_AGENT_SESSION_METHODS | `agentSession.send` | src/main/runtime/rpc/methods/structured-agent-session.ts:126–130 | RRT-06, RRT-J02, RRT-J06 |
| DR-STRUCTURED_AGENT_SESSION_METHODS | `agentSession.cancel` | src/main/runtime/rpc/methods/structured-agent-session.ts:131–135 | RRT-06, RRT-J02, RRT-J06 |
| DR-STRUCTURED_AGENT_SESSION_METHODS | `agentSession.close` | src/main/runtime/rpc/methods/structured-agent-session.ts:136–150 | RRT-08, RRT-J02, RRT-J06 |
| DR-STRUCTURED_AGENT_SESSION_METHODS | `agentSession.respondToApproval` | src/main/runtime/rpc/methods/structured-agent-session.ts:151–156 | RRT-06, RRT-J02, RRT-J06 |
| DR-STRUCTURED_AGENT_SESSION_METHODS | `agentSession.respondToQuestion` | src/main/runtime/rpc/methods/structured-agent-session.ts:157–162 | RRT-06, RRT-J02, RRT-J06 |
| DR-STRUCTURED_AGENT_SESSION_METHODS | `agentSession.setOption` | src/main/runtime/rpc/methods/structured-agent-session.ts:163–167 | RRT-06, RRT-J02, RRT-J06 |
| DR-STRUCTURED_AGENT_SESSION_METHODS | `agentSession.handoffStatus` | src/main/runtime/rpc/methods/structured-agent-session.ts:168–172 | RRT-08, RRT-J02, RRT-J06 |
| DR-STRUCTURED_AGENT_SESSION_METHODS | `agentSession.options` | src/main/runtime/rpc/methods/structured-agent-session.ts:173–177 | RRT-08, RRT-J02, RRT-J06 |
| DR-STRUCTURED_AGENT_SESSION_METHODS | `agentSession.history` | src/main/runtime/rpc/methods/structured-agent-session.ts:178–182 | RRT-08, RRT-J02, RRT-J06 |
| DR-STRUCTURED_AGENT_SESSION_METHODS | `agentSession.subscribe` | src/main/runtime/rpc/methods/structured-agent-session.ts:183–244 | RRT-08, RRT-J02, RRT-J06 |
| DR-STRUCTURED_AGENT_SESSION_METHODS | `agentSession.unsubscribe` | src/main/runtime/rpc/methods/structured-agent-session.ts:245–260 | RRT-08, RRT-J02, RRT-J06 |
| DR-STRUCTURED_AGENT_SESSION_METHODS | `agentSession.hold` | src/main/runtime/rpc/methods/structured-agent-session-hold.ts:31–51 | RRT-08, RRT-J02, RRT-J06 |
| DR-STRUCTURED_AGENT_SESSION_METHODS | `agentSession.release` | src/main/runtime/rpc/methods/structured-agent-session-hold.ts:52–63 | RRT-08, RRT-J02, RRT-J06 |
| DR-TERMINAL_METHODS | `terminal.list` | src/main/runtime/rpc/methods/terminal/terminal-query-methods.ts:14–23 | RRT-11, RRT-J03 |
| DR-TERMINAL_METHODS | `terminal.resolveActive` | src/main/runtime/rpc/methods/terminal/terminal-query-methods.ts:24–30 | RRT-11, RRT-J03 |
| DR-TERMINAL_METHODS | `terminal.resolvePane` | src/main/runtime/rpc/methods/terminal/terminal-query-methods.ts:31–37 | RRT-11, RRT-J03 |
| DR-TERMINAL_METHODS | `terminal.recoverPane` | src/main/runtime/rpc/methods/terminal/terminal-query-methods.ts:38–48 | RRT-11, RRT-J01, RRT-J03 |
| DR-TERMINAL_METHODS | `terminal.show` | src/main/runtime/rpc/methods/terminal/terminal-query-methods.ts:49–55 | RRT-11, RRT-J03 |
| DR-TERMINAL_METHODS | `terminal.read` | src/main/runtime/rpc/methods/terminal/terminal-query-methods.ts:56–66 | RRT-11, RRT-J03 |
| DR-TERMINAL_METHODS | `terminal.inspectProcess` | src/main/runtime/rpc/methods/terminal/terminal-query-methods.ts:67–84 | RRT-11, RRT-J03 |
| DR-TERMINAL_METHODS | `terminal.isRunningAgent` | src/main/runtime/rpc/methods/terminal/terminal-query-methods.ts:85–91 | RRT-11, RRT-J03 |
| DR-TERMINAL_METHODS | `terminal.agentStatus` | src/main/runtime/rpc/methods/terminal/terminal-query-methods.ts:92–98 | RRT-11, RRT-J03 |
| DR-TERMINAL_METHODS | `terminal.rename` | src/main/runtime/rpc/methods/terminal/terminal-query-methods.ts:99–105 | RRT-11, RRT-J03 |
| DR-TERMINAL_METHODS | `terminal.clearBuffer` | src/main/runtime/rpc/methods/terminal/terminal-query-methods.ts:106–112 | RRT-11, RRT-J03 |
| DR-TERMINAL_METHODS | `terminal.send` | src/main/runtime/rpc/methods/terminal/terminal-send-method.ts:20–251 | RRT-22, RRT-J03 |
| DR-TERMINAL_METHODS | `terminal.wait` | src/main/runtime/rpc/methods/terminal/terminal-lifecycle-methods.ts:23–33 | RRT-11, RRT-J03 |
| DR-TERMINAL_METHODS | `terminal.create` | src/main/runtime/rpc/methods/terminal/terminal-lifecycle-methods.ts:34–80 | RRT-09, RRT-J01 |
| DR-TERMINAL_METHODS | `terminal.split` | src/main/runtime/rpc/methods/terminal/terminal-lifecycle-methods.ts:81–92 | RRT-09, RRT-J01 |
| DR-TERMINAL_METHODS | `terminal.stop` | src/main/runtime/rpc/methods/terminal/terminal-lifecycle-methods.ts:93–97 | RRT-10, RRT-J03 |
| DR-TERMINAL_METHODS | `terminal.closeAll` | src/main/runtime/rpc/methods/terminal/terminal-lifecycle-methods.ts:98–102 | RRT-10, RRT-J03 |
| DR-TERMINAL_METHODS | `terminal.sleep` | src/main/runtime/rpc/methods/terminal/terminal-lifecycle-methods.ts:103–107 | RRT-10, RRT-J03 |
| DR-TERMINAL_METHODS | `terminal.stopExact` | src/main/runtime/rpc/methods/terminal/terminal-lifecycle-methods.ts:108–116 | RRT-10, RRT-J03 |
| DR-TERMINAL_METHODS | `terminal.resizeForClient` | src/main/runtime/rpc/methods/terminal/terminal-lifecycle-methods.ts:117–140 | RRT-23, RRT-J03 |
| DR-TERMINAL_METHODS | `terminal.focus` | src/main/runtime/rpc/methods/terminal/terminal-lifecycle-methods.ts:141–151 | RRT-11, RRT-J03 |
| DR-TERMINAL_METHODS | `terminal.close` | src/main/runtime/rpc/methods/terminal/terminal-lifecycle-methods.ts:152–164 | RRT-10, RRT-J03 |
| DR-TERMINAL_METHODS | `terminal.closeTab` | src/main/runtime/rpc/methods/terminal/terminal-lifecycle-methods.ts:165–177 | RRT-10, RRT-J03 |
| DR-TERMINAL_METHODS | `agentTeams.tmuxCompat` | src/main/runtime/rpc/methods/terminal/terminal-lifecycle-methods.ts:178–184 | RRT-24 |
| DR-TERMINAL_METHODS | `agentTeams.prepareLaunch` | src/main/runtime/rpc/methods/terminal/terminal-lifecycle-methods.ts:185–194 | RRT-24 |
| DR-TERMINAL_METHODS | `terminal.setDisplayMode` | src/main/runtime/rpc/methods/terminal/terminal-viewport-methods.ts:13–33 | RRT-23, RRT-J03 |
| DR-TERMINAL_METHODS | `terminal.restoreFit` | src/main/runtime/rpc/methods/terminal/terminal-viewport-methods.ts:34–45 | RRT-23, RRT-J03 |
| DR-TERMINAL_METHODS | `terminal.getDisplayMode` | src/main/runtime/rpc/methods/terminal/terminal-viewport-methods.ts:46–55 | RRT-23, RRT-J03 |
| DR-TERMINAL_METHODS | `terminal.updateViewport` | src/main/runtime/rpc/methods/terminal/terminal-viewport-methods.ts:56–78 | RRT-23, RRT-J03 |
| DR-TERMINAL_METHODS | `terminal.multiplex` | src/main/runtime/rpc/methods/terminal/terminal-multiplex-method.ts:15–71 | RRT-25, RRT-J04 |
| DR-TERMINAL_METHODS | `terminal.subscribe` | src/main/runtime/rpc/methods/terminal/terminal-subscribe-method.ts:13–94 | RRT-25, RRT-J04 |
| DR-TERMINAL_METHODS | `terminal.unsubscribe` | src/main/runtime/rpc/methods/terminal/terminal-viewport-methods.ts:82–105 | RRT-25 |
| DR-TERMINAL_METHODS | `terminal.getAutoRestoreFit` | src/main/runtime/rpc/methods/terminal/terminal-viewport-methods.ts:106–112 | RRT-23, RRT-J03 |
| DR-TERMINAL_METHODS | `terminal.setAutoRestoreFit` | src/main/runtime/rpc/methods/terminal/terminal-viewport-methods.ts:113–119 | RRT-23, RRT-J03 |
| DR-TERMINAL_ORPHAN_METHODS | `terminal.adoptOrphans` | src/main/runtime/rpc/methods/terminal-orphan.ts:108–112 | RRT-12 |
| DR-BROWSER_CORE_METHODS | `browser.snapshot` | src/main/runtime/rpc/methods/browser-core.ts:42–46 | RRT-BROWSER-snapshot |
| DR-BROWSER_CORE_METHODS | `browser.click` | src/main/runtime/rpc/methods/browser-core.ts:47–51 | RRT-BROWSER-RAW |
| DR-BROWSER_CORE_METHODS | `browser.goto` | src/main/runtime/rpc/methods/browser-core.ts:52–56 | RRT-BROWSER-goto |
| DR-BROWSER_CORE_METHODS | `browser.certificate.proceed` | src/main/runtime/rpc/methods/browser-core.ts:57–61 | RRT-BROWSER-certificate.proceed |
| DR-BROWSER_CORE_METHODS | `browser.fill` | src/main/runtime/rpc/methods/browser-text-rpc-methods.ts:6–13 | RRT-BROWSER-fill |
| DR-BROWSER_CORE_METHODS | `browser.type` | src/main/runtime/rpc/methods/browser-text-rpc-methods.ts:14–21 | RRT-BROWSER-type |
| DR-BROWSER_CORE_METHODS | `browser.keyboardInsertText` | src/main/runtime/rpc/methods/browser-text-rpc-methods.ts:22–29 | RRT-BROWSER-keyboardInsertText |
| DR-BROWSER_CORE_METHODS | `browser.select` | src/main/runtime/rpc/methods/browser-core.ts:63–67 | RRT-BROWSER-RAW |
| DR-BROWSER_CORE_METHODS | `browser.scroll` | src/main/runtime/rpc/methods/browser-core.ts:68–72 | RRT-BROWSER-RAW |
| DR-BROWSER_CORE_METHODS | `browser.back` | src/main/runtime/rpc/methods/browser-core.ts:73–77 | RRT-BROWSER-RAW |
| DR-BROWSER_CORE_METHODS | `browser.reload` | src/main/runtime/rpc/methods/browser-core.ts:78–82 | RRT-BROWSER-reload |
| DR-BROWSER_CORE_METHODS | `browser.screenshot` | src/main/runtime/rpc/methods/browser-core.ts:83–87 | RRT-BROWSER-screenshot |
| DR-BROWSER_CORE_METHODS | `browser.eval` | src/main/runtime/rpc/methods/browser-core.ts:88–92 | RRT-BROWSER-eval |
| DR-BROWSER_CORE_METHODS | `browser.tabList` | src/main/runtime/rpc/methods/browser-core.ts:93–97 | RRT-BROWSER-tabList |
| DR-BROWSER_CORE_METHODS | `browser.tabShow` | src/main/runtime/rpc/methods/browser-core.ts:98–102 | RRT-BROWSER-tabShow |
| DR-BROWSER_CORE_METHODS | `browser.tabCurrent` | src/main/runtime/rpc/methods/browser-core.ts:103–107 | RRT-BROWSER-tabCurrent |
| DR-BROWSER_CORE_METHODS | `browser.tabSwitch` | src/main/runtime/rpc/methods/browser-core.ts:108–112 | RRT-BROWSER-tabSwitch |
| DR-BROWSER_CORE_METHODS | `browser.tabCreate` | src/main/runtime/rpc/methods/browser-core.ts:113–120 | RRT-BROWSER-tabCreate |
| DR-BROWSER_CORE_METHODS | `browser.openUrl` | src/main/runtime/rpc/methods/browser-core.ts:121–125 | RRT-BROWSER-openUrl |
| DR-BROWSER_CORE_METHODS | `browser.tabSetProfile` | src/main/runtime/rpc/methods/browser-core.ts:126–130 | RRT-BROWSER-tabSetProfile |
| DR-BROWSER_CORE_METHODS | `browser.tabProfileShow` | src/main/runtime/rpc/methods/browser-core.ts:131–135 | RRT-BROWSER-tabProfileShow |
| DR-BROWSER_CORE_METHODS | `browser.tabProfileClone` | src/main/runtime/rpc/methods/browser-core.ts:136–140 | RRT-BROWSER-tabProfileClone |
| DR-BROWSER_CORE_METHODS | `browser.tabClose` | src/main/runtime/rpc/methods/browser-core.ts:141–145 | RRT-BROWSER-tabClose |
| DR-BROWSER_CORE_METHODS | `browser.profileList` | src/main/runtime/rpc/methods/browser-core.ts:146–150 | RRT-BROWSER-profileList |
| DR-BROWSER_CORE_METHODS | `browser.profileCreate` | src/main/runtime/rpc/methods/browser-core.ts:151–155 | RRT-BROWSER-profileCreate |
| DR-BROWSER_CORE_METHODS | `browser.profileDelete` | src/main/runtime/rpc/methods/browser-core.ts:156–160 | RRT-BROWSER-profileDelete |
| DR-BROWSER_CORE_METHODS | `browser.profileDetectBrowsers` | src/main/runtime/rpc/methods/browser-core.ts:161–165 | RRT-BROWSER-profileDetectBrowsers |
| DR-BROWSER_CORE_METHODS | `browser.profileImportFromBrowser` | src/main/runtime/rpc/methods/browser-core.ts:166–170 | RRT-BROWSER-profileImportFromBrowser, RRT-J05 |
| DR-BROWSER_CORE_METHODS | `browser.profileClearDefaultCookies` | src/main/runtime/rpc/methods/browser-core.ts:171–175 | RRT-BROWSER-profileClearDefaultCookies |
| DR-BROWSER_CORE_METHODS | `browser.hover` | src/main/runtime/rpc/methods/browser-core.ts:176–180 | RRT-BROWSER-RAW |
| DR-BROWSER_CORE_METHODS | `browser.drag` | src/main/runtime/rpc/methods/browser-core.ts:181–185 | RRT-BROWSER-RAW |
| DR-BROWSER_CORE_METHODS | `browser.upload` | src/main/runtime/rpc/methods/browser-core.ts:186–190 | RRT-BROWSER-RAW |
| DR-BROWSER_CORE_METHODS | `browser.wait` | src/main/runtime/rpc/methods/browser-core.ts:191–195 | RRT-BROWSER-RAW |
| DR-BROWSER_CORE_METHODS | `browser.check` | src/main/runtime/rpc/methods/browser-core.ts:196–200 | RRT-BROWSER-RAW |
| DR-BROWSER_CORE_METHODS | `browser.focus` | src/main/runtime/rpc/methods/browser-core.ts:201–205 | RRT-BROWSER-RAW |
| DR-BROWSER_CORE_METHODS | `browser.clear` | src/main/runtime/rpc/methods/browser-core.ts:206–210 | RRT-BROWSER-clear |
| DR-BROWSER_CORE_METHODS | `browser.selectAll` | src/main/runtime/rpc/methods/browser-core.ts:211–215 | RRT-BROWSER-RAW |
| DR-BROWSER_CORE_METHODS | `browser.keypress` | src/main/runtime/rpc/methods/browser-core.ts:216–220 | RRT-BROWSER-RAW |
| DR-BROWSER_CORE_METHODS | `browser.pdf` | src/main/runtime/rpc/methods/browser-core.ts:221–225 | RRT-BROWSER-pdf |
| DR-BROWSER_CORE_METHODS | `browser.fullScreenshot` | src/main/runtime/rpc/methods/browser-core.ts:226–230 | RRT-BROWSER-fullScreenshot |
| DR-BROWSER_CORE_METHODS | `browser.dblclick` | src/main/runtime/rpc/methods/browser-core.ts:231–235 | RRT-BROWSER-RAW |
| DR-BROWSER_CORE_METHODS | `browser.forward` | src/main/runtime/rpc/methods/browser-core.ts:236–240 | RRT-BROWSER-RAW |
| DR-BROWSER_CORE_METHODS | `browser.scrollIntoView` | src/main/runtime/rpc/methods/browser-core.ts:241–245 | RRT-BROWSER-RAW |
| DR-BROWSER_CORE_METHODS | `browser.get` | src/main/runtime/rpc/methods/browser-core.ts:246–250 | RRT-BROWSER-RAW |
| DR-BROWSER_CORE_METHODS | `browser.is` | src/main/runtime/rpc/methods/browser-core.ts:251–255 | RRT-BROWSER-RAW |
| DR-BROWSER_CORE_METHODS | `browser.find` | src/main/runtime/rpc/methods/browser-core.ts:256–260 | RRT-BROWSER-RAW |
| DR-BROWSER_CORE_METHODS | `browser.console` | src/main/runtime/rpc/methods/browser-core.ts:261–265 | RRT-BROWSER-RAW |
| DR-BROWSER_CORE_METHODS | `browser.network` | src/main/runtime/rpc/methods/browser-core.ts:266–270 | RRT-BROWSER-RAW |
| DR-BROWSER_CORE_METHODS | `browser.exec` | src/main/runtime/rpc/methods/browser-core.ts:271–275 | RRT-BROWSER-RAW |
| DR-BROWSER_CORE_METHODS | `browser.capture.start` | src/main/runtime/rpc/methods/browser-core.ts:276–280 | RRT-BROWSER-RAW |
| DR-BROWSER_CORE_METHODS | `browser.capture.stop` | src/main/runtime/rpc/methods/browser-core.ts:281–285 | RRT-BROWSER-RAW |
| DR-BROWSER_CORE_METHODS | `browser.download` | src/main/runtime/rpc/methods/browser-core.ts:286–290 | RRT-BROWSER-RAW |
| DR-BROWSER_CORE_METHODS | `browser.highlight` | src/main/runtime/rpc/methods/browser-core.ts:291–295 | RRT-BROWSER-RAW |
| DR-BROWSER_SCREENCAST_METHODS | `browser.screencast` | src/main/runtime/rpc/methods/browser-screencast.ts:13–30 | RRT-BROWSER-screencast |
| DR-BROWSER_SCREENCAST_METHODS | `browser.screencast.unsubscribe` | src/main/runtime/rpc/methods/browser-screencast.ts:31–44 | RRT-BROWSER-screencast.unsubscribe |
| DR-BROWSER_EXTRA_METHODS | `browser.cookie.get` | src/main/runtime/rpc/methods/browser-extras.ts:38–42 | RRT-BROWSER-RAW |
| DR-BROWSER_EXTRA_METHODS | `browser.cookie.set` | src/main/runtime/rpc/methods/browser-extras.ts:43–47 | RRT-BROWSER-RAW |
| DR-BROWSER_EXTRA_METHODS | `browser.cookie.delete` | src/main/runtime/rpc/methods/browser-extras.ts:48–52 | RRT-BROWSER-RAW |
| DR-BROWSER_EXTRA_METHODS | `browser.viewport` | src/main/runtime/rpc/methods/browser-extras.ts:53–57 | RRT-BROWSER-viewport |
| DR-BROWSER_EXTRA_METHODS | `browser.geolocation` | src/main/runtime/rpc/methods/browser-extras.ts:58–62 | RRT-BROWSER-RAW |
| DR-BROWSER_EXTRA_METHODS | `browser.intercept.enable` | src/main/runtime/rpc/methods/browser-extras.ts:63–67 | RRT-BROWSER-RAW |
| DR-BROWSER_EXTRA_METHODS | `browser.intercept.disable` | src/main/runtime/rpc/methods/browser-extras.ts:68–72 | RRT-BROWSER-RAW |
| DR-BROWSER_EXTRA_METHODS | `browser.intercept.list` | src/main/runtime/rpc/methods/browser-extras.ts:73–77 | RRT-BROWSER-RAW |
| DR-BROWSER_EXTRA_METHODS | `browser.mouseMove` | src/main/runtime/rpc/methods/browser-extras.ts:78–82 | RRT-BROWSER-RAW |
| DR-BROWSER_EXTRA_METHODS | `browser.mouseDown` | src/main/runtime/rpc/methods/browser-extras.ts:83–87 | RRT-BROWSER-RAW |
| DR-BROWSER_EXTRA_METHODS | `browser.mouseClick` | src/main/runtime/rpc/methods/browser-extras.ts:88–92 | RRT-BROWSER-mouseClick |
| DR-BROWSER_EXTRA_METHODS | `browser.mouseUp` | src/main/runtime/rpc/methods/browser-extras.ts:93–97 | RRT-BROWSER-RAW |
| DR-BROWSER_EXTRA_METHODS | `browser.mouseWheel` | src/main/runtime/rpc/methods/browser-extras.ts:98–102 | RRT-BROWSER-RAW |
| DR-BROWSER_EXTRA_METHODS | `browser.setDevice` | src/main/runtime/rpc/methods/browser-extras.ts:103–107 | RRT-BROWSER-RAW |
| DR-BROWSER_EXTRA_METHODS | `browser.setOffline` | src/main/runtime/rpc/methods/browser-extras.ts:108–112 | RRT-BROWSER-RAW |
| DR-BROWSER_EXTRA_METHODS | `browser.setHeaders` | src/main/runtime/rpc/methods/browser-extras.ts:113–117 | RRT-BROWSER-RAW |
| DR-BROWSER_EXTRA_METHODS | `browser.setCredentials` | src/main/runtime/rpc/methods/browser-extras.ts:118–122 | RRT-BROWSER-RAW |
| DR-BROWSER_EXTRA_METHODS | `browser.setMedia` | src/main/runtime/rpc/methods/browser-extras.ts:123–127 | RRT-BROWSER-RAW |
| DR-BROWSER_EXTRA_METHODS | `browser.clipboardRead` | src/main/runtime/rpc/methods/browser-extras.ts:128–132 | RRT-BROWSER-RAW |
| DR-BROWSER_EXTRA_METHODS | `browser.clipboardWrite` | src/main/runtime/rpc/methods/browser-extras.ts:133–140 | RRT-BROWSER-RAW |
| DR-BROWSER_EXTRA_METHODS | `browser.dialogAccept` | src/main/runtime/rpc/methods/browser-extras.ts:141–145 | RRT-BROWSER-RAW |
| DR-BROWSER_EXTRA_METHODS | `browser.dialogDismiss` | src/main/runtime/rpc/methods/browser-extras.ts:146–150 | RRT-BROWSER-RAW |
| DR-BROWSER_EXTRA_METHODS | `browser.storage.local.get` | src/main/runtime/rpc/methods/browser-extras.ts:151–155 | RRT-BROWSER-RAW |
| DR-BROWSER_EXTRA_METHODS | `browser.storage.local.set` | src/main/runtime/rpc/methods/browser-extras.ts:156–160 | RRT-BROWSER-RAW |
| DR-BROWSER_EXTRA_METHODS | `browser.storage.local.clear` | src/main/runtime/rpc/methods/browser-extras.ts:161–165 | RRT-BROWSER-RAW |
| DR-BROWSER_EXTRA_METHODS | `browser.storage.session.get` | src/main/runtime/rpc/methods/browser-extras.ts:166–170 | RRT-BROWSER-RAW |
| DR-BROWSER_EXTRA_METHODS | `browser.storage.session.set` | src/main/runtime/rpc/methods/browser-extras.ts:171–175 | RRT-BROWSER-RAW |
| DR-BROWSER_EXTRA_METHODS | `browser.storage.session.clear` | src/main/runtime/rpc/methods/browser-extras.ts:176–180 | RRT-BROWSER-RAW |
| DR-BROWSER_CLIENT_HOST_METHODS | `browser.clientHost.attach` | src/main/runtime/rpc/methods/browser-client-host.ts:20–157 | RRT-BROWSER-clientHost.attach |
| DR-BROWSER_CLIENT_HOST_METHODS | `browser.clientHost.commandResult` | src/main/runtime/rpc/methods/browser-client-host.ts:158–189 | RRT-BROWSER-clientHost.commandResult |
| DR-BROWSER_CLIENT_HOST_METHODS | `browser.clientHost.pageMetadata` | src/main/runtime/rpc/methods/browser-client-host.ts:190–229 | RRT-BROWSER-clientHost.pageMetadata |
| DR-BROWSER_CLIENT_FILE_CHANNEL_METHODS | `browser.clientHost.fileChannel.read` | src/main/runtime/rpc/methods/browser-client-file-channel.ts:68–87 | RRT-BROWSER-clientHost.fileChannel.read |
| DR-BROWSER_CLIENT_FILE_CHANNEL_METHODS | `browser.clientHost.fileChannel.write` | src/main/runtime/rpc/methods/browser-client-file-channel.ts:88–108 | RRT-BROWSER-clientHost.fileChannel.write |
| DR-BROWSER_CLIENT_FILE_CHANNEL_METHODS | `browser.clientHost.fileChannel.abort` | src/main/runtime/rpc/methods/browser-client-file-channel.ts:109–120 | RRT-BROWSER-clientHost.fileChannel.abort |
| DR-BROWSER_NETWORK_TUNNEL_METHODS | `network.browserTunnel` | src/main/runtime/rpc/methods/browser-network-tunnel.ts:24–222 | RRT-BROWSER-browserTunnel |
| DR-ORCHESTRATION_METHODS | `orchestration.runCreate` | src/main/runtime/rpc/methods/orchestration-runs.ts:30–52 | RRT-17 |
| DR-ORCHESTRATION_METHODS | `orchestration.runUse` | src/main/runtime/rpc/methods/orchestration-runs.ts:53–105 | RRT-17 |
| DR-ORCHESTRATION_METHODS | `orchestration.runCurrent` | src/main/runtime/rpc/methods/orchestration-runs.ts:106–117 | RRT-17 |
| DR-ORCHESTRATION_METHODS | `orchestration.runList` | src/main/runtime/rpc/methods/orchestration-runs.ts:118–122 | RRT-17 |
| DR-ORCHESTRATION_METHODS | `orchestration.runShow` | src/main/runtime/rpc/methods/orchestration-runs.ts:123–133 | RRT-17 |
| DR-ORCHESTRATION_METHODS | `orchestration.workerStart` | src/main/runtime/rpc/methods/orchestration-workers.ts:31–300 | RRT-19 |
| DR-ORCHESTRATION_METHODS | `orchestration.workerShow` | src/main/runtime/rpc/methods/orchestration-worker-control.ts:30–153 | RRT-20 |
| DR-ORCHESTRATION_METHODS | `orchestration.workerRead` | src/main/runtime/rpc/methods/orchestration-worker-control.ts:154–260 | RRT-20 |
| DR-ORCHESTRATION_METHODS | `orchestration.workerAbandon` | src/main/runtime/rpc/methods/orchestration-worker-control.ts:261–297 | RRT-20 |
| DR-ORCHESTRATION_METHODS | `orchestration.workerStop` | src/main/runtime/rpc/methods/orchestration-worker-stop.ts:16–181 | RRT-20 |
| DR-ORCHESTRATION_METHODS | `orchestration.workerRelease` | src/main/runtime/rpc/methods/orchestration-worker-release.ts:29–95 | RRT-20 |
| DR-ORCHESTRATION_METHODS | `orchestration.workerRetain` | src/main/runtime/rpc/methods/orchestration-worker-release.ts:96–141 | RRT-20 |
| DR-ORCHESTRATION_METHODS | `orchestration.workerList` | src/main/runtime/rpc/methods/orchestration-worker-release.ts:142–168 | RRT-20 |
| DR-ORCHESTRATION_METHODS | `orchestration.workerTerminalUserInput` | src/main/runtime/rpc/methods/orchestration-worker-release.ts:169–177 | RRT-20 |
| DR-ORCHESTRATION_METHODS | `orchestration.federationAttachStart` | src/main/runtime/rpc/methods/orchestration-federation.ts:27–289 | RRT-19 |
| DR-ORCHESTRATION_METHODS | `orchestration.federationPull` | src/main/runtime/rpc/methods/orchestration-federation-relay.ts:59–79 | RRT-21 |
| DR-ORCHESTRATION_METHODS | `orchestration.federationAck` | src/main/runtime/rpc/methods/orchestration-federation-relay.ts:80–143 | RRT-21 |
| DR-ORCHESTRATION_METHODS | `orchestration.federationImport` | src/main/runtime/rpc/methods/orchestration-federation-relay.ts:144–216 | RRT-21 |
| DR-ORCHESTRATION_METHODS | `orchestration.federationShow` | src/main/runtime/rpc/methods/orchestration-federation-control.ts:26–49 | RRT-20 |
| DR-ORCHESTRATION_METHODS | `orchestration.federationRead` | src/main/runtime/rpc/methods/orchestration-federation-control.ts:50–74 | RRT-20 |
| DR-ORCHESTRATION_METHODS | `orchestration.federationReadOutput` | src/main/runtime/rpc/methods/orchestration-federation-control.ts:75–126 | RRT-20 |
| DR-ORCHESTRATION_METHODS | `orchestration.federationStop` | src/main/runtime/rpc/methods/orchestration-federation-control.ts:127–194 | RRT-20 |
| DR-ORCHESTRATION_METHODS | `orchestration.requestShow` | src/main/runtime/rpc/methods/orchestration-mutation-request-show.ts:12–52 | RRT-21 |
| DR-ORCHESTRATION_METHODS | `orchestration.send` | src/main/runtime/rpc/methods/orchestration-send-methods.ts:22–187 | RRT-18 |
| DR-ORCHESTRATION_METHODS | `orchestration.check` | src/main/runtime/rpc/methods/orchestration-check-methods.ts:10–78 | RRT-18 |
| DR-ORCHESTRATION_METHODS | `orchestration.reply` | src/main/runtime/rpc/methods/orchestration-message-methods.ts:17–104 | RRT-18 |
| DR-ORCHESTRATION_METHODS | `orchestration.inbox` | src/main/runtime/rpc/methods/orchestration-message-methods.ts:106–117 | RRT-18 |
| DR-ORCHESTRATION_METHODS | `orchestration.taskCreate` | src/main/runtime/rpc/methods/orchestration-message-methods.ts:119–153 | RRT-17 |
| DR-ORCHESTRATION_METHODS | `orchestration.taskList` | src/main/runtime/rpc/methods/orchestration-message-methods.ts:155–191 | RRT-17 |
| DR-ORCHESTRATION_METHODS | `orchestration.taskUpdate` | src/main/runtime/rpc/methods/orchestration-message-methods.ts:193–218 | RRT-17 |
| DR-ORCHESTRATION_METHODS | `orchestration.dispatch` | src/main/runtime/rpc/methods/orchestration-dispatch-methods.ts:10–142 | RRT-19 |
| DR-ORCHESTRATION_METHODS | `orchestration.dispatchShow` | src/main/runtime/rpc/methods/orchestration-dispatch-methods.ts:144–177 | RRT-19 |
| DR-ORCHESTRATION_METHODS | `orchestration.ask` | src/main/runtime/rpc/methods/orchestration-ask-methods.ts:10–167 | RRT-18 |
| DR-ORCHESTRATION_METHODS | `orchestration.run` | src/main/runtime/rpc/methods/orchestration-gates.ts:51–90 | RRT-27 |
| DR-ORCHESTRATION_METHODS | `orchestration.runStop` | src/main/runtime/rpc/methods/orchestration-gates.ts:92–109 | RRT-27 |
| DR-ORCHESTRATION_METHODS | `orchestration.gateCreate` | src/main/runtime/rpc/methods/orchestration-gates.ts:111–152 | RRT-17 |
| DR-ORCHESTRATION_METHODS | `orchestration.gateResolve` | src/main/runtime/rpc/methods/orchestration-gates.ts:154–180 | RRT-17 |
| DR-ORCHESTRATION_METHODS | `orchestration.gateList` | src/main/runtime/rpc/methods/orchestration-gates.ts:182–207 | RRT-17 |
| DR-ORCHESTRATION_METHODS | `orchestration.reset` | src/main/runtime/rpc/methods/orchestration-reset-methods.ts:5–26 | RRT-17 |
| DR-SESSION_TAB_METHODS | `session.tabs.list` | src/main/runtime/rpc/methods/session-tabs.ts:22–34 | RRT-13 |
| DR-SESSION_TAB_METHODS | `session.tabs.listAll` | src/main/runtime/rpc/methods/session-tabs.ts:35–42 | RRT-13 |
| DR-SESSION_TAB_METHODS | `session.tabs.activate` | src/main/runtime/rpc/methods/session-tab-mutation-methods.ts:13–48 | RRT-14 |
| DR-SESSION_TAB_METHODS | `session.tabs.move` | src/main/runtime/rpc/methods/session-tab-mutation-methods.ts:49–85 | RRT-14 |
| DR-SESSION_TAB_METHODS | `session.tabs.updatePaneLayout` | src/main/runtime/rpc/methods/session-tab-mutation-methods.ts:86–105 | RRT-14 |
| DR-SESSION_TAB_METHODS | `session.tabs.setTabProps` | src/main/runtime/rpc/methods/session-tab-mutation-methods.ts:106–125 | RRT-14 |
| DR-SESSION_TAB_METHODS | `session.tabs.close` | src/main/runtime/rpc/methods/session-tab-close-methods.ts:10–78 | RRT-14 |
| DR-SESSION_TAB_METHODS | `session.tabs.closeLifecycle` | src/main/runtime/rpc/methods/session-tab-close-methods.ts:79–131 | RRT-14 |
| DR-SESSION_TAB_METHODS | `session.tabs.createTerminal` | src/main/runtime/rpc/methods/session-tabs.ts:45–81 | RRT-14, RRT-J01 |
| DR-SESSION_TAB_METHODS | `session.tabs.subscribe` | src/main/runtime/rpc/methods/session-tabs.ts:82–149 | RRT-13 |
| DR-SESSION_TAB_METHODS | `session.tabs.unsubscribe` | src/main/runtime/rpc/methods/session-tabs.ts:150–167 | RRT-13 |
| DR-SESSION_TAB_METHODS | `session.tabs.subscribeAll` | src/main/runtime/rpc/methods/session-tabs.ts:168–175 | RRT-13 |
| DR-SESSION_TAB_METHODS | `session.tabs.unsubscribeAll` | src/main/runtime/rpc/methods/session-tabs.ts:176–193 | RRT-13 |
| DR-SESSION_TAB_METHODS | `markdown.readTab` | src/main/runtime/rpc/methods/session-tab-markdown-methods.ts:5–10 | RRT-15 |
| DR-SESSION_TAB_METHODS | `markdown.saveTab` | src/main/runtime/rpc/methods/session-tab-markdown-methods.ts:11–21 | RRT-15 |
| DR-NATIVE_CHAT_METHODS | `nativeChat.readSession` | src/main/runtime/rpc/methods/native-chat.ts:208–232 | RRT-16, RRT-J06 |
| DR-NATIVE_CHAT_METHODS | `nativeChat.subscribe` | src/main/runtime/rpc/methods/native-chat.ts:233–351 | RRT-16, RRT-J06 |
| DR-NATIVE_CHAT_METHODS | `nativeChat.unsubscribe` | src/main/runtime/rpc/methods/native-chat.ts:352–364 | RRT-16, RRT-J06 |
| DR-CLIENT_EVENT_METHODS | `runtime.clientEvents.subscribe` | src/main/runtime/rpc/methods/client-events.ts:16–58 | RRT-26 |
| DR-CLIENT_EVENT_METHODS | `runtime.clientEvents.unsubscribe` | src/main/runtime/rpc/methods/client-events.ts:59–70 | RRT-26 |
| DR-CLIENT_UI_METHODS | `settings.get` | src/main/runtime/rpc/methods/client-ui.ts:12–16 | RRT-02 |
| DR-CLIENT_UI_METHODS | `settings.update` | src/main/runtime/rpc/methods/client-ui.ts:17–23 | RRT-02 |
| DR-CLIENT_UI_METHODS | `settings.getTerminalQuickCommands` | src/main/runtime/rpc/methods/client-ui.ts:24–32 | RRT-02 |
| DR-CLIENT_UI_METHODS | `settings.updateTerminalQuickCommands` | src/main/runtime/rpc/methods/client-ui.ts:33–39 | RRT-02 |
| DR-CLIENT_UI_METHODS | `settings.updatePRBotAuthorOverride` | src/main/runtime/rpc/methods/client-ui.ts:40–46 | RRT-02 |
| DR-CLIENT_UI_METHODS | `ui.get` | src/main/runtime/rpc/methods/client-ui.ts:47–51 | RRT-03 |
| DR-CLIENT_UI_METHODS | `ui.set` | src/main/runtime/rpc/methods/client-ui.ts:52–62 | RRT-03 |
| DR-CLIENT_UI_METHODS | `ui.recordFeatureInteraction` | src/main/runtime/rpc/methods/client-ui.ts:63–69 | RRT-03 |

## Browser leaf review and run evidence

The frozen leaf covers90 unique assigned browser/network methods. Parent review rejected the first sparse delivery and the second84-unique delivery, then checked the corrected exact90 set, source anchors and assertion bodies. Parent result contracts supersede annotation-as-validation and unread-import claims, including scalar/null/undefined translator output, client-host settlement/reconnect, actual cookie policy/store/rollback and native/renderer boundaries. All51 raw translator methods explicitly reuse RRT-BROWSER-RAW;39 other methods retain their own result definitions and exact leaf anchors. Physical browser behavior remains unexecuted.

The local translator JSON-parses stdout and, on truthy parsed.success, returns parsed.data unchanged. It can be any JSON value or undefined when data is absent; Browser*Result annotations do not validate it. Malformed JSON returns browser_error with at most1000 stdout characters. JSON null or malformed nonstring error can throw at property/error classification. No provider outcome is inferred from argv admission.

Commands can act before stdout parse, timeouts, loss of page or rejection. Queued target guards prevent stale page reuse but cannot undo completed page effects.

Approved historical child command: `claude --model claude-sonnet-5 --effort medium --dangerously-skip-permissions`, depth2; no grandchild. Final task `task_c7cbac2a55c8`, Dispatch `ctx_4cb996f27350`, worker_done `msg_57aa93e054df`. Parent reviewed the leaf files and honored the release outcome.

Exact release receipt: requestId `d6c34409-3209-4558-901b-bd4389f65069`; verdict `retained`; reason `external_terminal`; processAction `none`. The external terminal was retained, not killed or archived. All owned tasks settled before this handoff. Lifecycle receipts prove coordination only, not source test or product success.

## Assertion evidence and full test gates

- [SRC-173](contracts.json) — body inspected; not executed. Full-file source allocation retained.
- [SRC-174](contracts.json) — body inspected; not executed. Full-file source allocation retained.
- [SRC-175](contracts.json) — body inspected; not executed. Full-file source allocation retained.
- [SRC-176](contracts.json) — body inspected; not executed. Full-file source allocation retained.
- [SRC-177](contracts.json) — body inspected; not executed. Full-file source allocation retained.
- [SRC-178](contracts.json) — body inspected; not executed. Full-file source allocation retained.
- [SRC-179](contracts.json) — body inspected; not executed. Full-file source allocation retained.
- [SRC-180](contracts.json) — body inspected; not executed. Full-file source allocation retained.
- [SRC-181](contracts.json) — body inspected; not executed. Full-file source allocation retained.
- [SRC-241](contracts.json) — body inspected; not executed. Full-file source allocation retained.
- [SRC-250](contracts.json) — body inspected; not executed. Full-file source allocation retained.
- [SRC-251](contracts.json) — body inspected; not executed. Full-file source allocation retained.
- [SRC-252](contracts.json) — body inspected; not executed. Full-file source allocation retained.
- [SRC-253](contracts.json) — body inspected; not executed. Full-file source allocation retained.
- [SRC-254](contracts.json) — body inspected; not executed. Full-file source allocation retained.
- [SRC-255](contracts.json) — body inspected; not executed. Full-file source allocation retained.
- [SRC-256](contracts.json) — body inspected; not executed. Full-file source allocation retained.
- [SRC-365](contracts.json) — body inspected; not executed. Full-file source allocation retained.
- [SRC-366](contracts.json) — body inspected; not executed. Full-file source allocation retained.

The exit-proof unit file explicitly accepts a successful wait stub without probing and separately tests stale-handle absent/mismatched identity, unknown/live refusal, retry and unrelated errors. It does not compose the runtime's disconnected/missing-PTY wait. Cookie clear atomicity assertions discriminate unchanged jar on incomplete snapshot, successful restoration after remove failure, partial clear when restore fails, partition identities, frozen arrival plans, same-coordinate rollback and session serialization. These are precise existing assertions, not reported PASS or substitutes for complete files.

All13 original work-package arrays remain at their exact JSON pointers, with full manifest SHA256 and canonical ordered allocation hashes. Arrays preserve the complete original source files/hashes/domains; overlaps are intentional and must not be summed as unique coverage. No source-test allocation was reassigned.

All10 BM,14 R and12 F gates,70 inherited execution-queue entries,33 original test-queue entries and all47 inherited remaining-acceptance entries are preserved verbatim in JSON. They are not closed by source characterization. Required sequence remains coordinator-authorized source baseline, full assertion-preserving port, meaningful behavioral RED, implementation GREEN, then integrated rendered/native/host/platform tests. Setup failure is not RED, skipped is not PASS, and mocking missing behavior is not parity.

Required axes retain folder and repository workspaces, SSH ownership, mixed runtime/protocol versions, Windows/WSL/Linux/macOS, cancellation/late replies, absent/null/undefined/coercion, partial effects, restart/durability, and host-authoritative `live` / `unverifiable` / `exited`. Source defects need characterization and separately ratified intended-correction tests. No model provider inference or user runtime was exercised.

## Validation and acceptance

Artifact structural/hash validation is recorded in `execution.artifactValidation` in [contracts.json](contracts.json). Root must independently sample actual source results, ratify correction obligations, and reconcile the three common-service owners before accepting the E3 area. Assigned runtime result-source characterization is proposed complete; `auditAccepted` and `sourceGateClosed` remain false because only root can accept. No test migration or product-fidelity gate moves in this report.
