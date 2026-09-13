# AI development log

Prepared in English on September 13, 2026 from dated repository artifacts, public
PR/issue records and the builder's account in [SYSTEM.md](SYSTEM.md).
This is a curated development log, not a fabricated transcript. All times below
are UTC. Historical test results apply to their linked revisions, not a fresh run
of the submission branch.

## Reading the evidence

Agents and bots used the authenticated `clioo` account to publish work. A
coordinator, QA or worker label describes an event's role, not a distinct GitHub
identity. The builder confirms that review-to-fix follow-ups ran under the existing
orchestration rather than requiring a new manual prompt at every step. The public
record supplies the corresponding comments, subsequent commits and checks.

Model names in task reports and commit coauthor metadata are attribution records,
not independent identity verification. We retain this distinction without requiring
private client data, credentials or full provider transcripts.

## September 5–7 — intent, specifications and dispatch

| Event | Evidence | Why it matters |
| --- | --- | --- |
| September 5, 19:10:59: goal recorded before product implementation | [Goal at c6189dac](https://github.com/clioo/drogon/commit/c6189dac9b9ec5d6d2eff30be2639a8a935db9df) | Defines architecture, coordinator responsibility, three worker lanes and acceptance before expansion. Explicitly states implementation had not started. |
| September 5, 19:56:20: foundation implementation | [c3eb8802](https://github.com/clioo/drogon/commit/c3eb8802a8a1731fce0f5bd37e14531a1eeb2373) | Protocol and desktop work follows the recorded goal. |
| September 7, 18:19:24: initial scope plan refined | [PR #16](https://github.com/clioo/drogon/pull/16) | Twelve journeys, exclusions, four waves, ownership and dependency gates. Commit credits Claude Fable 5.1. |
| September 7, 18:48:00: simultaneous lanes recorded | [Status commit 9c92b5e9](https://github.com/clioo/drogon/commit/9c92b5e95f1e759b323b42c331de8c94cd3324cb) | Palette/review/sidebar work is merged while backbone/CLI, automation and browser work remains in progress in separate lanes. |

The initial scope plan refined an existing foundation; it was not the first specification.
[SPEC.md](SPEC.md) provides the English consolidation and links present behavior to
existing implementation and tests.

## Primary autonomous loop: PR #5

Task: preserve provider-record extensions without allowing them to override typed
or reserved authority. All events in this table occurred on September 6.

| Stage | Time | Recorded event |
| --- | --- | --- |
| Act | 21:05:59 | [Implementation 3c91fff9](https://github.com/clioo/drogon/commit/3c91fff97cfe7df95564a2836a465513d6b5b004). |
| Verify and observe | 21:22:05 | [Independent review](https://github.com/clioo/drogon/pull/5#issuecomment-5562259983) finds that `launchEnv` is rejected on input but can still be serialized through extensions. Existing green checks missed this boundary. |
| Fix | 21:28:58 | [Correction 5e0f57ae](https://github.com/clioo/drogon/commit/5e0f57ae91c7f54ae5eea2ded5d836f08f68087c) reserves the key and adds regression coverage and a RED receipt. It follows the review comment. |
| Verify again | 21:30:35–21:30:44 | [CI run 34061203435](https://github.com/clioo/drogon/actions/runs/34061203435) passes Windows compilation, macOS native tests and Ubuntu native tests on the corrected SHA. |
| Record the outcome | 21:31:56 | [Follow-up report](https://github.com/clioo/drogon/pull/5#issuecomment-5562316669) records the genuine RED, passing correction, 379 workspace tests, clippy/fmt and green CI. |

The review records run `run_ddca7735397e` and three scoped read-only tasks:
Muse correctness (`task_0c89c05e28c9`), Sonnet authority
(`task_c8915bdd6b14`) and Kimi evidence (`task_48a381a99d95`).
The coordinator reconciled their findings and accepted the serialization defect;
approval was not decided by majority vote.

The [committed RED output](https://github.com/clioo/drogon/blob/5e0f57ae91c7f54ae5eea2ded5d836f08f68087c/tests/parity/ports/WP-ENG-RUNTIME/native-session-authority/provider-record/red-round-launchenv.txt)
records 10 passed and one failed test:
`source_refused_launch_env_never_persists_through_extensions_smuggling`.
The [acceptance record at the corrected commit](https://github.com/clioo/drogon/commit/5e0f57ae91c7f54ae5eea2ded5d836f08f68087c)
records 11/11 after the correction, 227 core tests and 379 workspace tests.
The RED output has no separate wall-clock timestamp; its placement in the correction
commit is not presented as a timestamp for when the failing test ran.

This is the submission's clearest Act → Verify → Observe → Fix → Verify example:
a concrete task, a missed failure found by another agent, a subsequent correction,
a failing regression receipt and independently recorded CI on the corrected commit.
The builder's account supplies the unattended-operation context.

## Early foundation: additional independent review and recovery

- **PR #3 — startup permission boundary.** A
  [19:53:40 review](https://github.com/clioo/drogon/pull/3#issuecomment-5561758097)
  identified missing hardening when startup fails before the database gate.
  [Correction 1a812ed9](https://github.com/clioo/drogon/commit/1a812ed998dbed65d313e083d144ee908b034b29)
  followed at 20:16:46. The
  [20:18:21 report](https://github.com/clioo/drogon/pull/3#issuecomment-5561902884)
  records the regression and 368 passing tests. CI was still pending in that report.
- **PR #7 — fixture success was insufficient.**
  [Real packaging failed](https://github.com/clioo/drogon/pull/7#issuecomment-5562457806)
  and the candidate had to be corrected and rebuilt. The
  [later report](https://github.com/clioo/drogon/pull/7#issuecomment-5564784748)
  records packaging and acceptance results, including a Pi empty-profile fixture;
  that fixture is not a live-model inference result.
- **PR #8 — readiness race.** The
  [review and correction trail](https://github.com/clioo/drogon/pull/8#issuecomment-5564768275)
  records listener-readiness reproduction and packaged-app checks with screenshots.
- **PR #9 — specialist reviewers.** The
  [PR report](https://github.com/clioo/drogon/pull/9) names three supplemental tasks:
  two Sonnet review dimensions and one OpenCode/ZAI GLM lane. Root reconciliation
  follows those three reviews; it is not the third reviewer.
- **PR #10 — coordinated checkpoint.** The
  [report](https://github.com/clioo/drogon/pull/10) records five leader tasks,
  an 86-row audit and a 126-task inventory, including recovery and handoffs.

The early-history review covered repository numbers #1–200, containing 156 merged
PRs in the inspected snapshot. GitHub issues and PRs share a number sequence: this
is not a claim to have inspected 200 separate PRs. Status/documentation PRs are
coordination evidence, not additional product features.

## September 8 — assignment, capacity and QA boundaries

R16 comments show explicit dispatch by specialization:
[Muse copy/token work](https://github.com/clioo/drogon/issues/124#issuecomment-5578419535),
[Sonnet editor work](https://github.com/clioo/drogon/issues/133#issuecomment-5578420623),
[a nine-worker cap](https://github.com/clioo/drogon/issues/156#issuecomment-5578798907)
and [follow-up to an existing worker](https://github.com/clioo/drogon/issues/185#issuecomment-5579686793).
These complement the dated parallel-lane status, rather than relying on commit
cadence alone.

QA reported partial results when that was all it could establish:
[issue #118](https://github.com/clioo/drogon/issues/118#issuecomment-5578648636)
retains unverifiable live Pi hook states, while
[issue #136](https://github.com/clioo/drogon/issues/136#issuecomment-5578974947)
records a rerun and remaining failures. Incomplete verification was not converted
into a blanket pass.

### Headless automation: issue #186

1. **Act:** [Assign the headless-launch slice](https://github.com/clioo/drogon/issues/186#issuecomment-5579679347)
   to the running task and make the dependent automation lane wait.
2. **Verify and observe:** [QA reproduces the break](https://github.com/clioo/drogon/issues/186#issuecomment-5580354718):
   Pi remains at `needs_input`, the run says `Launched`, no work completes,
   and the detail contains interactive TUI output.
3. **Fix:** [The worker report and PR #227](https://github.com/clioo/drogon/issues/186#issuecomment-5580587630)
   identify positional prompting and interactive approvals as incompatible with
   the unattended path, and introduce explicit headless launch behavior.
4. **Verify again:** That report records a live DGX-Spark run with
   `HEADLESS_OK`, completed scheduled work and no sessions at `needs_input`.
   The [later closure note](https://github.com/clioo/drogon/issues/186#issuecomment-5584609271)
   requests installed-build re-verification and keeps a separate policy gap in
   #188. The request is not itself evidence that this additional QA passed.

### CI recovery: issue #312

The [reopened issue](https://github.com/clioo/drogon/issues/312#issuecomment-5589713766)
shows that an earlier mitigation did not eliminate the failure. The investigation
evolved; the external signal sender was not established, so the initial diagnosis
is not presented here as a proven final cause.

The [subsequent mitigation report](https://github.com/clioo/drogon/issues/312#issuecomment-5591122750)
and [PR #342](https://github.com/clioo/drogon/pull/342) discuss remaining timeout
and module-pollution failures rather than hiding them. The
[closure](https://github.com/clioo/drogon/issues/312#issuecomment-5592145226)
records three consecutive green main runs. This is recovery through revised
hypotheses and repeated verification, not a claim that the first fix solved it.

## September 10 — adversarial lifecycle hardening

[PR #409's adversarial follow-up](https://github.com/clioo/drogon/pull/409#issuecomment-5615172599)
maps five observed breaks to corrections and red-first regressions: disable-mid-turn,
Stop while disabled, disable/re-enable state, restart durability and foreign-harness
hook events.

[PR #417's next round](https://github.com/clioo/drogon/pull/417#issuecomment-5616145127)
addresses two additional races and a forged-event path. The
[integration follow-up](https://github.com/clioo/drogon/pull/417#issuecomment-5617869726)
records the rebase and post-fix tests. A passing happy path did not end the review;
newly observed failures became regression coverage.

## Later dogfooding — Drogon building Drogon

The builder places the final three days of development inside Drogon itself.
These reports document concrete use of the resulting execution paths:

| Report | What the run exposed | Recorded result |
| --- | --- | --- |
| [PR #523](https://github.com/clioo/drogon/pull/523) | Real Pi/Luna runs across three orchestration modes exposed drift handling, unwanted runtime commits, missing CLI access and editor persistence problems. | Corrections plus requested artifacts, execution evidence and repository commit-count checks. |
| [PR #527](https://github.com/clioo/drogon/pull/527) | UI testing exposed conflicting child-worker instructions, fragile completion keywords and missing live-session projection. | Role-specific context, artifact verification, 18 reported acceptance checks and 53/55 inventoried Orchestrator controls exercised. This is not whole-product coverage. |
| [PR #528](https://github.com/clioo/drogon/pull/528) | DGX-backed bot work created monitor/scheduled execution while the UI incorrectly reported a disconnected adapter. | UI correction and nine reported checks covering monitoring, scheduled work, resulting files and UI. |

Ordinary acceptance uses fixtures, as documented in [acceptance.md](acceptance.md).
These historical live-model reports are labeled separately and do not authorize
real inference during current contributor validation.

## Human decisions and lessons

The human supplied intent, chose the deadline scope and tested usability in real
work. Browser work was deferred rather than declared complete; the CLI was
prioritized so bots could create workspaces and delegate without manual handoffs.

The practical lesson was that orchestration needed both a clear brief and a way to
return observed failures. Independent reviews found defects that existing green
tests missed. Corrective commits and regression results, not completion messages,
closed the loop.
