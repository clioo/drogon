# Drogon–Orca UX and parity audit

**Report status: validated read-only audit report, ready for coordinator/Carlos triage. Product, full rendered parity, release and installed acceptance are NOT granted.**

## 1. Executive summary

The current rewrite is a working but narrow local workspace/terminal/harness shell, not a full Orca replacement. The audit found two real navigation failures in that implemented shell: clicking the already-selected workspace hides its live tab; renderer reload forgets the selected second workspace. Neither result proves a process exited or data was lost. Missing source capabilities remain explicit rather than being awarded parity through placeholders or records-only code.

The sealed artifact passed 14 bounded positive shell/package/form/recovery checks. A separate real-CDP regression run preserved those 14 positive checks but **FAILED both navigation expectations**, with exact fixture cleanup and an unchanged artifact seal. Sixteen CLI help/error/unsupported-entry probes met their stated expectations; unsupported-command errors are missing-capability evidence, not feature PASS. Source Mentu quarantine was positively characterized; a worker's opposite assertion was rejected. Windows native service is explicitly unsupported despite green compilation.

This package contains 86 finding/contract rows ({'P1': 43, 'NIT': 15, 'P2': 28}), a 50-ID source crosswalk, reproducible commands, source/body references, source/target screenshots, qualifications and independent review. Counts are not a product-completion score. No source code, Git refs/commits/PRs, installed preview or user product data was changed by this audit. Reviewer-provider calls via Orca are distinct from prohibited product/benchmark inference.

## 2. Baseline and clean-status proof

