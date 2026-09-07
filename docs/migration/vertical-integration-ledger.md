# Five-vertical integration ledger

Root director checkpoint, 2026-09-07 11:03 UTC. Deadline remains 16:41:33 UTC,
anchored at 08:41:33. This records actual launches and accepted baseline evidence,
not completed verticals or full-product parity.

## Accepted common seed and preview

PR9 merged at 10:52:55 UTC to main `596ddbd9e8b6fdc5d5fa26616479e910b34ba604`.
Its complete tree matches tested source `83e9eca2e6f391a1c02f255c14a73b14308b9d24`.
CI run `34113466282` passed macOS/Linux native suites and Windows compilation
(not Windows runtime). Full local Rust tests, strict clippy, fmt, desktop typecheck
and 114 tests passed. Native real daemon/CLI acceptance passed 26 checks.

The exact macOS arm64 package passed 10 Electron/Playwright-CDP checks, including
quit/reopen preserving the incumbent daemon and exact session/output. Seal v3
`d9b7febf7e42f90dcb60098621ec61389aaa3ff1f6d87c08546a3b2a3f108f4d`, 293 entries,
309447135 bytes, 191 notices; local ad-hoc signature, not notarized. Installed
source is `83e9eca` through the versioned preview installer. Previous `dc12c7a`
build and all user data remain; installation stopped no process. Fixture cleanup
reported every owned acceptance process exited without force.

Local acceptance receipts (not portable archive files):
`.preflight/acceptance/core-cli-1788778064300-ca3903f1-2e8a-4c0d-b89a-a460a33ae523.json`
and `.preflight/acceptance/desktop-1788778220335-44ea56ca-94ed-4e71-af04-c732487aed4e/report.json`.
Earlier mail review/corrections are in `native-coordination-combined-acceptance.md`.

## Pi launch acceptance

Root Run `run_ddca7735397e`, runtime `e9c8216c-44ad-42d5-9d9a-065bd6ada0b9`.
Pi Task `task_04ba101a9b04` / Dispatch `ctx_ba61c093aba3` used real read/Git tools
at the clean seed and created subordinate Run `run_f661a6025bcc`. Its Sonnet 5 high
child `task_a3925f2826e5` / `ctx_1df9eb0717cb` was independently verified depth 2,
completed, released and transcript-archived. Root verified the release state and
observed child exit; Pi completion was accepted, release returned external-terminal
retention without process action, then root ACKed its delivery.

The worker correctly declined to self-certify its model from unavailable internal
introspection. Root separately observed the actual Pi startup banner:
`(muse-code) muse-spark-1.3-contributor • max`. The exact launch command was
`/opt/homebrew/bin/pi --provider muse-code --model muse-spark-1.3-contributor --thinking max --approve --offline`.
Offline disables startup networking, not inference. No model switch/global setting
change, generic subagent substitution, extra depth or Qwen benchmark was used.

## Five persistent leaders

Every worktree was created through Orca from the SAME exact main seed above,
with independent top-level lineage and `--setup run`. Repository policy is
start-immediately and its setup script is empty. Orca's default-prefixed new
branches were renamed to the assigned `codex/` names before agent launch; no
existing branch was replaced. Root read each newly created unused shell before
launching custom Pi argv in that same terminal, avoiding extra fallback tabs.
All five worker-start receipts are `ready/input_accepted`; Task/Dispatch depth 1
and each startup model/max banner were independently verified. Pinned dependencies
were installed with Node24/pnpm offline/frozen in every checkout: exit 0, 241 reused,
zero downloads. Leaders own normal commits/PRs on their branches, not main.

All checkout paths are under `/Users/carlos/orca/workspaces/Drogon-rewrite/`.

