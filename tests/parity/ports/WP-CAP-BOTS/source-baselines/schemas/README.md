# WP-CAP-BOTS bot-schemas source baseline

Source baseline for the original `bot-schemas.test.ts` suite, executed unchanged
against its exact source/dependency closure in a fresh, hash-verified capsule
stage. Source failure would be evidence here; the observed outcome is a full
pass, recorded without any modification to the source expectations.

## Pinning

- Source repo (read-only): `/Users/carlos/Documents/Drogon-mentu-session`
- Source revision: `c97906287bb7a390b25e2025b600d9fb3c25d9c3` (verified by the
  runner against both the working tree and `git show <rev>:<path>` blob bytes)
- Node: `v24.19.0` at `/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`
- Vitest: `4.1.11` at the pinned source entry
  `/Users/carlos/Documents/Drogon-mentu-session/node_modules/vitest/vitest.mjs`
  (source `package.json` devDependency `^4.1.11`)
- No installs, no services, no global/settings/credential changes.

## Exact executed command

Single stage+execute invocation of the reviewed capsule runner
(`scripts/run-parity-baseline-capsule.mjs`), from `/Users/carlos/Documents/Drogon-rewrite`:

```
/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  scripts/run-parity-baseline-capsule.mjs \
  --manifest tests/parity/ports/WP-CAP-BOTS/source-baselines/schemas/bot-schemas.source-baseline.json \
  --source-root /Users/carlos/Documents/Drogon-mentu-session \
  --label wp-cap-bots-schemas \
  --execute \
  --approved-manifest-sha256 fac50877e931e7db2f807ec708167b3ad4417303e589f2569fd2dd06ec0ba5cd \
  --node-bin /Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --vitest-entry /Users/carlos/Documents/Drogon-mentu-session/node_modules/vitest/vitest.mjs \
  --timeout-ms 60000
```

The approval digest is the sha256 of the exact manifest bytes:

```
shasum -a 256 tests/parity/ports/WP-CAP-BOTS/source-baselines/schemas/bot-schemas.source-baseline.json
# fac50877e931e7db2f807ec708167b3ad4417303e589f2569fd2dd06ec0ba5cd
```

The runner re-verified every staged file's bytes, the generated minimal
`vitest.config.mjs`, and the pinned transport package trees immediately before
execution, and refused to overwrite a pre-existing results path.

## Source file digests (sha256, pinned in the manifest)

| Path | Role | sha256 |
| --- | --- | --- |
| `src/main/ipc/bot-schemas.test.ts` | test | `ceeed197fc9ed3d6835a6d089d918f1140d7e6c94d142e0a8a3aae373ce284f6` |
| `src/main/ipc/bot-schemas.ts` | module | `6f3316eea51381dc341b772278a43afaa3f0c80d82fe092e27a355731b3f14d5` |
| `src/shared/drogon-bot-contract.ts` | module | `870600454e28b6f51ed73017b6c8d390f8bdc0ba3a0ed61509982c6cef7cfd66` |
| `src/shared/tui-agent-config.ts` | module | `192226db679f6241bc68a3093b4aac2e8922d11079beeb16cddc26698b4f1b7f` |
| `src/shared/orca-cli-command-name.ts` | module | `c90b037ec7a6143770a40dd907bf9d053fb2cede21128b60b78a78671c0780c0` |
| `src/shared/tui-agent.ts` | module (type-only) | `7c470c858ddc10988ea2b7e230d127a8d9bc70acf03e8dc8226d799749ce023b` |
| `src/shared/automations-types.ts` | module (type-only) | `ac7b60881d60f8bd777b56bacb99de3c3661ea26ed77cb8f233f8375956761e9` |
| `src/shared/mentu-run-contract.ts` | module (type-only) | `29a1ee32ef1352166322a1390c12191a38b37d3d6506afe0ea4c7d5e18ef4988` |
| `src/shared/worktree/create-types.ts` | module (type-only) | `f6052e0a1d84eb3f24a2a90e012ae0bef2de9026ba29d507dd0728ce7b30dbed` |
| `LICENSE` | license (MIT, (c) 2026 Lovecast Inc.) | `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3` |

## Dependency digests (staged as symlinks from source `node_modules`, pinned by version + full package-tree sha256)

| Package | Version | treeSha256 |
| --- | --- | --- |
| `zod` | `4.5.4` | `8675df81babc63b169f49743e654198f574342b364a9bf831eb39f4e881ba63f` |
| `ws` | `8.21.3` | `aad13c0d5b988c454b067e8f6d9d0e8ed938293ec60989a2207cf8614ef9a4a0` |
| `tweetnacl` | `1.0.3` | `79d76ce10a07a02d66cba99b0f11b00724e8095e0a5004ed62c8bc2f43183793` |

`zod` is the only external package imported by the executed suite. `ws` and
`tweetnacl` are staged solely because the reviewed transport package-runtime
helper requires its full pinned closure (`ws`, `tweetnacl`, optional `zod`) to
stage any package; they are never imported by the suite. No safe stand-ins or
mocks were used; no tested behavior was replaced.

## Outcome (full executed suite)

- Capsule stage: `/Users/carlos/Documents/Drogon-rewrite/.preflight/parity-baseline/wp-cap-bots-schemas-otoIL4` (retained as evidence fixture; nothing force-closed or deleted).
- Installed Vitest banner: `vitest/4.1.11 darwin-arm64 node-v24.19.0`.
- Exit code `0`, not timed out, `success: true`.
- Counts: `numTotalTests 3, numPassedTests 3, numFailedTests 0, numPendingTests 0, numTodoTests 0, numFailedTestSuites 0` — matches `expectedTestCounts {files: 1, tests: 3, plainIt: 3, tableRows: 0}`.
- Per-test outcomes, all `passed`:
  1. `Bot IPC schemas accepts a bounded Bot create payload with harness-default model policy`
  2. `Bot IPC schemas rejects unsupported harnesses and undeclared payload fields`
  3. `Bot IPC schemas validates responsibility trigger semantics at the IPC boundary`
- No failures, no setup blocks, no skips, no pending/todo.

Raw artifacts: `capsule-run-report.json` (runner report), `stage-receipt.json`
(staged-byte receipt), `vitest-results.json` (full Vitest JSON), and the
binding manifest `bot-schemas.source-baseline.json`.

## Limitations

- Pilot evidence for this single pinned suite only; does not establish the
  source project's full-suite status or rewrite parity.
- The capsule's intentionally minimal Vitest config (node environment, default
  timeouts, no source aliases/define/setup scripts) differs from
  `config/vitest.config.ts` in ways declared in the manifest; the closure uses
  none of the omitted facilities. Not full source-environment equivalence.
- Passing proves only the pure zod parsing contract at the IPC schema boundary;
  it does not exercise Electron IPC registration, main-process wiring,
  renderer behavior, persistence, scheduling or any live bot operation.
- Type-only import chains deeper than the staged boundary files are erased by
  the TypeScript transform and were neither staged nor typechecked.
- Execution approval is a caller-supplied manifest digest binding, not
  independent proof of human review.
