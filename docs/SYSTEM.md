# How Drogon was built

Submission draft, reconstructed on September 13, 2026 from the builder's account,
repository sources, and linked pull-request reports. This describes the development
process, not just capabilities demonstrated by the finished product. Historical
practices attributed to the builder are not independently verified session records.

## Why this system

I liked Orca, but my everyday development workflow was split between Orca for
orchestration, Codex for quick chats, and Hermes for bots. Drogon grew from wanting
those workflows in one developer workspace. Its desktop began as a component-level
port of Orca's MIT-licensed source; the attribution remains in
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

The development workflow became the product's proving ground. I initially used
Orca to coordinate the work. During the final three days described in my account,
I used Drogon itself to build Drogon: coordinating agents, watching work with bots,
and routing follow-up fixes. I used the app in real client work, filed GitHub issues
when I found problems, and had the bots take those issues into implementation and
regression testing. Client data and private transcripts are not submission evidence.

## People, agents, and tools

The following allocation is my account of the actual development setup. Model names
are the labels I used, not a verified inventory of provider API identifiers.

| Role | Responsibility |
| --- | --- |
| Human builder | Set direction, constrain scope, use Drogon in real work, report usability issues, and decide readiness. |
| Coordinator, identified as Fable 5.1 | Decompose work into detailed specs, assign scopes, choose harnesses and models, integrate QA findings, and reassign work when usage limits were reached. |
| Implementation workers | Execute distinct specs in parallel, make scoped changes, and add or update tests. |
| QA agents | Exercise affected features, inspect sandbox logs, interact with the Electron UI, and send actionable failures back to the coordinator. |
| Drogon bots, in the later phase | Watch incoming work and delegate it into the appropriate project and agent workflow. |

The reported model pool included Z.ai GLM 5.3 Flash; GPT-5.6 Sol and Luna;
Opus, Sonnet, and Fable through Claude Code; and
`qwen3.8-flash-next-nvidia-nvfp4` on my own DGX Spark. These are models and harnesses,
not interchangeable terms: a harness supplies the execution interface, while the
model supplies reasoning. I used local inference to reduce metered provider spend
during repeated internal QA, not to claim that compute had no cost.

The coordinator selected workers based on observed suitability and available usage.
Reassigning work at a usage limit was part of that coordination practice; this is
not a measured claim of 100% token utilization or proof that every such reassignment
was a daemon-level automatic failover.

## Context and parallel execution

Context had two complementary sources:

1. **Task intent:** the coordinator supplied detailed specs, constraints, rules,
   and implementation scope to each worker.
2. **Observed behavior:** QA agents inspected controlled feature environments and
   their logs, then reported failures to the coordinator. The coordinator passed
   the relevant evidence into subsequent implementation work.

Features and tests were developed concurrently rather than as a single serial
conversation. Separate tasks and worktrees bounded changes; pull requests were the
integration boundary. Repository instructions establish scoped ownership, protected
shared files, real-test requirements, and delivery through PRs rather than direct
pushes to main; see [AGENTS.md](../AGENTS.md).

The public merge history corroborates the scale: a GitHub API snapshot on September
13, 2026 contains **423 merged PRs from September 6–13**, including **168 merged on
September 8**. Using each merged PR's public created/merged interval, at least 13 of
those already-merged lanes were open at the same time (the lower bound excludes PRs
that were still open or closed without merging). This does not identify which model
wrote each change, but it makes a single-person serial workflow implausible and
corroborates the parallel-work account. A complete historical parallelism exhibit
would still map overlapping dispatch/session records to specific PRs.

Commit cadence is supporting evidence, not a claim that timestamps alone prove an
agent was executing at every instant. Likewise, this retrospective account is not a
substitute for dated specs written before implementation.

## Verification, backpressure, and recovery

My coordination rule was to launch end-to-end QA after every three or four merged
PRs. QA selected affected surfaces from those changes and checked the rendered UI,
not just assertions about its internal state. Obvious defects were often caught
before I encountered them; my own findings increasingly concerned usability in real
work. This cadence is my recollection, not a claim that every historical batch has
been audited.

The evidence distinguishes two test layers:

- **Deterministic checks:** Rust and desktop tests, renderer contracts, packaging
  checks, and acceptance using shell or sealed provider fixtures. The fixture
  provider is documented in [acceptance.md](acceptance.md). These validate repeatable
  behavior without depending on a model's answer.
