# How Drogon was built

Prepared in English on September 13, 2026. This document combines the builder's
account with dated planning artifacts, implementation commits, and public review
and verification records. [SPEC.md](SPEC.md) defines the product and acceptance
criteria; [AI-DEV-LOG.md](AI-DEV-LOG.md) follows the actual iterations.

## Why Drogon

I liked Orca, but my everyday workflow was split between Orca for orchestration,
Codex for quick chats, and Hermes for bots. Drogon grew from wanting those workflows
in one developer workspace. Its desktop began as a component-level port of Orca's
MIT-licensed source; attribution remains in
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

I initially used Orca to coordinate development. During the final three days
described in my account, Drogon was built with Drogon: its sessions, orchestration
and bots handled ongoing work. I used it with real client projects, reported
usability problems as GitHub issues, and had bots take those issues into fixes and
regression tests. Client data and private conversations are not submission artifacts.

## Specification before implementation

The [September 5 goal](https://github.com/clioo/drogon/commit/c6189dac9b9ec5d6d2eff30be2639a8a935db9df)
was committed at 19:10:59 UTC and explicitly states that product implementation had
not started. It defines the independent Rust core/service/CLI, Electron desktop,
licensing, coordinator responsibilities, three worker lanes and acceptance gates.
The [protocol and desktop implementation](https://github.com/clioo/drogon/commit/c3eb8802a8a1731fce0f5bd37e14531a1eeb2373)
followed at 19:56:20 UTC.

The [September 7 initial scope plan](https://github.com/clioo/drogon/pull/16)
refined that foundation into twelve journeys, exclusions, four implementation waves,
ownership and dependencies. Shared contracts came first; dependent UI work followed.
[PR #16](https://github.com/clioo/drogon/pull/16) records the plan, whose commit
credits Claude Fable 5.1 as a coauthor. The original planning documents are Spanish;
the submission specification summarizes them in English without backdating it.

## Roles, harnesses and models

| Role | Responsibility |
| --- | --- |
| Human builder | Set intent, prioritize scope, use the product in real work, report usability failures and decide readiness. |
| Coordinator, Fable 5.1 in the builder's account | Break the goal into scoped specifications, choose workers, manage dependencies, integrate QA findings and reassign work when usage limits were reached. |
| Implementation workers | Execute separate tasks in isolated worktrees, implement behavior and add regression tests. |
| QA and adversarial reviewers | Exercise affected behavior, inspect sandbox logs and rendered Electron UI, challenge assumptions and return reproducible failures. |
| Drogon bots in the later phase | Watch incoming work and delegate it into the appropriate project and session workflow. |

My model pool included Z.ai GLM 5.3 Flash; GPT-5.6 Sol and Luna; Opus, Sonnet and
Fable through Claude Code; and `qwen3.8-flash-next-nvidia-nvfp4` on my DGX Spark.
These are the labels I used, not an exact provider-ID inventory. Historical task
reports also name Muse and Kimi review lanes. A harness is the execution interface;
a model is the reasoning engine used through it.

The coordinator selected workers by observed suitability and available usage.
Local inference reduced metered provider spending during repeated internal QA;
it did not make hardware or computation free. Reassignment at usage limits was a
coordination practice, not a measured claim of perfect token utilization or a
claim that every reassignment used Drogon's runtime failover machinery.

## Context engineering and parallel execution

Each worker received a detailed task brief: intended behavior, owned paths,
constraints, dependencies and verification expectations. QA supplied a second kind
of context: logs, observed UI behavior and reproducible failures from controlled
environments. The coordinator fed those observations into the next implementation
task. Intent and observations served different purposes.

Parallelism is visible in planning records, not only commit volume. The
[September 7 status update at 18:48 UTC](https://github.com/clioo/drogon/commit/9c92b5e95f1e759b323b42c331de8c94cd3324cb)
records merged palette, review and sidebar lanes while the Sonnet backbone/CLI
work and the Muse automation and browser lanes were still in progress.

The initial scope plan allocated four workers. Later R16 issue comments record
specialist assignments and a nine-worker cap:
[Muse copy/token work](https://github.com/clioo/drogon/issues/124#issuecomment-5578419535),
[Sonnet editor work](https://github.com/clioo/drogon/issues/133#issuecomment-5578420623),
and [capacity backpressure](https://github.com/clioo/drogon/issues/156#issuecomment-5578798907).
These describe different stages of the build, not one constant worker count.

Worktrees bounded simultaneous changes; PRs were the integration boundary.
[AGENTS.md](../AGENTS.md) records path ownership, protected shared files, real-test
requirements and delivery through PRs. In the early foundation wave,
[PR #9](https://github.com/clioo/drogon/pull/9) reports three supplemental review
tasks: two Sonnet dimensions and one OpenCode/ZAI GLM lane, followed by root
reconciliation. [PR #10](https://github.com/clioo/drogon/pull/10) reports five leader
tasks, an 86-row audit and a 126-task inventory.

## The execution and recovery loop

The standing process was:

1. Act on the scoped task.
2. Verify through tests, independent review or rendered QA.
3. Observe the actual failure and return its evidence to the coordinator.
4. Fix the failure and add a regression.
5. Verify again before accepting the result.

As the builder, I confirm that the agent review comments and corrective follow-up
work described here happened within the ongoing orchestration. I did not manually
write a new prompt for each intermediate review-to-fix transition. My interventions
were direction, scope decisions, real-world issues and readiness decisions.

The public record makes those transitions inspectable. In
[PR #5](https://github.com/clioo/drogon/pull/5), a review at 21:22:05 UTC identified
a reserved-key serialization hole despite green checks. A corrective commit
followed at 21:28:58. Its committed RED receipt contains the failing regression;
CI on the corrected SHA then passed the Ubuntu native, macOS native and Windows
compilation jobs. The [development log](AI-DEV-LOG.md) links each event.

That is the distinction between the two sources of evidence: the builder attests
to how the agents were operated; GitHub preserves the review, subsequent code,
failure receipt and verification. Shared-account timestamps alone are not used to
identify a model or prove the absence of private human input.

## Verification strategy and backpressure

My later coordination rule was to launch end-to-end QA after every three or four
merged PRs. QA selected affected surfaces from those changes and inspected the
rendered UI. This is my account of the later cadence; earlier planning records
used different batching and worker limits.

Two test layers mattered:

- **Repeatable acceptance:** Rust and desktop tests, renderer contracts, packaging
  checks and shell/sealed provider fixtures. See [acceptance.md](acceptance.md).
  These validate behavior without relying on a model's answer.
- **Historical live-model QA:** separate sessions exercised real harness behavior.
  [PR #523](https://github.com/clioo/drogon/pull/523) reports Pi with
  `openai-codex/gpt-5.6-luna:low` across three orchestration modes.
  [PR #528](https://github.com/clioo/drogon/pull/528) reports DGX-local inference
  for bot monitoring and scheduled execution. Assertions about their outputs can
  be deterministic; model generation itself is not.

Today's contributor rules prohibit real model inference inside app validation and
require shell fixtures. The historical live-model reports are evidence of past
work, not permission to bypass those rules now.

Backpressure meant rejecting missing artifacts, failed packaging and incomplete QA
instead of accepting an agent's completion message. [PR #7](https://github.com/clioo/drogon/pull/7)
records a real packaging failure after fixture checks;
[PR #409](https://github.com/clioo/drogon/pull/409#issuecomment-5615172599) and
[PR #417](https://github.com/clioo/drogon/pull/417#issuecomment-5616145127)
turn adversarial lifecycle failures into regressions.
[PR #527](https://github.com/clioo/drogon/pull/527) reports replacing fragile
completion-keyword handling with artifact verification.

Validation also had operational boundaries: isolated profiles, background windows,
preserved developer focus and cleanup of test-owned processes. Passing assertions
did not authorize disruption of the developer's working sessions.

The [CI workflow](../.github/workflows/foundation.yml) runs executable checks,
including Rust tests, type checks, renderer contracts, packaging tests and desktop
test shards. These produce deterministic pass/fail signals. Path ownership and
review expectations in AGENTS.md are instructions; this submission does not claim
that every such instruction was enforced by an access-control system. The builder
also used Electron-testing skills for human-like UI exploration; the recorded
rendered-validation interface is Playwright over CDP.

To reproduce the workflow pattern, start from a scoped requirement and acceptance
criteria, assign independent paths to separate worktrees, and keep contract changes
ahead of dependent work. Run the gates listed in [SPEC.md](SPEC.md), return failing
output to the responsible worker, require a regression and rerun the affected checks.
Integrate through a reviewed PR, then validate the integrated desktop using isolated
fixtures. This reconstructs the method; exact historical model responses are not
required to reproduce the tests.

## Human judgment and scope

The hardest decision was reducing scope after the first three or four days.
I deferred some Hermes- and Codex-inspired functionality to meet the deadline.
The browser remained incomplete in my assessment; it was part of the original
product plan, but not a mandatory hackathon feature, so I did not make it the core
submission demonstration.

The other major decision was making the CLI usable by bots. Bots needed to invoke
commands, create worktrees and delegate to coordinator sessions as I would when
prompting manually. [PR #525](https://github.com/clioo/drogon/pull/525) documents
bot delegation; [PR #528](https://github.com/clioo/drogon/pull/528) reports a
monitor-to-work integration run.

My role was not absence. It was direction, tradeoffs, real-world feedback and
judgment. Autonomous execution happened inside that human-directed process.
