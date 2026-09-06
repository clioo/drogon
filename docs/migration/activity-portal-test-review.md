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
