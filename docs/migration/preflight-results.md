# Environment and execution preflight — 2026-09-05

## Outcome

The old repository was renamed without deleting its history. The new public, independent repository is bootstrapped. Three real development agents completed scoped artifact tasks through Orca orchestration, and the coordinator independently reran all three verifiers successfully. No product rewrite or Mentu benchmark was executed.

## Repository identities

| Role | Repository | GitHub ID | Verified state |
| --- | --- | --- | --- |
| Previous implementation | [clioo/drogon-orca](https://github.com/clioo/drogon-orca) | 1357520197 | Public fork; history and merged PR1 preserved |
| Rewrite | [clioo/drogon](https://github.com/clioo/drogon) | 1358475089 | Public, independent (`fork: false`), default branch `main` |

The rewrite checkout is `/Users/carlos/Documents/Drogon-rewrite`; its origin is `git@github.com:clioo/drogon.git`. Initial bootstrap commit: `cda3342af538a1427cd3a590fb168b57d547466a`.

The old worktree paths remain unchanged. Their shared origin now points to `git@github.com:clioo/drogon-orca.git`. Reference main is `34ae1a1c926fd1ce1f174f7c6ef2f65e0a0c4168`; the implementation handoff checkout is `/Users/carlos/Documents/Drogon-mentu-session` at `c97906287bb7a390b25e2025b600d9fb3c25d9c3`.

**Privacy is still pending:** GitHub does not permit changing a public fork directly to private. The old repo must be detached from its fork network first through a supported route. No deletion/recreation or private-copy workaround was performed. The user was informed; do not describe the old repo as private.

## Orchestration evidence

Orca version: `1.4.197`. New registered repo ID: `a8600e26-85de-4a2e-9837-82fd47a9fc57`; project identity: `github:clioo/drogon`.

Run: `run_c002d292fa7e`. Coordinator: `term_fa0de916-26da-4394-ba54-86a2ab8597e7` (plain shell, not another model).

| Lane | Explicit model, also observed in harness UI | Task | Successful dispatch | Independent verification |
| --- | --- | --- | --- | --- |
| AGY | `gemini-3.8-flash-medium` | `task_374717f83d50` | `ctx_d082d7e6b652` | PASS |
| Claude Code | `claude-sonnet-5`, medium | `task_394b73317e54` | `ctx_4831b41aba86` | PASS |
| OpenCode | `zai-coding-plan/glm-5.3-flash` | `task_fdb365d98b9c` | `ctx_722fb71bdb47` | PASS |

Each leaf worker read its own challenge, computed a sorted distinct list, a sum including duplicates, and the SHA-256 of the exact input bytes; wrote the five-field JSON artifact; ran the frozen verifier; and sent a real `worker_done` with its Task/Dispatch IDs and report path. No nested agents were requested. All artifact outputs were under disjoint, ignored `.preflight/<lane>/` paths.

| Lane | Input values | Distinct sorted output | Sum | Input SHA-256 |
| --- | --- | --- | --- | --- |
| AGY | 19, 4, 23, 4, 11 | 4, 11, 19, 23 | 61 | `f38a6cc73bdd59c13e81541a01976f51380e52843093570740daf738e1927ecb` |
| Sonnet | 20, 4, 23, 4, 10 | 4, 10, 20, 23 | 61 | `5f30d254549d21b78c6c92f3815fcd60bd4b77d681207d7249389d28875cc12e` |
| GLM | 21, 4, 23, 4, 9 | 4, 9, 21, 23 | 61 | `1f3e51525ee7e7ae3cfb6ad303e8952c17d69c3eaffc76fc35959d4b3ecce58b` |

Coordinator verification: `node scripts/verify-preflight.mjs agy`, `sonnet`, and `glm` each returned `status: PASSED`, exit 0. Tracked source remained unchanged after worker execution (`git diff --exit-code` succeeded and `git status --short` was empty before this report). Raw local artifacts are intentionally not published.

AGY additionally exercised blocking ask/reply: question `msg_761f58089880` asked whether duplicates count in the sum; coordinator reply `msg_56bb5eeadfc7` confirmed that they do. The reply was delivered and the resulting artifact followed it.

Completion messages: AGY `msg_dec1597223a1`, Sonnet `msg_33b9860b4d95`, GLM `msg_77b710b12d19`. Deliveries were processed and acknowledged after review.

Model evidence is explicit invocation plus observed provider UI, not a claim about upstream weights or billing. Claude supported structured transcript reads; AGY/OpenCode used terminal fallback (`provider_unsupported`). Pre-created-terminal launch receipts did not themselves prove the model selection.

## Failures and cleanup

- AGY dispatches `ctx_60a7638d16bd` and `ctx_91232be6e5d2` failed readiness. A workspace trust prompt, then stale trust-prompt text in the stream, prevented readiness recognition. After accepting trust for this new checkout and closing the failed terminal, a fresh exact-model terminal passed. Failed records were preserved.
- Claude dispatch `ctx_d89ab725523a` failed input delivery (`agent_prompt_stalled`) during workspace trust handling. It was released; a new terminal with explicit model/effort and confirmed workspace trust passed.
- Completed custom terminals were retained by `worker-release` as `external_terminal`, not claimed as automatically closed. The coordinator then closed only its three identified worker terminals; each close reported `ptyKilled: true`. The coordinator shell remains available.
- One `worker-release` invocation with unsupported `--run/--from` flags was rejected and corrected; no success was inferred from that rejection.

These startup failures are real evidence, but do not replace the planned controlled task-failure, cancellation, or duplicate-delivery tests.

## Future launch policy requested by the user

Installed CLI help confirmed these per-invocation options:

```sh
agy --model gemini-3.8-flash-medium --dangerously-skip-permissions
claude --model claude-sonnet-5 --effort medium --dangerously-skip-permissions
opencode --model zai-coding-plan/glm-5.3-flash --auto
```

OpenCode's `--auto` approves permissions not explicitly denied; it is not the identical flag or a bypass of explicit denies. Keep model selection, worker ownership, no-nesting, and Task/Dispatch reporting intact. Do not change global permission defaults. These options are the policy for **future** launches; the completed smoke was not rerun with them, and existing permission prompts were handled during that smoke.

Create the terminal in the exact rewrite workspace, then attach using `worker-start --terminal`; do not combine `--terminal` with `--model`. Inspect the actual launch and readiness instead of assuming the argument was accepted.

## Remaining gates

1. Complete P0 controlled failure, cancellation, and duplicate-delivery checks on disposable, owned work only. Workspace trust behavior also needs a repeatable unattended-launch check.
2. Resolve old-repository detachment/privacy without losing history.
3. Freeze the capability/provenance inventory and versioned protocol; create the Rust/Electron skeleton and CI.
4. Prove one real vertical slice through Electron and `drogon-cli`, including process ownership, persistence, reconnection and exact cancellation, before broad feature migration.
5. Continue the planned parallel waves and cross-platform/SSH acceptance. No claim of rewritten product availability or Orca feature parity is made by this smoke.
6. After migration, resume the existing Mentu/Bots/Meetings handoff. Mentu comparisons remain exclusively Pi + DGX Spark; the three development harnesses do not change that requirement.
