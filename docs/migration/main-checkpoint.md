# Main checkpoint and worktree transition

2026-09-06. This closes the shared-checkout engineering wave; it does **not** close the rewrite goal or claim Orca feature parity. PR #1 remains a foundation checkpoint, not a release.

## Preserved work and ownership

- Accepted baseline: `0f915cf26c6121fe4cd85ad902e9dbb7f0de7709`. Integration checkout: `/Users/carlos/orca/workspaces/Drogon-rewrite/codex-integration-main-checkpoint`, branch `codex/integration-main-checkpoint`. It was created through Orca from the committed foundation, with setup enabled. The configured setup hook was empty.
- The original `/Users/carlos/Documents/Drogon-rewrite` checkout and its uncommitted files remain intact. No stash, reset, deletion, or broad staging was used. Its native Bot storage, provider-session records, foundation corrections, desktop recovery and packaging drafts are **not included** merely because they exist on disk.
- All three Sol leads settled their current assignments. Their parent Dispatches were released through Orca; external terminals were retained without process action. No new Sol lead was launched.
- Subsequent implementation uses root Astra plus at most three direct, non-OpenAI workers, each with a separate Orca-managed worktree, `codex/` branch, explicit file ownership and PR based on the newly accepted main. Root owns shared contracts, integration order, combined acceptance and installation. Read-only reviewers may share the clean integration checkout.
- Approved pool includes Sonnet, GLM, Kimi and `opencode-go/muse-spark-1.3-contributor`. Muse completed a real bounded response/lifecycle smoke (`task_8d36146c9483` / `ctx_baca3116fa73`); this proves availability at that time, not product correctness or unlimited quota. Per-invocation permissions only; no descendants or global changes.

## Independent local acceptance

On the clean baseline, macOS arm64:

- Rust workspace: 220 tests passed, none failed/ignored; locked offline build and formatting passed.
- Desktop typecheck, 44 unit tests and production build passed.
- Candidate renderer contracts: 72 tests across ten files passed. The strict persisted fixture typecheck passed with `skipLibCheck=false`, including the negative compile assertions.
- Native CLI/service: 17 real-process checks passed. Report: `.preflight/acceptance/core-cli-1788719186214-9d8636b8-c320-4920-9efd-159ae5ba62f3.json`.
- Electron/Playwright CDP: six checks passed (isolation, folder registration, real terminal output, reload identity, keyboard/sibling-close behavior, light/dark/narrow capture and final close grouped by the runner). Report and screenshots: `.preflight/acceptance/desktop-1788719242083-a73787da-0eef-4639-a410-9777d8b23a09/`. Owned desktop, daemon and sessions all exited; user profiles and running Orca were untouched. Root inspected the dark screenshot.
- A bounded common-secret-pattern scan found no matches in tracked candidate content; this is not an exhaustive secret audit.

The first strict Clippy run failed on four test-only lints in `claim_identity.rs`. Root corrected the expressions/type alias without disabling rules. Root also added deadlines and an explicit closure assertion to the oversized-frame socket test, plus a sensitivity test that refuses to treat a read timeout as closure. The eight server tests and strict workspace Clippy then passed. This is test hardening, not a reproduced production behavior defect.

`pnpm test:renderer-contracts` and `pnpm typecheck:renderer-contracts` now expose the admitted candidate gates and run in CI. They deliberately do not run the frozen source-only corpus against missing product modules. The local pinned-source declaration oracle is not wired into CI: its reference checkout/capsule prerequisites remain local and documented.

The historical PR checks at `09c728f` are not acceptance of this checkpoint. Current-head Linux/macOS checks and Windows compilation must pass before merge. Windows runtime, remote-host execution, packaged installation and full feature parity remain separate gates. Keep the latest previously verified installed preview; do not replace it with an unaccepted packaging draft or downgrade it to this narrower checkpoint.

## Review triage

Run `run_ddca7735397e`, baseline `0f915cf`, base `edcc2e96f74fb81de3ea5ce05023b7e6f1d042bc`. Three independent read-only passes: Sonnet `task_6954ae4f64dd/ctx_23de3ff0ee80`, GLM `task_6b8109b97d7a/ctx_8cc9a324a253`, Muse `task_bf5ceffbba1e/ctx_21e2d333f560`. All settled and released before root corrections; HEAD and tracked status stayed unchanged during review. Reports were temporary files outside the repository. No review worker modified candidate files.

### P0

None confirmed. The missing CI gate is important but is not a demonstrated security/data-loss incident; the worker's P0 classification was not adopted.

### P1

- Missing admitted renderer CI gates: independently confirmed by root, GLM and Muse; corrected with explicit candidate-only scripts and CI steps.
- Strict Clippy failures: reproduced and corrected by root.
- Oversized-frame test could hang and ignored the read result: confirmed from the test, now deadline-bounded with explicit closure/timeout distinction and a sensitivity test.

### P2

- Local IPC token equality is not constant-time. Defense-in-depth follow-up, not an established privilege bypass: socket and token are already owner-readable only.
- The simulated crash-recovery test intentionally leaves a time-bounded child; fixture lifetime/cleanup hardening remains in the preserved native-foundation follow-up. It is not a real-process-death proof.
- Source declaration comparison still requires a local pinned reference; cross-machine replay remains pending.

### NIT

- The leaf declaration map's old “30 fields” label is stale; actual `WorkspaceSessionState` comparison is 33 fields. The root declaration review already records this correction without rewriting hashed historical evidence.

Scope adjudication: unimplemented durable renderer persistence, updater wiring, Windows runtime and packaging are real required follow-ups, but explicitly absent from this foundation's claimed capabilities. They are not accepted features, nor newly hidden regressions. Antigravity leading-dash prompt behavior needs downstream-parser evidence before being called a defect; OpenCode already uses `--prompt=value`. Static timing concerns without a failure reproduction remain hypotheses, not confirmed P1 findings.

Coverage is limited: 882 changed files include roughly 54 MB of audit/fixture data. Reviewers used bounded targeted reads, not an exhaustive review of that corpus. Sonnet's report inconsistently claimed all 57 Rust files while listing unread modules; only its explicit read list is counted. Muse reported a 98,812-character selected diff; GLM reviewed substantive desktop modules but not every fixture/type body. Passing tests do not expand that static coverage claim.

## Next isolated blocks

1. Provider-session record correction: preserve the current Kimi handoff, fix numeric schema admission, consume all 266 raw source-oracle cases in Rust, then register the production module before durable lease/store integration.
2. Bot/automation state: preserve the Sonnet storage handoff; review migration atomicity, host-default locale and remaining case map. Real SSH host-authority fencing is mandatory before global automation mutation/deletion RPCs; Bot ownership is not a substitute.
3. Native/desktop lifecycle and packaging: finish the already identified accept-loop platform constants, fixture ownership, session retirement/recovery, sealed artifact identity and safe installed-preview gates. These drafts do not become accepted through a checkpoint merge.

Audit remains 11/12 (91.7%, medium confidence, delta zero). E5 publication/resources/services remains the audit closure milestone; full-fidelity delivery in the original 24-hour target remains high risk. Mentu upstream proposals and the later Pi/DGX-only comparison remain in the overall rewrite goal, not this merge gate.
