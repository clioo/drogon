# Drogon engineering specification

This English specification consolidates the recorded goals, subsequent scope
decisions, and implemented acceptance criteria. It was assembled for submission on
September 13, 2026. The implementation references below describe the documentation
branch's product baseline, [8c9f3550](https://github.com/clioo/drogon/commit/8c9f3550f539046c18c2d86144eee84828a33f7b).
Development process and iteration evidence are in [SYSTEM.md](SYSTEM.md) and
[AI-DEV-LOG.md](AI-DEV-LOG.md).

## Specification provenance

The project had written intent before its first substantial implementation wave:

| Recorded artifact | What it established | Chronology |
| --- | --- | --- |
| [Approved goal, c6189dac](https://github.com/clioo/drogon/commit/c6189dac9b9ec5d6d2eff30be2639a8a935db9df) | Independent Rust core, service and CLI; Electron/React desktop; licensing; coordinator ownership; three scoped worker lanes; lifecycle and rendered acceptance before expansion. | September 5, 19:10:59 UTC. It explicitly records that product implementation had not started at activation. |
| [Protocol and desktop implementation, c3eb8802](https://github.com/clioo/drogon/commit/c3eb8802a8a1731fce0f5bd37e14531a1eeb2373) | Execution contract, desktop client and foundation acceptance. | September 5, 19:56:20 UTC, after the approved goal. |
| [Initial scope plan, PR #16](https://github.com/clioo/drogon/pull/16) | Twelve journeys, explicit exclusions, architecture dependencies, four implementation waves, owners and validation gates. Its initial status table marks the upcoming journeys pending. | September 7, 18:19:24 UTC. This refined an existing foundation; it was not the start of all development. |

The source planning record was later retired from the product tree. This document
keeps an English summary of the scope that was recorded at that time; it does not
restore a retired plan or impose a separate architecture on the shipped product.

## Objective and intended user

Build a desktop workspace for a developer who needs persistent coding sessions,
parallel Git worktrees, coordinated agents, and recurring follow-up work in one
place. The builder previously split those activities between Orca, Codex quick
chats, and Hermes bots. Drogon should make the task, its execution context, and its
review evidence accessible together.

The workflow is: select a project, create an isolated workspace, give an agent a
task and execution policy, inspect progress and failures, and review the resulting
changes. Bots add monitored and scheduled entry points into that workflow.

## Requirements and acceptance evidence

These are behavioral criteria with links to existing tests and implementation.
Test existence is traceability; historical passing results are recorded separately
in the linked PRs and development log.

| Requirement | Acceptance criterion | Implementation and tests |
| --- | --- | --- |
| Projects and worktrees | A repo or folder becomes a project; worktrees have distinct workspace identities and changes do not switch another worker's checkout. | [Project implementation](../crates/drogon-core/src/project.rs), [project/worktree tests](../crates/drogon-core/tests/project_worktree.rs), [Git worktree tests](../crates/drogon-core/tests/git_worktree.rs). |
| Persistent sessions | Session records survive reload/restart; observations distinguish `live`, `unverifiable`, and `exited`. | [Persistence tests](../crates/drogon-core/tests/session-persistence.rs), [restart tests](../crates/drogon-core/tests/session_restart_record.rs). |
| Review and GitHub work | Developers inspect changes and use Git review operations; a GitHub issue can be linked to a workspace. | [Git review tests](../crates/drogon-core/tests/git_review.rs), [issue/worktree tests](../crates/drogon-core/tests/worktree_issue_links.rs), [Tasks UI](../apps/desktop/src/renderer/src/features/tasks/TasksPage.tsx). |
| CLI for agents | Sessions receive the correct CLI and workspace context; coordination has scoped runs, tasks, dispatch and reporting. | [Session environment](../crates/drogon-core/src/session_env.rs), [CLI shim tests](../crates/drogon-core/tests/session_env_shim.rs), [coordination tests](../crates/drogon-core/tests/orchestration_runs_tasks.rs). |
| Bots and automations | Bots retain identity and responsibilities; scheduled or monitored work produces recorded execution rather than only a notification. | [Bot delegation](../crates/drogon-core/src/bots/delegation.rs), [delegation tests](../crates/drogon-core/tests/bot_delegation.rs), [bot run tests with fixtures](../crates/drogon-core/tests/native_bot_run_shell_fixture.rs). |
| Supported monitors | File and GitHub PR watches evaluate supported events; approval, deduplication and delegation boundaries remain observable. Unsupported evaluator kinds are handled explicitly. | [Monitor evaluator](../crates/drogon-core/src/bots/monitors/eval.rs), [GitHub watch tests](../crates/drogon-core/tests/bot_github_pr_watch.rs), [monitor-kind tests](../crates/drogon-core/tests/bot_monitor_rule_kinds.rs). |
| Work Graph and runtime policy | Human-authored intent is distinct from observed execution state. Policy reaches the agent brief; runtime attempts and failures can be inspected. | [Graph storage](../crates/drogon-core/src/graph/store.rs), [session-brief tests](../crates/drogon-core/tests/graph_policy_session_brief.rs), [failover tests](../crates/drogon-core/tests/graph_failover.rs). |
| Bounded verification loop | The configured orchestration mode controls execution; adversarial findings lead into review within the configured bound, with a durable result. | [Orchestrator](../crates/drogon-core/src/graph/orchestrator.rs), [daemon orchestration tests](../crates/drogon-core/tests/graph_orchestrator.rs), [Work Graph UI tests](../apps/desktop/src/renderer/src/features/work-graph/WorkGraphPane.test.tsx). |
| Packaged desktop | The packaged app launches against an isolated profile, runs acceptance journeys and identifies its source revision and bundle. | [Packager](../scripts/package-desktop.mjs), [desktop acceptance](../scripts/accept-desktop.mjs), [acceptance guide](acceptance.md). |

The original twelve journeys also covered embedded browsing, command palette and
quick open, settings, and the status bar. The [initial scope plan](https://github.com/clioo/drogon/pull/16)
defines their recorded scope; the [README](../README.md) describes their current
surfaces. The table emphasizes the developer and automation path central to this
submission.

## Architecture and major decisions

- **Rust service boundary.** `drogond` hosts the core state and execution services;
  `drogon-cli` and the Electron desktop are clients. Shared protocol types define
  the cross-process contract. SQLite backs durable state and PTYs host terminal
  sessions. See [core](../crates/drogon-core), [protocol](../crates/drogon-protocol)
  and [daemon](../crates/drogond).
- **Desktop interaction.** Electron main/preload bridges connect the React renderer
  to native operations. Workspaces, sessions, review, Bots and Work Graph remain
  visible developer controls. Browser interactions and screenshots complement
  component tests when validating actual rendering.
- **Harness choice.** Harness adapters connect to installed coding tools and their
  configured providers. Models are selected per task; different runtimes can serve
  different roles. Some workflow execution at this baseline uses the configured
  Mentu runtime; it must be provisioned for those paths. Drogon does not execute
  through an installed Orca application.
- **Agent-capable CLI.** Bots and workers need executable commands and scoped
  context to create workspaces, dispatch work and report outcomes. The builder
  prioritized this over requiring manual prompting for every handoff. [PR #200](https://github.com/clioo/drogon/pull/200)
  develops the agent context; [PR #525](https://github.com/clioo/drogon/pull/525)
  teaches bot delegation.
- **Evidence before completion.** Graph policy, recorded outcomes and test results
  support review. [PR #527](https://github.com/clioo/drogon/pull/527) demonstrates
  replacing fragile completion-keyword transcription with artifact verification.
- **Reuse with attribution.** The desktop began with MIT-licensed Orca components.
  Existing copyright notices and [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)
  remain part of the product.

## Implementation approach and context boundaries

The recorded approach assigned shared contracts to the coordinator or the Sonnet
lane, then dispatched dependent renderer work after those contracts were available.
Independent status bar, palette, review and service work ran in parallel. Each task
had owned paths, a bounded scope and a required verification result. PRs carried the
worker report; the coordinator integrated changes and returned QA findings to the
responsible worker. The historical wave table and the execution examples are linked
in [SYSTEM.md](SYSTEM.md).

## Constraints and scope decisions

- The initial target was a macOS desktop preview. Ad-hoc signing does not establish
  notarization or production release readiness; Windows compilation is not Windows
  runtime acceptance.
- Use installed harness/provider configuration for real agent work. Ordinary app
  acceptance uses isolated shell or sealed provider fixtures. The log identifies
  historical live-model QA separately, including DGX-local inference.
- Keep client information and credentials out of submission artifacts. Validation
  must preserve the user's working sessions, OS focus, and data, and clean up its
  own processes. Current rules are in [AGENTS.md](../AGENTS.md).
- The original plan excluded remote SSH, mobile, voice and several integrations.
  Later additions must be justified by their own implementation and evidence.
- The builder reduced scope to meet the deadline. Browser work was partially
  implemented but remained incomplete by the builder's assessment; it is not used
  as the submission's main demonstration of reliability. A browser was in the
  product's original plan even though the hackathon did not require that feature.
- HTTP/script monitor rule schemas alone do not establish active evaluation. The
  baseline's [tests](../crates/drogon-core/tests/bot_monitor_rule_kinds.rs) explicitly
  cover missing evaluators; the submission demonstrates supported watches.

## Definition of done and reproduction

A submitted feature must connect its UI or CLI entry point to real behavior, satisfy
its behavioral tests, and retain evidence of correction when checks fail. Integrated
desktop work additionally needs rendered acceptance. A release candidate must name
its revision, preserve licensing, include setup instructions, and pass the applicable
checks on the candidate actually being delivered.

The [README](../README.md) supplies installation and run instructions. The pinned
toolchain is declared in [package.json](../package.json) and [Cargo.toml](../Cargo.toml).
From an isolated checkout with dependencies installed, the existing gates include:

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
pnpm typecheck
pnpm --filter @drogon/desktop test
pnpm test:renderer-contracts
pnpm test:packaging
pnpm build
```

For packaged acceptance, follow [SUBMISSION.md](SUBMISSION.md) and
[acceptance.md](acceptance.md), using the isolated/background launch and cleanup
rules in AGENTS.md. Historical test results in the development log apply to their
linked commits. This specification defines acceptance; it does not assert that a
fresh full-product run was performed while preparing these documents.
