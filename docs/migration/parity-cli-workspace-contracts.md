# CLI Workspace Contracts — repo / worktree / project setup-existing-folder (13 commands)

Coordinator-reviewed bounded CLI source contracts (v2), from Task `task_a3b252be24ff`, dispatch `ctx_7ff13cf9a6a1`. Not runtime or full-test acceptance.
Source: frozen `/Users/carlos/Documents/Drogon-mentu-session` @ `c97906287bb7a390b25e2025b600d9fb3c25d9c3` (head verified). No source executed, no mutations, original tests **not executed** (recorded). Canonical names reconciled against `parity-source-contracts.json` (13/13 matched); parser contract reused from `parity-cli-argument-contract.json`. Detailed machine form: `parity-cli-workspace-contracts.json`.

## Shared contracts (all 13 commands)

- Registration: `src/cli/handler-group-manifest.ts` (sha `20e594…b2a77`) — repo keys L62-66, worktree L67-79, project L49-61.
- Flag validation: `src/cli/args.ts` (sha `3d6362…e8e77`) `validateCommandAndFlags` L230-262 — unknown command / `Unknown flag --<f> for command: <path>` / global value flags need values. Parser L36-79: `=`-form splits on first `=`; non-boolean flag consumes next non-`--` token.
- Flag helpers: `src/cli/flags.ts` (sha `c7bf17…cb83`) — required string L5-11 (`Missing required --<n>`), optional string L24-30 (non-string/empty→absent; whitespace preserved), finite number L62-75 (zero/negative/fraction accepted), positive-integer L77-89, nullable-number (exact `'null'`→clears) L129-138.
- Worktree selectors: `src/cli/selectors.ts` (sha `c3627f…a0cc5`) — `active`/`current`→cwd path L32-37; WSL path rewrite L46-78; remote rejects cwd shortcuts L92-102; `resolveCurrentWorktreeSelector` L104-140 lists `{limit:10000}`, deepest enclosing worktree, returns concrete `id:<id>`.
- Remote path rule: `src/cli/repo-path-arguments.ts` (sha `93d99e…06f96`) L13-31 — local→`resolve(cwd,p)`; remote→absolute server path only (`/`, `C:\`, `\\`, `//`), else `…requires --path to be an absolute path on the remote server.`
- Host flag: `src/cli/execution-host-flag.ts` (sha `0c000c…6eb9e`) — parse L28-46 (`local | ssh:<target-id> | runtime:<environment-id>`); ssh label→id resolution L130-148; runtime: filter also matches `local`-stamped rows L115-124.
- Listing scope: `src/cli/omitted-host-scope-selectors.ts` (sha `f7ff76…5ec3`) — `annotateOmittedHostScope` L117-126 (no-op when nothing omitted); `scope: unverifiable` when host reports none L95-114; answers selectability, never liveness. Required by `docs/reference/ssh-execution-boundary.md` (sha `eb6616…38b2`) L96-97: a listing names its gaps; empty ≠ nothing elsewhere.
- Output: `printResult` (`src/cli/format.ts` sha `a4ba26…9fe43`) L74-84 — `--json` prints the full RPC envelope; text prints formatter result. Worktree/repo formatters: `src/cli/workspace-format.ts` (sha `ac51e8…fef42`).

Parser nuance in scope: `--no-parent` and `--activate` are **not** in `CLI_BOOLEAN_FLAGS`; bare `--no-parent --json` parses true, but `--no-parent id:x` stores a string and the handler's `=== true` check reads false (`worktree.ts:221,292`). `--force`, `--run-hooks`, `--json` are boolean.

## Command contracts (exact 13)

| # | Command | Handler (file:lines) | RPC | Required flags | Key optional / validation |
|---|---|---|---|---|---|
| 1 | `repo list` | repo.ts:8-11 | `repo.list` (no params argument) | – | none |
| 2 | `repo add` | repo.ts:12-18 | `repo.add` `{path}` | `--path` | remote→absolute server path, subject `Remote repo add` |
| 3 | `repo show` | repo.ts:19-24 | `repo.show` `{repo}` | `--repo` | selector passed verbatim |
| 4 | `repo set-base-ref` | repo.ts:25-31 | `repo.setBaseRef` `{repo,ref}` | `--repo --ref` | repo-level default base ref (not per-worktree, not lineage) |
| 5 | `repo search-refs` | repo.ts:32-39 | `repo.searchRefs` `{repo,query,limit?}` | `--repo --query` | `--limit` positive int |
| 6 | `worktree list` | worktree.ts:185-195 | `worktree.list` `{repo?,limit?}` | – | hostScope annotation post-RPC |
| 7 | `worktree show` | worktree.ts:196-201 | `worktree.show` `{worktree}` | `--worktree` | selector normalization + WSL rewrite |
| 8 | `worktree current` | worktree.ts:202-207 | `worktree.show` (cwd-resolved) | – | local-only; remote rejected pre-RPC |
| 9 | `worktree create` | worktree.ts:208-278 | `worktree.create` (large payload) | `--name` | see branching below |
| 10 | `worktree set` | worktree.ts:279-295 | `worktree.set` | `--worktree` | `--linear-issue null` clears; parent conflict checks |
| 11 | `worktree rm` (aliases remove/delete, destructive) | worktree.ts:296-319 | `worktree.show` → `worktree.rm` | `--worktree` | `--force` (also sets `allowUnverifiedPtyStop`), `--run-hooks` |
| 12 | `worktree ps` | worktree.ts:177-184 | `worktree.ps` `{limit?}` | – | hostScope annotation |
| 13 | `project setup-existing-folder` | project.ts:112-131 | `projectHostSetup.setupExistingFolder` | `--project --host --path` | `--kind git\|folder`, `--display-name`; ssh hosts count as off-client |

### worktree create — resolution order, conflicts, distinctions

- Repo target (`getCreateRepoSelector`, worktree.ts:153-174 + `worktree-project-target.ts` sha `e14c97…2616f`): ① project target (ready setup by `--project-host-setup`, or `--project`+`--host` with exact `runtime:<id>` row winning) → `id:<setup.repoId>`; ② `--repo` verbatim; ③ inferred from cwd parent `id:` prefix (L141-151); else `Missing repo selector…`.
- Conflicts (all pre-RPC): `--parent-worktree`+`--no-parent` → `Choose either one parent selector or --no-parent.` (`worktree-create-parent-selector.ts` sha `4bd777…8cff3` L13-24); `--repo`+project flags → `Choose either --repo or project target flags, not both.`; `--host` alone → `--host requires --project unless --project-host-setup is provided.`; `--prompt` without `--agent`; unknown TUI agent; bare `--agent/--prompt/--setup` → `Missing value for --<f>`; `--run-hooks`+`--setup ≠ run` → contradictory.
- Lineage channels kept separate: explicit `parentWorktree` vs workspace keys (`folder:`/`worktree:`) routed to `parentWorkspace` (incl. `id:`-prefixed and `active`/`current` resolving to a folder workspace); `envParentWorkspace` from `ORCA_WORKSPACE_ID`/`ORCA_WORKTREE_ID`. `--no-parent` suppresses inferred lineage, but cwd lookup still runs when no repo/project target was supplied and repo inference is needed. Lookup failure is caught. The original no-parent test supplies `--repo`; its one-RPC assertion does not cover repo omission.
- Distinctions: `--base-branch` = Git base ref of the new checkout; `--no-parent`/`--parent-worktree` = lineage metadata only (spec note L120); `--setup run|skip|inherit` = repo setup-hook decision; `--run-hooks` = legacy alias that also activates. `activate` ⇒ `navigation:'all'` (CLI is a device, not a viewer, L255-257). `cliProvenanceRequest` always sent; `callerTerminalHandle` from `ORCA_TERMINAL_HANDLE`. Post-output: stderr hook warning + lineage summary (`worktree-lineage-summary.ts` sha `35f12d…fb9e8`), suppressed under `--json`.

### project setup-existing-folder — semantics

- Host id kept **unresolved** on purpose (project.ts:71-80 comment): runtime rejects every `ssh:` host for setup regardless of id validity; `--host` absent → `Missing required --host`.
- Off-client test: `client.isRemote || hostId is ssh:*` (L117) — relative `--path` rejected against both remote runtimes and ssh hosts; subject `Remote project setup`.
- Version gate: `callProjectHostSetup` (L38-58) maps `method_not_found` → `incompatible_runtime` ("does not support project host setup yet").
- This imports-and-manages a real checkout now (vs `project setup-create` metadata-only, spec note L83). Sets no base ref, no lineage.

## Output shapes (text; `--json` always full envelope)

- Repo list: `No repos found.` | `<id>  <displayName>  <path>` rows. Repo show/set-base-ref: `key: value` dump. search-refs: refs | +`truncated: yes`.
- Worktree list/ps: rows + trailing `scope:` line; `host=<id|unverifiable>`; truncated → `truncated: showing N of M`. ps rows: `live:<n>  pty:…  unread:…`. Show: `key: value` dump. rm: `removed: <bool>` + stderr preserved-branch/hook warnings.

## Located test evidence (leaf-reported bodies; independent subset below)

- `src/cli/index-project-setup.test.ts` (sha `44f825…ab0fd`): repo.add cwd resolve L58-76; remote relative reject L515-532; absolute passthrough incl. `C:\`, UNC it.each L534-581; setup-existing-folder local payload L389-452, remote/ssh relative rejects L454-513; `incompatible_runtime` gate L196-214; malformed `--host` L353-367.
- `src/cli/index-worktree-create-parent.test.ts` (sha `08ed55…25d855`): explicit/branch/workspace-key/current parents L58-396; conflicts L398-489; runtime lineage failure passthrough L491-553; `--no-parent` skip L555-588.
- `src/cli/index-worktree-create-target.test.ts` (sha `9aca03…f910df`): activate+navigation L57-89; project/host→repo L91-164; setup-id L166-212; repo+project conflict L214-241; caller handle + provenance L243-305.
- `src/cli/index-worktree-create-agent.test.ts` (sha `80b64e…2a5f`): run-hooks alias L57-91; agent background L93-143; repo inference L145-192; all validation errors L194-318.
- `src/cli/index-worktree-create-linear.test.ts` (sha `759470…a35363`): URL/bare-id payloads L57-160; null/invalid/missing rejects L162-249.
- `src/cli/index-worktree-set.test.ts` (sha `197495…abb694`): active/parent/current/no-parent/linear-url/linear-null/invalid/status payloads L57-393.
- `src/cli/index-worktree-selector-resolution.test.ts` (sha `34ac5a…531bd9`): current/show resolution + ORCA_CLI_CWD + remote rejection L58-276.
- `src/cli/index-omitted-host-scope-selectors.test.ts` (sha `f884fc…d34cc2`): worktree list scope line/truncation L200-232; ps `scope: unverifiable` L234-245; selector resolution/no-extra-RPC L73-187.
- `src/cli/index.test.ts` (sha `8f2691…9c3e829d6d8db`): rm aliases + force + host fail-closed L91-136; unknown flag/command for worktree list L213-229.
- `src/cli/format.test.ts` (sha `08051f…a6700`): formatWorktreeList parent/child lines L154-177.
- `src/cli/worktree-selector-wsl-posix-path.test.ts` (sha `659581…92c0`): WSL translation rules shared by show/rm L40-129.
- Server-side pointer only (not CLI coverage): `src/main/runtime/rpc/methods/repo.test.ts` (sha `722633…b46e1`) — searchRefs limit clamp L14+, repo.show CLI-compatible shape L200-211, repo.list visibility projection L48-61.

## Gaps (explicit, with next source pointers)

- `repo list` / `repo show` / `repo set-base-ref` / `repo search-refs`: no CLI-level test found in this audit's read of `src/cli` test files (call payload, flag errors, formatter output untested). Next pointer: `src/cli/handlers/repo.ts:8-39`, `src/cli/workspace-format.ts:151-172`; server-side behavior referenced above.
- worktree list/ps: `--repo`/`--limit` passthrough unasserted (pointer `worktree.ts:177-195`).
- worktree set: `--display-name`, `--issue` (incl. `'null'` clear via `flags.ts:129-138`) unasserted (pointer `worktree.ts:284-293`).
- worktree rm: `--run-hooks`, warning printers, `removed:` line unasserted (pointer `worktree.ts:296-319`).
- worktree create: `--base-branch`, `--issue`, `--comment` non-default values, `ORCA_WORKTREE_ID` env branch (`worktree.ts:86-89`), `--setup skip|inherit` success path, `startupPrompt` allowEmpty (`worktree.ts:271`) unasserted.
- setup-existing-folder: invalid `--kind`, missing-required-flag errors, formatter output, and the `incompatible_runtime` mapping exercised directly through this command unasserted (pointer `project.ts:82-91,112-131`).

## Coordinator corrections and acceptance boundary

Read all13 requested CLI handler bodies and their relevant flag/selector,
parent/project, host-scope and output paths; independently checked31 structured
source fingerprints. This accepts bounded source contracts, not server-side
effects or every leaf-reported test assertion. Independently read test bodies:
parent:555–588; create-agent:57–192; index:91–136; project-setup:389–452.
Other test summaries above remain located leaf evidence, not execution or
independent full-body acceptance; search gaps are not global absence claims.

Additional source distinctions: empty-string prompt with a valid agent is
allowed, while a bare prompt is rejected; create/set parent conflict messages
differ. Linear clearing trims/lowercases `null`; numeric issue clearing does
not. Create prints hook warning, then warning-array entries, then workspace
lineage (preferred) or worktree lineage, then the result. JSON suppresses
those stderr summaries. `printResult` first applies the computer-screenshot
transformer; ordinary repo/workspace envelopes have no screenshotStatus and
are returned unchanged. These paths were read, not invoked against user state.

E4 remains open for the other CLI families, passthrough/routing and actual
dual-target tests. Do not repeat the shared parser or these13 handler traces.