- Whole fork: `/Users/carlos/Documents/Drogon-mentu-session`, `clioo/drogon-orca` (upstream `stablyai/orca`), pinned `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. Tracked source clean; one untracked local plan `.mentu/plans/drogon-rewrite-preflight.md` explicitly excluded. No tests/tools used its cwd; pinned Git reads only.
- Candidate: `/Users/carlos/orca/workspaces/Drogon-rewrite/final-audit`, branch `clioo/final-audit`, HEAD `252de85c2fd28bbdc4c09c70c16063a0c7eb901e`. Initial and repeated porcelain output empty. The earlier dirty primary checkout at 0f915cf was **not** incorporated. Carlos moved this harness into its own clean Orca session; this baseline change was announced explicitly before audit delegation.
- Complete Git tree `ba24aee8aa84c02c8a9b761867d825d03384f64e` is identical for target 252de85 and package-source dc12c7a. They are distinct commits; artifact build metadata is not relabeled.
- Retained artifact: `/tmp/drogon-ux-parity-audit-252de85c2fd2/retained-bundle/Drogon.app`. Build revision `dc12c7ab4c8a5b82802da5f54dcc17824f9eb90f`; sealed v3 digest `320ab38c3e0fc4371532e0e59c82b3fa22dcc618c07332c942819eccdd59a7f9` ; 293 entries / 307543311 bytes. `verify-baseline.mjs` and `artifact-retention.json` prove identity.
- Original worktree package location became unavailable before a later probe; that probe failed before launching any process. Cause is unknown; the implementation coordinator says it did not remove it. The independently sealed archived installed copy was verified and copied to audit `/tmp`. No installation, app-link change or user-session replacement occurred. Original observation is retained in `baseline-original.json`; current reproducibility uses the retained identical package.
- PR #7 is now MERGED at 252de85 (handoff's open-PR statement is stale); PR #8 MERGED at b7addf4. Read-only `gh pr view` confirmed their Ubuntu/macOS native and Windows-compilation checks. No new merge/PR operation occurred. Other ongoing implementation branches are outside this frozen audit.

## 3. Formal source audit index

**11/12 = 91.7%**, unchanged: M1–M7 metadata plus E1–E4 source reconciliation. E5 still holds publication/assets/recordings/packaged-notice/service-policy decisions, not permission to publish private or rights-uncertain material. The ledger Markdown still contains historical 10/12 prose; its JSON and e3-final-composition/audit-progress documents carry 11/12. Target `docs/STYLEGUIDE.md` is absent; the pinned fork guide was explicitly read instead.

This number is not UX fidelity, implemented feature completion, test coverage, installed acceptance, or a linear estimate of remaining effort. Source deeper/runtime obligations stay visible. No E5 group was closed here. Confidence in this inherited source-characterization index is medium; delta is 0 groups. The next product closure milestone is triage and tests-first fixes for the two observed navigation failures, then the missing capability gates. A full-fidelity 24-hour implementation commitment remains high risk; this audit does not manufacture an ETA.

## 4. UX coverage and exclusions

Coverage addresses A–K from the handoff, the existing 50-source-ID anti-omission index and additional concrete runtime/navigation findings. `coverage.json` maps all 50 IDs without treating them as 50 passing capabilities. Source bodies are anchored in the matrix and `workers/source-bodies.json`; 12 interior dependency details remain explicitly unexecuted/unread where the claimed contract stops at the owning surface. Optional/default-hidden/experimental and legacy components are distinguished from missing source behavior.

Fresh rendered scope: macOS arm64 Electron+Playwright/CDP; synthetic ordinary folders; sealed actual package; 1440×1000/DPR1 wide and 760×600/DPR1 narrow; actual light/dark rendering; real shell input/output/session recovery and native replies. Initial/empty, normal, pending, path error/recovery, transport timeout/recovery and alternate-theme/narrow states were captured for the existing workspace–terminal flow. Harness picker/default/trust/form/escape states were rendered **without launching an agent**.

| Flow/screen | Empty/initial | Normal | Pending | Failure/recovery | Alternate theme/narrow |
|---|---|---|---|---|---|
| Workspace shell/registration | initial-empty, workspace-form-empty | workspace-added-empty-session | pending-real-transport | workspace-path-failure, recovered-after-latency | light/dark/narrow |
| Terminal/session | workspace-added-empty-session | terminal-normal | real transport latency/timeout | terminal-unverifiable, terminal-transport-recovered, terminal-reload-recovered | light/dark/narrow |
| Harness picker/form | harness-menu-availability, harness-form-initial | advanced form fields/trust default (not execution success) | launch not attempted | Escape/no session; actual launch failure/cancel not freshly exercised | harness-form-advanced-light/dark/narrow |
| Active workspace navigation | one visible live tab | clicking current row is the tested action | n/a synchronous action | active-workspace-click shows missing tab; service remains live; Refresh recovers | normal shell theme evidence |
| Workspace selection restore | first+second fixture workspace | selected-second-workspace | reload | workspace-selection-after-reload shows reset | normal shell theme evidence |
| Missing source UI families | No candidate route/component/runtime; confirmed missing rather than a fake screenshot | Not renderable in candidate | Not renderable | Not renderable | Not renderable |
| Original fork reference | Verified historical empty workspace/Bots/Meetings captures, exact hashes | Additional historical form/settings evidence and owning-source contracts; no whole reference success claim | Source owning-state bodies/retained contracts | Source availability/error contracts; no unsafe reference relaunch | Historical light1440×1000; unmatched original dark/narrow states remain an evidence gap |

Exclusions are **not waived product requirements**: Windows native IPC missing; Linux GUI/WSL/SSH/two-way remote version skew not run; real provider/model inference, actual Bot/automation/recipe/meeting execution, transcription/download/install/publish/account mutations prohibited; no benchmark with/without Mentu; no user profiles/transcripts; no external service provisioning. Full IME/paste/Unicode/Nerd-glyph behavior, keyboard-close focus, screen-reader certification/all-control contrast, performance budgets and every original screen's five-state rendered matrix remain unverified. A static component/file or green unrelated test never closes those obligations. Missing candidate features are listed, not implemented during audit.

## 5. Findings matrix

**Integral full 13-field matrix:** [matrix.md](matrix.md) / [matrix.json](matrix.json). Each row includes source/target behavior and evidence, disposition, severity, user/fidelity impact, acceptance journey, owner/dependency and confidence. Proposed acceptance journeys are future tests, not actions executed in this read-only audit. `defer`/`scope-change` are recommendations for explicit triage, never silent removal of implemented source features.

| ID | Area | Disposition | Priority | User impact |
|---|---|---|---|---|
| UX-NAV-01 | navigation | missing | P1 | no entry points to Bots/Automations/Mentu/Meetings |
| UX-BOTS-01 | G-bots | reuse | NIT | identity defaults already native |
| UX-BOTS-02 | G-bots | missing | P1 | core bot creation + responsibility authoring journey |
| UX-BOTS-03 | G-bots | missing | P1 | no bot conversation surface |
| UX-BOTS-04 | G-bots | missing | P1 | harness/model policy authoring unavailable |
| UX-BOTS-05 | G-bots | missing | P1 | responsibility execution + history is the bots value loop |
| UX-BOTS-06 | G-bots | defer | P2 | reactive responsibilities cannot actually fire |
| UX-AUTO-01 | G-automations | missing | P1 | scheduled work never runs without engine |
| UX-AUTO-02 | G-automations | missing | P1 | No implemented automation history/reconciliation workflow; do not infer an observed data-loss bug from its absence. |
| UX-AUTO-03 | G-automations | rewrite | P1 | host-ownership fencing protects scheduled dispatch on wrong host |
| UX-MENTU-01 | H-mentu | missing | P1 | recipe review/approval/execute journey absent |
| UX-MENTU-02 | H-mentu | missing | P1 | Run/retry/quarantine evidence cannot be inspected in the candidate; formal records are a separate scope row. |
| UX-MENTU-03 | H-mentu | missing | P1 | No shared Mentu panel/tab or reviewed recovery workflow; stale-response and resume safety must be preserved when implemented. |
| UX-MEET-01 | I-meetings | missing | P1 | no meeting surface or availability explanation |
| UX-MEET-02 | I-meetings | defer | P2 | adding a recording button would be a fidelity regression |
| UX-MEET-03 | I-meetings | missing | P1 | no transcript browsing |
| UX-MEET-04 | I-meetings | missing | P2 | Q&A over transcripts absent |
| UX-MEET-05 | I-meetings | missing | P1 | speech separation + non-destructive probing are trust contracts |
| UX-SHELL-NAV-01 | A-navigation | missing | P1 | Source global feature pages beyond the current workspace/terminal shell are unreachable. |
| UX-SHELL-NAV-02 | A-navigation | missing | P1 | no configuration surface |
| UX-SHELL-VIS-01 | B-visual | missing | P1 | no theme choice independent of OS |
| UX-SHELL-VIS-02 | B-visual | reuse | P2 | new surfaces need consistent primitives |
| UX-SHELL-WS-01 | C-workspaces | preserve | NIT | Existing ordinary folders can be registered and used; alias and full worktree parity remain separate. |
| UX-SHELL-WS-02 | C-workspaces | missing | P1 | stale workspaces cannot be dropped |
| UX-SHELL-WS-03 | C-workspaces | missing | P2 | no organization of many workspaces |
| UX-SHELL-J-01 | J-explorer | missing | P1 | no file browsing |
| UX-SHELL-J-02 | J-editor | missing | P1 | no file viewing/diffing |
| UX-SHELL-J-03 | J-source-control | missing | P1 | no git workflows in product |
| UX-SHELL-J-04 | J-checks | missing | P2 | no CI visibility |
| UX-SHELL-J-05 | J-ssh | missing | P1 | no remote operation possible |
| UX-SHELL-J-06 | J-skew | missing | P2 | no mixed-version visibility when remotes land |
| UX-SHELL-K-01 | K-localization | missing | P2 | non-English users lose localized surface |
| UX-SHELL-K-02 | K-a11y | missing | P2 | power-user keyboard layer absent |
| UX-SHELL-K-03 | K-copy-privacy | missing | P2 | no privacy/provenance surface |
| UX-RT-D-01 | D-sessions | reuse | NIT | identity races guarded |
| UX-RT-D-02 | D-terminals | reuse | NIT | terminal fidelity |
| UX-RT-D-03 | D-liveness | reuse | NIT | trust in session state |
| UX-RT-D-04 | D-tabs | reuse | NIT | close/dismiss trust |
| UX-RT-D-05 | D-tabs | missing | P2 | power-user layout absent |
| UX-RT-D-06 | D-recovery | reuse | NIT | Service/session survived the tested owned desktop-process stop and reopen; native menu Quit is not separately verified. |
| UX-RT-E-01 | E-launch | missing | P1 | launch breadth absent |
| UX-RT-E-02 | E-policy | reuse | NIT | Generic model/provider/trust input normalization is reusable; richer per-agent policy mediation still needs acceptance. |
| UX-RT-E-03 | E-readiness | reuse | NIT | interrupted launches restorable |
| UX-RT-E-04 | E-usage | missing | P2 | no cost/token visibility |
| UX-RT-F-01 | F-bootstrap | reuse | NIT | spawn-over-live is a P0 hazard if regressed |
| UX-RT-F-02 | F-auth | reuse | NIT | auth fails closed |
| UX-RT-F-03 | F-lock | reuse | NIT | multi-instance race safety |
| UX-RT-F-04 | F-cli | missing | P1 | CLI parity far from source |
| UX-RT-F-05 | F-cli-contract | reuse | NIT | scriptability |
| UX-RT-F-06 | F-shutdown | reuse | NIT | clean shutdown trust |
| UX-SURFACE-01 | Browser pane (trust-boundary / guest-view chrome) | missing | P1 | No integrated browser pane workflow in the candidate; stated optional/legacy limits apply. |
| UX-SURFACE-02 | Native-chat portal (per-tab rendering mode) | missing | P1 | No integrated native-chat portal workflow in the candidate; stated optional/legacy limits apply. |
| UX-SURFACE-03 | Agent dashboard popout | missing | P2 | No integrated agent dashboard popout workflow in the candidate; stated optional/legacy limits apply. |
| UX-SURFACE-04 | AI Vault session panel | missing | P1 | No integrated ai vault session panel workflow in the candidate; stated optional/legacy limits apply. |
| UX-SURFACE-05 | Branded per-provider account switcher (status bar, not only Settings->Accounts) | missing | P1 | No integrated branded per-provider account switcher workflow in the candidate; stated optional/legacy limits apply. |
| UX-SURFACE-06 | First-run onboarding flow | missing | P1 | No integrated first-run onboarding flow workflow in the candidate; stated optional/legacy limits apply. |
| UX-SURFACE-07 | Contextual feature-tip system | missing | P2 | No integrated contextual feature-tip system workflow in the candidate; stated optional/legacy limits apply. |
| UX-SURFACE-08 | Plugin marketplace install/consent + rollback | missing | P1 | No integrated plugin marketplace install/consent + rollback workflow in the candidate; stated optional/legacy limits apply. |
| UX-SURFACE-09 | Native notification delivery + permission probing | missing | P1 | No integrated native notification delivery + permission probing workflow in the candidate; stated optional/legacy limits apply. |
| UX-SURFACE-10 | Stats settings pane + search index contribution | missing | P2 | No integrated stats settings pane + search index contribution workflow in the candidate; stated optional/legacy limits apply. |
| UX-SURFACE-11 | Status-bar pet segment (agent-state-driven animation) | missing | P2 | No integrated status-bar pet segment workflow in the candidate; stated optional/legacy limits apply. |
| UX-SURFACE-12 | Quick command definition + terminal/tab trigger | missing | P1 | No integrated quick command definition + terminal/tab trigger workflow in the candidate; stated optional/legacy limits apply. |
| UX-SURFACE-13 | Sparse-checkout presets (repo-scoped, applied at worktree-creation time) | missing | P1 | No integrated sparse-checkout presets workflow in the candidate; stated optional/legacy limits apply. |
| UX-SURFACE-14 | Remote-server settings/compatibility | missing | P1 | No integrated remote-server settings/compatibility workflow in the candidate; stated optional/legacy limits apply. |
| UX-SURFACE-15 | Mobile pairing (QR) + emulator pane | missing | P1 | No integrated mobile pairing workflow in the candidate; stated optional/legacy limits apply. |
| UX-SURFACE-16 | PR page (reexport chain confirmed; deep body reused from root) | missing | P1 | No integrated pr page workflow in the candidate; stated optional/legacy limits apply. |
| UX-SURFACE-17 | Settings search (per-control keyword index) | missing | P2 | No integrated settings search workflow in the candidate; stated optional/legacy limits apply. |
| UX-SURFACE-18 | Settings deep links | missing | P2 | No integrated settings deep links workflow in the candidate; stated optional/legacy limits apply. |
| UX-SURFACE-19 | Shared keybinding definitions + shortcut editor + global dispatcher | missing | P2 | No integrated shared keybinding definitions + shortcut editor + global dispatcher workflow in the candidate; stated optional/legacy limits apply. |
| UX-SURFACE-20 | Web-mode fallback API (browser deployment target) | missing | P2 | No integrated web-mode fallback api workflow in the candidate; stated optional/legacy limits apply. |
| UX-SURFACE-21 | Workspace-space (disk usage) manager | missing | P2 | No integrated workspace-space workflow in the candidate; stated optional/legacy limits apply. |
| UX-SURFACE-22 | Terminal search overlay | missing | P2 | No integrated terminal search overlay workflow in the candidate; stated optional/legacy limits apply. |
| UX-SURFACE-23 | Floating terminal (detach/resize/orchestration dialog) | missing | P2 | No integrated floating terminal workflow in the candidate; stated optional/legacy limits apply. |
| UX-SURFACE-24 | Platform shell chrome | rewrite | P2 | Window-chrome contract differs from the source custom chrome; native controls are not claimed absent and OS-level appearance was not certified. |
| UX-SURFACE-25 | Legacy DrogonProductSectionPage placeholder | defer | NIT | No active feature gap asserted for this legacy scaffold; do not substitute it for the real source Bots/Meetings pages. |
| UX-MENTU-CP | Mentu/Commitment Protocol | scope-change | P2 | Do not mistake ordinary run logs for formal protocol commitments. |
| UX-AUTO-APPROVAL | Automation approval scope | scope-change | P2 | Do not invent a parity feature or remove general authorization based on a keyword grep. |
| UX-PLATFORM-WINDOWS | Windows native service | missing | P1 | The Windows packaged runtime cannot be accepted as functional. |
| UX-RECOVERY-PENDING | Pending/reconnect copy | rewrite | P2 | Users receive a premature recovery instruction for a still-healthy service. |
| UX-MENTU-RECORD-OBS | Mentu record/liveness clarity | rewrite | P2 | A stale run record must not be mistaken for observed process liveness. |
| UX-SURFACE-PORTS | Workspace ports | missing | P1 | Users cannot inspect or manage workspace-local/remote forwarding through the UI. |
| UX-SURFACE-SKILLS | Skills | missing | P1 | The named integrated source workflow is unavailable in the rewrite. |
| UX-SURFACE-ARTIFACTS | Artifacts | missing | P1 | The named integrated source workflow is unavailable in the rewrite. |
| UX-SURFACE-TASKS | External task providers | missing | P1 | The named integrated source workflow is unavailable in the rewrite. |
| UX-NAV-ACTIVE-WORKSPACE | Workspace/session navigation | rewrite | P1 | Existing work disappears from the UI and may prompt duplicate session creation; Refresh recovers it. |
| UX-NAV-RESTORE-WORKSPACE | Workspace selection persistence | missing | P1 | Reload drops the user into a different workspace. |

## 6. Preserved/working slices, with exact limits

The positive evidence supports ordinary-folder registration and real error feedback; actual shell output; exact native session/output retention across renderer reload and GUI quit/reopen; timeout→unverifiable→same-session/service recovery; keyboard **selection** plus exact sibling mouse-close and dismissed-tab persistence; basic token/theme reuse; safe picker-form dismissal; actual sealed fixture quiescent cleanup. The driver’s historically named quit/reopen check stops the exact owned desktop child via SIGTERM and reopens it; it is not a separately executed native-menu Quit or window-close interaction. These are bounded candidate/required-contract slices, not full-source-journey certification. The two navigation failures specifically prevent calling complete workspace/session UI persistence preserved. Most raw worker `preserve` labels were narrowed to reusable implementations and unexecuted edge obligations.

## 7. Missing/materially different surfaces

No integrated Settings/search/shortcuts/localization; project grouping/removal and worktree management; explorer/editor/diffs/source control/checks/PR workflow; browser/native-chat/Vault/dashboard/account surfaces; Skills/Artifacts/Tasks/plugins/onboarding/notifications/stats/pets; remote/mobile/emulator/ports/web deployment; connected Bots/automations/Mentu/Meetings. Native Bot/automation records are real code but no routed feature. The source legacy DrogonProductSectionPage scaffold is not the active Bots/Meetings implementation and is not a reason to accept the candidate placeholder.

Source limitations must not be replicated blindly: Mentu stored status is not process liveness; cancellation is intent; automation recovery waits for a surface/grace; folder removal catches sweep errors before metadata removal; web fallback can fabricate empty/false-like responses for unimplemented APIs. Quarantine **exists** and must not be deferred as a newly invented feature. Formal Commitment Protocol records, connected reactive event adapters and live meeting capture were not established as implemented source product behavior; their separate scope decisions remain explicit.

## 8. Visual evidence index

Fresh positive-run evidence and hashes: `evidence-index.json`. Navigation failure images/hashes: `navigation-visual-index.json`; navigation tested bundle is `/tmp/drogon-ux-parity-audit-252de85c2fd2/retained-bundle/Drogon.app`, with its report at `harness/.preflight/acceptance/desktop-1788767241615-bd578f1a-4f4a-4650-b1a2-3d58a534db32/report.json`. All screenshots are local synthetic fixtures, not published artifacts.

Original reference image hashes, 1105 verified visual-build outputs and five pre-existing main-process-only isolation guards: `reference-evidence.json`. Original source captures live under `/Users/carlos/orca/workspaces/Drogon-rewrite/final-audit/docs/migration/reference-captures/c9790628-light-empty/`. Historical form/settings and other captures retain their original limited scope. Rights-uncertain character artwork and private-host terminal captures are not embedded or redistributed in this report. No pixel-perfect comparison, source font-file identity or full original dark/narrow equivalence is claimed.

## 9. Commands and exact results

Runtime used: Node 24.19.0, existing Playwright 1.63.0 for CDP; esbuild 0.25.12 only for unchanged-source reader characterization. No dependency installation. Isolated exported scripts use existing dependency modules through disclosed read-only symlinks; source-build reproducibility of those dependencies is not claimed.

- `node verify-baseline.mjs`: VERIFIED_IDENTITY_NOT_FEATURE_ACCEPTANCE; full source-tree equality and identical retained seal, even though navigation assertions fail.
- `node verify-reference-evidence.mjs`: VERIFIED; 1105 output hashes and three initial reference PNG hashes; not fresh reference-app execution or detached-helper exit proof.
- `node harness/scripts/accept-desktop.mjs --bundle <retained-bundle>`: original 10 bounded checks previously passed. Its original bundle path is now historical; retained copy has the identical seal.
- `node harness/scripts/audit-desktop-states.mjs --bundle <retained-bundle>`: latest 14 bounded checks PASSED, cleanup exited; 18 screenshots, viewport/DPR/style metadata, exact driver/helper hashes. Earlier 10/12/13-check passes are subsets, **not additive unique coverage**.
- `node harness/scripts/audit-navigation-regressions.mjs --bundle <retained-bundle>`: **exit 1 / FAILED**, both new navigation expectations false, 14 other checks passed, all owned cleanup exited, seal unchanged. This is observed behavior, not compilation/setup RED. The earlier ENOENT attempt never launched and is an infrastructure failure, not this repro.
- `python3 audit-cli.py`: exit 0, 16 expected result checks (four help exits 0; usage/unsupported exits 2; absent-service JSON exits 1 with `unverifiable`). Missing command errors are not feature PASS. See full argv/stdout/stderr in `cli-results.json`.
- `node characterize-mentu-evidence.mjs`: CHARACTERIZED_SOURCE_NOT_PARITY; quarantine readback, not-present formal records, stored-running→live / stored-ok→exited and unchanged 23-file closure confirmed. No recipe or model executed.
- Read-only `gh pr view 7 --repo clioo/drogon --json number,state,mergeCommit,headRefOid,statusCheckRollup` and the same command with `8`: both merged, named checks successful; Windows compilation only. Exact captured metadata is in `github-baseline.json`.

For every node command above use `/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`. Rendered probes were launched with `env -i HOME=/tmp/drogon-ux-parity-audit-252de85c2fd2/home TMPDIR=/tmp PATH=/usr/bin:/bin:/usr/sbin:/sbin SHELL=/bin/sh LANG=en_US.UTF-8 PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 PLAYWRIGHT_BROWSERS_PATH=/tmp/drogon-ux-parity-audit-252de85c2fd2/browser-cache`. Run from the audit directory; product source checkout stays read-only. `run-audit-checks.sh` provides exact reproducible invocations without installs or inference.

## 10. Platform, SSH and folder-workspace gaps

| Boundary | Verdict |
|---|---|
| macOS arm64 sealed package | Fresh bounded real-CDP/native slice exercised; not whole application acceptance |
| Linux | Native CI checks green at reviewed PR heads; no fresh Linux GUI/installed parity |
| Windows | Compile check green, but non-Unix `serve` explicitly UnsupportedPlatform; working runtime not accepted |
| SSH/remote mixed versions/WSL | Required source contracts retained; candidate remote route absent or unexecuted; no local fallback claimed |
| Ordinary folder | Real fixture registration/output/recovery tested; two UI navigation failures found |
| Git worktree | `.git` marker classification exists; actual create/remove/branch/diff/review journeys not implemented/accepted |
| Auth/locks/shutdown | Bounded local code/cleanup evidence; no same-user tamper isolation, no manual lock deletion, no timeout-as-exit |

## 11. Mentu, Bots and Meetings status

See detailed rows and `root-integrations-review.md`. Bots: records present, no usable scoped feature; preserve preset/default/identity and ownership before wiring execution. Automations: scheduler/history/host workflow missing; reactive foundation is not a live adapter. Candidate Mentu: discovery/review/approval/retry/shared surfaces and quarantine evidence UI are missing; the source quarantine reader exists and was characterized. Formal records are distinct from logs; no upstream PR was implemented/published. Meetings: no transcript page/integration; source browsing/setup/privacy/model-unavailable behavior is real, while on-page recording/download is deliberately withheld. Official Mentu skills remain part of future integration acceptance; no recipe was authored or modified here, so no recipe checker run is represented as completed. Any upstream gap requires a reproducible English report and tests under coordinator authority; the separate Pi/DGX benchmark was not run.

## 12. Recommended implementation order

1. Triage the two actual navigation failures and truthful pending/unsupported-platform copy; add exact regression tests before fixes.
2. Freeze native contracts/host identity, persistence and safe lifecycle; preserve currently working local slice. Do not silently adopt ongoing unmerged implementation work as this baseline.
3. Restore source shell/navigation/settings/shortcuts and correct project/folder/worktree contracts; keep ordinary registration free of Git side effects.
4. Restore explorer/editor/diffs/source-control/checks/PR workflows with source tests and provider-neutral host ownership.
5. Wire Bots/automations and session-native Mentu, preserving approvals/quarantine/evidence and explicitly qualifying record liveness; integrate Meetings browsing/setup/privacy.
6. Remaining source surfaces and Windows/SSH/WSL/mobile/web equivalents require their own tests and state matrices. Existing supported source functionality cannot be silently deferred to meet a deadline.
7. Close E5 rights/notices/recordings/services decisions separately; only after human triage may implementation/PR/install/merge proceed under the current direct-worker policy.

## 13. Release gates, independent review and decisions

**Full-parity release is not accepted.** Required gates: repair and rerun observed navigation failures; every missing feature mapped to a reviewed PR/test or explicitly approved deferral; full source-to-candidate assertion mapping and behavioral gates; missing original/candidate rendered states; native Windows and actual Linux/SSH/WSL/two-way skew; privacy-safe diagnostics/permissions/notices; reproducible package plus separately verified installed user-safe acceptance. Unknown states are not defects by default and are never PASS.

Perspectives: Kimi source research (`integrations-v2`, `shell`, `runtime`), root direct source/real-CDP/native/CLI checks, fresh Sonnet source-50/release challenge and direct-body safety follow-up, plus the two-navigation independent review. Raw reports were not accepted verbatim: quarantine absence, inferred cancellation exit, immediate crash terminalization, unordered list, universal case folding, manual-lock-deletion safety, scrollback/truncation conflation and excessive preserve/P0 claims were corrected. Review artifacts preserve disagreements. Source deeper-operation gaps remain disclosed rather than invented evidence.

Operational deviations are retained in `checkpoint.md` and orchestration history: external-session auto-routing initially rebound an existing coordinator and was restored; a hidden-but-live third implementation leaf made the first Kimi launch exceed the project-wide limit before its warning was consumed. That Dispatch was fenced/abandoned, partial work preserved and release returned retained/identity-unproven; no external terminal was force-closed. Thereafter an explicit one-slot reservation and sequential exact handoffs were used. Both incidents are disclosed, not erased or presented as compliant history. Final lifecycle validation shows no active owned audit Dispatches. Official idempotent release receipts in `release-receipts.json` returned retained/external_terminal with no process action; inventory can still show releaseState=not_requested and is not overwritten with an invented released/exited claim. Retained idle external processes are not called exited. Their provenance stays exact.

## 14. Final separation and audit acceptance

- **Source audit:** inherited 11/12 characterization index; E5 remains open. No claim of recursive dependency, original-suite or source publication completion.
- **UX audit/report:** full known source-ID reconciliation and A–K findings are documented; actual rendered coverage and unverified/excluded states are enumerated. This is not a claim that every original screen/state has been runtime-verified.
- **Implemented product:** narrow working local slices plus two reproduced navigation defects and substantial missing capability domains. No implementation occurred in this audit.
- **Packaged/installed acceptance:** sealed bytes were verified and tested in isolated fixtures; an identical archive was retained. No installation/replacement/user-profile acceptance was performed; whole release is not accepted.

Root completed the report-level reconciliation and evidence review. `validation.json` records the requirement-by-requirement checks, exact source references, clean-status proof, matrix/crosswalk integrity, preserved positive and failing results, and settled audit tasks. `lifecycle.json` records exact retained/released worker identities; no audit leaf remains assigned. The failed pilot is explicitly superseded, not accepted as success. This deliverable is complete at the stated read-only audit coverage, with the original/candidate execution exclusions above retained as open product gates. It ends in findings, tests, exclusions and priorities—not an implementation claim.
