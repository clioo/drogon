# Original CLI argument baseline

Executed by the coordinator on 2026-09-06 at 00:26:53–00:26:54 UTC.
Source revision: `c97906287bb7a390b25e2025b600d9fb3c25d9c3`.
Original installed Vitest 4.1.11, Node 24.19.0, macOS arm64.

**38 passed / 38 total; zero failed, skipped, pending or todo.**
The coordinator independently checked all 38 assertion results and all eight
staged source hashes. Original tests and assertions were not modified.
Expected count was declared before execution: 32 direct tests and six table cases.

Manifest: `tests/parity/baseline-capsules/cli-arguments.json`;
SHA-256 `cda8f4e0f2ca6447bdb959e27bac3ff9d284b05a52fb3b939346fa4986981e86`.
The exact invocation, environment allowlist, stage receipt, runner output and
Vitest report are retained here without altering their contents. Private HOME
and temporary directories belong to the disposable fixture; no credentials were
inherited by the test child. MIT provenance is recorded in the stage receipt.

This establishes an original-code parsing baseline, not candidate parity:
no real CLI handler, RPC connection, harness, bot or model was invoked. Minimal
capsule configuration differences remain declared in the manifest. This result
does not close full-suite baseline, command semantics or cross-platform gates.
