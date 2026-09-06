# Original Windows environment-expansion baseline

2026-09-06. Root reviewed the complete original38-line module and46-line test file, then ran all four existing assertions unchanged. This establishes a source baseline for one pure helper, not rewrite parity or Windows OS acceptance.

Source revision: `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. Capsule staging checked source bytes against pinned Git blobs and retained MIT/Lovecast attribution. The source checkout was not modified. No dependency install, personal PATH change, registry access, provider request or product service was involved.

| Evidence | Value |
| --- | --- |
| Manifest | `tests/parity/baseline-capsules/windows-environment-expansion.json` |
| Manifest SHA256 | `34e86d1c39f9d88ce2c78f4cb214b4f1c657ea422f4783a7aaeb1f87179f9fb8` |
| Original module SHA256 | `b0bebbd420d5ca71e4472b00515fae9dbf4b4350870e0015620f469b98da10e1` |
| Original test SHA256 | `688208beed26a40efff6e1f5380d92e566eb45b0428fef2b33239201771c4218` |
| Retained capsule | `.preflight/parity-baseline/audit-windows-path-expansion-qRJulw` |
| Retained results | capsule `vitest-results.json`, SHA256 `59a698b5707a444aab7c526eaa07c3b2e1eb9d4fa7ed6c43eb857a05fff9e4d8` |
| Runtime | Vitest4.1.11, Node24.19.0, macOS arm64 |
| Result | 1 file, 4 passed, 0 failed/pending/todo; exit0, no timeout |

Root read the actual JSON assertions after the runner returned. They verify case-insensitive expansion with unknown-variable preservation, empty-string expansion, both PATH casings without modifying other fixture variables, and the non-Windows no-op. Production performs one expansion pass, prefers exact-case variables and snapshots inputs before mutating PATH variants. The tests do **not** prove recursive expansion, conflicting exact-case variables, registry persistence, shell quoting, installed CLI resolution or actual Windows execution.

Reproduce from the rewrite root using the existing approved capsule runner and the source-compatible installed Vitest entry:

```sh
/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/run-parity-baseline-capsule.mjs --manifest tests/parity/baseline-capsules/windows-environment-expansion.json --source-root /Users/carlos/Documents/Drogon-mentu-session --vitest-entry /Users/carlos/Documents/Drogon-mentu-session/node_modules/vitest/vitest.mjs --execute --approved-manifest-sha256 34e86d1c39f9d88ce2c78f4cb214b4f1c657ea422f4783a7aaeb1f87179f9fb8 --label audit-windows-path-expansion
```

The machine-specific paths identify the actual run, not cross-platform installation defaults. A rerun creates a fresh unique capsule. Source-global setup hooks/aliases are omitted, explicitly recorded in the manifest; this module has no production runtime imports. This is not a general execution sandbox or a complete dependency-integrity assertion. Full source-suite migration, candidate behavioral RED/GREEN and real platform tests remain required. E5 and the12-group audit denominator are unchanged.
