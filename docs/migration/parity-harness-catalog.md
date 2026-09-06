# Parity harness catalog — TuiAgent/ALL_TUI_AGENTS reconciliation (bounded static audit)

Read-only static audit against the frozen legacy checkout `/Users/carlos/Documents/Drogon-mentu-session` at `c97906287bb7a390b25e2025b600d9fb3c25d9c3` (including `out/`/deps — untouched, unread). Static source-text inspection only. No agent binary was invoked, no CLI was spawned, no network call was made, no app/daemon was launched. All 'presence' claims below are grep/Read confirmations of source TEXT (a registry object literal containing a key, a directory existing on disk), never a claim that the underlying integration currently works at runtime. Machine companion: `docs/migration/parity-harness-catalog.json` (schema `drogon.parity-harness-catalog/1`, status `bounded-static-audit`).

## 0. Correction note (supersedes the prior revision's dynamic-model-discovery coverage)

The prior revision of this catalog reported dynamic model discovery as Claude-only, derived from a targeted `rg` that missed the actual registry. This revision reads `src/shared/agent-model-probe-spec.ts`, `src/shared/commit-message-agent-spec.ts` (+ its `-primary`/`-secondary` shards), `src/shared/grok-model-list-probe.ts`, `src/main/text-generation/commit-message-model-discovery.ts`, and `src/main/codex/codex-structured-session-options.ts` directly and reconciles all 36 rows against them. Corrected counts: **6** agents (claude, codex, opencode, pi, cursor, antigravity) have a genuine dynamic model-list PROBE registered for commit-message generation; **3** (amp, kimi, copilot) have a maintained STATIC catalog with no live probe; **1** (grok) is probe-only and explicitly NOT a commit-message-generation agent; **Codex additionally** has a second, independent dynamic mechanism — a paginated app-server `model/list` request feeding its interactive session-option catalog, found in no other agent's directory this pass. The remaining **26** agents are recorded `unresolved-not-registered` in this specific registry — per instruction, this is never treated as proof the agent lacks dynamic model discovery anywhere, only that this one registry (commit-message generation + a short probe-only allowlist) does not name it, and no dedicated per-agent search beyond that was performed for those 26.

## 1. Methodology

Reconciles the 36-entry TuiAgent/ALL_TUI_AGENTS census against src/renderer/src/lib/agent-catalog.tsx and five additional static registries: TUI_AGENT_CONFIG (detection+launch, exhaustive Record<TuiAgent,...> in tui-agent-config.ts, TypeScript-enforced complete), TUI_AGENT_AUTO_PICK_ORDER (selection.ts, independently verified to contain exactly the same 36 ids with zero duplicates), YOLO_TUI_AGENT_ARGS/ENV and UNSUPPORTED_TUI_AGENT_ARGS (permissions.ts/launch-defaults.ts, both explicitly Partial<Record<TuiAgent,...>>, so absence from these two is a real fact about the registry, not a read failure), RESUMABLE_TUI_AGENTS (agent-session-resume.ts, a literal array independently counted at 14), and AgentSessionOptionCatalogMap (agent-session-option-catalog.ts, keyed by AgentType not TuiAgent, populated for exactly 5 agent ids that also happen to be valid TuiAgent ids). Main-process directory presence (src/main/<id>/) was checked by listing src/main/'s top-level directories once and matching against all 36 ids plus normalized (dash-stripped, prefix-only) candidates — an EXACT match, an ALIASED match (different directory name), or NO match is recorded per agent; aliased/absent cases are listed as named, unresolved cross-registry mappings, never assumed equivalent. Dynamic model discovery is reconciled from the actual registry chain (src/shared/agent-model-probe-spec.ts -> commit-message-agent-spec.ts -> commit-message-agent-specs-{primary,secondary}.ts -> grok-model-list-probe.ts, consumed by commit-message-model-discovery.ts, plus codex-structured-session-options.ts's independent app-server path), not from a targeted rg alone — see the correction paragraph below and §0 of the markdown companion for the full reconciliation and corrected counts. All file hashes below are literal sha256 over the exact bytes read this pass against the frozen SHA; a byte read from anywhere else (out/, node_modules, any other checkout) would fail this document's own claims and none was used. CORRECTION (this pass): see the markdown companion's §0 Correction note for the full reconciliation and corrected per-bucket counts (dynamic-probe / static-catalog / probe-only / unresolved), derived directly from the registry chain above rather than a targeted grep.

## 2. Counts (all computed from the 36 rows in the JSON companion — recomputed independently, not hand-tallied)

- `canonicalAgentCount`: **36**
- `rowsProduced`: **36**
- `labelMismatchesDisplayNamesVsCatalog`: **0**
- `agentsWithDetectCmdAliases`: **2**
- `agentsWithLaunchCmdDifferentFromDetectCmd`: **4**
- `agentsWithPlatformSpecificLaunchCmd`: **1**
- `agentsWithDetectUnsupportedRuntimes`: **1**
- `agentsWithWindowsQuirkEncoding`: **6**
- `agentsWithPreflightTrust`: **3**
- `agentsWithYoloArgMechanism`: **26**
- `agentsWithYoloEnvMechanism`: **1**
- `agentsWithNoKnownPermissionBypass`: **9**
- `agentsResumable`: **14**
- `agentsNotResumable`: **22**
- `agentsWithSessionOptionCatalog`: **5**
- `agentsWithExactMainProcessDir`: **16**
- `agentsWithAliasedMainProcessDir`: **1**
- `agentsWithNoMainProcessDir`: **19**
- `agentsWithAccountSwitcherUi`: **3**
- `unresolvedCrossRegistryMappings`: **7**
- `filesRead`: **22**
- `agentsWithDynamicCommitMessageModelProbe`: **6**
- `agentsWithStaticCommitMessageModelCatalog`: **3**
- `agentsProbeOnlyNotCommitMessageAgent`: **1**
- `agentsUnresolvedModelProbeRegistry`: **26**
- `agentsWithCodexAppServerModelList`: **1**
- `agentsWithAnyConfirmedDynamicModelProbe`: **7**

No percentage/completeness figure is stated. `canonicalAgentCount` (36) matches the prior census (`ALL_TUI_AGENTS`) exactly, independently re-derived this pass from `TUI_AGENT_DISPLAY_NAMES` (`src/shared/tui-agent-display-names.ts`), the `TuiAgent` type union (`src/shared/tui-agent.ts`), the renderer's `getAgentCatalog()` (`src/renderer/src/lib/agent-catalog.tsx`), the exhaustive `TUI_AGENT_CONFIG`/`TUI_AGENT_CONFIG_SOURCE` (`src/shared/tui-agent-config.ts`), and `TUI_AGENT_AUTO_PICK_ORDER` (`src/shared/tui-agent-selection.ts`) — all five independently confirmed to contain exactly the same 36 ids with zero duplicates and zero omissions (assertions embedded in the generating script, not a manual claim).

## 3. Per-agent catalog (all 36, source-anchored)

