# Original WSL filesystem bridge baseline

Twelve unchanged original cases passed on macOS arm64, Node24.19.0 / Vitest4.1.11. Exit0, no timeout, zero failed/pending/todo. One result file contains twelve assertions; Vitest's suite count includes the describe container and is not a file count.

Source: c97906287bb7a390b25e2025b600d9fb3c25d9c3. Manifest: tests/parity/baseline-capsules/wsl-hook-fs-bridge.json; SHA256 30f199e6e9cb0a1a6fbb0f31b02d4b48b135478694389ffa7400fc4987fcea06. Stage: .preflight/parity-baseline/audit-wsl-hook-fs-bridge-56PUGR. The three JSON files preserve the actual runner output, receipt and result values. Source bytes and MIT LICENSE matched both pinned Git blobs and the read-only checkout before execution.

Important correction to the generic runner disclaimer: this is **not a pure-function capsule**. It captures registrations with a fake dispatcher but exercises real filesystem operations in per-test temporary homes. Read-only readdir probes inspect the home ancestor and root; no names are printed. Boundary refusals happen before outside writes, renames and mkdir calls. The original afterEach removes only the test-created temporary home. No real home configuration, relay process, network, WSL command or model is used.

Scope: home/link status, file round-trip, missing file, traversal/sibling/relative-path rejection, ancestor probes, cross-boundary rename refusal, mkdir and invalid chmod. No successful rename/unlink/chmod/stat handler assertions, complete registration-set assertion, symlink semantics test, Windows host or Linux guest integration. Source deliberately follows symlinks inside home: the lexical boundary is not a security sandbox. Original win32 skip remains intact; skips are not acceptance.

This is source baseline evidence, not rewritten Drogon parity. Configuration differences and reviewed closure are declared in the manifest. No original test assertions/imports, product code, dependencies or installed preview were changed.