| Vertical / checkout | Branch | Task / Dispatch | First deliverable |
|---|---|---|---|
| V1 `codex-vertical-01-runtime-cli` | `codex/vertical-01-runtime-cli` | `task_bbb62f343b3c` / `ctx_c62f0e47ad7a` | Native model dogfood/retry/release and remaining CLI/harness obligations |
| V2 `codex-vertical-02-desktop-settings` | `codex/vertical-02-desktop-settings` | `task_9e42feed8627` / `ctx_b8999954bf9c` | Both archived navigation failures, CDP, typed V3/V4 mounting contract |
| V3 `codex-vertical-03-workspaces-remote` | `codex/vertical-03-workspaces-remote` | `task_a12105de2816` / `ctx_62b07c551e42` | Folder/Git explorer and real read/save editor, host-safe contracts |
| V4 `codex-vertical-04-capabilities` | `codex/vertical-04-capabilities` | `task_565c41f74577` / `ctx_6f0e78e8230d` | Bots/schedule/history behavior and exported panel, existing store reused |
| V5 `codex-vertical-05-platform-release` | `codex/vertical-05-platform-release` | `task_1546a2a90f4c` / `ctx_3dc8d5809559` | Windows/runtime boundary with V1, runners and E5 decisions |

Each may start up to two disjoint same-worktree coding leaves, Sonnet 5 high and/or
approved OpenCode GLM/Muse. Exactly two delegated generations, no extra worktrees,
no leaves dispatching. Leaders delegate implementation and own review/testing and
small merge-ready checkpoints; a first checkpoint does not settle their full
vertical responsibility. Root serializes shared-contract wiring and integration
on `codex/vertical-integration` in the original contract checkout, not the dirty
historical main checkout. No leader files may be read as accepted merely because
they are dirty or a worker reports success.

## Acceptance state and next checkpoint

At this checkpoint all five assignments are launched, but no first vertical
delivery is accepted. Root is awaiting their child-Run/file-ownership maps and
bounded interface requests. Aim for reviewable checkpoints in 30-45 minutes and
continuous composition, not five final merges at the deadline.

Full scope remains 46 assigned packages, all original source/Drogon features,
platforms and shared gates. Source audit remains 11/12 (91.7%, medium confidence,
delta 0); product fidelity has no defensible completion percentage. E5 rights,
recordings, exact notices and service decisions remain open. The delayed old-wave
closure consumed more than two hours of the eight-hour window; full parity by
the deadline is high risk and is not promised by staffing or these passing checks.

## 11:18 UTC: first integration and mailbox correction

V2 checkpoint `518e4cb676c9e1772b6eb2c372467f91fb8ac6de` is staged as
`02d3735` in the integration branch. Root independently ran desktop 141/141
tests, typecheck, build and both real-Electron navigation regressions through
Playwright CDP. Active workspace re-click preserves the visible tab and exact
session ID/host/incarnation; reload restores the second folder without a session.
The owned desktop, fixture daemon and sessions all exited without forced cleanup.
Local evidence: `.preflight/verify-v2-navigation.mjs`; result under
`/var/folders/8g/w9x4n8ws4mx6vxjhmnrnwy640000gn/T/dgnav-qzP0Uc/report.json`.
The first probe attempt had a wrong CLI executable name and was a setup failure,
not product RED; its daemon exited without force. This is development-build
acceptance, not a newly sealed/installed build. Panel mounting remains unaccepted:
root requested nullable session props and safe unavailable-capability fallback.

V3 `ff327a56`/`2cd9153` is under review, not integrated: file-read bounds,
special-file admission, write permissions/path races and UI stale-state/save
identity require correction before exposing filesystem RPC. V5 docs-only
`2d9990e`/`893113e` is not product progress; stale package/security claims were
returned for correction and actual Windows fixture runner work was assigned.

Root reproduced a live coordinator-mail routing limitation: after a leader binds
its child Run, ordinary checks read that Run; selecting the parent Run returns
`consumer_fenced`, and root-Run dispatch-addressed guidance is not returned.
Sending as root with matching `--run <child-run>` and `--to run:<child-run>`
delivers guidance to the leader's existing coordinator inbox. V5 acknowledged
this route, then began the requested implementation. No rebind, impersonation,
restart, depth change or child-mail acknowledgment by root was performed.
The same guidance was relayed to all five existing child Runs. Their Tasks and
Dispatches retain original ownership and depth; this is an operational routing
correction, not a claim that the Orca product limitation was fixed.
