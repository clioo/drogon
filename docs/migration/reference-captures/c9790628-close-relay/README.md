# Original session-close relay baseline

**7/7 passed**, no failed, skipped or todo cases, one original test file.
Source c97906287bb7a390b25e2025b600d9fb3c25d9c3; Node24.19.0,
original installed Vitest4.1.11, macOS arm64. This is an isolated original
unit baseline, not candidate parity, a real window or remote session test.

Manifest: tests/parity/baseline-capsules/session-tab-close-relay.json.
Digest: 0ab02a9641b3e8f543de4827e3afe1caac8e2282fd2f37c1256c90bacda2feb2.
Runner: scripts/run-parity-baseline-capsule.mjs, execute mode,30s outer bound.
Only PATH (Node24/system binaries), LANG and CI were supplied after clearing
the environment; no HOME, credentials, installation or provider invocation.
Three source files and MIT license were staged unchanged and checked against
disk and Git. Retained stage: .preflight/parity-baseline/coordinator-close-relay-tG4CDG.
Config differences are explicit in manifest/stdout; no full-config equivalence.

The original test uses mocked Electron/EventEmitter objects. Four direct cases
and three table rows cover acknowledgement, wrong sender, cancellation, window
close, three webContents lifecycle events and fake-timer lease expiry.
Wrong request ID, initial destroyed-window guard, send throw, concurrency and
actual IPC are not demonstrated. No user tab or application was closed.

## Archived receipts

Archive JSON values equal the retained raw files; a final newline was added.
stdout.json formats the observed runner report. Neither receipt is claimed
byte-identical to its original. Raw results have seven passed assertionResults.

| File | Raw SHA-256 | Archive SHA-256 |
| --- | --- | --- |
| stage-receipt.json | e7a0799ae715ce2c1cbe7d3c51dbf7f4af0a89c4be9a88e3eaffac69eb57e5f2 | c46a709c356ab152f03b4a87dcb599937f7ff1a03b98a6089a58585eb9833b4a |
| vitest-results.json | be9fa4426d8e9a323e886d597926e1a9a14f0dfe8fb84e8580fee9d440bc0037 | 66ddc1d1a0187ba722e242fe7a6289d09cce1807f10118e472ed1e18cf2d6a85 |

The distinct original baseline now totals100 cases across8 capsules
(previous93 plus7 here). This is not the full original suite or rewrite
acceptance. No product behavior, package or installation changed.