One row per agent. `Main dir` is `exact` (a `src/main/<id>/` directory exists under the literal TuiAgent id), `alias` (a differently-named directory backs this agent — see §4 unresolved mappings), or `none` (no dedicated main-process directory was found for this agent under any candidate name checked). `Permission bypass` is `arg` (a YOLO/auto-approve CLI flag is registered), `env` (an environment-variable equivalent), or `none-known` (no bypass mechanism found this pass — not proof the agent lacks one, only that this registry doesn't name one). `Resume` / `Session opts` are exact membership in `RESUMABLE_TUI_AGENTS` / `AgentSessionOptionCatalogMap`. `Model probe` is `dynamic` (a live model-list subprocess/request is spawned), `static` (a maintained catalog exists, no live probe), `probe-only` (Grok: supports discovery but is not a commit-message-generation agent), or `unresolved` (not registered in this specific registry — never read as 'no dynamic discovery exists anywhere').

| # | id | Display name | detectCmd | launchCmd (if different) | Prompt mode | Main dir | Permission bypass | Resume | Session opts | Model probe | Account UI |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `claude` | Claude | `claude` | — | argv | exact | arg | ✅ | ✅ | dynamic | ✅ |
| 2 | `claude-agent-teams` | Claude Agent Teams | `orca` | `orca claude-teams` | stdin-after-start | none | arg | — | — | unresolved | — |
| 3 | `openclaude` | OpenClaude | `openclaude` | — | argv | exact | arg | — | — | unresolved | — |
| 4 | `codex` | Codex | `codex` | — | argv | exact | arg | ✅ | ✅ | dynamic +app-server | ✅ |
| 5 | `devin` | Devin | `devin` | — | stdin-after-start | exact | arg | ✅ | — | unresolved | — |
| 6 | `ante` | Ante | `ante` | — | stdin-after-start | none | arg | — | — | unresolved | — |
| 7 | `trae` | Trae | `traecli` | — | argv | none | arg | — | — | unresolved | — |
| 8 | `autohand` | Autohand Code | `autohand` | — | stdin-after-start | none | arg | — | — | unresolved | — |
| 9 | `opencode` | OpenCode | `opencode` | — | flag-prompt | exact | none-known | ✅ | — | dynamic | — |
| 10 | `mimo-code` | MiMo Code | `mimo` | — | flag-prompt | alias (mimo) | none-known | ✅ | — | unresolved | — |
| 11 | `pi` | Pi | `pi` | — | argv | exact | none-known | ✅ | — | dynamic | — |
| 12 | `omp` | OMP | `omp` | — | argv | none | none-known | ✅ | — | unresolved | — |
| 13 | `prime-agent` | Prime Agent | `prime-agent` | — | argv | none | none-known | ✅ | — | unresolved | — |
| 14 | `gemini` | Gemini | `gemini` | — | flag-prompt-interactive | exact | arg | ✅ | ✅ | unresolved | — |
| 15 | `antigravity` | Antigravity | `agy` | — | flag-prompt-interactive | exact | arg | ✅ | — | dynamic | — |
| 16 | `aider` | Aider | `aider` | — | stdin-after-start | none | arg | — | — | unresolved | — |
| 17 | `goose` | Goose | `goose` | — | stdin-after-start | none | env | — | — | unresolved | — |
| 18 | `amp` | Amp | `amp` | — | stdin-after-start | exact | arg | — | — | static | — |
| 19 | `kilo` | Kilocode | `kilo` | — | stdin-after-start | none | none-known | — | — | unresolved | — |
| 20 | `kiro` | Kiro | `kiro-cli` | `kiro-cli chat --tui` | stdin-after-start | none | arg | — | — | unresolved | — |
| 21 | `crush` | Charm | `crush` | — | stdin-after-start | none | arg | — | — | unresolved | — |
| 22 | `aug` | Auggie | `auggie` | — | stdin-after-start | none | none-known | — | — | unresolved | — |
| 23 | `cline` | Cline | `cline` | — | stdin-after-start | none | arg | — | — | unresolved | — |
| 24 | `codebuff` | Codebuff | `codebuff` | — | stdin-after-start | none | none-known | — | — | unresolved | — |
| 25 | `command-code` | Command Code | `command-code` | `command-code --trust` | argv | exact | arg | — | — | unresolved | — |
| 26 | `continue` | Continue | `cn` | — | stdin-after-start | none | arg | — | — | unresolved | — |
| 27 | `cursor` | Cursor | `cursor-agent` | — | argv | exact | arg | — | ✅ | dynamic | — |
| 28 | `droid` | Droid | `droid` | — | argv | exact | arg | ✅ | — | unresolved | — |
| 29 | `kimi` | Kimi | `kimi` | — | stdin-after-start | exact | arg | ✅ | — | static | — |
| 30 | `mistral-vibe` | Mistral Vibe | `vibe` | — | stdin-after-start | none | arg | — | — | unresolved | — |
| 31 | `qwen-code` | Qwen Code | `qwen` | — | stdin-after-start | none | arg | — | — | unresolved | — |
| 32 | `rovo` | Rovo Dev | `rovo` | — | stdin-after-start | none | arg | — | — | unresolved | — |
| 33 | `hermes` | Hermes | `hermes` | `hermes --tui` | hermes-query | exact | arg | — | — | unresolved | — |
| 34 | `openclaw` | OpenClaw | `openclaw` | — | stdin-after-start | none | none-known | — | — | unresolved | — |
| 35 | `copilot` | GitHub Copilot | `copilot` | — | flag-interactive | exact | arg | ✅ | — | static | — |
| 36 | `grok` | Grok | `grok` | — | argv | exact | arg | ✅ | ✅ | probe-only | ✅ |

## 4. Per-agent detail (source anchors)

### `claude` — Claude

- **Source anchors:** `src/shared/tui-agent.ts:4` (type union); `src/shared/tui-agent-display-names.ts:9` (display name); `src/shared/tui-agent-config.ts:70` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:48` (renderer catalog entry).
- **Detection:** `detectCmd = 'claude'`.
- **Launch:** `launchCmd = 'claude'` (same as detectCmd); prompt injection mode `argv`, draft-prompt flag `--prefill`.
- **Permission bypass:** arg.
- **Resumable:** yes — member of RESUMABLE_TUI_AGENTS.
- **Session option catalog (dynamic model/option switching UI):** yes.
- **Commit-message model-probe registry:** `dynamic` — Registered in COMMIT_MESSAGE_AGENT_SPECS (commit-message-agent-spec.ts:90) with modelSource='dynamic'; getAgentModelProbeSpec() returns this spec, so both discoverModelsLocal/Remote spawn a real probe subprocess for this agent.
  - Probe: binary `claude`, args `CLAUDE_MODEL_LIST_ARGS (via claude-model-list-probe.ts) + stdin control-request payload` — `src/shared/commit-message-agent-specs-primary.ts:31-58`
  - Local/remote symmetry: discoverModelsLocal (commit-message-model-discovery.ts:33-113) and discoverModelsRemote (commit-message-model-discovery.ts:181-238) both call the SAME getAgentModelProbeSpec(agentId) and branch identically on modelSource === 'static' vs 'dynamic' — verified structurally, not guessed. The remote (SSH) path additionally distinguishes an unverifiable timeout from an unreachable PATH via isSshRequestOutcomeUnverifiable, consistent with the AGENTS.md live/unverifiable/exited liveness contract applied here to model discovery, not just PTY liveness.
- **Main-process directory:** `src/main/claude/` (exact id match).
- **Branded account-switcher UI:** yes (claude-accounts/codex-accounts/grok-accounts main dirs, per prior UI audit cross-reference).
- **Auto-pick fallback order position:** 1 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

### `claude-agent-teams` — Claude Agent Teams

- **Source anchors:** `src/shared/tui-agent.ts:5` (type union); `src/shared/tui-agent-display-names.ts:10` (display name); `src/shared/tui-agent-config.ts:76` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:54` (renderer catalog entry).
- **Detection:** `detectCmd = 'orca'`, aliases `['orca-dev', 'orca-ide']`, requires also-present commands `['claude']`, unsupported on runtimes `['win32', 'wsl']`.
- **Launch:** `launchCmd = 'orca claude-teams'` (differs from detectCmd), platform override `{'linux': "getOrcaCliCommandNameForPlatform('linux') + ' claude-teams'", 'win32': "getOrcaCliCommandNameForPlatform('win32') + ' claude-teams'"}`; prompt injection mode `stdin-after-start`.
- **Permission bypass:** arg.
- **Resumable:** no — absent from RESUMABLE_TUI_AGENTS (agent-session-resume.ts).
- **Session option catalog (dynamic model/option switching UI):** no — absent from AgentSessionOptionCatalogMap.
- **Commit-message model-probe registry:** `unresolved-not-registered` — getAgentModelProbeSpec(agentId) returns undefined for this agent — it is NOT registered in either COMMIT_MESSAGE_AGENT_SPECS or MODEL_DISCOVERY_ONLY_SPECS. This is recorded as UNRESOLVED, not as 'no dynamic model discovery exists': absence from this one registry (whose purpose is commit-message generation + a short probe-only allowlist) is not proof the agent's own CLI lacks a model-listing capability elsewhere, and no dedicated main-process directory was separately searched for a per-agent model-list mechanism for this agent this pass.
- **Main-process directory:** none found under this id or an obvious normalized variant.
- **Branded account-switcher UI:** no.
- **Auto-pick fallback order position:** 2 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

### `openclaude` — OpenClaude

- **Source anchors:** `src/shared/tui-agent.ts:6` (type union); `src/shared/tui-agent-display-names.ts:11` (display name); `src/shared/tui-agent-config.ts:92` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:60` (renderer catalog entry).
- **Detection:** `detectCmd = 'openclaude'`.
- **Launch:** `launchCmd = 'openclaude'` (same as detectCmd); prompt injection mode `argv`, draft-prompt flag `--prefill`.
- **Permission bypass:** arg.
- **Resumable:** no — absent from RESUMABLE_TUI_AGENTS (agent-session-resume.ts).
- **Session option catalog (dynamic model/option switching UI):** no — absent from AgentSessionOptionCatalogMap.
- **Commit-message model-probe registry:** `unresolved-not-registered` — getAgentModelProbeSpec(agentId) returns undefined for this agent — it is NOT registered in either COMMIT_MESSAGE_AGENT_SPECS or MODEL_DISCOVERY_ONLY_SPECS. This is recorded as UNRESOLVED, not as 'no dynamic model discovery exists': absence from this one registry (whose purpose is commit-message generation + a short probe-only allowlist) is not proof the agent's own CLI lacks a model-listing capability elsewhere, and no dedicated main-process directory was separately searched for a per-agent model-list mechanism for this agent this pass.
- **Main-process directory:** `src/main/openclaude/` (exact id match).
- **Branded account-switcher UI:** no.
- **Auto-pick fallback order position:** 3 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

### `codex` — Codex

- **Source anchors:** `src/shared/tui-agent.ts:7` (type union); `src/shared/tui-agent-display-names.ts:12` (display name); `src/shared/tui-agent-config.ts:97` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:69` (renderer catalog entry).
- **Detection:** `detectCmd = 'codex'`.
- **Launch:** `launchCmd = 'codex'` (same as detectCmd); prompt injection mode `argv`, preflight trust preset `codex`.
- **Platform quirks (rule, not guessed — explicit fields in tui-agent-config.ts):** windowsInputRecordPasteNewline = `alt-enter`.
- **Permission bypass:** arg.
- **Resumable:** yes — member of RESUMABLE_TUI_AGENTS.
- **Session option catalog (dynamic model/option switching UI):** yes.
- **Commit-message model-probe registry:** `dynamic` — Registered in COMMIT_MESSAGE_AGENT_SPECS (commit-message-agent-spec.ts:90) with modelSource='dynamic'; getAgentModelProbeSpec() returns this spec, so both discoverModelsLocal/Remote spawn a real probe subprocess for this agent.
  - Probe: binary `codex`, args `['debug', 'models']` — `src/shared/commit-message-agent-specs-primary.ts:80-153`
  - **Codex app-server model/list (additional, independent mechanism):** Codex has a SECOND, independent dynamic-model-discovery mechanism beyond the commit-message 'codex debug models' CLI probe above: readCodexStructuredSessionOptions (src/main/codex/codex-structured-session-options.ts:78-116) issues a live 'model/list' JSON request over the codex app-server connection, paginated up to MAX_MODEL_PAGES=20 pages of MODEL_PAGE_LIMIT=100 (codex-structured-session-options.ts:12-13), used to populate the INTERACTIVE native-chat session-option model switcher (distinct from the commit-message-generation feature). No sibling '*-structured-session-options.ts' file was found for any other agent this pass (targeted rg for 'structured-session-options' across src/main matched only src/main/codex/) — recorded as Codex-unique, not assumed absent for others beyond what was actually searched.
  - Local/remote symmetry: discoverModelsLocal (commit-message-model-discovery.ts:33-113) and discoverModelsRemote (commit-message-model-discovery.ts:181-238) both call the SAME getAgentModelProbeSpec(agentId) and branch identically on modelSource === 'static' vs 'dynamic' — verified structurally, not guessed. The remote (SSH) path additionally distinguishes an unverifiable timeout from an unreachable PATH via isSshRequestOutcomeUnverifiable, consistent with the AGENTS.md live/unverifiable/exited liveness contract applied here to model discovery, not just PTY liveness.
- **Main-process directory:** `src/main/codex/` (exact id match).
- **Branded account-switcher UI:** yes (claude-accounts/codex-accounts/grok-accounts main dirs, per prior UI audit cross-reference).
- **Auto-pick fallback order position:** 4 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

### `devin` — Devin

- **Source anchors:** `src/shared/tui-agent.ts:36` (type union); `src/shared/tui-agent-display-names.ts:13` (display name); `src/shared/tui-agent-config.ts:284` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:297` (renderer catalog entry).
- **Detection:** `detectCmd = 'devin'`.
- **Launch:** `launchCmd = 'devin'` (same as detectCmd); prompt injection mode `stdin-after-start`.
- **Permission bypass:** arg.
- **Resumable:** yes — member of RESUMABLE_TUI_AGENTS.
- **Session option catalog (dynamic model/option switching UI):** no — absent from AgentSessionOptionCatalogMap.
- **Commit-message model-probe registry:** `unresolved-not-registered` — getAgentModelProbeSpec(agentId) returns undefined for this agent — it is NOT registered in either COMMIT_MESSAGE_AGENT_SPECS or MODEL_DISCOVERY_ONLY_SPECS. This is recorded as UNRESOLVED, not as 'no dynamic model discovery exists': absence from this one registry (whose purpose is commit-message generation + a short probe-only allowlist) is not proof the agent's own CLI lacks a model-listing capability elsewhere, and no dedicated main-process directory was separately searched for a per-agent model-list mechanism for this agent this pass.
- **Main-process directory:** `src/main/devin/` (exact id match).
- **Branded account-switcher UI:** no.
- **Auto-pick fallback order position:** 35 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

### `ante` — Ante

- **Source anchors:** `src/shared/tui-agent.ts:37` (type union); `src/shared/tui-agent-display-names.ts:14` (display name); `src/shared/tui-agent-config.ts:110` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:101` (renderer catalog entry).
- **Detection:** `detectCmd = 'ante'`.
- **Launch:** `launchCmd = 'ante'` (same as detectCmd); prompt injection mode `stdin-after-start`.
- **Permission bypass:** arg.
- **Resumable:** no — absent from RESUMABLE_TUI_AGENTS (agent-session-resume.ts).
- **Session option catalog (dynamic model/option switching UI):** no — absent from AgentSessionOptionCatalogMap.
- **Commit-message model-probe registry:** `unresolved-not-registered` — getAgentModelProbeSpec(agentId) returns undefined for this agent — it is NOT registered in either COMMIT_MESSAGE_AGENT_SPECS or MODEL_DISCOVERY_ONLY_SPECS. This is recorded as UNRESOLVED, not as 'no dynamic model discovery exists': absence from this one registry (whose purpose is commit-message generation + a short probe-only allowlist) is not proof the agent's own CLI lacks a model-listing capability elsewhere, and no dedicated main-process directory was separately searched for a per-agent model-list mechanism for this agent this pass.
- **Main-process directory:** none found under this id or an obvious normalized variant.
- **Branded account-switcher UI:** no.
- **Auto-pick fallback order position:** 9 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

### `trae` — Trae

- **Source anchors:** `src/shared/tui-agent.ts:38` (type union); `src/shared/tui-agent-display-names.ts:15` (display name); `src/shared/tui-agent-config.ts:115` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:108` (renderer catalog entry).
- **Detection:** `detectCmd = 'traecli'`.
- **Launch:** `launchCmd = 'traecli'` (same as detectCmd); prompt injection mode `argv`, argv separator `--`.
- **Permission bypass:** arg.
- **Resumable:** no — absent from RESUMABLE_TUI_AGENTS (agent-session-resume.ts).
- **Session option catalog (dynamic model/option switching UI):** no — absent from AgentSessionOptionCatalogMap.
- **Commit-message model-probe registry:** `unresolved-not-registered` — getAgentModelProbeSpec(agentId) returns undefined for this agent — it is NOT registered in either COMMIT_MESSAGE_AGENT_SPECS or MODEL_DISCOVERY_ONLY_SPECS. This is recorded as UNRESOLVED, not as 'no dynamic model discovery exists': absence from this one registry (whose purpose is commit-message generation + a short probe-only allowlist) is not proof the agent's own CLI lacks a model-listing capability elsewhere, and no dedicated main-process directory was separately searched for a per-agent model-list mechanism for this agent this pass.
- **Main-process directory:** none found under this id or an obvious normalized variant.
- **Branded account-switcher UI:** no.
- **Auto-pick fallback order position:** 10 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

### `autohand` — Autohand Code

- **Source anchors:** `src/shared/tui-agent.ts:8` (type union); `src/shared/tui-agent-display-names.ts:16` (display name); `src/shared/tui-agent-config.ts:106` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:203` (renderer catalog entry).
- **Detection:** `detectCmd = 'autohand'`.
- **Launch:** `launchCmd = 'autohand'` (same as detectCmd); prompt injection mode `stdin-after-start`.
- **Permission bypass:** arg.
- **Resumable:** no — absent from RESUMABLE_TUI_AGENTS (agent-session-resume.ts).
- **Session option catalog (dynamic model/option switching UI):** no — absent from AgentSessionOptionCatalogMap.
- **Commit-message model-probe registry:** `unresolved-not-registered` — getAgentModelProbeSpec(agentId) returns undefined for this agent — it is NOT registered in either COMMIT_MESSAGE_AGENT_SPECS or MODEL_DISCOVERY_ONLY_SPECS. This is recorded as UNRESOLVED, not as 'no dynamic model discovery exists': absence from this one registry (whose purpose is commit-message generation + a short probe-only allowlist) is not proof the agent's own CLI lacks a model-listing capability elsewhere, and no dedicated main-process directory was separately searched for a per-agent model-list mechanism for this agent this pass.
- **Main-process directory:** none found under this id or an obvious normalized variant.
- **Branded account-switcher UI:** no.
- **Auto-pick fallback order position:** 23 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

### `opencode` — OpenCode

- **Source anchors:** `src/shared/tui-agent.ts:9` (type union); `src/shared/tui-agent-display-names.ts:17` (display name); `src/shared/tui-agent-config.ts:125` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:88` (renderer catalog entry).
- **Detection:** `detectCmd = 'opencode'`.
- **Launch:** `launchCmd = 'opencode'` (same as detectCmd); prompt injection mode `flag-prompt`.
- **Permission bypass:** none-known (this agent's launch args also have an unsupported-flag stripping rule in tui-agent-launch-defaults.ts).
- **Resumable:** yes — member of RESUMABLE_TUI_AGENTS.
- **Session option catalog (dynamic model/option switching UI):** no — absent from AgentSessionOptionCatalogMap.
- **Commit-message model-probe registry:** `dynamic` — Registered in COMMIT_MESSAGE_AGENT_SPECS (commit-message-agent-spec.ts:90) with modelSource='dynamic'; getAgentModelProbeSpec() returns this spec, so both discoverModelsLocal/Remote spawn a real probe subprocess for this agent.
  - Probe: binary `opencode`, args `['models']` — `src/shared/commit-message-agent-specs-primary.ts:155-189`
  - Local/remote symmetry: discoverModelsLocal (commit-message-model-discovery.ts:33-113) and discoverModelsRemote (commit-message-model-discovery.ts:181-238) both call the SAME getAgentModelProbeSpec(agentId) and branch identically on modelSource === 'static' vs 'dynamic' — verified structurally, not guessed. The remote (SSH) path additionally distinguishes an unverifiable timeout from an unreachable PATH via isSshRequestOutcomeUnverifiable, consistent with the AGENTS.md live/unverifiable/exited liveness contract applied here to model discovery, not just PTY liveness.
- **Main-process directory:** `src/main/opencode/` (exact id match).
- **Branded account-switcher UI:** no.
- **Auto-pick fallback order position:** 7 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

### `mimo-code` — MiMo Code

- **Source anchors:** `src/shared/tui-agent.ts:10` (type union); `src/shared/tui-agent-display-names.ts:18` (display name); `src/shared/tui-agent-config.ts:131` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:94` (renderer catalog entry).
- **Detection:** `detectCmd = 'mimo'`.
- **Launch:** `launchCmd = 'mimo'` (same as detectCmd); prompt injection mode `flag-prompt`.
- **Permission bypass:** none-known.
- **Resumable:** yes — member of RESUMABLE_TUI_AGENTS.
- **Session option catalog (dynamic model/option switching UI):** no — absent from AgentSessionOptionCatalogMap.
- **Commit-message model-probe registry:** `unresolved-not-registered` — getAgentModelProbeSpec(agentId) returns undefined for this agent — it is NOT registered in either COMMIT_MESSAGE_AGENT_SPECS or MODEL_DISCOVERY_ONLY_SPECS. This is recorded as UNRESOLVED, not as 'no dynamic model discovery exists': absence from this one registry (whose purpose is commit-message generation + a short probe-only allowlist) is not proof the agent's own CLI lacks a model-listing capability elsewhere, and no dedicated main-process directory was separately searched for a per-agent model-list mechanism for this agent this pass.
- **Main-process directory:** `src/main/mimo/` — ALIASED, directory name differs from the TuiAgent id `mimo-code` (see §4).
- **Branded account-switcher UI:** no.
- **Auto-pick fallback order position:** 8 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

### `pi` — Pi

- **Source anchors:** `src/shared/tui-agent.ts:11` (type union); `src/shared/tui-agent-display-names.ts:19` (display name); `src/shared/tui-agent-config.ts:137` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:117` (renderer catalog entry).
- **Detection:** `detectCmd = 'pi'`.
- **Launch:** `launchCmd = 'pi'` (same as detectCmd); prompt injection mode `argv`, draft-prompt env var `ORCA_PI_PREFILL`.
- **Platform quirks (rule, not guessed — explicit fields in tui-agent-config.ts):** windowsShiftEnterEncoding = `csi-u`.
- **Permission bypass:** none-known.
- **Resumable:** yes — member of RESUMABLE_TUI_AGENTS.
- **Session option catalog (dynamic model/option switching UI):** no — absent from AgentSessionOptionCatalogMap.
- **Commit-message model-probe registry:** `dynamic` — Registered in COMMIT_MESSAGE_AGENT_SPECS (commit-message-agent-spec.ts:90) with modelSource='dynamic'; getAgentModelProbeSpec() returns this spec, so both discoverModelsLocal/Remote spawn a real probe subprocess for this agent.
  - Probe: binary `pi`, args `['--list-models']` — `src/shared/commit-message-agent-specs-primary.ts:191-223`
  - Local/remote symmetry: discoverModelsLocal (commit-message-model-discovery.ts:33-113) and discoverModelsRemote (commit-message-model-discovery.ts:181-238) both call the SAME getAgentModelProbeSpec(agentId) and branch identically on modelSource === 'static' vs 'dynamic' — verified structurally, not guessed. The remote (SSH) path additionally distinguishes an unverifiable timeout from an unreachable PATH via isSshRequestOutcomeUnverifiable, consistent with the AGENTS.md live/unverifiable/exited liveness contract applied here to model discovery, not just PTY liveness.
- **Main-process directory:** `src/main/pi/` (exact id match).
- **Branded account-switcher UI:** no.
- **Auto-pick fallback order position:** 11 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

### `omp` — OMP

- **Source anchors:** `src/shared/tui-agent.ts:12` (type union); `src/shared/tui-agent-display-names.ts:20` (display name); `src/shared/tui-agent-config.ts:145` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:123` (renderer catalog entry).
- **Detection:** `detectCmd = 'omp'`.
- **Launch:** `launchCmd = 'omp'` (same as detectCmd); prompt injection mode `argv`, draft-prompt env var `ORCA_OMP_PREFILL`.
- **Platform quirks (rule, not guessed — explicit fields in tui-agent-config.ts):** windowsShiftEnterEncoding = `csi-u`.
- **Permission bypass:** none-known.
- **Resumable:** yes — member of RESUMABLE_TUI_AGENTS.
- **Session option catalog (dynamic model/option switching UI):** no — absent from AgentSessionOptionCatalogMap.
- **Commit-message model-probe registry:** `unresolved-not-registered` — getAgentModelProbeSpec(agentId) returns undefined for this agent — it is NOT registered in either COMMIT_MESSAGE_AGENT_SPECS or MODEL_DISCOVERY_ONLY_SPECS. This is recorded as UNRESOLVED, not as 'no dynamic model discovery exists': absence from this one registry (whose purpose is commit-message generation + a short probe-only allowlist) is not proof the agent's own CLI lacks a model-listing capability elsewhere, and no dedicated main-process directory was separately searched for a per-agent model-list mechanism for this agent this pass.
- **Main-process directory:** none found under this id or an obvious normalized variant.
- **Branded account-switcher UI:** no.
- **Auto-pick fallback order position:** 12 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

### `prime-agent` — Prime Agent

- **Source anchors:** `src/shared/tui-agent.ts:39` (type union); `src/shared/tui-agent-display-names.ts:21` (display name); `src/shared/tui-agent-config.ts:152` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:131` (renderer catalog entry).
- **Detection:** `detectCmd = 'prime-agent'`.
- **Launch:** `launchCmd = 'prime-agent'` (same as detectCmd); prompt injection mode `argv`, argv separator `--`.
- **Platform quirks (rule, not guessed — explicit fields in tui-agent-config.ts):** windowsShiftEnterEncoding = `csi-u`.
- **Permission bypass:** none-known.
- **Resumable:** yes — member of RESUMABLE_TUI_AGENTS.
- **Session option catalog (dynamic model/option switching UI):** no — absent from AgentSessionOptionCatalogMap.
- **Commit-message model-probe registry:** `unresolved-not-registered` — getAgentModelProbeSpec(agentId) returns undefined for this agent — it is NOT registered in either COMMIT_MESSAGE_AGENT_SPECS or MODEL_DISCOVERY_ONLY_SPECS. This is recorded as UNRESOLVED, not as 'no dynamic model discovery exists': absence from this one registry (whose purpose is commit-message generation + a short probe-only allowlist) is not proof the agent's own CLI lacks a model-listing capability elsewhere, and no dedicated main-process directory was separately searched for a per-agent model-list mechanism for this agent this pass.
- **Main-process directory:** none found under this id or an obvious normalized variant.
- **Branded account-switcher UI:** no.
- **Auto-pick fallback order position:** 13 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

### `gemini` — Gemini

- **Source anchors:** `src/shared/tui-agent.ts:13` (type union); `src/shared/tui-agent-display-names.ts:22` (display name); `src/shared/tui-agent-config.ts:162` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:138` (renderer catalog entry).
- **Detection:** `detectCmd = 'gemini'`.
- **Launch:** `launchCmd = 'gemini'` (same as detectCmd); prompt injection mode `flag-prompt-interactive`.
- **Permission bypass:** arg.
- **Resumable:** yes — member of RESUMABLE_TUI_AGENTS.
- **Session option catalog (dynamic model/option switching UI):** yes.
- **Commit-message model-probe registry:** `unresolved-not-registered` — getAgentModelProbeSpec(agentId) returns undefined for this agent — it is NOT registered in either COMMIT_MESSAGE_AGENT_SPECS or MODEL_DISCOVERY_ONLY_SPECS. This is recorded as UNRESOLVED, not as 'no dynamic model discovery exists': absence from this one registry (whose purpose is commit-message generation + a short probe-only allowlist) is not proof the agent's own CLI lacks a model-listing capability elsewhere, and no dedicated main-process directory was separately searched for a per-agent model-list mechanism for this agent this pass.
- **Main-process directory:** `src/main/gemini/` (exact id match).
- **Branded account-switcher UI:** no.
- **Auto-pick fallback order position:** 14 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

### `antigravity` — Antigravity

- **Source anchors:** `src/shared/tui-agent.ts:14` (type union); `src/shared/tui-agent-display-names.ts:23` (display name); `src/shared/tui-agent-config.ts:166` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:145` (renderer catalog entry).
- **Detection:** `detectCmd = 'agy'`.
- **Launch:** `launchCmd = 'agy'` (same as detectCmd); prompt injection mode `flag-prompt-interactive`.
- **Permission bypass:** arg.
- **Resumable:** yes — member of RESUMABLE_TUI_AGENTS.
- **Session option catalog (dynamic model/option switching UI):** no — absent from AgentSessionOptionCatalogMap.
- **Commit-message model-probe registry:** `dynamic` — Registered in COMMIT_MESSAGE_AGENT_SPECS (commit-message-agent-spec.ts:90) with modelSource='dynamic'; getAgentModelProbeSpec() returns this spec, so both discoverModelsLocal/Remote spawn a real probe subprocess for this agent.
  - Probe: binary `agy`, args `['models']` — `src/shared/commit-message-agent-specs-secondary.ts:211-225`
  - Local/remote symmetry: discoverModelsLocal (commit-message-model-discovery.ts:33-113) and discoverModelsRemote (commit-message-model-discovery.ts:181-238) both call the SAME getAgentModelProbeSpec(agentId) and branch identically on modelSource === 'static' vs 'dynamic' — verified structurally, not guessed. The remote (SSH) path additionally distinguishes an unverifiable timeout from an unreachable PATH via isSshRequestOutcomeUnverifiable, consistent with the AGENTS.md live/unverifiable/exited liveness contract applied here to model discovery, not just PTY liveness.
- **Main-process directory:** `src/main/antigravity/` (exact id match).
- **Branded account-switcher UI:** no.
- **Auto-pick fallback order position:** 15 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

### `aider` — Aider

- **Source anchors:** `src/shared/tui-agent.ts:15` (type union); `src/shared/tui-agent-display-names.ts:24` (display name); `src/shared/tui-agent-config.ts:170` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:152` (renderer catalog entry).
- **Detection:** `detectCmd = 'aider'`.
- **Launch:** `launchCmd = 'aider'` (same as detectCmd); prompt injection mode `stdin-after-start`.
- **Permission bypass:** arg.
- **Resumable:** no — absent from RESUMABLE_TUI_AGENTS (agent-session-resume.ts).
- **Session option catalog (dynamic model/option switching UI):** no — absent from AgentSessionOptionCatalogMap.
- **Commit-message model-probe registry:** `unresolved-not-registered` — getAgentModelProbeSpec(agentId) returns undefined for this agent — it is NOT registered in either COMMIT_MESSAGE_AGENT_SPECS or MODEL_DISCOVERY_ONLY_SPECS. This is recorded as UNRESOLVED, not as 'no dynamic model discovery exists': absence from this one registry (whose purpose is commit-message generation + a short probe-only allowlist) is not proof the agent's own CLI lacks a model-listing capability elsewhere, and no dedicated main-process directory was separately searched for a per-agent model-list mechanism for this agent this pass.
- **Main-process directory:** none found under this id or an obvious normalized variant.
- **Branded account-switcher UI:** no.
- **Auto-pick fallback order position:** 16 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

### `goose` — Goose

- **Source anchors:** `src/shared/tui-agent.ts:16` (type union); `src/shared/tui-agent-display-names.ts:25` (display name); `src/shared/tui-agent-config.ts:174` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:158` (renderer catalog entry).
- **Detection:** `detectCmd = 'goose'`.
- **Launch:** `launchCmd = 'goose'` (same as detectCmd); prompt injection mode `stdin-after-start`.
- **Permission bypass:** env.
- **Resumable:** no — absent from RESUMABLE_TUI_AGENTS (agent-session-resume.ts).
- **Session option catalog (dynamic model/option switching UI):** no — absent from AgentSessionOptionCatalogMap.
- **Commit-message model-probe registry:** `unresolved-not-registered` — getAgentModelProbeSpec(agentId) returns undefined for this agent — it is NOT registered in either COMMIT_MESSAGE_AGENT_SPECS or MODEL_DISCOVERY_ONLY_SPECS. This is recorded as UNRESOLVED, not as 'no dynamic model discovery exists': absence from this one registry (whose purpose is commit-message generation + a short probe-only allowlist) is not proof the agent's own CLI lacks a model-listing capability elsewhere, and no dedicated main-process directory was separately searched for a per-agent model-list mechanism for this agent this pass.
- **Main-process directory:** none found under this id or an obvious normalized variant.
- **Branded account-switcher UI:** no.
- **Auto-pick fallback order position:** 17 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

### `amp` — Amp

- **Source anchors:** `src/shared/tui-agent.ts:17` (type union); `src/shared/tui-agent-display-names.ts:26` (display name); `src/shared/tui-agent-config.ts:178` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:165` (renderer catalog entry).
- **Detection:** `detectCmd = 'amp'`.
- **Launch:** `launchCmd = 'amp'` (same as detectCmd); prompt injection mode `stdin-after-start`.
- **Permission bypass:** arg.
- **Resumable:** no — absent from RESUMABLE_TUI_AGENTS (agent-session-resume.ts).
- **Session option catalog (dynamic model/option switching UI):** no — absent from AgentSessionOptionCatalogMap.
- **Commit-message model-probe registry:** `static-catalog` — Registered in COMMIT_MESSAGE_AGENT_SPECS with modelSource='static' — a maintained static model catalog exists and is used directly (staticModelDiscoveryResult), but NO live probe subprocess is spawned for this agent.
  - Static catalog anchor: `src/shared/commit-message-agent-specs-secondary.ts:22-55`
  - Local/remote symmetry: discoverModelsLocal (commit-message-model-discovery.ts:33-113) and discoverModelsRemote (commit-message-model-discovery.ts:181-238) both call the SAME getAgentModelProbeSpec(agentId) and branch identically on modelSource === 'static' vs 'dynamic' — verified structurally, not guessed. The remote (SSH) path additionally distinguishes an unverifiable timeout from an unreachable PATH via isSshRequestOutcomeUnverifiable, consistent with the AGENTS.md live/unverifiable/exited liveness contract applied here to model discovery, not just PTY liveness.
- **Main-process directory:** `src/main/amp/` (exact id match).
- **Branded account-switcher UI:** no.
- **Auto-pick fallback order position:** 18 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

### `kilo` — Kilocode

- **Source anchors:** `src/shared/tui-agent.ts:18` (type union); `src/shared/tui-agent-display-names.ts:27` (display name); `src/shared/tui-agent-config.ts:182` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:172` (renderer catalog entry).
- **Detection:** `detectCmd = 'kilo'`.
- **Launch:** `launchCmd = 'kilo'` (same as detectCmd); prompt injection mode `stdin-after-start`.
- **Permission bypass:** none-known (this agent's launch args also have an unsupported-flag stripping rule in tui-agent-launch-defaults.ts).
- **Resumable:** no — absent from RESUMABLE_TUI_AGENTS (agent-session-resume.ts).
- **Session option catalog (dynamic model/option switching UI):** no — absent from AgentSessionOptionCatalogMap.
- **Commit-message model-probe registry:** `unresolved-not-registered` — getAgentModelProbeSpec(agentId) returns undefined for this agent — it is NOT registered in either COMMIT_MESSAGE_AGENT_SPECS or MODEL_DISCOVERY_ONLY_SPECS. This is recorded as UNRESOLVED, not as 'no dynamic model discovery exists': absence from this one registry (whose purpose is commit-message generation + a short probe-only allowlist) is not proof the agent's own CLI lacks a model-listing capability elsewhere, and no dedicated main-process directory was separately searched for a per-agent model-list mechanism for this agent this pass.
- **Main-process directory:** none found under this id or an obvious normalized variant.
- **Branded account-switcher UI:** no.
- **Auto-pick fallback order position:** 19 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

### `kiro` — Kiro

- **Source anchors:** `src/shared/tui-agent.ts:19` (type union); `src/shared/tui-agent-display-names.ts:28` (display name); `src/shared/tui-agent-config.ts:186` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:178` (renderer catalog entry).
- **Detection:** `detectCmd = 'kiro-cli'`.
- **Launch:** `launchCmd = 'kiro-cli chat --tui'` (differs from detectCmd); prompt injection mode `stdin-after-start`.
- **Permission bypass:** arg.
- **Resumable:** no — absent from RESUMABLE_TUI_AGENTS (agent-session-resume.ts).
- **Session option catalog (dynamic model/option switching UI):** no — absent from AgentSessionOptionCatalogMap.
- **Commit-message model-probe registry:** `unresolved-not-registered` — getAgentModelProbeSpec(agentId) returns undefined for this agent — it is NOT registered in either COMMIT_MESSAGE_AGENT_SPECS or MODEL_DISCOVERY_ONLY_SPECS. This is recorded as UNRESOLVED, not as 'no dynamic model discovery exists': absence from this one registry (whose purpose is commit-message generation + a short probe-only allowlist) is not proof the agent's own CLI lacks a model-listing capability elsewhere, and no dedicated main-process directory was separately searched for a per-agent model-list mechanism for this agent this pass.
- **Main-process directory:** none found under this id or an obvious normalized variant.
- **Branded account-switcher UI:** no.
- **Auto-pick fallback order position:** 20 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

### `crush` — Charm

- **Source anchors:** `src/shared/tui-agent.ts:20` (type union); `src/shared/tui-agent-display-names.ts:29` (display name); `src/shared/tui-agent-config.ts:193` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:189` (renderer catalog entry).
- **Detection:** `detectCmd = 'crush'`.
- **Launch:** `launchCmd = 'crush'` (same as detectCmd); prompt injection mode `stdin-after-start`.
- **Permission bypass:** arg.
- **Resumable:** no — absent from RESUMABLE_TUI_AGENTS (agent-session-resume.ts).
- **Session option catalog (dynamic model/option switching UI):** no — absent from AgentSessionOptionCatalogMap.
- **Commit-message model-probe registry:** `unresolved-not-registered` — getAgentModelProbeSpec(agentId) returns undefined for this agent — it is NOT registered in either COMMIT_MESSAGE_AGENT_SPECS or MODEL_DISCOVERY_ONLY_SPECS. This is recorded as UNRESOLVED, not as 'no dynamic model discovery exists': absence from this one registry (whose purpose is commit-message generation + a short probe-only allowlist) is not proof the agent's own CLI lacks a model-listing capability elsewhere, and no dedicated main-process directory was separately searched for a per-agent model-list mechanism for this agent this pass.
- **Main-process directory:** none found under this id or an obvious normalized variant.
- **Branded account-switcher UI:** no.
- **Auto-pick fallback order position:** 21 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

### `aug` — Auggie

- **Source anchors:** `src/shared/tui-agent.ts:21` (type union); `src/shared/tui-agent-display-names.ts:30` (display name); `src/shared/tui-agent-config.ts:197` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:196` (renderer catalog entry).
- **Detection:** `detectCmd = 'auggie'`.
- **Launch:** `launchCmd = 'auggie'` (same as detectCmd); prompt injection mode `stdin-after-start`.
- **Permission bypass:** none-known.
- **Resumable:** no — absent from RESUMABLE_TUI_AGENTS (agent-session-resume.ts).
- **Session option catalog (dynamic model/option switching UI):** no — absent from AgentSessionOptionCatalogMap.
- **Commit-message model-probe registry:** `unresolved-not-registered` — getAgentModelProbeSpec(agentId) returns undefined for this agent — it is NOT registered in either COMMIT_MESSAGE_AGENT_SPECS or MODEL_DISCOVERY_ONLY_SPECS. This is recorded as UNRESOLVED, not as 'no dynamic model discovery exists': absence from this one registry (whose purpose is commit-message generation + a short probe-only allowlist) is not proof the agent's own CLI lacks a model-listing capability elsewhere, and no dedicated main-process directory was separately searched for a per-agent model-list mechanism for this agent this pass.
- **Main-process directory:** none found under this id or an obvious normalized variant.
- **Branded account-switcher UI:** no.
- **Auto-pick fallback order position:** 22 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

### `cline` — Cline

- **Source anchors:** `src/shared/tui-agent.ts:22` (type union); `src/shared/tui-agent-display-names.ts:31` (display name); `src/shared/tui-agent-config.ts:202` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:210` (renderer catalog entry).
- **Detection:** `detectCmd = 'cline'`.
- **Launch:** `launchCmd = 'cline'` (same as detectCmd); prompt injection mode `stdin-after-start`.
- **Permission bypass:** arg.
- **Resumable:** no — absent from RESUMABLE_TUI_AGENTS (agent-session-resume.ts).
- **Session option catalog (dynamic model/option switching UI):** no — absent from AgentSessionOptionCatalogMap.
- **Commit-message model-probe registry:** `unresolved-not-registered` — getAgentModelProbeSpec(agentId) returns undefined for this agent — it is NOT registered in either COMMIT_MESSAGE_AGENT_SPECS or MODEL_DISCOVERY_ONLY_SPECS. This is recorded as UNRESOLVED, not as 'no dynamic model discovery exists': absence from this one registry (whose purpose is commit-message generation + a short probe-only allowlist) is not proof the agent's own CLI lacks a model-listing capability elsewhere, and no dedicated main-process directory was separately searched for a per-agent model-list mechanism for this agent this pass.
- **Main-process directory:** none found under this id or an obvious normalized variant.
- **Branded account-switcher UI:** no.
- **Auto-pick fallback order position:** 24 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

### `codebuff` — Codebuff

- **Source anchors:** `src/shared/tui-agent.ts:23` (type union); `src/shared/tui-agent-display-names.ts:32` (display name); `src/shared/tui-agent-config.ts:206` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:217` (renderer catalog entry).
- **Detection:** `detectCmd = 'codebuff'`.
- **Launch:** `launchCmd = 'codebuff'` (same as detectCmd); prompt injection mode `stdin-after-start`.
- **Permission bypass:** none-known.
- **Resumable:** no — absent from RESUMABLE_TUI_AGENTS (agent-session-resume.ts).
- **Session option catalog (dynamic model/option switching UI):** no — absent from AgentSessionOptionCatalogMap.
- **Commit-message model-probe registry:** `unresolved-not-registered` — getAgentModelProbeSpec(agentId) returns undefined for this agent — it is NOT registered in either COMMIT_MESSAGE_AGENT_SPECS or MODEL_DISCOVERY_ONLY_SPECS. This is recorded as UNRESOLVED, not as 'no dynamic model discovery exists': absence from this one registry (whose purpose is commit-message generation + a short probe-only allowlist) is not proof the agent's own CLI lacks a model-listing capability elsewhere, and no dedicated main-process directory was separately searched for a per-agent model-list mechanism for this agent this pass.
- **Main-process directory:** none found under this id or an obvious normalized variant.
- **Branded account-switcher UI:** no.
- **Auto-pick fallback order position:** 25 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

### `command-code` — Command Code

- **Source anchors:** `src/shared/tui-agent.ts:24` (type union); `src/shared/tui-agent-display-names.ts:33` (display name); `src/shared/tui-agent-config.ts:210` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:224` (renderer catalog entry).
- **Detection:** `detectCmd = 'command-code'`.
- **Launch:** `launchCmd = 'command-code --trust'` (differs from detectCmd); prompt injection mode `argv`.
- **Permission bypass:** arg.
- **Resumable:** no — absent from RESUMABLE_TUI_AGENTS (agent-session-resume.ts).
- **Session option catalog (dynamic model/option switching UI):** no — absent from AgentSessionOptionCatalogMap.
- **Commit-message model-probe registry:** `unresolved-not-registered` — getAgentModelProbeSpec(agentId) returns undefined for this agent — it is NOT registered in either COMMIT_MESSAGE_AGENT_SPECS or MODEL_DISCOVERY_ONLY_SPECS. This is recorded as UNRESOLVED, not as 'no dynamic model discovery exists': absence from this one registry (whose purpose is commit-message generation + a short probe-only allowlist) is not proof the agent's own CLI lacks a model-listing capability elsewhere, and no dedicated main-process directory was separately searched for a per-agent model-list mechanism for this agent this pass.
- **Main-process directory:** `src/main/command-code/` (exact id match).
- **Branded account-switcher UI:** no.
- **Auto-pick fallback order position:** 26 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

### `continue` — Continue

- **Source anchors:** `src/shared/tui-agent.ts:25` (type union); `src/shared/tui-agent-display-names.ts:34` (display name); `src/shared/tui-agent-config.ts:217` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:235` (renderer catalog entry).
- **Detection:** `detectCmd = 'cn'`.
- **Launch:** `launchCmd = 'cn'` (same as detectCmd); prompt injection mode `stdin-after-start`.
- **Permission bypass:** arg.
- **Resumable:** no — absent from RESUMABLE_TUI_AGENTS (agent-session-resume.ts).
- **Session option catalog (dynamic model/option switching UI):** no — absent from AgentSessionOptionCatalogMap.
- **Commit-message model-probe registry:** `unresolved-not-registered` — getAgentModelProbeSpec(agentId) returns undefined for this agent — it is NOT registered in either COMMIT_MESSAGE_AGENT_SPECS or MODEL_DISCOVERY_ONLY_SPECS. This is recorded as UNRESOLVED, not as 'no dynamic model discovery exists': absence from this one registry (whose purpose is commit-message generation + a short probe-only allowlist) is not proof the agent's own CLI lacks a model-listing capability elsewhere, and no dedicated main-process directory was separately searched for a per-agent model-list mechanism for this agent this pass.
- **Main-process directory:** none found under this id or an obvious normalized variant.
- **Branded account-switcher UI:** no.
- **Auto-pick fallback order position:** 27 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

### `cursor` — Cursor

- **Source anchors:** `src/shared/tui-agent.ts:26` (type union); `src/shared/tui-agent-display-names.ts:35` (display name); `src/shared/tui-agent-config.ts:222` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:244` (renderer catalog entry).
- **Detection:** `detectCmd = 'cursor-agent'`.
- **Launch:** `launchCmd = 'cursor-agent'` (same as detectCmd); prompt injection mode `argv`, preflight trust preset `cursor`.
- **Permission bypass:** arg.
- **Resumable:** no — absent from RESUMABLE_TUI_AGENTS (agent-session-resume.ts).
- **Session option catalog (dynamic model/option switching UI):** yes.
- **Commit-message model-probe registry:** `dynamic` — Registered in COMMIT_MESSAGE_AGENT_SPECS (commit-message-agent-spec.ts:90) with modelSource='dynamic'; getAgentModelProbeSpec() returns this spec, so both discoverModelsLocal/Remote spawn a real probe subprocess for this agent.
  - Probe: binary `cursor-agent`, args `['--list-models']` — `src/shared/commit-message-agent-specs-secondary.ts:57-76`
  - Local/remote symmetry: discoverModelsLocal (commit-message-model-discovery.ts:33-113) and discoverModelsRemote (commit-message-model-discovery.ts:181-238) both call the SAME getAgentModelProbeSpec(agentId) and branch identically on modelSource === 'static' vs 'dynamic' — verified structurally, not guessed. The remote (SSH) path additionally distinguishes an unverifiable timeout from an unreachable PATH via isSshRequestOutcomeUnverifiable, consistent with the AGENTS.md live/unverifiable/exited liveness contract applied here to model discovery, not just PTY liveness.
- **Main-process directory:** `src/main/cursor/` (exact id match).
- **Branded account-switcher UI:** no.
- **Auto-pick fallback order position:** 28 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

### `droid` — Droid

- **Source anchors:** `src/shared/tui-agent.ts:27` (type union); `src/shared/tui-agent-display-names.ts:36` (display name); `src/shared/tui-agent-config.ts:228` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:251` (renderer catalog entry).
- **Detection:** `detectCmd = 'droid'`.
- **Launch:** `launchCmd = 'droid'` (same as detectCmd); prompt injection mode `argv`.
- **Platform quirks (rule, not guessed — explicit fields in tui-agent-config.ts):** windowsShiftEnterEncoding = `csi-u`, ctrlEnterEncoding = `csi-u`.
- **Permission bypass:** arg.
- **Resumable:** yes — member of RESUMABLE_TUI_AGENTS.
- **Session option catalog (dynamic model/option switching UI):** no — absent from AgentSessionOptionCatalogMap.
- **Commit-message model-probe registry:** `unresolved-not-registered` — getAgentModelProbeSpec(agentId) returns undefined for this agent — it is NOT registered in either COMMIT_MESSAGE_AGENT_SPECS or MODEL_DISCOVERY_ONLY_SPECS. This is recorded as UNRESOLVED, not as 'no dynamic model discovery exists': absence from this one registry (whose purpose is commit-message generation + a short probe-only allowlist) is not proof the agent's own CLI lacks a model-listing capability elsewhere, and no dedicated main-process directory was separately searched for a per-agent model-list mechanism for this agent this pass.
- **Main-process directory:** `src/main/droid/` (exact id match).
- **Branded account-switcher UI:** no.
- **Auto-pick fallback order position:** 29 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

### `kimi` — Kimi

- **Source anchors:** `src/shared/tui-agent.ts:28` (type union); `src/shared/tui-agent-display-names.ts:37` (display name); `src/shared/tui-agent-config.ts:235` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:257` (renderer catalog entry).
- **Detection:** `detectCmd = 'kimi'`.
- **Launch:** `launchCmd = 'kimi'` (same as detectCmd); prompt injection mode `stdin-after-start`.
- **Permission bypass:** arg.
- **Resumable:** yes — member of RESUMABLE_TUI_AGENTS.
- **Session option catalog (dynamic model/option switching UI):** no — absent from AgentSessionOptionCatalogMap.
- **Commit-message model-probe registry:** `static-catalog` — Registered in COMMIT_MESSAGE_AGENT_SPECS with modelSource='static' — a maintained static model catalog exists and is used directly (staticModelDiscoveryResult), but NO live probe subprocess is spawned for this agent.
  - Static catalog anchor: `src/shared/commit-message-agent-specs-secondary.ts:78-111`
  - Local/remote symmetry: discoverModelsLocal (commit-message-model-discovery.ts:33-113) and discoverModelsRemote (commit-message-model-discovery.ts:181-238) both call the SAME getAgentModelProbeSpec(agentId) and branch identically on modelSource === 'static' vs 'dynamic' — verified structurally, not guessed. The remote (SSH) path additionally distinguishes an unverifiable timeout from an unreachable PATH via isSshRequestOutcomeUnverifiable, consistent with the AGENTS.md live/unverifiable/exited liveness contract applied here to model discovery, not just PTY liveness.
- **Main-process directory:** `src/main/kimi/` (exact id match).
- **Branded account-switcher UI:** no.
- **Auto-pick fallback order position:** 30 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

### `mistral-vibe` — Mistral Vibe

- **Source anchors:** `src/shared/tui-agent.ts:29` (type union); `src/shared/tui-agent-display-names.ts:38` (display name); `src/shared/tui-agent-config.ts:239` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:264` (renderer catalog entry).
- **Detection:** `detectCmd = 'vibe'`, aliases `['mistral-vibe']`.
- **Launch:** `launchCmd = 'vibe'` (same as detectCmd); prompt injection mode `stdin-after-start`.
- **Permission bypass:** arg.
- **Resumable:** no — absent from RESUMABLE_TUI_AGENTS (agent-session-resume.ts).
- **Session option catalog (dynamic model/option switching UI):** no — absent from AgentSessionOptionCatalogMap.
- **Commit-message model-probe registry:** `unresolved-not-registered` — getAgentModelProbeSpec(agentId) returns undefined for this agent — it is NOT registered in either COMMIT_MESSAGE_AGENT_SPECS or MODEL_DISCOVERY_ONLY_SPECS. This is recorded as UNRESOLVED, not as 'no dynamic model discovery exists': absence from this one registry (whose purpose is commit-message generation + a short probe-only allowlist) is not proof the agent's own CLI lacks a model-listing capability elsewhere, and no dedicated main-process directory was separately searched for a per-agent model-list mechanism for this agent this pass.
- **Main-process directory:** none found under this id or an obvious normalized variant.
- **Branded account-switcher UI:** no.
- **Auto-pick fallback order position:** 31 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

### `qwen-code` — Qwen Code

- **Source anchors:** `src/shared/tui-agent.ts:30` (type union); `src/shared/tui-agent-display-names.ts:39` (display name); `src/shared/tui-agent-config.ts:245` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:273` (renderer catalog entry).
- **Detection:** `detectCmd = 'qwen'`.
- **Launch:** `launchCmd = 'qwen'` (same as detectCmd); prompt injection mode `stdin-after-start`.
- **Permission bypass:** arg.
- **Resumable:** no — absent from RESUMABLE_TUI_AGENTS (agent-session-resume.ts).
- **Session option catalog (dynamic model/option switching UI):** no — absent from AgentSessionOptionCatalogMap.
- **Commit-message model-probe registry:** `unresolved-not-registered` — getAgentModelProbeSpec(agentId) returns undefined for this agent — it is NOT registered in either COMMIT_MESSAGE_AGENT_SPECS or MODEL_DISCOVERY_ONLY_SPECS. This is recorded as UNRESOLVED, not as 'no dynamic model discovery exists': absence from this one registry (whose purpose is commit-message generation + a short probe-only allowlist) is not proof the agent's own CLI lacks a model-listing capability elsewhere, and no dedicated main-process directory was separately searched for a per-agent model-list mechanism for this agent this pass.
- **Main-process directory:** none found under this id or an obvious normalized variant.
- **Branded account-switcher UI:** no.
- **Auto-pick fallback order position:** 32 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

### `rovo` — Rovo Dev

- **Source anchors:** `src/shared/tui-agent.ts:31` (type union); `src/shared/tui-agent-display-names.ts:40` (display name); `src/shared/tui-agent-config.ts:250` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:282` (renderer catalog entry).
- **Detection:** `detectCmd = 'rovo'`.
- **Launch:** `launchCmd = 'rovo'` (same as detectCmd); prompt injection mode `stdin-after-start`.
- **Permission bypass:** arg.
- **Resumable:** no — absent from RESUMABLE_TUI_AGENTS (agent-session-resume.ts).
- **Session option catalog (dynamic model/option switching UI):** no — absent from AgentSessionOptionCatalogMap.
- **Commit-message model-probe registry:** `unresolved-not-registered` — getAgentModelProbeSpec(agentId) returns undefined for this agent — it is NOT registered in either COMMIT_MESSAGE_AGENT_SPECS or MODEL_DISCOVERY_ONLY_SPECS. This is recorded as UNRESOLVED, not as 'no dynamic model discovery exists': absence from this one registry (whose purpose is commit-message generation + a short probe-only allowlist) is not proof the agent's own CLI lacks a model-listing capability elsewhere, and no dedicated main-process directory was separately searched for a per-agent model-list mechanism for this agent this pass.
- **Main-process directory:** none found under this id or an obvious normalized variant.
- **Branded account-switcher UI:** no.
- **Auto-pick fallback order position:** 33 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

### `hermes` — Hermes

- **Source anchors:** `src/shared/tui-agent.ts:32` (type union); `src/shared/tui-agent-display-names.ts:41` (display name); `src/shared/tui-agent-config.ts:254` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:290` (renderer catalog entry).
- **Detection:** `detectCmd = 'hermes'`.
- **Launch:** `launchCmd = 'hermes --tui'` (differs from detectCmd); prompt injection mode `hermes-query`.
- **Permission bypass:** arg.
- **Resumable:** no — absent from RESUMABLE_TUI_AGENTS (agent-session-resume.ts).
- **Session option catalog (dynamic model/option switching UI):** no — absent from AgentSessionOptionCatalogMap.
- **Commit-message model-probe registry:** `unresolved-not-registered` — getAgentModelProbeSpec(agentId) returns undefined for this agent — it is NOT registered in either COMMIT_MESSAGE_AGENT_SPECS or MODEL_DISCOVERY_ONLY_SPECS. This is recorded as UNRESOLVED, not as 'no dynamic model discovery exists': absence from this one registry (whose purpose is commit-message generation + a short probe-only allowlist) is not proof the agent's own CLI lacks a model-listing capability elsewhere, and no dedicated main-process directory was separately searched for a per-agent model-list mechanism for this agent this pass.
- **Main-process directory:** `src/main/hermes/` (exact id match).
- **Branded account-switcher UI:** no.
- **Auto-pick fallback order position:** 34 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

### `openclaw` — OpenClaw

- **Source anchors:** `src/shared/tui-agent.ts:33` (type union); `src/shared/tui-agent-display-names.ts:42` (display name); `src/shared/tui-agent-config.ts:261` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:304` (renderer catalog entry).
- **Detection:** `detectCmd = 'openclaw'`.
- **Launch:** `launchCmd = 'openclaw'` (same as detectCmd); prompt injection mode `stdin-after-start`.
- **Permission bypass:** none-known.
- **Resumable:** no — absent from RESUMABLE_TUI_AGENTS (agent-session-resume.ts).
- **Session option catalog (dynamic model/option switching UI):** no — absent from AgentSessionOptionCatalogMap.
- **Commit-message model-probe registry:** `unresolved-not-registered` — getAgentModelProbeSpec(agentId) returns undefined for this agent — it is NOT registered in either COMMIT_MESSAGE_AGENT_SPECS or MODEL_DISCOVERY_ONLY_SPECS. This is recorded as UNRESOLVED, not as 'no dynamic model discovery exists': absence from this one registry (whose purpose is commit-message generation + a short probe-only allowlist) is not proof the agent's own CLI lacks a model-listing capability elsewhere, and no dedicated main-process directory was separately searched for a per-agent model-list mechanism for this agent this pass.
- **Main-process directory:** none found under this id or an obvious normalized variant.
- **Branded account-switcher UI:** no.
- **Auto-pick fallback order position:** 36 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

### `copilot` — GitHub Copilot

- **Source anchors:** `src/shared/tui-agent.ts:34` (type union); `src/shared/tui-agent-display-names.ts:43` (display name); `src/shared/tui-agent-config.ts:265` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:82` (renderer catalog entry).
- **Detection:** `detectCmd = 'copilot'`.
- **Launch:** `launchCmd = 'copilot'` (same as detectCmd); prompt injection mode `flag-interactive`, preflight trust preset `copilot`.
- **Permission bypass:** arg.
- **Resumable:** yes — member of RESUMABLE_TUI_AGENTS.
- **Session option catalog (dynamic model/option switching UI):** no — absent from AgentSessionOptionCatalogMap.
- **Commit-message model-probe registry:** `static-catalog` — Registered in COMMIT_MESSAGE_AGENT_SPECS with modelSource='static' — a maintained static model catalog exists and is used directly (staticModelDiscoveryResult), but NO live probe subprocess is spawned for this agent.
  - Static catalog anchor: `src/shared/commit-message-agent-specs-secondary.ts:113-209`
  - Local/remote symmetry: discoverModelsLocal (commit-message-model-discovery.ts:33-113) and discoverModelsRemote (commit-message-model-discovery.ts:181-238) both call the SAME getAgentModelProbeSpec(agentId) and branch identically on modelSource === 'static' vs 'dynamic' — verified structurally, not guessed. The remote (SSH) path additionally distinguishes an unverifiable timeout from an unreachable PATH via isSshRequestOutcomeUnverifiable, consistent with the AGENTS.md live/unverifiable/exited liveness contract applied here to model discovery, not just PTY liveness.
- **Main-process directory:** `src/main/copilot/` (exact id match).
- **Branded account-switcher UI:** no.
- **Auto-pick fallback order position:** 6 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

### `grok` — Grok

- **Source anchors:** `src/shared/tui-agent.ts:35` (type union); `src/shared/tui-agent-display-names.ts:44` (display name); `src/shared/tui-agent-config.ts:272` (detection+launch config); `src/renderer/src/lib/agent-catalog.tsx:75` (renderer catalog entry).
- **Detection:** `detectCmd = 'grok'`.
- **Launch:** `launchCmd = 'grok'` (same as detectCmd); prompt injection mode `argv`, argv separator `--`.
- **Platform quirks (rule, not guessed — explicit fields in tui-agent-config.ts):** ctrlEnterEncoding = `csi-u`.
- **Permission bypass:** arg.
- **Resumable:** yes — member of RESUMABLE_TUI_AGENTS.
- **Session option catalog (dynamic model/option switching UI):** yes.
- **Commit-message model-probe registry:** `dynamic-probe-only-not-commit-message-agent` — Registered ONLY in agent-model-probe-spec.ts's MODEL_DISCOVERY_ONLY_SPECS (not in COMMIT_MESSAGE_AGENT_SPECS) — Grok supports the model-discovery half of this contract (dynamic probe via grok-model-list-probe.ts) but has no promptDelivery/buildArgs, i.e. it is NOT wired as a commit-message-generation agent at all, only as a probe-only model source.
  - Probe: binary `grok`, args `GROK_MODEL_LIST_ARGS = ['models'] (src/shared/grok-model-list-probe.ts:6)` — `src/shared/agent-model-probe-spec.ts:11-24`
  - Local/remote symmetry: discoverModelsLocal (commit-message-model-discovery.ts:33-113) and discoverModelsRemote (commit-message-model-discovery.ts:181-238) both call the SAME getAgentModelProbeSpec(agentId) and branch identically on modelSource === 'static' vs 'dynamic' — verified structurally, not guessed. The remote (SSH) path additionally distinguishes an unverifiable timeout from an unreachable PATH via isSshRequestOutcomeUnverifiable, consistent with the AGENTS.md live/unverifiable/exited liveness contract applied here to model discovery, not just PTY liveness.
- **Main-process directory:** `src/main/grok/` (exact id match).
- **Branded account-switcher UI:** yes (claude-accounts/codex-accounts/grok-accounts main dirs, per prior UI audit cross-reference).
- **Auto-pick fallback order position:** 5 of 36 (`TUI_AGENT_AUTO_PICK_ORDER`, src/shared/tui-agent-selection.ts).

## 5. Unresolved cross-registry mappings (named, not guessed)

### `mimo-code`

- **Issue:** TuiAgent id 'mimo-code' has detectCmd 'mimo' (tui-agent-config.ts:131) and its src/main/ deeper-integration directory is named 'mimo' (not 'mimo-code'). The id/detectCmd/directory-name triple is NOT a 1:1 string match across all three registries for this agent alone among the 16 agents with a dedicated main/ directory.
- **Resolution:** unresolved — recorded as a naming divergence between the TuiAgent id and its main-process directory, not silently normalized or assumed equivalent.

### `kiro`

- **Issue:** TuiAgent id 'kiro' has detectCmd 'kiro-cli' (tui-agent-config.ts:186-192, comment: 'the Kiro installer ships kiro-cli, not kiro; keep id kiro for stored prefs') and NO src/main/kiro or src/main/kiro-cli directory exists.
- **Resolution:** unresolved — the id/detectCmd divergence is explicit and commented in source (stored-preference compatibility), but there is no dedicated main-process directory for kiro under any of the three candidate names checked (kiro, kiro-cli, kirocli).

### `aug`

- **Issue:** TuiAgent id 'aug' has detectCmd 'auggie' (tui-agent-config.ts:197-200, comment: '@augmentcode/auggie installs a binary named auggie, not aug; keep id aug for stored prefs') and NO src/main/aug or src/main/auggie directory exists.
- **Resolution:** unresolved — same id/detectCmd divergence pattern as kiro, no dedicated main-process directory found under either candidate name.

### `mistral-vibe`

- **Issue:** TuiAgent id 'mistral-vibe' has detectCmd 'vibe' with detectCmdAliases ['mistral-vibe'] (tui-agent-config.ts:239-244) — i.e. the id itself is ALSO registered as a detection alias of a differently-named primary command. No src/main/vibe or src/main/mistral-vibe directory exists.
- **Resolution:** unresolved — no dedicated main-process directory found under either candidate name.

### `qwen-code`

- **Issue:** TuiAgent id 'qwen-code' has detectCmd 'qwen' (tui-agent-config.ts:245-248) and NO src/main/qwen or src/main/qwen-code directory exists.
- **Resolution:** unresolved — no dedicated main-process directory found under either candidate name.

### `continue`

- **Issue:** TuiAgent id 'continue' has detectCmd 'cn' (tui-agent-config.ts:217-221, comment: shell builtin collision) and NO src/main/continue or src/main/cn directory exists.
- **Resolution:** unresolved — no dedicated main-process directory found under either candidate name.

### `claude-agent-teams`

- **Issue:** TuiAgent id 'claude-agent-teams' has detectCmd 'orca' (the Orca CLI itself, not a separate agent binary) and its own main-process directory does not exist as 'claude-agent-teams' — its detection/launch is layered on top of the 'claude' main-process integration plus the Orca CLI, per tui-agent-config.ts:76-91's comment ('an Orca-provided launch mode, not a separate binary').
- **Resolution:** unresolved as a distinct main-process directory question — by design this agent shares claude's main-process integration rather than having its own, per the source comment; recorded as a rule (explicit design choice), not a gap.

## 6. Main-process directories present but not mapped to any TuiAgent id

Directories: `minimax`, `computer`, `gitea`, `azure-devops`.

src/main/ also contains directories minimax/, computer/, gitea/, azure-devops/ that do NOT correspond to any of the 36 TuiAgent ids. These are NOT flagged as missing TuiAgent coverage — 'computer' backs the Computer-Use feature (a distinct capability, not a TUI coding agent) and 'gitea'/'azure-devops' back Git-hosting-provider integrations (like github/gitlab), not launchable TUI agents. 'minimax' has no corresponding TuiAgent id anywhere in the 4 primary registries checked this pass and its relationship to the TUI agent system (if any) is unresolved — recorded here rather than silently omitted, per the instruction to preserve all original agents/integrations found.

## 7. Observed vs. proposed

**Observed:** Every field in 'rows' above is observed source-text evidence (a registry entry, a directory listing, a line-anchored source location) from the frozen legacy checkout — none of it is this document's own proposal for how the rewrite should behave.

**Proposed:** This document makes NO migration-strategy recommendation (no REUSE/REWRITE verdict per agent) — that is explicitly out of scope for a 'bounded static audit follow-up' whose sole deliverable is the reconciled catalog. Any future migration-planning document that cites this catalog must treat every row as 'observed legacy behavior to preserve', not as a design decision already made here.

## 8. Migration preservation note

All 36 agents in CANONICAL are recorded as present, regardless of which ones are exercised by the current active worker/agent pool in this rewrite effort — per instruction, this catalog does not assume only the currently-used subset matters. Removing any agent row from a future migrated registry is a product decision this document does not make and does not imply.

## 9. Files read this pass (hash + line count)

| File | SHA-256 | Lines |
|---|---|---|
| `src/shared/tui-agent.ts` | `7c470c858ddc10988ea2b7e230d127a8d9bc70acf03e8dc8226d799749ce023b` | 40 |
| `src/shared/tui-agent-display-names.ts` | `1a4b102bb7e8c13a48344c6da22f531e1ebf77329bd868f2580b7729684c7296` | 50 |
| `src/shared/tui-agent-config.ts` | `192226db679f6241bc68a3093b4aac2e8922d11079beeb16cddc26698b4f1b7f` | 317 |
| `src/shared/tui-agent-detection-commands.ts` | `bd2f0e30b5911190f8660fafaeea823c3e48f2b656b87d334f04f4dfc2f6d33f` | 78 |
| `src/shared/tui-agent-launch-command.ts` | `2865ca6c69ac58c10259f8b66a91e85f9fd7f801ef0fcb936e493bbd84d38788` | 110 |
| `src/shared/tui-agent-resume-startup.ts` | `932908c5b5861516d825cbd74bc3e37fce5394cc8a454cb01ee815cb785d4a88` | 72 |
| `src/shared/tui-agent-startup.ts` | `a0f5d1bf9fbff7ca4eac9c12fce9131753d29abe949712cfd89755203c900521` | 271 |
| `src/shared/tui-agent-permissions.ts` | `7f151a5401daa5a9794e632764be6018db46cbe717d63d467b08b0e1283ba853` | 168 |
| `src/shared/tui-agent-launch-defaults.ts` | `99de3fd1f2b2ecee749244f6ebc3dbf7f77b417645c4ceec9b31550e35b1b6e8` | 105 |
| `src/shared/tui-agent-selection.ts` | `5cd27d5e949957989d45d986f6682304b9abb86d4a891fd05ff5d737e8ef2501` | 100 |
| `src/shared/agent-session-resume.ts` | `ebd386d6613f3d6251817039eff56c18e3bc4496dd6bd7cbc74322b9212442ae` | 296 |
| `src/shared/agent-session-option-catalog.ts` | `5f70bcd92353fbce4e742a19b35eab340ecfb5a4d9f73918431ea76ff4023956` | 96 |
| `src/shared/agent-session-option-catalog-types.ts` | `35703d295be6db560e244cc76bef5116aaacc450d983969df56d32aa34ccffa3` | 85 |
| `src/shared/claude-model-list-probe.ts` | `df75b839e486193dd1ef0c20e3d581e057de8b7ad5a56be186ee81a22042ac6c` | 125 |
| `src/renderer/src/lib/agent-catalog.tsx` | `671d1dc8a4c4af6370b7954f594f0dbc7e7e5a3b78fffa0e9de8d594303bfcb7` | 398 |
| `src/shared/agent-model-probe-spec.ts` | `5019f6fd14d9d660f16241ab802f2e171592db0c8da6964e7f9b52687526ef1c` | 31 |
| `src/shared/commit-message-agent-spec.ts` | `cbfdc45a83aeb8bba58ffc089cb1a4b109248b6f13c7feca735d94a5cb54464b` | 210 |
| `src/shared/commit-message-agent-specs-primary.ts` | `2187dcce69b191810ac924fe4acb74650981b804959280b0acc8e203a6faf41d` | 224 |
| `src/shared/commit-message-agent-specs-secondary.ts` | `ccef1ca470c68f9c5de3b07bc21a019a3c8aa76f5830dfa40ebe1b39861029e9` | 228 |
| `src/shared/grok-model-list-probe.ts` | `2e60fca4e03914f0f97732e971e99a6f2c122554be37b6bcfd1aef492b5c993b` | 45 |
| `src/main/text-generation/commit-message-model-discovery.ts` | `8b15eb7791dece1bfa6682a321e4cc1c58731f123b1b4d58f9668fd84f2922da` | 241 |
| `src/main/codex/codex-structured-session-options.ts` | `4d5608a335a589261d0e96c1449889f185943af3aa14758e5f482d06fac66742` | 204 |

## 10. Scope boundaries honored

- No agent binary was invoked; no CLI subprocess was spawned; no network call was made.
- The source hash manifest now lists 22 files after the model-probe correction; account/security/connectivity evidence remains directory-presence-only (claude-accounts/codex-accounts/grok-accounts), never a live-credential or live-connection check.
- No product/script/config/test file in this repository was edited; no install, no Git mutation, no nested worker/agent was spawned.
- This document owns exactly two files: `docs/migration/parity-harness-catalog.json` and `docs/migration/parity-harness-catalog.md`.
