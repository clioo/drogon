# Relay Registration & Composition Reconciliation v2 (G13-gap-2/3 portion)

Coordinator follow-up: [bounded boundary review](parity-relay-boundary-review.md) corrects obligations1/3 below, traces the delivery-cancellation producer/consumer boundary and archives12 unchanged original filesystem cases. Original leaf read tiers below describe its dispatch, not the later review. Full composition/runtime acceptance remains open.

Corrected leaf report for task `task_5f6097897f74`, dispatch `ctx_32b26a8bba25`. Status: **leaf-reported-pending-coordinator-review**; runtime acceptance **unproven**; no universal surface count and no audit closure.
Source: frozen `/Users/carlos/Documents/Drogon-mentu-session` @ `c97906287bb7a390b25e2025b600d9fb3c25d9c3`, read-only; source review only (no scanner rerun, no tests/scripts executed). Machine form: `parity-relay-registration-composition.json` (schema v2, contains the exact 147-entry source call-site map; all summaries below are computed from that mapping).

Mentu Navigator: **read** `~/.codex/skills/mentu-navigator/SKILL.md`; `mentu-nav status` succeeds, version 1.1.1, read-only target mode. The previous leaf's "navigator capability gap" claim is **withdrawn** — the missing `~/.agents` entry proved nothing.

## 1. Corrections applied to the previous leaf version

1. **No "148th site"**: `registeredMethod` (plugin-host-call-handler.ts:34) is *inside* the census's 22 Identifiers. The census stays exactly **147 = 116 StringLiteral + 22 Identifier + 9 MemberExpression** (coordinator-verified). Fixed-constant Identifier sites: **21**; wrapper-parameter site: **1**.
2. **WSL guest = 13 runtime lane registrations, not 11**: `new PreflightHandler(dispatcher)` at `wsl-agent-hook-relay.ts:73` instantiates the **same two source sites** (`preflight-handler.ts:48-49`) the daemon instantiates at `relay-runtime-services.ts:71`. Guest lanes = 2 preflight (shared source) + 2 agent_hook + 9 wslfs. The earlier 137+11 partition ignored shared sites.
3. **Method names never summed across lanes**: `relay.configureGraceTime` and `session.registerRoot` are dual-lane single names. The two different "135" figures are now explicitly distinguished (§3).
4. **Evidence tiers downgraded** where only intervals were read (§6).
5. Navigator gap note replaced by the verified skill status above.

## 2. The 147 source call sites (map in JSON)

| Class | Sites | Resolution |
|---|---|---|
| StringLiteral | 116 | name is the literal |
| Identifier — fixed constant | 21 | `relay.configureGraceTime` (ssh-types.ts:10), `agent_hook.requestReplay`/`installPlugins`/`installManagedHooks` (agent-hook-relay.ts:202/207/211), `aiVault.listSessions`/`resolveSessionTitles` (ssh-ai-vault-relay.ts:1-2), `pty.openClient` (local const, ssh-pty-consumer-session-adapter.ts:24), 11 `skills.*` (skill-ssh-relay-contract.ts:12-22) |
| Identifier — wrapper parameter | 1 | `registeredMethod`, closure param invoked exactly twice: `plugins.hostCall.panel` (L67, def L13, panel admission-gated) + `plugins.hostCall.worker` (L68, def L14) — fixed2 confirmed |
| MemberExpression | 9 | `WSL_HOOK_FS_METHODS.*` → `wslfs.home/readFile/writeFile/stat/rename/unlink/chmod/readdir/mkdir` (wsl-hook-relay-contract.ts:35-45) |

Lanes: **136 request sites + 11 notification sites**. Receiver variants: `dispatcher.` 72, `this.dispatcher.` 72, `primaryChannel.dispatcher.` 1 (relay-daemon.ts:139 `relay.status`), `options.dispatcher.` 2 (relay-grace-lifecycle.ts:33/36).

Site classes: **134 daemon-resident**, **11 guest-resident** (`wsl-agent-hook-relay.ts`, `wsl-hook-fs-bridge.ts`), **2 shared-source** (preflight-handler.ts:48-49, instantiated in both processes).

