# AI development log

Draft for the hackathon submission. This is a compact reconstruction of the
important development loops from the public GitHub issue/PR trail, supplemented by
the builder's account in `docs/SYSTEM.md`. It is intentionally not a transcript and
does not include client data, provider secrets, or raw model conversations.

## How to read this log

The GitHub API shows the comments below under the `clioo` account. That account was
the authenticated integration identity for the coordination workflow. The bots and
workers used that identity to open branches, PRs, and issue updates, so a comment
labelled “coordinator”, “QA”, or “follow-up” describes the role of that event, not a
separate GitHub account. The useful evidence is the role, timestamp, linked commit,
test result, and subsequent state transition. The account name alone cannot identify
which model authored a message, but the single identity is expected for this setup.

Where available, PR reports provide stronger attribution. PR [#342](https://github.com/clioo/drogon/pull/342)
contains the Claude Code generation marker, links a Claude session, and has commits
with GitHub's `claude` author alongside `clioo`. PR [#523](https://github.com/clioo/drogon/pull/523)
and PR [#528](https://github.com/clioo/drogon/pull/528) explicitly describe live
end-to-end harness sessions; the ordinary acceptance suite remains fixture-backed.

## Scale and concurrency corroboration

A September 13 GitHub API snapshot counted 423 merged PRs between September 6 and
September 13, with 168 merged on September 8 alone. The public created/merged
intervals for the merged set overlap in at least 13 lanes at once; this is a lower
bound because still-open and unmerged PRs are not included. The range includes the
cluster of Orchestrator, Bot, Work Graph, CLI, and evidence PRs that landed while
the issue comments below were being written. This volume and overlap corroborate
the builder's account that the work was distributed; they do not, without private
dispatch logs, prove the exact worker/model assignment for every PR.

## 2026-09-08 — headless bot and automation runs

1. **Act — assign the failure.** The coordinator assigned the headless-launch slice
   to the running R16-S task and made the automation lane depend on it
   ([assignment](https://github.com/clioo/drogon/issues/186#issuecomment-5579679347)).
   A worker then pushed the first `plan_launch` headless slice
   ([implementation](https://github.com/clioo/drogon/issues/186#issuecomment-5579825778)).
2. **Verify — reproduce the real break.** QA ran a Pi automation and observed
   `agent=needs_input`, a run row stuck at `Launched`, zero completed work, and raw Pi
   TUI escape codes in the run detail. The session was killed manually after the
   observation ([QA r2](https://github.com/clioo/drogon/issues/186#issuecomment-5580354718)).
3. **Observe problem → fix.** The follow-up identified the cause: daemon runs passed
   the prompt as a positional argument, while Pi requested tool approvals that a
   headless PTY could not answer. The fix added explicit headless modes (`Pi -p`,
   `Claude -p`, `OpenCode run`, `Antigravity -p`), bypassed interactive hook waits,
   threaded the mode through bot/automation/scheduler paths, and persisted terminal
   state ([root cause and PR #227](https://github.com/clioo/drogon/issues/186#issuecomment-5580587630)).
4. **Verify again.** The same report records a live DGX-Spark run: `HEADLESS_OK`,
   completed bot responsibility and scheduler work, answered/exited chat turns, and
   zero sessions at `needs_input`. A later note records re-verification on the
   installed build and deliberately leaves the separate bot harness-policy issue
   open ([closure note](https://github.com/clioo/drogon/issues/186#issuecomment-5584609271)).

This is the clearest issue-level example of **act → verify → observe → fix → verify**.
The linked comments do not establish that no human prompt occurred between every
step; that boundary must be shown by a redacted session/run record if the submission
requires proof of a fully unattended loop.

## 2026-09-08 — CI failure, mitigation, and recovery

Issue #312 shows a longer feedback loop rather than a convenient green-only story:

- The investigation measured an external Ubuntu SIGTERM around the Vitest worker
  recycle boundary and linked the first fix in PR #325
  ([root cause](https://github.com/clioo/drogon/issues/312#issuecomment-5587612596)).
- The first green run was followed by a residual failure with the same boundary
  signature ([follow-up](https://github.com/clioo/drogon/issues/312#issuecomment-5587938606)).
- The issue was reopened when current main reproduced the failure
  ([reopen](https://github.com/clioo/drogon/issues/312#issuecomment-5589713766)).
- A new mitigation sharded the desktop suite and made the remaining timeout/module
  pollution visible instead of hiding it ([mitigation in #342](https://github.com/clioo/drogon/issues/312#issuecomment-5591122750)).
- The issue closed only after three consecutive green main runs, while preserving the
  residual-risk explanation ([closure](https://github.com/clioo/drogon/issues/312#issuecomment-5592145226)).

PR #342 is especially useful submission evidence: its body reports repeated full-suite
measurements and an honest residual; the PR is marked “Generated with Claude Code”;
and the commit metadata includes the `claude` author. This supports model-assisted
work on that lane, while not proving that every historical comment or line came from
Claude.

## 2026-09-10 — adversarial lifecycle hardening

The adversarial pass in PR [#409](https://github.com/clioo/drogon/pull/409#issuecomment-5615172599)
reported five concrete lifecycle breaks beyond the happy path: disable-mid-turn
state, Stop while disabled, disable/re-enable state, restart durability, and
foreign-harness hook events. It mapped each finding to a code correction and a
red-first regression test, and also stabilized the fixture under parallel execution.

The next round in PR [#417](https://github.com/clioo/drogon/pull/417#issuecomment-5616145127)
closed two additional races and the forged-event path with named tests. The interlock
resolution then recorded the rebase and post-fix suites
([verification](https://github.com/clioo/drogon/pull/417#issuecomment-5617869726)).
The sequence demonstrates adversarial backpressure: a passing happy path was not
accepted as done, and each observed break became a regression.

## Other corroborating trails

- PR [#523](https://github.com/clioo/drogon/pull/523) reports all three Orchestrator
  modes driven through the real desktop, fixes discovered by those runs, and checks
  that requested artifacts and evidence landed.
- PR [#527](https://github.com/clioo/drogon/pull/527) reports 53 of 55 inventoried
  Orchestrator controls driven, plus defects found in delegated-child instructions,
  completion verification, and Main-agent projection. The 53/55 figure is not whole
  product coverage.
- PR [#528](https://github.com/clioo/drogon/pull/528) reports a bot creating its own
  monitor and automation with the DGX-local model, the monitor firing real delegated
  work, and a UI contradiction corrected after the run.
- The browser trail is similarly honest: triage assigned the work, a PR reported a
  sealed acceptance result, and a later QA round still found blank embedded content
  ([issue #279](https://github.com/clioo/drogon/issues/279#issuecomment-5584564399),
  [follow-up QA](https://github.com/clioo/drogon/issues/279#issuecomment-5584846071)).

## Human-in-the-loop boundary

The human builder supplied intent and constraints, selected the deadline scope,
used Drogon in real client work, filed usability issues, and decided what was ready
to ship. The coordinator and workers handled decomposition, implementation, and
verification inside those boundaries. The process therefore demonstrates autonomous
work in bounded loops, not a claim that the repository was built without human
direction.

## Evidence to attach for a strict autonomy claim

Before submission, attach one redacted chronological run record showing the initial
task, failed verification, observed failure, corrective action, and successful
re-verification with no intervening human prompt. Also retain the dated initial spec
and one overlapping worker/dispatch record. Commit timestamps and the landing-page
animation are useful context, but neither proves unattended execution by itself.
