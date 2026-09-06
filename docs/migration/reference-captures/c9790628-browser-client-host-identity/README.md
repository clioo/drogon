# Original browser-client-host-identity capsule

6 unchanged original cases passed, zero failed/skipped/todo, one actual
test file. Node24.19.0, original installed Vitest4.1.11, macOS arm64.
Frozen source c97906287bb7a390b25e2025b600d9fb3c25d9c3.

Manifest: tests/parity/baseline-capsules/browser-client-host-identity.json
SHA256: 21e43d1debbd1fe9942c4ae1a4b4be880cab4a25461b4f2ab9ccb42edc982db1
Retained stage: .preflight/parity-baseline/audit-browser-client-host-identity-4RnfUi

Global API stub/cache/reset behavior; three it.each rows. No actual preload or renderer.

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
