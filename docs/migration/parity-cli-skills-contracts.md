# Skills CLI: six source contracts

Coordinator-reviewed static characterization at frozen source
`c97906287bb7a390b25e2025b600d9fb3c25d9c3`; companion
`parity-cli-skills-contracts.json` schema v2 records full SHA256 hashes,
anchors, exact argv and test declarations. **No command, original test,
skill discovery/install/share or cloud request was executed.**

The accepted parser and skill/provider census are reused, not repeated.
Global flags remain help/json/pairing-code/environment. Selection `--skill`
is repeatable; `--agent` is a single CSV value, not repeatable.

| Command | Source contract | Output / effect |
|---|---|---|
| `installed` | Rejects nonempty ORCA_CLI_CWD **or** remote client before discovery; invokes skills.discover with cwd. | JSON preserves RPC envelope with result.skills containing public summary fields, not local paths; text summaries or empty message. |
| `share` | Same host refusal; requires explicit selectors and normalized bundle name; release notes default empty. CLI preflight rejects explicit false but tolerates missing settings / read failure. Runtime requires explicit true, rechecks before publish and rejects concurrent publishing. | No dry-run. Requests an unlisted share; JSON RPC envelope contains public result fields; text pluralizes skill(s). Authentication outcomes translated; method_not_found becomes update_required. Timeout600000ms. |
| `list` | Local lazy bundled table, sorted by canonical name; descriptions whitespace-normalized. | Direct JSON {topics} or name:description lines; no runtime client. |
| `get` / `show` | Topic positional or --topic; canonical and guide-alias lookup. Missing/unknown topic fails with available topics. --full uses flag presence. | Direct JSON {name,full,markdown} or Markdown; no runtime client. |
| `install` | No selection lists bundled names before host checks. Selection is --all xor repeatable --skill, aliases deduplicated/sorted. Refuses ORCA_CLI_CWD with selection even in dry-run; does not inspect client.isRemote. Explicit valid agent CSV avoids detection; otherwise host-detected agents are required. Global default; --local removes --global. | Resolves npx and delegates selected installation to community skills CLI. Dry-run resolves agents and emits direct JSON {command,skills,global,executed:false} or command text. Real --json rejected; child stdio inherited, status stderr, exit forwarded. |
| `update` | Same selection/forwarding behavior; no agent detection or --agent flag. Global default; --local becomes explicit --project. | Delegates update to community CLI. No-selection lists **all bundled names**, not an installed/updatable scan. Same dry-run/JSON/streaming rules. |

## Exact child argv and formatting boundaries

`src/shared/agent-feature-install-commands.ts:21-63,67-84` and
`src/cli/handlers/skills.ts:222-240` build:

- Install: npx --yes skills add [original repository URL] followed by one
  --skill per selected name, optional --global, one --agent per target, -y.
- Update: npx --yes skills update [selected names] followed by
  --global **or --project**, then -y.

The original upstream repository constant is provenance, **not authority
to copy a cloud/updater/install destination into Drogon**. External skills
CLI downloading/placement/refresh behavior remains an integration obligation.

Installed/share retain id/ok/result/_meta through printResult
(`src/cli/format.ts:74-84`). Their result objects do not have screenshotStatus,
so the formatter early-returns the same envelope
(`src/cli/computer-format.ts:57-69`). This differs from local list/get and
mutation-preview handlers, which write direct JSON without that envelope.

## Publication authority

The CLI settings preflight is compatibility-tolerant
(`handlers/skill-sharing.ts:53-70`); it is not the authoritative default-off
gate. `shared/agent-skill-sharing-gate.ts:24-34` requires exactly true.
`main/runtime/runtime-skill-command-surface.ts:46-147` checks before
preparation and again before publish, tracks a single in-progress share,
and disposes preparation state in finally. Deeper discovery, selection,
archive and upload internals are outside this six-handler slice.

Bundle normalization is source-defined in `shared/skill-bundle-name.ts:1-13`:
NFKD, remove U+0300–036F marks, en-US lowercase, replace disallowed runs,
collapse/trim hyphen/dot runs, truncate64, trim trailing punctuation;
empty result rejected. The spec describes an unlisted link accessible to
anyone holding it; nothing was actually published.

## Original test obligations — static count, not PASS

Coordinator AST enumeration expands literal tables:

- `src/cli/skills.test.ts`: 46 direct declarations + two tables of3 =52 cases.
- `src/cli/handlers/skill-sharing.test.ts`: 6 direct + one table of2 =8 cases.
- `src/cli/specs/skills.test.ts`: 1 case.
- **61 statically enumerable cases; zero executed in this audit.**

The JSON preserves all56 declaration titles/anchors. Table expansion
corrects the worker's incomplete 46+6+1 count. Source execution, original
assertions preserved in candidate tests, and safe fixture integration
remain owed. Runtime resolution/PATH/probe effects and dispatch mechanics
need their existing owning contracts; previously accepted guide bytes and
mapping tables are not relabeled unknown.
