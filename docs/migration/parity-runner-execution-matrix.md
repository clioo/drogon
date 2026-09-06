# Runner lane source index — non-executable planning draft

Planning-only. No listed suite was executed or imported for this document.
Coordinator correction: entries still mix source commands, abbreviated
examples and unresolved placeholders (`<os>`, explicit-list abbreviations,
benchmark families and workflow variables). The previous claim that every
entry was exact and placeholder-free was incorrect. This is a source index,
not an executable dispatch plan. Resolve complete argv, cwd, versions,
fixtures and safety guards from each source before running it. Source anchors
are navigation aids, not independent verification of every command here.
Every JSON lane is `dispatchable: false`; `entryExamples` is not an API for
execution. Membership inference is never treated as collected cases.

Provenance: manifest `parity-source-tests.json` sha256
`85ac41eb…f5caf83` (9 038 records, 14 gaps); `tests-first-checkpoint.md`
receipts; work packages v2 (DAG acyclic, depth 5, `dispatchable: false`).

## 0. Version truth (source-declared vs capsule-observed)

Source-declared requirements (read, not inferred): `vitest ^4.1.11`
(root `package.json` devDependencies), `node 24` (`engines`), `pnpm 12`
(`packageManager`), Electron `^43.4.1`. The coordinator capsules ran the
**installed** Vitest 4.1.11 on Node 24.19.0 — inside the declared ranges,
so for the root lane this is **coincidence with the requirement, not an
override**. "Vitest 5.0.0" names only the rewrite's own desktop suite and a
historical note; it must never be stated as any original lane's
requirement. Per-lane runner versions are restated below only where a
source file pins them.

## 1. Lanes (source references, examples and pending prerequisites)

