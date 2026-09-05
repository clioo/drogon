# Test porting plan: Orca → Drogon, tests-first full-fidelity migration

Planning-only proposal. No product tests were executed, no source was written,
no dependencies installed, no Git operations performed, no apps started, no
inference run, no nested agents used. This document is a proposal, not proof of
migration or coverage.

- **NEW:** `/Users/carlos/Documents/Drogon-rewrite` at `09c728f` (+ tracked
  dirty changes; coordinator owns integration).
- **LEGACY (read-only reference, never edited):**
  `/Users/carlos/Documents/Drogon-mentu-session` at baseline
  `c97906287bb7a390b25e2025b600d9fb3c25d9c3`.
- Coordinator owns `docs/migration/rewrite-parity-plan.md` (read here as the
  governing plan; §7–§8 define the test/fidelity gates this proposal serves).
  This task owns ONLY this file and modifies no other worker's file.
- Skill discipline: official `mentu-navigator` skill loaded
  (`/Users/carlos/.codex/skills/mentu-navigator/SKILL.md`); `mentu-nav status`
  OK (v1.1.1, read-only). Frontmatter used for routing only; every claim cites
  a read source body. Unknowns are gaps, never passed.

## 1. Tool smoke

- Read rewrite `AGENTS.md` (14 lines: Rust core/service/CLI + versioned
  contracts, isolated Electron renderer, real tests not model assertions,
  `live`/`unverifiable`/`exited` vocabulary, no nested agents).
- Read coordinator-owned `docs/migration/rewrite-parity-plan.md` (251 lines;
  full-fidelity goal, 19 capability groups in §3, waves/gates in §6,
  capture matrix + `unverified`-not-passed rule in §8, install gate in §9).
- Provider/model observed for this run: **Muse Spark (muse-spark, Meta MSL)**,
  reported in the lifecycle heartbeat as the bounded model smoke; no
  provider/model switch performed.

## 2. Legacy test inventory (verified against the checkout, not `out/`)

### 2.1 Runner configs and suite separation

