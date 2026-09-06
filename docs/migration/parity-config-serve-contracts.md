# Config / orca.yaml / serve Contracts (G7 reconciliation)

Leaf audit for task `task_1c98dab16afa`, dispatch `ctx_6ad197577366`, independently reviewed by the coordinator at rewrite `129598f`. Status: **bounded source contracts reviewed**; candidate runtime acceptance **unproven**; not audit closure.
Source: frozen `/Users/carlos/Documents/Drogon-mentu-session` @ `c97906287bb7a390b25e2025b600d9fb3c25d9c3` (read-only).33 unchanged original parser cases passed in two isolated capsules, no skips; no product edits. Detailed machine form: `parity-config-serve-contracts.json` v2 records23 direct source reads, precise partial bounds, test evidence tiers and remaining owners.
Non-substitutes honored: the accepted 234-command CLI registry and the G12 orcad five-option parser do **not** cover these contracts; `orca serve` is characterized from its own handler/launch/publishing sources.

## 1. orca.yaml — keys, defaults, validation

Parser `src/shared/orca-yaml.ts` (sha `fe76fd…f4413`, `parseOrcaYaml` L199-268); types `src/shared/orca-yaml-hook-types.ts` (sha `ba9726…0d10`); limits `orca-yaml-file-limit.ts` (sha `ed4f2d…6989`).

| Key | Type / default | Validation & behavior |
|---|---|---|
| `scripts.setup` / `scripts.archive` | string / absent | trimmed; blank→absent; >64 KiB (code units or UTF-8 bytes) field dropped |
| `setupAgentStartupPolicy` | `start-immediately\|wait-for-setup` / falls to shared default (`src/shared/constants.ts:199`) | other values dropped (L228-232) |
| `issueCommand` | string / absent | shared default command for linked GitHub issues |
| `defaultTabs` | `{title?,color?,command?}[]` / absent when empty | color `#rgb|#rrggbb` (L29); entry needs ≥1 valid field; >256 entries → list dropped |
| `environmentRecipes` | recipe[] / absent when empty | id `^[a-z0-9][a-z0-9._-]{0,63}$`; duplicate ids; `checkoutMode` orca-worktree\|provisioned-root; aliases `command`→`create`, `cleanup`→`destroy`, `destroy: none`→`destroyDisabled`; failures become non-fatal `{index,field?,message}` diagnostics |
| `worktree.sharedDirectories` | string[] / absent when empty | first100 input entries only, before validation/deduplication; `\`→`/`, `./`+trailing `/` stripped; absolute/drive/`..`/`.`/empty/`.git` dropped; entries still needing collapse (e.g. `apps/./web`) are **dropped, not rewritten** |

Normalization uses empty arrays internally but does not emit them. Invalid
checkoutMode can reserve an otherwise valid recipe id before a later duplicate
is checked. The actual shared startup default is `start-immediately`.

Global rules: file >256 KiB → null **before** YAML parse; YAML errors → null; non-mapping root → null; nothing usable → null (L243-254). Unknown top-level keys are ignored by the parser but detected by `hasUnrecognizedOrcaYamlKeys` (`src/main/hooks.ts:56-80`, recognized set: `scripts, setupAgentStartupPolicy, issueCommand, defaultTabs, environmentRecipes, worktree`) so the UI can suggest an update instead of "could not be parsed".

## 2. Precedence and defaults

- Loader `src/main/hooks.ts` (sha `58e251…682c`): `loadHooks` L34-46 reads `<repoPath>`/`<worktreePath>`/orca.yaml (worktree path overrides the read location, L82-85); any read error → null.
- Merge `src/main/effective-hook-config.ts` (sha `11434a…e7e5e`) + `src/shared/hook-command-source-policy.ts` (sha `cbd824…3016`), resolved **per hook** (setup and archive independently):
  - `local-only` → local Settings script only; `run-both` → yaml script then local script joined `\n`; `shared-only` → yaml only.
  - Policy unset **and** a local script exists → `local-only`; unknown legacy value → `shared-only` (treat removed shared-first mode as committed-config-only).
  - Both sides empty → null effective hooks.
- Setup decision: `shouldRunSetupForCreate` L64-78 — explicit `run`/`skip` wins; `inherit` uses repo `setupRunPolicy` (default `run-by-default`, `src/shared/constants.ts:195-205`); `ask` + inherit throws `Setup decision required for this repository`.
- `defaultTabs` commands run only when tab commands exist, policy ≠ `local-only`, and the setup decision allows it (`getDefaultTabsLaunch` L94-115); commandless tabs never need approval.
- Source discrepancy to preserve explicitly for intent/regression review: `run-both` with only local setup yields null from `getSetupCommandSource`, but the effective-hook merger keeps the local script. Do not silently equate these two functions.

## 3. Hooks authorization (content-hash trust)

- Trust content = trimmed `scripts.setup` plus `# defaultTabs[i] <title>` + command blocks joined `\n\n` (`getDefaultTabCommandTrustContent` L80-92); vmRecipe content renders each recipe's create/suspend/resume/destroy lines (`ensure-hooks-confirmed.ts:49-69`).
- Runtime supplies `setupTrust {contentHash: sha256, scriptContent}` for nonempty content unless RAW policy is explicitly `local-only`; it does not infer local-only from an unset policy plus local script.
- Renderer gate: repo-wide trust requires no duplicate repoId entries, not an explicit distinct-host calculation. Hash equality grants run; otherwise serialized modal, dismissal skip. Owner settings select the repository runtime instead of the focused runtime. Inspection errors fail closed. Cancellation checks occur at queue entry and around hashing; this source does not continuously cancel an already-open modal. Local-owned issue commands/resolved local-only bypass shared trust. Persistence and execution-call-site coverage remain owed.
- `runHook` is a policy-merged **executor, not an authorization gate**: it never checks a trust record or calls `ensureHooksConfirmed`. No script → `{success:true, output:''}`. Caller authorization must be preserved and tested separately.