## 3. Computed summaries (from the JSON map)

- Unique source call sites: **147** (116+22+9).
- Source-level registrations (contexts collapsed): **148** — the wrapper site expands 1→2. This is a source-level figure, not a per-process claim.
- **Runtime lane registrations**: SSH daemon dispatcher **137** (134 resident sites → 135 lanes incl. wrapper expansion, + 2 shared preflight lanes); WSL guest dispatcher **13** (11 resident + 2 shared); total **150**.
- **Distinct method names** (lane-overlap removed):
  - SSH daemon: **135** = 126 request names + 11 notification names − 2 dual-lane names (`relay.configureGraceTime`, `session.registerRoot`).
  - WSL guest: **13** = `preflight.detectAgents`, `preflight.detectWindowsTerminalCapabilities`, `agent_hook.requestReplay`, `agent_hook.installPlugins`, 9 × `wslfs.*`.
  - Cross-context union: **144** (4 names shared between processes).
- **Two different 135s — do not conflate**: (a) daemon distinct method names = 135; (b) cross-context **request-name vocabulary** = 126 daemon requests + 9 guest-only `wslfs.*` = **135**, which is the accepted census's `requestMethodCount`. Neither is a universal per-process registration count.
- `rpc.cancel` is handled **inline** in `dispatcher-rpc-routing.ts:170-176` (aborts the request's AbortController before the notification map); it is a recognized wire name in both processes but appears in **no** registration count.

## 4. Deployed composition (vs test support)

- **Entrypoint** `src/relay/relay.ts` (sha `18e0d1…d18e`): daemon (default) / `--connect` / `--orca-cli` — the latter two are socket clients registering nothing.
- **Daemon** `relay-daemon.ts` (sha `62ca17…c4aa`): RelayPrimaryChannel (dispatcher on stdio) → RelayRuntimeServices → RelayAgentHookRuntime → RelayGraceLifecycle → RelayReconnectListener → `relay.status` (L139-164, advertises `SKILL_RELAY_CAPABILITIES`).
- **RelayRuntimeServices** (`relay-runtime-services.ts` sha `d14045…5fea`): dual-lane `session.registerRoot` (L121/L127); one **shared `GitResponseStreamRegistry`** for FsHandler (L64) + GitHandler (L70); unconditional handlers L71-76; **conditional** `aiVault.*` — skipped on unsupported platform or missing service (`ai-vault-handler.ts:36-51`, soft-disable); plugin methods installed with identity `() => null` → `{ok:false, code:'unavailable'}` (`plugin-host-call-handler.ts:41-47`); `orca.cli`/`orca.cli.postOutput` proxies via `requestAnyClient(excludeClientId=caller, timeoutMs=remoteCliRequestTimeoutMs(params))` (L139-152).
- **WSL guest** `wsl-agent-hook-relay.ts` (sha `d8a384…e98b`): own dispatcher on stdin/stdout, dies with stdin, no grace/socket; 13 runtime lanes as above; launched by `src/main/agent-hooks/wsl-hook-relay-manager.ts` (callsite-only tier).
- **Test support separated**: `agent-exec-handler-test-harness.ts` (sha `a27a9c…4c55`) is vitest-only; deployed AgentExecHandler is RelayRuntimeServices L75; 8+ test files build `new RelayDispatcher` directly. No dispatcher construction found outside `src/relay` non-test; desktop main is a relay **client** (G13-gap-3, WP-ENG-REMOTE).

## 5. Outbound 13 preserved + one delta

The 13 outbound names and parameterized publication paths are reused verbatim from accepted v3 (`pty.data/exit/replay/restoreRequired/recoveryComplete`, `fs.changed/watchFailed/streamChunk`, `git.cloneProgress/responseChunk`, `agent.hook`, `workspace.changed/stale`; `fs.changed` origin relay-watcher-event-emitter.ts:101/168; `workspace.stale` parameterized resync publisher workspace-snapshot-publication.ts:18-21). **No equivalence to the 615 runtime RPC registry names.**
Delta observed (prior pass, unchanged): `pty.deliveryCanceled` via `dispatcher.notifyControl` at `ssh-pty-consumer-session-adapter.ts:38-43` — 0 mentions in accepted v3; scoped delta for coordinator review.

## 6. Evidence tiers (downgraded where interval-only)

- **Full-body reads**: relay.ts, relay-daemon.ts, relay-runtime-services.ts, plugin-host-call-handler.ts, relay-grace-lifecycle.ts, dispatcher-rpc-routing.ts, dispatcher-contract.ts, wsl-agent-hook-relay.ts.
- **Interval reads (downgraded)**: ai-vault-handler L1-80; ssh-pty-consumer-session-adapter L1-115; relay-agent-hook-runtime L115-169; preflight-handler L40-55; fs-handler registration block + helper window; pty-handler L1066-1112 window; git-handler-registration L1-12 + census lines; skill-install-handler L65-75 + census lines; managed-hook-installer L40-70; wsl-hook-fs-bridge signature/const window; constant-definition windows (ssh-types.ts:10, skill-ssh-relay-contract.ts:12-22, ssh-ai-vault-relay.ts:1-2, agent-hook-relay.ts:202/207/211, wsl-hook-relay-contract.ts:35-45); wsl-hook-relay-manager grep tier; remaining small handlers at census-line tier.
- **Tests**: none read, none executed (source-only dispatch); obligations remain with WP-ENG-RELAY / WP-ENG-REMOTE per accepted G13-gap-1..3.

## 7. Authority boundaries

Handler errors → handler code else `-32000`; `error.data` published only through the schema allowlist (`SkillInstallFailureSchema`, `TerminalUnavailableCauseSchema`) else dropped (routing L139-151). Oversized response → `ResponseOverCapacity` substitute on the control lane, connection preserved (L204-239); relay→client default timeout 30s (`dispatcher-contract.ts:93`). `RequestContext.sessionIdentity {principal, authenticated, allowSessionOwner, authenticationKind}` (dispatcher-contract.ts:18-23) — per-method consumption not traced (U1). Plugins: transport authority fixed by the registered method name; params cannot promote panel→worker (plugin-host-call-handler.ts:65-68).

## 8. Remaining semantic test obligations (labeled, not executed)

1. Dual-lane methods: `session.registerRoot` request returns `{ok:true}`; `relay.configureGraceTime` request returns `{graceTimeMs:number}`. Both also accept notifications; name asserted once per surface. Corrected by coordinator source review; runtime tests remain required.
2. `rpc.cancel` inline abort cancels an in-flight request without touching the notification map.
3. `aiVault.*` absent on unsupported platform or missing service. The prior assertion about failed service construction surviving startup is withdrawn: runtime composition calls the factory without a catch. Later child-process startup failures require separate characterization.
4. Plugin resolver answers `unavailable` for both plugin methods under the daemon null identity resolver; panel admission gate separate.
5. WSL guest dispatcher: exactly 13 runtime lanes (2 shared preflight + 2 agent_hook + 9 wslfs); no fs/git/pty methods.
6. `orca.cli` proxy excludes the calling client and applies `remoteCliRequestTimeoutMs`.
7. `pty.deliveryCanceled` delta: characterize the control-lane proof payload before adding it to any register.

## 9. Scoped unknowns (owners)

- **U1** per-method `sessionIdentity` consumption — WP-ENG-RELAY (dispatcher-contract.ts:18-23, relay-handshake.ts, relay-reconnect-listener.ts).
- **U2** wsl-hook-relay-manager spawn/respawn lifecycle (grep tier) — WP-ENG-RELAY.
- **U3** `pty.deliveryCanceled` client-side handling — WP-ENG-REMOTE (ssh-pty-source-credit-adapter.ts + client credit code).
- **U4** git/fs/pty handler parameter/auth/error bodies at registration-line tier — WP-ENG-RELAY (git-handler-operation-set.ts, fs-handler-*, pty-handler.ts).
