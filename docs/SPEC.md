# Drogon engineering specification

This English specification consolidates the recorded goals, subsequent scope
decisions, and implemented acceptance criteria. It was assembled for submission on
September 13, 2026 and updated on September 14 for the published
[v0.1.0-rc.7 product baseline](https://github.com/clioo/drogon/commit/e30bbdc4b7b7838b132b63f25977c9903656d3bd).
The provenance and historical results retain their original dates and revisions.
Development process and iteration evidence are in [SYSTEM.md](SYSTEM.md) and
[AI-DEV-LOG.md](AI-DEV-LOG.md).

## Specification provenance

The project had written intent before its first substantial implementation wave:

| Recorded artifact | What it established | Chronology |
| --- | --- | --- |
| [Approved goal, c6189dac](https://github.com/clioo/drogon/blob/c6189dac9b9ec5d6d2eff30be2639a8a935db9df/docs/migration/rewrite-goal.md) | Independent Rust core, service and CLI; Electron/React desktop; licensing; coordinator ownership; three scoped worker lanes; lifecycle and rendered acceptance before expansion. | September 5, 19:10:59 UTC. It explicitly records that product implementation had not started at activation. |
| [Protocol and desktop implementation, c3eb8802](https://github.com/clioo/drogon/commit/c3eb8802a8a1731fce0f5bd37e14531a1eeb2373) | Execution contract, desktop client and foundation acceptance. | September 5, 19:56:20 UTC, after the approved goal. |
| [MVP plan, ec8dd5ba](https://github.com/clioo/drogon/blob/ec8dd5ba72eb6aaad44587538ad8bfb7497a16f4/docs/migration/rewrite-mvp-plan.md) | Twelve journeys, explicit exclusions, architecture dependencies, four implementation waves, owners and validation gates. Its initial status table marks the upcoming journeys pending. | September 7, 18:19:24 UTC, in [PR #16](https://github.com/clioo/drogon/pull/16). This refined an existing foundation; it was not the start of all development. |

The original MVP plan is Spanish; this document summarizes its requirements in
English. Historical links pin the original revisions even though the migration
corpus was later retired. They establish what was planned at that time, not a
requirement to restore the old scope or architecture.

## Objective and intended user

Drogon is an open-source agentic development environment for ambitious builds:
coordinate coding agents across the vendors you already pay for, with parallel
Git worktrees, persistent sessions, bots, and verification in one local workspace.
The developer keeps their preferred harness and delegates work to other configured
harnesses through Drogon's CLI and daemon. Model access uses each harness's existing
subscription or provider account. The builder previously split these activities
between Orca, Codex quick chats, and Hermes bots.

The workflow is: select a project, create an isolated workspace, give an agent a
task and execution policy, inspect progress and failures, and review the resulting
changes. Bots add monitored and scheduled entry points into that workflow.

The Work Graph shows the configured orchestration structure. Agent telemetry makes
dispatches, findings, and outcomes inspectable, while Usage shows reported token
measurements by agent and runtime. The current orchestration policy supports
depth-1 workers and bounded review iterations, not unlimited recursive delegation.
Missing token measurements remain unavailable; token totals do not establish savings.

Explore the product at [drogon.work](https://drogon.work),
[watch the demo](https://youtu.be/jgnitCkmpKk), or install the
[Apple Developer ID signed and notarized Mac release](https://github.com/clioo/drogon/releases/tag/v0.1.0-rc.7).

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
| Agent telemetry and token usage | Local records expose agent roles, dispatches, findings, outcomes, and reported input/output/cache tokens. Missing usage is not converted to zero. | [Native ledgers and tests](../crates/drogon-core/src/graph/observability.rs), [telemetry and usage views](../apps/desktop/src/renderer/src/features/work-graph-workflows/ObservabilityViews.tsx), [view tests](../apps/desktop/src/renderer/src/features/work-graph-workflows/ObservabilityViews.test.tsx). |
| Signed Mac distribution | The published archive passes signature and notarization validation after extraction; the Homebrew cask identifies the same version and checksum. | [Artifact verifier](../scripts/verify-release-artifact.mjs), [verifier tests](../scripts/verify-release-artifact.test.mjs), [rc.7 release evidence](https://github.com/clioo/drogon/actions/runs/34861305249). |

The original twelve journeys also covered embedded browsing, command palette and
quick open, settings, and the status bar. The [original plan](https://github.com/clioo/drogon/blob/ec8dd5ba72eb6aaad44587538ad8bfb7497a16f4/docs/migration/rewrite-mvp-plan.md)
defines their initial scope; the [README](../README.md) describes their current
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
  different roles using their existing provider accounts. The native orchestrator
  launches graph roles as Drogon sessions; Mentu is provisioned separately only for
  optional recipe commands. Drogon does not execute through an installed Orca application.
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

- The distributed rc.7 release targets Apple Silicon and macOS Sonoma (14) or newer.
  It is Apple Developer ID signed and notarized by Apple, with Gatekeeper acceptance
  recorded in the release pipeline. It remains a release candidate. Local source
  builds use ad-hoc signing unless configured otherwise; Windows compilation is not
  Windows runtime acceptance.
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

The [rc.7 release run](https://github.com/clioo/drogon/actions/runs/34861305249)
verified the published archive and tap, executed 107 packaged checks, and recorded
eight skipped checks for missing real harnesses or an upgrade baseline. These skips
remain unverified coverage. The developer's [three product captures](screenshots/MANIFEST.md)
show the graph, agent telemetry, and usage from a working session; they supplement
the linked tests rather than asserting that every displayed finding was resolved.
