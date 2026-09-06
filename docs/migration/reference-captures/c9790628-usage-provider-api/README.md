# Original usage-provider api baseline

Coordinator executed one unchanged original test on macOS with Node24.19.0 and original installed Vitest4.1.11. One pass; no failure, skip, todo or timeout. Source frozen at c97906287bb7a390b25e2025b600d9fb3c25d9c3.

The single original test loops three provider prefixes and asserts eight invoke call names and arguments for each. These are 24 checked call shapes, not 24 test cases.

Fresh retained stage: `/Users/carlos/Documents/Drogon-rewrite/.preflight/parity-baseline/coordinator-usage-api-r5B13q`.
Manifest: `tests/parity/baseline-capsules/usage-provider-api.json`.
Approved manifest digest: `7dd506fb7c9055a4650e4a739f2714ca418a1cdc235494ac25c3ee2d0f50dac4`.
Both staged source files and MIT license were pinned and verified by the runner; no source edits or weakened assertions.

Raw stage receipt SHA256: `add42e52635723c56136e5af24468a86c47a9a0d30467261fb1abc225bfccefd`.
Raw Vitest result SHA256: `ed16088af8f03d171c410f4bd4101ad7dc8f934c05a3466d7f19487fdc771a17`.
The archived receipt/results add one final newline; all parsed values are unchanged. Raw files remain in the stage. stdout.json retains observed output. The runner's inherited phrase “pure-function” is imprecise here: these are mocked IPC calls and registration, not actual Electron or provider execution.

Minimal capsule config omits source aliases, setup, feature define and platform runner settings; type-only imports are erased, not typechecked. The test uses its original mocks. No live stores, token counting, network, provider models, personal files, renderer, SSH, Windows/Linux or Drogon candidate acceptance. Source API and handler tests passing separately do not prove a real end-to-end IPC round trip.