| Runner | Config | Scope |
|---|---|---|
| Vitest (unit + integration + `*.unit.test.ts` under e2e) | `config/vitest.config.ts:1-43` — env node, `execArgv --no-experimental-webstorage --expose-gc`, happy-dom setup files (`happy-dom-offscreen-canvas`, `happy-dom-mutation-observer-retention`, `vitest-host-ports-setup`), include `src/**/*.test.{ts,tsx}` + `config/scripts/**/*.test.{ts,mjs}` + `tests/tools/**/*.test.mjs` + `tests/e2e/**/*.unit.test.ts`, hook 60s / test 30s timeouts, win32 `maxWorkers: 4` | `pnpm test` = `ensure-native-runtime.mjs --runtime=node && vitest run --config config/vitest.config.ts` |
| Playwright (Electron E2E `*.spec.ts`) | `tests/playwright.config.ts`; helpers `tests/e2e/helpers/orca-app.ts`, `orca-restart.ts` | `pnpm run test:e2e`; requires `--mode e2e` build exposing `window.__store` (`tests/e2e/AGENTS.md:1-10`); DOM assertions mandatory, store-only assertions forbidden (`tests/e2e/AGENTS.md:24-34`, #710/#1186 precedent) |
| Type checks (3 projects) | `config/tsconfig.{node,cli,web}.json` via `run-typecheck-projects-in-parallel.mjs` | `pnpm tc` |
| Lint/quality ratchets | oxlint configs, `max-lines-baseline.txt`, `ts-nocheck-baseline.txt`, `runtime-electron-baseline.txt`, knip, react-doctor, reliability gates | `pnpm lint` |
| Cross-version harness | `tests/e2e/cross-version-wire/` (below) | vitest, 180s suite timeout, needs baseline release checkout |
| Native builds | `config/scripts/build-native-for-platform.mjs`, per-OS (`computer-macos`, `keyboard-layout-macos`, `notification-status-macos`, `windows-cli-launcher` in `native/`) | platform-specific; glibc floor per `docs/reference/linux-glibc-compatibility.md` |
| orcad / serve smokes | `build-orcad.mjs`, `runtime-serve-terminal-smoke.mjs` (`smoke:orcad-terminal`, `smoke:serve-terminal`) | headless Linux per `docs/reference/headless-linux-server.md` |
| mobile | `mobile/` workspace (`src`, `packages`, `expo-route-module-boundary.test.ts`, compat tests e.g. `hermes-array-sorting-compat.test.ts`) | separate app; route-boundary + compat tests |

Foreground/focus safety is policy, not convention: `tests/AGENTS.md:1-21`
(background launch env, `showInactive()` never `show()`, `@headful` tagging,
`ORCA_E2E_FOREGROUND=1` opt-out only for native-focus subjects).

### 2.2 Representative test references (body reads and discovery distinguished)

| # | Test | Contract it freezes | Verdict |
|---|---|---|---|
| T1 | `src/cli/cli-command-name-parity.test.ts:7-25` — every `COMMAND_SPECS` top-level name redirected by `CLI_COMMAND_NAMES` and vice versa, sorted, deduped | CLI surface identity between spec table and launch redirect | REUSE literally (adapt import path only) |
| T2 | `src/main/git/git-capability-state.test.ts:19-61` — native cache shared, per-WSL-distro isolation, per-SSH-provider lifetime, host-routed WSL worktree uses native state | `GitCapabilityCache` host scoping (git-compatibility policy) | TRANSLATE to Rust (same invariant table, real `git` binaries 2.25.5/2.38.1/2.49.1) |
| T3 | `src/main/github/client-ssh-provider-execution-boundary.test.ts:1-60` (+`:129-170` outcomes) — remote `repoPath` never answered locally; missing SSH provider ⇒ typed unavailable; loss of contact ⇒ `unverifiable` | SSH execution boundary (§3 of platform audit) | TRANSLATE (mock harness `client-test-mocks` stays TS-side if client kept; re-implement verdict core in Rust with identical outcome matrix) |
| T4 | `tests/e2e/cross-version-wire/cross-version-terminal-wire.unit.test.ts:1-50` — named journey frames (`C>H Subscribe`, `H>C SnapshotStart/Chunk/End`, …), same-version reference pairing, rolling baseline never hand-written | Remote wire Rules 1–3 (`docs/reference/remote-wire-compatibility.md`) | ADAPT: port harness to Drogon protocol; keep "never write down what the old side has" discipline + `published-field-shape.ts` occurrence comparison |
| T5 | `src/shared/orchestration-ask-timeout.test.ts:10-27` — default/clamp/max constants, client timeout leaves transport grace (`1_805_000`), max+3min < `MAX_TIMER_DELAY_MS` | Orchestration ask timeout policy (pure) | REUSE literally |
| T6 | `src/main/git-bash.test.ts:10-40` — candidate paths from env+PATH, first-existing resolution, non-Windows ⇒ no discovery | Windows shell discovery (pure, injected `exists`/`platform`/`env`) | REUSE literally |
| T7 | `src/main/bots/bot-reactive-dispatch.test.ts:1-50` (+510 lines: `FakeReceiptRepository`, deterministic receipts, dedupe/delegation) — normalized events, responsibility scope, receipt idempotency | Bot reactive dispatch determinism | REUSE service in TS if bots stay TS; else TRANSLATE receipt/dedupe invariants with the same fake-repository shape |
| T8 | `src/main/mentu/mentu-cli-process.test.ts`, `mentu-doctor.test.ts`, `mentu-runtime*.test.ts`, `mentu-session-execution.test.ts`, `mentu-session-real-cli.test.ts` (names verified; bodies 🔍 gap) | Mentu runtime/doctor/session contracts | TRIAGE per body: pure logic REUSE; real-CLI tests become DUAL-TARGET black-box (see §4.5) |
| T9 | `src/main/meetings/write-that-down-{bridge,ipc}.test.ts` | Write-That-Down bridge/IPC | REUSE if surface kept; else contract-table entry |
| T10 | Rewrite-native precedent `crates/drogon-core/tests/engine.rs:1-60` — real `portable-pty` children + real SQLite-per-test via `tempfile`, Unix-only, `ok()`/`err_code()` dispatch helpers | How Rust internal tests must look (no mocks of missing impl) | KEEP as the template for all TRANSLATE rows |

Renderer-side precedent in the rewrite (`apps/desktop/src/renderer/src/session-projection.test.ts:18-44`):
stale-incarnation observations cannot change state; resize/exit update exactly
— this is the `unverifiable`-never-`exited` rule expressed as a pure
projection test, and the pattern to follow for verdict logic ported to Rust.

### 2.3 Domain sweep (directory-verified, bodies mostly 🔍 — see §7)

Renderer pure TS: `src/renderer/src/store/slices/*.test.ts` (preferred over
E2E per `tests/e2e/AGENTS.md:11-22`, `createTestAppStore()`); CLI:
`src/cli/*.test.ts` (args, flags, format, execution-host-flag, codex
classification, emulator logcat/permissions, computer format, recovery);
service/PTY: `src/main/daemon/*`, `src/main/pty/*`, `src/main/runtime/*`
(subscribe/mount-replay/multiplex/output-pause/viewport/ack-budget tests);
SSH/WSL/wire: `src/main/ssh/*`, `src/main/providers/ssh-*`, WSL runner tests,
`wsl-command-execution` trap tests (`--exec`, fence codec); Git:
`src/main/git/*.test.ts` + `repo*` + `status*` suites; orchestration:
`src/cli/index-orchestration.test.ts`,
`orchestration-mutation-recovery.test.ts`, `src/main/runtime/orchestration/*`,
`src/shared/orchestration-*.test.ts`; Bots/Mentu/Meetings:
`src/main/bots/*`, `src/main/mentu/*`, `src/main/meetings/*` (+ renderer
counterparts per UI audit); native/mobile: `native/*` per-OS builds,
`mobile/src/**/*.test.ts`.

## 3. Tests-first protocol (binding on all waves)

1. **Freeze expectations first.** For each capability: copy the source test
   (or its assertion table) into the candidate repo path *before* any
   implementation; record source anchor + contract version on the card.
   No implementation commit may precede its frozen test.
2. **Establish the Orca baseline in isolated fixtures.** Run the frozen tests
   against an isolated baseline build/copy, never writing caches or build outputs
   into the read-only migration checkout, with fixture-only data (temp dirs, fixture
   repos, loopback ports from `vitest-host-ports-setup`). Record the baseline
   result per test: `pass` / `known-defect` (link issue) / `flaky` (evidence)
   / `env-blocked` (missing OS/binary). A baseline is a measurement, never a
   waiver: `known-defect` items stay in the inventory as origin defects per
   `rewrite-parity-plan.md §1` (documented, not silently replicated).
3. **Reuse TS UI tests unchanged** where the renderer is reused (slices,
   pure helpers, bridges' admission functions). Import-path adaptation only;
   any assertion change requires reviewer sign-off + rationale.
4. **Translate Rust internal tests preserving invariants** (ENGINE pattern,
   T10): real PTY (`portable-pty`), real SQLite-per-test (`tempfile`), real
   `git` binaries for the compat matrix, real sockets. Assertion tables
   (timeouts, cache isolation, verdict vocabulary) copied value-for-value.
5. **Dual-target black-box CLI/RPC/journeys.** Every CLI command, RPC method,
   and skew journey runs against *both* legacy and candidate from the same
   driver (`scripts/accept-core-cli.mjs:1-50` pattern: fixture tmpdir, binary
   sha256 recorded, `probe-native-protocol/session-boundaries/harness-launch`
   probes). Same inputs, same fixtures, diffed observable outputs.
6. **Independent reviewer.** A context that did not author the port reviews
   the table row: source anchor read, assertion preserved, red honest (§5),
   quarantine respected (§6). Reviewer sign-off is a card field, not a chat
   message.
7. **Red → green on candidate.** Tests for missing capabilities must fail on the candidate for
   a *behavioral* reason (missing method, wrong verdict, dropped field) and
   turn green only through implementation. Compile failure, missing fixture,
   or skipped test is NOT a valid red (§5). Existing correct behavior may already
   pass; do not introduce a defect to manufacture RED.

## 4. Source-test → contract → disposition table

`R` = reuse TS literally · `A` = adapt (same test, new harness/driver) ·
`T` = translate to Rust preserving invariants · `D` = dual-target black-box ·
`?` = triage pending (body not read — §7).

| Domain | Source anchor (verified) | Behavioral contract | Disp. | Candidate target |
|---|---|---|---|---|
| CLI surface | T1 `cli-command-name-parity.test.ts:7-25` | spec↔redirect name identity, sorted, deduped | R+D | `crates/drogon-cli` + clap spec census test |
| CLI args/flags/format | `src/cli/args.test.ts`, `flags.test.ts`, `format*.test.ts`, `execution-host-flag.test.ts` (?) | parsing + `--exec` argv shapes + host flag routing | R+D | CLI golden tests via `accept-core-cli.mjs` driver |
| Runtime protocol | `protocol-version.ts` + T4 journey `:1-50` | proto window, capability negotiation, frame journey | A+T+D | `drogon-protocol` + cross-version harness port |
| Agent-session wire | `cross-version-agent-session-wire.unit.test.ts:12-21,307-340` | declared surface executes with declared answers; stale-fence refusal; cursor resume replays missed-only | A+T+D | same harness, both skew directions |
| PTY/daemon | `src/main/daemon/*`, `src/main/pty/*` tests (?) | `daemon-v<N>` attach, preserve-with-live-sessions, replay tail, output-pause opcode 16 | T+D | `drogon-core` engine tests (T10 pattern) |
| SSH boundary | T3 `:1-60,129-170` | no local substitution; typed unavailable; `live/unverifiable/exited` + proven-exited marker | T+D | verdict machine tests + outcome matrix |
| WSL exec | `wsl-command-execution` trap tests, runner tests (?) | `--exec` only; fenced reads; no fence on long-running `exec` | R+T | argv-builder + fence-codec unit tests (both languages share vectors) |
| Git compat | T2 `:19-61` + capability suites (?) | per-host cache isolation; 6 capabilities + placeholder fail-open; matrix 2.25.5/2.38.1/2.49.1 | T+D | `core-git` tests on real binaries |
| Git Bash/shells | T6 `:10-40` | candidate paths, first-existing, OS gating | R | reuse as-is |
| Orchestration | T5 `:10-27`, `index-orchestration`, `mutation-recovery`, `check-output`, `compatibility-evidence` (?) | ask timeouts, mutation recovery, DAG/mail/gates/fencing/release | R+T+D | pure policy R; runtime parts T; journeys D |
| Worktrees/projects | `created-worktree-reconciliation`, lineage-pruning, clone-lifecycle tests (?) | create/remove/adopt/lineage/drift events | T+D | `core-worktree` + journey tests |
| Settings | store slice tests (?) | key round-trip, per-host overrides, corrupt-store recovery | R+T | TS slice R; Rust store T |
| Updater/install | `updater-events.test.ts`, `cli-appimage-stale-registration.test.ts`, `appimage-runtime-identity.test.ts` (?) | status machine, Linux package instructions, registration repair | T+D | state-machine tests + packaged-install checks |
| Notifications/tray | tray close-lifecycle, badge tests (?) | dispatch/dismiss/probe, tray/dock contracts | T | contract tests (OS-gated) |
| Auth/accounts | `claude-windows-interactive-login.test.ts`, runtime-auth tests (?) | WSL/host isolation, reauth, cancel | T | routing + redaction tests (no secret values) |
| Integrations | provider boundary suites (T3 family), rate-limit breaker (?) | per-host execution, capability-gated mutations with verbatim refusal messages | T+D | dispatch tests + refusal-message goldens |
| Bots | T7 `:1-50` + responsibility/dispatch suites | deterministic dispatch, dedupe, delegation, receipts | R/T | R if TS kept, else T with same fakes |
| Mentu | `mentu-cli-process/doctor/runtime/session-execution/session-real-cli` (?) | recipe/doctor/runtime/session contracts + evidence files | ?→R/T/D | triage per body; real-CLI ⇒ D |
| Meetings | `write-that-down-{bridge,ipc}.test.ts` | bridge/IPC round-trip, transcript roots | R | reuse |
| Mobile | `expo-route-module-boundary`, compat, route tests (?) | route boundary, wire compat aliases | R+D | keep mobile suite; D for paired flows |
| Speech | bridge/model tests (?) | catalog/download/dictation events, bridge byte-preservation | R+T | bridge R; engine T |
| Emulator | `emulator-stream-listener-cleanup.test.ts` (?) | stream ids, frame routing, listener disposal | R+T | leak tests mandatory |
| Renderer store | `store/slices/*.test.ts` + `createTestAppStore()` (?) | tab/split/modal/session state | R | reuse verbatim |
| E2E journeys | `tests/e2e/*.spec.ts` (DOM-asserted) | user-observable journeys per parity-plan §8 matrix | A+D | Electron/Playwright CDP on candidate build |
| Quality ratchets | baselines (`max-lines`, `ts-nocheck`, `runtime-electron`), knip, gates (?) | no-regression ratchets | A | candidate-appropriate equivalents, frozen before code |

## 5. Explicit disallows (red-line rules)

1. **No passing with mocks of missing implementation.** A mock may stand in
   for an *external* (OS, network peer, provider CLI); it must never stand in
   for the candidate unit under test. T3-style `vi.mock` harnesses port as
   fakes of the *boundary*, with the candidate core real (T10 pattern).
2. **No skipping expected-red tests.** `it.skip`/`test.skip` on a ported test
   requires a card-linked reason + expiry wave; skipped tests count as gaps,
   never as passes, in any report.
3. **No weakening assertions.** Changing `toEqual([])` to
   `toBeGreaterThanOrEqual(0)` or dropping cases to obtain GREEN is prohibited.
   A deliberate approved product delta needs a separate contract rationale and
   equivalent tests, not merely reviewer permission to weaken an assertion.
   Environment-specific timing requires baseline measurement before adjustment.
4. **Compile failure / missing fixture is not a valid behavioral red.**
   A red counts toward §3.7 only when the test *ran* and the observable
   behavior differed. Toolchain/fixture breakage goes to the gaps register
   as `env-blocked`, not to the red ledger.
5. **No auto-accepted snapshots.** Every snapshot (DOM, frame sequence,
   golden output) is reviewed field-by-field on first port and on any update;
   updates record what changed and why. Pixel-diff alone never proves
   functional equivalence (parity-plan §8).
6. **No `not_applicable` without a reason**, and no `unverified` reported as
   passed (parity-plan §8). Missing machines/hosts stay `unverified`.

## 6. Bounded commands + safety quarantine

- **Allowed test commands (bounded, fixture-scoped):**
  `pnpm test -- <paths>` (vitest single-file/class), `cargo test -p <crate>
  --test <target>`, `node --test scripts/<acceptance>.test.mjs`,
  `SKIP_BUILD=1 pnpm run test:e2e -- <spec>` (after one `--mode e2e` build),
  cross-version wire suites with the harness's own checkout mechanism.
  All write into `mkdtemp`/fixture dirs; ports from
  `vitest-host-ports-setup`; ports never hard-coded.
- **Quarantine (require explicit card authorization + human-visible guard):**
  anything touching the live user profile (`~/.orca`, Orca `userData`),
  the foreground/focus/Dock (outside `tests/AGENTS.md` helpers),
  non-loopback binds, real SSH hosts, real provider CLIs with paid models
  (`pi` harness acceptance: `accept-core-cli.mjs --harness pi` stays
  opt-in, cost-metered, never in default runs), filesystem outside fixtures,
  keychain/credential stores (assert routing/redaction only — values never
  logged), update/install flows touching the installed app, mobile pairing
  against real devices, emulator images, microphone/speech hardware.
- **Quarantine mechanics:** quarantined tests live in a named project/flag
  excluded from default runs, carry the `forbiddenEffects` card field, and
  run only on coordinator-assigned machines with prior state snapshotted and
  a rollback step recorded.

## 7. Coverage gaps + non-transportable tests

- **Bodies not read (triage pending, §4 `?` rows):** most CLI suites, all
  daemon/PTY suites, SSH/WSL suites beyond anchors, Git suites beyond T2,
  orchestration suites beyond T5, worktree/store/updater/tray/auth suites,
  all Mentu/Meetings/mobile/speech/emulator suites beyond names, all
  renderer slice suites, all `*.spec.ts` journeys, ratchet configs. **Coverage
  count: the table contains 10 representative references, not 10 fully read
  legacy test bodies (T8/T9 explicitly lack body evidence and T10 is a rewrite
  test). Full body and suite census is not established; the enumerator must
  determine the denominator. No percentage is stated.**
- **Not transportable literally (retain originals; map observable
  obligations):** Electron-main tests depending on `ipcMain`/`BrowserWindow`
  (obligation ⇒ same channel behavior over the native RPC); happy-dom
  component tests asserting browser quirks (obligation ⇒ DOM-asserted E2E on
  candidate); timing-sensitive burst/bench tests (obligation ⇒ frozen
  budgets measured on legacy baselines first, parity-plan §8); OS-only tests
  (WSL/Windows/macOS helpers run only on their host; elsewhere
  `unverified`); paid-model/real-CLI tests (obligation ⇒ dual-target runs in
  quarantine with spend caps); release-checkout harness tests (obligation ⇒
  preserve the declared compatibility baselines and derivation discipline;
  changing a pinned reference needs an explicit compatibility rationale).
- **Originals retention:** nothing is deleted from the legacy reference; the
  candidate mirrors each ported test's provenance (source path + baseline
  rev `c9790628` + disposition R/A/T/D) in a header comment, preserving
  upstream copyright/license notices per AGENTS.md.
