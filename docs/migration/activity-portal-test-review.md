# Activity portal test correction and baseline preparation

Root review, 2026-09-06. Source reference: `c97906287bb7a390b25e2025b600d9fb3c25d9c3` in the read-only previous implementation. This corrects the depth-2 leaf's candidate assertion that Activity portal publication has no tests. It does not accept E1 or the full audit.

## Source evidence independently read in full

All paths below are under `src/renderer/src/components/activity/` in the reference checkout.

| File | SHA-256 | Actual evidence |
| --- | --- | --- |
| `activity-terminal-portal.ts` | `20c3840da57b65636bf8c22e67991a7d3bbf328155d61a8ab12366b217b45149` | React external-store publication, field-wise equality, subscription/disabled snapshot, target lookup |
| `activity-terminal-portal.test.tsx` | `ae48216a0952041709428573660dc87d6f6e02caff8181312372e8acdb96763e` | Two original assertion bodies: identical descriptor does not rerender; changed pane key causes one additional render |
| `activity-terminal-portal-publication-loop.react185.test.tsx` | `9d9233336368365b9acf1a0c2b1ef8e8157684452e4ba4b6ef6150ec2eb94a9b` | One original assertion body: publisher/subscriber feedback settles without throwing and with fewer than ten renders |

The tests use happy-dom and real React roots/hooks, with teardown of roots and module state. They are **read, not executed** here. Missing `.test.ts` does not imply missing `.test.tsx`, and absence of a symbol-specific file does not prove no indirect coverage. These three cases do not establish all field permutations, disabled/unsubscribe transitions, target lookup precedence or actual Electron terminal rendering. Root sent this concrete counterexample to E1 in `msg_9c26e6965f1d`.

The same leaf snapshot also cites stale parent lifecycle IDs and overstates source mount branches as successful rendering. Root requested correction in E1's owned review while preserving the original leaf snapshot. Pane-qualified settings IDs remain a proposal; no legacy central ID is retired by a leaf report.

## Test infrastructure RED and GREEN

The existing capsule runner generated only `.test.ts` or `.test.mjs` discovery globs. Root extended its existing parameterized source-byte-preservation test with `.tsx` **before** changing the implementation. The targeted run failed on the exact expected `.test.tsx` include: 1 failed, 2 passed, 66 filtered/skipped. This is a genuine test-infrastructure assertion failure, not candidate product RED.

The minimal implementation now selects `.test.tsx` when that is the explicitly reviewed entry extension. Existing `.ts` and `.mjs` config bytes remain unchanged. Full runner regression suite: **69/69 passed, 0 skipped**, Vitest 5.0.0 / Node 24.19.0, exit 0. The suite's temporary fixture directories were cleaned by its existing teardown; no retained baseline capsule or user directory was deleted.

```sh
/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  apps/desktop/node_modules/vitest/vitest.mjs run \
  scripts/run-parity-baseline-capsule.test.mjs --root . --dir scripts
```

This proves extension-specific staging/config behavior and existing refusal regressions. It does **not** prove JSX transformation, DOM setup, dependency resolution or execution of the three original tests. The parameterized fixture is intentionally plain code with each extension; do not describe it as a rendered React test.

## Remaining original-test baseline prerequisites

The original installed source dependencies resolve to React **19.2.8**, React DOM **19.2.8**, happy-dom **20.11.8**. None of those packages resolves from the rewrite root used as the capsule ancestor. A valid renderer capsule needs explicit reviewed source-compatible dependency resolution and JSX/environment configuration; do not silently use a different React, mutate the frozen source, or count module-resolution failure as behavioral RED. No renderer capsule was executed or claimed ready in this checkpoint.

Next: reuse the accepted isolated runner, add the smallest reviewed dependency/config contract with regression tests, preserve original assertion bytes and run both exact source files. Then port the full relevant renderer suite and execute real product journeys. These three tests supplement, never replace, the complete source-test inventory.

## Executed follow-up — 2026-09-06 06:29 UTC

The preparation above is superseded for these **three exact original tests only**. Both source files executed successfully, with assertions and production module byte-for-byte preserved. Root inspected retained JSON assertion results, not just exit status.

| Retained capsule under `.preflight/parity-baseline/` | Original cases | Result |
| --- | --- | --- |
| `audit-activity-publication-QWdNFk` | Identical descriptors do not rerender; changed pane key rerenders once | 2 passed |
| `audit-activity-feedback-uOSGIu` | Publisher/subscriber feedback settles without throwing, fewer than ten renders | 1 passed |

Both: exit 0, no skipped/pending/todo/failed tests, Node 24.19.0, **Vitest 4.1.11**, React/React DOM 19.2.8, happy-dom 20.11.8, macOS arm64. The filename containing `react185` does not mean the executed React version was 18.5. No Electron window or terminal was rendered. No candidate product RED/GREEN or E1 closure is claimed.

Manifests in `tests/parity/baseline-capsules/`:

- `activity-terminal-publication.json`: SHA256 `0849331966bd8787eb18152a8345dcf92113ce01e99b173c6035ec75d5dfc7db`.
- `activity-terminal-publication-loop.json`: SHA256 `96943dc91106156833970f0f5c8b703181a19d11ca2b03347bc67e77fd66045f`.

Each capsule retains `stage-receipt.json`, exact source/license bytes, config and `vitest-results.json`. Reproduce using the existing runner and appropriate manifest with `--source-root /Users/carlos/Documents/Drogon-mentu-session --vitest-entry /Users/carlos/Documents/Drogon-mentu-session/node_modules/vitest/vitest.mjs --execute --approved-manifest-sha256 <digest>`, using the bundled Node above. Each invocation creates a fresh evidence directory.

The optional `rendererRuntime` manifest contract pins exactly three package names/versions. Installed source dependencies resolve into capsule-local links, with package metadata hashes/targets bound into the stage receipt and rechecked before execution. Nothing installs dependencies or writes the source checkout. Automatic JSX follows the independently read `config/tsconfig.web.json`; test-local happy-dom annotations remain unchanged. Original global setup hooks and application aliases are not loaded for this reviewed dependency-small slice.

**Limits:** not a hermetic sandbox or complete dependency-integrity check. Package metadata is hashed, not every dependency byte; transitive dependencies resolve through the existing installation. Links expose those package directories to executed code; source tests must still be reviewed for effects. General source-suite configuration compatibility remains unproven.

Test-first infrastructure check: new declaration-refusal assertion failed before integration (1 failed, 69 filtered). After integration and additional binding/redirect regressions, **78 infrastructure tests pass, none skipped**, on Vitest 5.0.0. This is separate from the original Vitest 4.1.11 tests above. Root notified E1 via `msg_cbac666240d7`. Audit remains ~60% (7/12 accepted groups, medium-low confidence); next milestone is acceptance of finite area follow-ups, not more passing isolated cases. The 24-hour implementation target remains at risk while audit gates are open.