| Lane | Entry examples / source references (not runnable cards) | Config / collection (file:line) | CI job / OS / versions | Prerequisites + fixtures |
|---|---|---|---|---|
| unit | `node config/scripts/ensure-native-runtime.mjs --runtime=node && vitest run --config config/vitest.config.ts` (root `package.json:27`); scoped e.g. `vitest run --config config/vitest.config.ts src/main/skills …` (`test:skill-sharing:release`, root `package.json`) | `config/vitest.config.ts:27-34` includes; 30 s/60 s timeouts (`:37-38`); win32 4 workers (`:4,40`) | `unit-tests.yml:15-60` — ubuntu-latest, node-matrix input, 8 shards, 17 `--exclude` tokens (`:42-60`, node-pty/live-shell + cross-version-wire) | Declared vitest ^4.1.11 / Node 24; Electron binary via `install-electron-package-binary.mjs` (`unit-tests.yml:37-38`); seeded git fixtures where used |
| integration-wire | `vitest run --config config/vitest.config.ts tests/e2e/cross-version-wire/` | Rolling release-tag baseline, same-version reference pairing (`cross-version-terminal-wire.unit.test.ts:1-26`); 180 s suite timeout (`:29`) | unit shard minus `:59` exclude + `pr.yml` env-conditioned runs | Release-tag checkout; both skew directions; never hand-written old-side lists |
| browser/Electron | `pnpm run ensure:electron-runtime && npx playwright test --config tests/playwright.config.ts --project=electron-headless` (root `package.json:102`); `--project electron-headful`; subset scripts e.g. `test:e2e:source-control-golden`, `test:e2e:terminal-perf`, `test:e2e:workspace-session-golden` (root `package.json`) | `tests/playwright.config.ts:15-60` (testDir, globalSetup `:17`, per-test isolated userData, projects `:42-59`); `tests/e2e/helpers/orca-app.ts:230-257` launch env; `window.__store` gate (`:299`) | `e2e.yml:36-70` (ubuntu build job, `electron-vite build --mode e2e` `:61`, artifact `out/`); `terminal-ime-e2e.yml`; docker-SSH lanes | Fresh `--mode e2e` build of frozen SHA with recorded hashes; Xvfb on Linux; mock keychain darwin (`electron-launch-args.ts:6-9`); CDP-driven; personal app never restarted |
| computer-e2e | `vitest run --config tests/e2e/vitest.config.ts [tests/e2e/computer-<os>.e2e.ts]` (root `package.json:133`) | `tests/e2e/vitest.config.ts:6` include `tests/e2e/computer-*.e2e.ts`; `fileParallelism: false` (`:9`) | `computer-e2e.yml:69-199` — macos-15, ubuntu-22.04 (+at-spi/xvfb), windows-latest; `verify:computer-native` + `build:cli` first | Native helpers per OS; real display/focus isolation |
| native | `swift test` (`native/computer-use-macos/Package.swift` testTargets); `pnpm verify:computer-native`; `node tests/tools/win-crash-survival-e2e/run.mjs` (root `package.json:128`); `node tests/tools/win-update-e2e/run.mjs` | Per-OS helpers; swift `Tests/` convention | mac builds; `windows-terminal-restart-e2e.yml`; `win-crash-survival-e2e.yml`; `win-update-e2e.yml` | OS-gated only; elsewhere `unverified`, never passed |
| os-matrix | `pnpm build:release`; `node config/scripts/run-linux-cli-launch-contract-docker.mjs --appimage dist/orca-linux.AppImage` (root `package.json:81`) | glibc ≥ 2.31 floor (`docs/reference/linux-glibc-compatibility.md`); AppImage/deb/RPM | mac/win builders; `linux-wayland-gpu-sandbox.yml`; `windows-signing-rehearsal.yml` | Per-OS runners; signing identities for release lanes only |
| mobile | `pnpm test` with cwd `mobile/` (`.github/workflows/mobile.yml:76-77`, working-directory `mobile/` per `:30-32`) | `mobile/vitest.config.ts:10-17` (`src/**.test.ts(x)`, setup, oxc tsconfig false); root install first with `--ignore-scripts` (`mobile.yml:66-71`) | `mobile.yml` (ubuntu, paths-gated `:3-18`, Ruby/fastlane pin `:46-49`); release workflows for stores | Expo toolchain for device runs; headless for route-boundary tests |
| cloud | `node --test <47-file explicit list>` (`cloud/package.json:24`, e.g. `dev/scripts/infra.test.mjs`, `dev/scripts/relay-repository.test.mjs`, `dev/scripts/github-smoke-token.test.mjs`); `pnpm -r test` from `cloud/`; `vitest run` in `cloud/apps/relay/` (`cloud/apps/relay/package.json:14`) | Relay config computes postgres project by `ORCA_RELAY_TEST_POSTGRES_URL` body scan (`cloud/apps/relay/vitest.config.ts:11-44`, serialized, 15 s timeouts `:21`); rest parallel on SQLite | `cloud-verify.yml`; prove/deploy workflows (GCP-gated) | Postgres for `*-postgres` tests; GCP project/secrets for prove/deploy (never planning runs) |
| compatibility | `pr.yml:274-310` git lanes: `ORCA_GIT_COMPAT_BINARY="$source/git" ORCA_GIT_COMPAT_VERSION="2.25.5"` (source-built tarball + cache `:281-282`); `"alpine/git:edge-2.38.1\|2.38.1"`, `"alpine/git:v2.49.1\|2.49.1"` (`:309-310`); `codex_index_heal_contract` job (`pr.yml:333-366`, test `src/main/codex/codex-index-heal-binary-contract.test.ts:366`); `node-next-compat.yml` (Node 26, ubuntu) | Behavior probes via `GitCapabilityCache` per host (`docs/reference/git-compatibility.md`), not version sniffing | Ubuntu containers per git line; `node-next-compat` ubuntu Node 26 | Real binaries per line; upgrade self-heal assertions |
| performance | Exact representatives: `pnpm bench:startup`, `pnpm bench:daemon-coldstart` (root `package.json:136-137`), plus `bench:cold-park-resource/reveal`, `bench:idle-cpu`, `bench:main-thread-jank`, `bench:multi-workspace-typing`, `bench:worktree-deletion/refresh-churn`, `bench:wsl-git-shell/hook-relay-reattach`, `bench:zustand-selector-fanout`, `bench:ai-vault-typing`, `bench:hang-watchdog-memory`, `bench:macos-computer-helper-owner-loss` (full index: root `package.json` `bench:*` keys); `test:e2e:terminal-perf*` + `check-terminal-perf-report-budgets.mjs` | Budgets frozen on legacy baselines first (parity-plan §8) | `terminal-perf.yml`; golden experiments | Same-machine same-load comparisons; budgets frozen pre-evaluation |
| release | `pnpm build:release`; `node config/scripts/verify-macos-release-env.mjs`; `node config/scripts/verify-dev-channel-packaging.mjs --channel=$CHANNEL --platform=win32` | `electron-builder.config.cjs`; release channels | `release-cut.yml`; mac/win/mobile release; signing | Signing identities; store credentials; never from planning runs |
| docs | `node --test tests/*.test.mjs` with cwd `docs/site/` (`docs/site/package.json:11`) | No config; two files | `docs.yml` | Node only |

