# Original diagnostic HTTP capsule

Two unchanged original cases passed, zero failed/skipped, one actual test
file; Vitest's suite counter includes nested describe blocks. Node24.19.0,
original installed Vitest4.1.11, macOS arm64. Frozen source c97906287bb7a390b25e2025b600d9fb3c25d9c3.

Manifest: tests/parity/baseline-capsules/diagnostic-upload-http.json,
SHA256 9d56177e8056583f253b40a17e831a51afe4fbe361ec2d4dd4127bce317645c5.
Fresh retained stage: .preflight/parity-baseline/coordinator-diagnostic-http-1ZeZNG.
Both source/test files and MIT license are byte-pinned against the source Git revision.

The test replaces both Node HTTP transports with mocks. It proves successful
JSON resolution and oversized-response rejection clean up five listeners;
the latter also destroys request and response once. No endpoint contacted,
personal data collected, Electron loaded, model invoked or service started.
No endpoint-selection, consent, timeout, actual upload, UI or candidate proof.

stdout.json is the runner report. Its inherited pure-function disclaimer is
imprecise: this capsule exercises EventEmitter lifecycle against mocks, not
a pure function. Original results and stage receipt are archived with only
a final newline added where absent; original files remain in the stage.
Original assertions and mocks were not modified. Configuration differences
are disclosed in the manifest/report. This is not full-suite acceptance.
