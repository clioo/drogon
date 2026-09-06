# Original usage-provider handlers baseline

Coordinator executed one unchanged original test on macOS with Node24.19.0 and original installed Vitest4.1.11. One pass; no failure, skip, todo or timeout. Source frozen at c97906287bb7a390b25e2025b600d9fb3c25d9c3.

The single original test asserts all 24 route registrations, then invokes getScanState for all three providers and the other seven operations on the Claude store mock. Refresh is asserted with false and true. It does not execute all eight handlers for all providers.

Fresh retained stage: `/Users/carlos/Documents/Drogon-rewrite/.preflight/parity-baseline/coordinator-usage-handlers-Da4Z6n`.
Manifest: `tests/parity/baseline-capsules/usage-provider-handlers.json`.
Approved manifest digest: `bc1b8ef998795c0515f18f53f47e2378dc228feec2b5ccb1b2b7e4834fce391f`.
Both staged source files and MIT license were pinned and verified by the runner; no source edits or weakened assertions.

Raw stage receipt SHA256: `5adb7b1f78c9ce7e495ea793b4ff685a07ed2a38a8e5306dfadc8287084a413b`.
Raw Vitest result SHA256: `99333c90fb6806276c66d8c6a0fb652a96b95bc74cbde447cf01b9c8477fe3b4`.
The archived receipt/results add one final newline; all parsed values are unchanged. Raw files remain in the stage. stdout.json retains observed output. The runner's inherited phrase “pure-function” is imprecise here: these are mocked IPC calls and registration, not actual Electron or provider execution.

Minimal capsule config omits source aliases, setup, feature define and platform runner settings; type-only imports are erased, not typechecked. The test uses its original mocks. No live stores, token counting, network, provider models, personal files, renderer, SSH, Windows/Linux or Drogon candidate acceptance. Source API and handler tests passing separately do not prove a real end-to-end IPC round trip.