## 2. Prohibitions (binding on any future run on a personal machine)

The legacy E2E helpers are **reuse candidates, not an approved verbatim
harness** (coordinator findings in `parity-reference-launch-audit.md`
§§24–36, which supersede any earlier approval language): the E2E network
boundary defaults to all-interfaces listening (random port is not loopback
isolation); the inherited environment is stripped, not allowlisted, so
ambient credentials may pass through; daemon cleanup trusts numeric PID
files without incarnation checks; CLI installation and managed-hook lanes
reach beyond the fixture unless separately verified. **Do not blindly
execute the listed legacy scripts, helpers, or globalSetup/globalTeardown
on the personal machine or against the personal profile.** Collection-only
`playwright --list` still imports configs and test modules (top-level side
effects possible) — it is **not** a no-execution static read. Required
before even config-loading: guards/isolation review (loopback bind,
explicit child env, keychain/auth resolution, CLI/hook destination
verification, exact-PID teardown), per the launch audit's prelaunch gaps.
The independent disposable source copy + recorded build receipt
(`parity-reference-launch-audit.md` §§43–65) is the only sanctioned pattern.

## 3. The 14 manifest gaps — states (inventoried/planned/execution-pending/unresolved)

| # | Gap ID | State | Executable closure (command + owner) | Remaining read question |
|---|---|---|---|---|
| 1 | candidates:unclassified-present | unresolved | Owner test-infra: trace `runtime-render.test.ps1` in Windows CI legs; if runnerless keep explicit bucket | Which job, if any, invokes the ps1? |
| 2 | cases:static-markers-only | inventoried | No static resolution exists; each lane run records runner-reported counts as baseline receipt (lane leads, W1+) | none (method limit, stated) |
| 3 | cloud:pnpm-recursive | planned | Owner ENG-CLOUD: `pnpm -r test` from `cloud/` on fixture checkout; record per-workspace selection | none (runtime-resolved by design) |
| 4 | imports:binary-unscanned | execution-pending | 1 file (`src/relay/dispatcher.test.ts`); run it, confirm collection (test-infra, W0) | none |
| 5 | playwright-discovery | execution-pending | Per-project `testMatch **/*.spec.ts` present; verify with collection-only `--list` under reviewed guards (§2) | `--list` output |
| 6 | reachability:inferred-not-verified | execution-pending | Lane runs with `--reporter=json` collection receipts per package (package leads) | none (execution-gated) |
| 7 | vitest-include:computed (relay) | execution-pending | Run relay suite; assert postgres/parallel split (ENG-CLOUD, W2) | none |
| 8 | vitest-include:conditional (root) | execution-pending | Run once per OS; diff collected sets (test-infra, W0) | Windows/macOS deltas |
| 9–13 | vitest-include:defaulted ×5 | execution-pending | Bare `vitest run` in each package cwd; record selection (package owners) | none |
| 14 | workflows:dynamic-matrix | inventoried | Enumerate expansions from workflow text; expand at CI time (test-infra, W0) | Full shard×node×container list per ref |

No gap is marked closed: rows are execution-pending or unresolved by
explicit state above.

## 4. Assertion-preserving ports (unchanged protocol, restated scope)

Freeze source bytes + license → port bodies verbatim (TS) or translate
invariants value-for-value (Rust: real pty/SQLite/sockets/git) → minimal
documented shims, assertions never weakened → baseline receipt on frozen
source (installed Vitest 4.1.11 / Node 24.19.0 pattern, inside declared
ranges) → behavioral RED on candidate (compile/setup failure is not RED;
skips are not passes) → GREEN through implementation → combined gates
(both skews; packaged validation before install; dual-target black-box).

## 5. Rendered evidence, stated exactly

Reference screens of the **original** product exist under coordinator
control (`parity-reference-launch-audit.md` §§79–116: initial workspace,
Bots, Meetings, bot form, settings — light theme, recorded build
receipts). **No rewrite rendered acceptance** exists. Nothing in this
matrix claims otherwise.