## 4. Execution: platform / SSH / folder differences

- Local/WSL (`src/main/hooks.ts`): 120s timeout; Windows `ComSpec||cmd.exe` else `/bin/bash` (L21-27); under WSL, env UNC paths → Linux, shell pinned to **bash** (user-authored scripts; sh would fail bash-only hooks), only git prompt-guard flags + indexed git-config protocol reach the guest (#7652, L135-169); non-WSL `exec` with prompt-guard env blocking GCM prompts; conda-activation coherence drop (L192); timeout/exit≠0 → `success:false` with combined output.
- SSH methods differ: `getRepoHooks` collapses missing provider/any read error to no-file plus policy, and derives hasHooksFile from usable parsed hooks. `checkRepoHooks` reports missing provider as error, binary as ok/no-hooks, text-read success as hasHooks=true even if parsing returns null; ENOENT is ok and other errors are error. Do not collapse these response contracts.
- Folder repos: `checkRepoHooks` short-circuits ok/no-hooks; setup-import inspection returns [] (L73-75, L113-115).
- Remote archive hook (`src/main/ipc/worktrees/removal/worktree-archive-hook.ts`, sha `fb3f14…8819`): Windows remote runs `cmd.exe /d /s /c`, else `/bin/bash -lc`, 120s, via the SSH git provider; success = no spawn error, no timeout, exit 0; timeout/exit text appended to output.

## 5. `orca serve` — CLI handler, launch, publishing

- Spec `src/cli/specs/serve.ts` (sha `39842b…c6c1f`): `--port --pairing-address --mobile-pairing --no-pairing --project-root --recipe-json [--json]`.
- Handler `src/cli/handlers/core.ts:95-122` (sha `f89d4a…484df`): validation order = shared cross-flag checks (`src/shared/serve-option-validation.ts` sha `a7608c…600be` L10-24: pairing conflict; recipe-json needs runtime pairing and `--project-root`) → port integer 0-65535 (`Missing value for --port.` / `Invalid --port value: <raw>`; forwarded as string) → `serveOrcaApp(...)`; `process.exitCode` = returned code; the handler makes **no** runtime RPC.
- Launch `src/cli/runtime/launch.ts` (sha `90db4d…6771`): executable from `ORCA_APP_EXECUTABLE` or `ELECTRON_RUN_AS_NODE` exec path, else `runtime_serve_failed`; argv translated to `--serve*` form; **recipe-json process lifetime**: detached spawn, stdout piped, 60s wait (`Timed out waiting for recipe JSON.` + SIGTERM), only `orca-server`-connection recipe lines re-printed, nonempty rejected stdout lines emit only `[serve] ignored non-recipe stdout` on stderr; blank lines are silent, exit-before-JSON → `runtime_serve_failed`, then `unref` — **the CLI exits 0 and the headless server keeps running**. Foreground mode: inherited stdio (plus IPC for mac app-bundle update handoff), supervised by `serve-update-supervisor.ts` (sha `3cd094…7de15`) for the child's lifetime.
- Main-side argv: `serve-mode-argv.ts` (sha `6c84e4…bd1c`) — help refusal stops `serve --help` from binding a pairing-on server; option values named `serve` never read as the subcommand; `--no-pairing=false` passes through untranslated (#12677: CLI reads booleans `=== true`).
- Main-side options: `serve-options.ts` (sha `6e4a28…d245`) — everything after `--` ignored; **last occurrence wins** for value flags (equals-form supported); booleans: last occurrence wins; equals-form sets false; port 0-65535; same shared validation; security-typo detector rejects only near-miss pairing flags, Chromium switches stay open.
- Readiness/publishing: `main-process-serve.ts` (sha `0e4dbf…a8ccc`) — recipe-json requires absolute existing directory; advertised endpoint changes only the client-advertised address; `--no-pairing` → `disabled_by_operator` + restart guidance; mobile scope renders terminal QR (dynamic import can reject; rendering retries utf8 before null); publication is one-shot (`ServeReadinessPublisher`, second publish throws). Output `src/main/server/serve-readiness.ts` (sha `c46105…b701e`): recipe-json = single-line `{schemaVersion:1, pairingCode, projectRoot}`; json = `orca_server_ready` envelope (+ optional `health`, absence = "not reported", never healthy); human = ready/bound/advertised + daemon PTY self-test + web-client URL + QR + pairing URL or unavailable/guidance; `managedWslCliReconciliation: 'pending'` is a JSON field; its source comment warns of a repair race, but human output has no pending warning.

## 6. Test evidence — separate coordinator execution from leaf claims

Coordinator fully read and executed only `serve-mode-argv.test.ts` (17cases)
and `serve-options.test.ts` (16cases), with their full pure dependency closure.
Evidence: `reference-captures/c9790628-serve-mode-argv/README.md` and
`reference-captures/c9790628-serve-options/README.md`. The exhaustive argv test
checks22621 inputs inside ONE case. All other body summaries below remain
leaf-reported, hash-verified pointers, not independently reviewed assertions.

- `src/cli/index-serve-command.test.ts` (sha `922c3c…31035`): exact `serveOrcaApp` payloads (port as string `'6768'`, booleans, projectRoot null vs path) L56-119; pre-launch rejections with exit 1 L121-202.
- `src/main/startup/serve-options.test.ts` (sha `42a715…cd307`): full-parse, equals-form, last-occurrence-wins, final-occurrence invalid, mixed boolean aliases (`--no-pairing=false` after bare flag → false and vice versa), `--json=false` still json, pairing-address value `--no-pairng` accepted, shared validation, typo vs Chromium switches, post-`--` ignored, port required (incl. `''`).
- `src/main/startup/serve-mode-argv.test.ts` (sha `670bca…a617`): #12677 `=false` passthrough; help refusal (`serve --project-root help` is a path, not help); real GUI argv untouched; CLI→`--serve*` rewrite; `=value` split; mixed form; one-directional value-skip property.
- `src/main/hooks-orca-yaml-parsing.test.ts` (sha `dbae8b…a16e`): payload `toEqual` cases for setup/archive/issueCommand/tabs/recipes/sharedDirectories, diagnostics, null shapes, unrecognized-key regex cases.
- `src/main/hooks-effective-hook-resolution.test.ts` (sha `48a7aa…7d76a`): full precedence table incl. worktree-path override, legacy fallback only when yaml missing, run-both join order, per-hook split, ask-throw, decision-override, local-only tab-command block.
- `src/shared/orca-yaml-bounds.test.ts` (sha `1d1b47…b869`) + `orca-yaml-alias-bounds.test.ts` (sha `9f1193…0d27`): exact-boundary/+1 for bytes, fields (code units and UTF-8), 256 entries, alias multiplication cap.
- Declaration-only (help text/comments, no executed assertions cited): serve spec notes; WSL/Windows hook-run branches and remote archive branches recorded from source + issue references (#7652, #11960 context).

## 7. Bounded test-port candidates (candidate ports not executed here)

1. `parseOrcaYaml` pure parser table + size/alias bounds (shared module, no mocks beyond `yaml`).
2. Effective-hook precedence table (`getEffectiveHooksFromConfig`, `getSetupCommandSource`, `shouldRunSetupForCreate`, `getDefaultTabsLaunch`) with fs mocks.
3. `getServeOptions` / `normalizeServeModeArgv` pure argv cases (last-occurrence, `=false`, terminator, typo, help refusal, GUI argv).
4. CLI serve handler payload/rejection cases via the existing index test harness (mock `serveOrcaApp`).
5. `waitForRecipeJson` line classification behind a fake child stdout stream (bounded unit).

## 8. Unknowns (owned followups, not absence claims)

- U1 / WP-ENG-CLI + WP-ENG-INSTALL: supervisor body/closure now independently reviewed in `parity-serve-supervisor-contracts.json`;12 unchanged original signal/late-write cases passed. Four replacement assertions read, not executed. Full launch baseline, updater producer/readiness sender, installed/launchd/real-signal and candidate/skew tests remain.
- U2 / WP-SUP-CONFIG + WP-UI-SETTINGS: trust persistence/restart and execution caller authorization, including host/cancellation boundaries.
- U3 / WP-SUP-CONFIG + WP-ENG-CLI: setup env/worktree consumption and the getSetupCommandSource discrepancy above.
- U4 / WP-SUP-CONFIG coordinated with G8: build-time config entrypoints remain required. No user clarification or scope reduction is needed.

## Coordinator corrections to the serve summary

- Blank recipe stdout lines are ignored silently; only nonempty invalid/non-orca-server lines emit the fixed stderr marker. The raw line is never logged. Success destroys stdout/removes listeners/unrefs; no live child was launched by this review.
- Foreground IPC stdio is conditional on the mac app-bundle update handoff; other foreground launches inherit stdio without IPC.
- Only port's missing value directly throws in `valueAfter`; missing pairing-address/project-root is null, with recipe prerequisites checked separately. Boolean aliases use the LAST occurrence; every equals-form string is false. The source test title claiming equals-form values cannot be read is stale; the implementation and original options tests explicitly accept them.
- Dynamic QR import happens outside the rendering try/catch and can reject; only rendering errors get utf8/null fallback.
- `managedWslCliReconciliation: pending` is in JSON with a source warning comment, not a human-output warning. `renderServeReadiness` checks pairing availability for recipe JSON, not its scope; earlier option validation carries runtime-scope prerequisites.