- **Live-model exploratory and integration QA:** separate runs exercised real
  harness sessions and their behavior through the desktop. PR [#523](https://github.com/clioo/drogon/pull/523)
  reports Pi with `openai-codex/gpt-5.6-luna:low` for the three orchestration modes.
  PR [#528](https://github.com/clioo/drogon/pull/528) reports Pi with the DGX model
  for bot monitoring and scheduled execution. Their assertions can be deterministic;
  model generation itself is not.

Those historical live-model reports must not be confused with permission to run
inference during ordinary validation today. Current contributor instructions require
shell fixtures and prohibit real model inference from inside the app.

Backpressure meant observing failures and missing artifacts rather than accepting an
agent's completion message as sufficient evidence. The reported workflow sent QA
findings back through the coordinator for correction and another check. Repository
controls additionally require isolated background test instances, preservation of
the developer's foreground focus, and cleanup of test-owned processes.

Concrete linked examples:

| Report | Observation and correction | Reported verification |
| --- | --- | --- |
| [#523](https://github.com/clioo/drogon/pull/523) | E2E runs exposed drift handling, unintended runtime commits, missing CLI access, and task-editor persistence problems. The PR records corresponding fixes. | Three execution modes, requested output artifacts, run evidence, and unchanged repository commit count. |
| [#527](https://github.com/clioo/drogon/pull/527) | Expanded UI testing found conflicting worker instructions, fragile completion keywords, and an unreachable live-session projection. Fixes added role-specific context and artifact-based verification. | Reported 18 acceptance checks plus regression suites; 53 of 55 inventoried Orchestrator controls exercised, not 96% coverage of the entire product. |
| [#528](https://github.com/clioo/drogon/pull/528) | A bot's monitor dispatched work successfully, while its card incorrectly said the adapter was disconnected. The card and regression assertion were corrected. | Reported nine checks covering the bot's monitor, scheduled automation, resulting files, and UI. |

These are PR-authored reports of checks performed at those revisions, not a new run
of the current branch and not proof that every current check passes.

### Issue-to-PR-to-QA trails

The public issue trail supplies a more useful audit than commit cadence alone. It
contains coordinator assignment, a worker's implementation result, and a later QA
verdict. For example:

- [Issue #186: QA reproduction](https://github.com/clioo/drogon/issues/186#issuecomment-5580354718)
  records a Pi automation stuck at `needs_input` with a `Launched` row and raw TUI
  output. [The follow-up](https://github.com/clioo/drogon/issues/186#issuecomment-5580587630)
  identifies the positional-prompt/headless-approval root cause, links PR #227, and
  reports a live DGX-Spark run with `HEADLESS_OK`, completed scheduler work, and zero
  sessions at `needs_input`. [The later closure note](https://github.com/clioo/drogon/issues/186#issuecomment-5584609271)
  records re-verification on the installed build and keeps a separate scheduler-policy
  gap open in #188.
- [Issue #312](https://github.com/clioo/drogon/issues/312#issuecomment-5587612596)
  records a CI failure, its measured cause, and PR #325. Later comments record a
  residual failure after the first mitigation
  ([follow-up](https://github.com/clioo/drogon/issues/312#issuecomment-5587938606)),
  a reopened issue when the failure returned
  ([reopen](https://github.com/clioo/drogon/issues/312#issuecomment-5589713766)),
  a shard-based mitigation ([#342](https://github.com/clioo/drogon/issues/312#issuecomment-5591122750)),
  and closure after three consecutive green main runs
  ([closure](https://github.com/clioo/drogon/issues/312#issuecomment-5592145226)).
- [PR #409's adversarial follow-up](https://github.com/clioo/drogon/pull/409#issuecomment-5615172599)
  maps five discovered lifecycle breaks to fixes and red-first regression tests.
  [PR #417's next round](https://github.com/clioo/drogon/pull/417#issuecomment-5616145127)
  closes two races and a forged-event path, and [the interlock resolution](https://github.com/clioo/drogon/pull/417#issuecomment-5617869726)
  records the rebase and post-fix test results.

GitHub exposes these comments under the `clioo` account because that account was the
authenticated publisher for the coordination workflow. They are therefore evidence
of the chronological work trail, not independent author identities. One stronger
attribution signal is [PR #342](https://github.com/clioo/drogon/pull/342): its body
contains the Claude Code generation marker, links a Claude session, and its commits
include GitHub's `claude` author alongside `clioo`. This is still not a cryptographic
proof of which model wrote every line.

The same trail begins in the first foundation wave. PR [#9](https://github.com/clioo/drogon/pull/9)
records 18 coordination entry points and three supplemental review Tasks split across
Sonnet, OpenCode/ZAI GLM-5.3-Flash, and a root reconciliation pass. PR
[#10](https://github.com/clioo/drogon/pull/10) records five leader tasks, an 86-row
audit, and a 126-task worker inventory. Early review PRs #2–#8 repeatedly record
multi-provider review lanes, explicit RED findings, correction ownership, and fresh
verification. During the R16 issue wave, the coordinator assigned issues to named
lanes/models and enforced a nine-worker cap (for example [R16-C](https://github.com/clioo/drogon/issues/124#issuecomment-5578419535)
and [R16-L](https://github.com/clioo/drogon/issues/156#issuecomment-5578798907)).
These artifacts show that orchestration was present before the later Work Graph UI.

## The human's decisions

The hardest decision was scope. After the first three or four days, I recognized
that the original ambition would miss the deadline. I deferred some Hermes- and
Codex-inspired functionality. In particular, the browser was not fully finished;
I chose to leave further work for later rather than make it the submission's core.

Another important decision was adapting the CLI for bots. A bot needed to invoke
the CLI, create worktrees, and delegate to coordinator sessions as I would when
prompting manually. That changed the CLI from a convenience for an interactive
user into an interface usable by delegated work. PR
[#525](https://github.com/clioo/drogon/pull/525) documents teaching bots to delegate;
[#528](https://github.com/clioo/drogon/pull/528) provides a concrete monitor-to-work
integration report.

My role was not absence. It was direction, scope, real-world feedback, and judgment
about whether the result served a developer. Autonomous execution happened inside
that human-directed process.

## Evidence still needed before calling the submission complete

The linked reports support a development sequence of **act → verify → observe a
problem → fix → verify again**. They do not, on their own, establish that there was
no new human instruction inside a particular sequence.

For the autonomous-loop requirement, attach one redacted, chronological run or
session excerpt to the development log: initial task, failed verification, observed
problem, corrective action, successful re-verification, and the boundaries showing
no intervening human prompt. Also attach a dated pre-implementation spec and one
overlapping-worker record for the planning and parallelism claims. Do not infer
these facts solely from commit timestamps or from the landing-page demonstration.
