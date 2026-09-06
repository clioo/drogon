# E4 original baseline batch

24/24 original cases passed across five unchanged suites, with no reported failures, pending/todo cases or timeouts. This is source-baseline evidence after E4 source acceptance in `0c8df8f`, not candidate implementation or full-suite/platform acceptance. Detailed case names, hashes and retained result locations are in `e4-original-baseline-batch.json`.

| Contract | Original suite | Passed |
| --- | --- | --- |
| E4-F02 | github/repository-identity-key | 1 |
| E4-F05 | json-text-structure-limit | 3 |
| E4-F27 | node-bounded-file-reader | 7 |
| E4-F28 | node-bounded-json-stringify | 9 |
| E4-F30 | secure-path-hardening-cache | 4 |

Root read every selected production and test body before execution. Each two-file dependency closure uses only built-ins and Vitest; the file-reader suite mocks async filesystem access. No provider, personal profile, network, app or service was launched. The runner and renderer-capsule machinery were unchanged. Five exact manifests under `tests/parity/baseline-capsules/` pin source/test bytes against `c97906287bb7a390b25e2025b600d9fb3c25d9c3` and preserve the original MIT license. Their execution-approval digests bind reviewed manifests; they are not separate user-approval requests or a general sandbox.

Execution used Node24.19.0 and the source-installed Vitest4.1.11 on macOS arm64. Each fresh capsule retained `stage-receipt.json` and `vitest-results.json`; root independently opened results and checked all24 case statuses. Original aliases, feature define, GC/WebStorage flags and three renderer/host-port setup files were omitted because these reviewed closures do not use them. No source assertion was edited and no dependency was installed. The same Node binary reports `JSON.rawJSON` and `JSON.isRawJSON` functions; the rawJSON-named case passed, but this run did not instrument branch coverage. On a runtime lacking that API the original test returns early, so a future green case alone must not prove that branch.

Reproduce from the rewrite checkout using the existing runner and each record's exact manifest path/digest:

```text
<node24> scripts/run-parity-baseline-capsule.mjs --manifest <manifestPath> --source-root /Users/carlos/Documents/Drogon-mentu-session --execute --timeout-ms 30000 --node-bin <node24> --vitest-entry /Users/carlos/Documents/Drogon-mentu-session/node_modules/vitest/vitest.mjs --approved-manifest-sha256 <manifestSha256>
```

Here `<node24>` was `/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`. A reproduction creates a new retained nonce directory; never overwrite existing evidence. The runner timeout signals its single child, not a general process-tree proof; these reviewed tests do not create descendant services.

These tests do not cover source defects D-ACL/D-BARRIER/D-PHASE, synchronous file reads, live GitHub/GHES, remote owners, UI, platform installation or the whole9037-file inventory. Preserve all remaining assertions and supplementary edge fixtures in E4's accepted source contracts. Five complete suites are a bounded baseline contribution, not permission to substitute them for the full tests-first migration. Audit remains9/12 (~75%, medium-low confidence), with E1/E3/E5 pending; Sol implementation remains behind the complete source-audit gate.

