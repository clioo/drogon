# Original browser-host-client-page-adoption capsule

14 unchanged original cases passed, zero failed/skipped/todo, one actual
test file. Node24.19.0, original installed Vitest4.1.11, macOS arm64.
Frozen source c97906287bb7a390b25e2025b600d9fb3c25d9c3.

Manifest: tests/parity/baseline-capsules/browser-host-client-page-adoption.json
SHA256: c77abda1d0ca3e704a05e06ab28a67bdb300461eb11dc86bcfe23278c699e961
Retained stage: .preflight/parity-baseline/audit-browser-host-client-page-adoption-sKJGgn

Seven candidacy and seven intent assertions: invalid/foreign/self-owned entries excluded, current host key, ordered newer generations, no reclaimFrom. No actual guest restoration.

Complete runtime import closure read before execution, all source assertions
and existing mocks unchanged. Type-only imports erased; no need to execute
unrelated source dependencies. No Electron, application, network, files,
processes, user profile, model or service invoked by tested code. This does
not prove real placement, DOM survival, server recovery, rendering, storage,
OS/SSH behavior, wire skew or candidate parity.

Runner checked exact source bytes against frozen checkout AND Git blobs,
staged MIT license, and bound execution to this manifest hash. Minimal node
config differences are disclosed in manifest/stdout.json; this is not a
security sandbox or full original-config/typecheck acceptance.

stdout.json is the actual runner report. stage-receipt.json and
vitest-results.json preserve stage evidence with only final newline added
where absent. Their contents and one actual test file were independently
verified. The runner's generic pure-function disclaimer is narrower than
these tests: some use injected mocks/global stubs and asynchronous control
flow, not only pure functions. No mocks stand in for candidate features.
