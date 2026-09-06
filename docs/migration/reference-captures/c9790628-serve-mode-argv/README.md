# Original serve-mode-argv capsule

17 unchanged original cases passed, zero failed/skipped/todo, one actual test
file. Original installed Vitest4.1.11, Node24.19.0, macOS arm64; source
c97906287bb7a390b25e2025b600d9fb3c25d9c3. Assertions/imports unchanged.

Manifest: tests/parity/baseline-capsules/serve-mode-argv.json
SHA256: d784ca7d8dd7e774d2a7fcc7e307317f66efc98d3dbbac9fca1a11f0f41eb161
Retained stage: .preflight/parity-baseline/coordinator-serve-mode-argv-yYRhSV

Coordinator fully read the complete pure dependency closure before execution.
The exhaustive consistency loop explores22621 argv tails within one test;
this is NOT22621 reported cases. It preserves detection, help refusal, GUI
argv, value skipping, equals-form handling and normalization consistency.

No server, Electron, network, model, user profile or application session was
started/modified by tested code. These are string/array transformations,
not live CLI/server/update/QR/trust or candidate parity proof. No Windows,
Linux or SSH runtime was exercised. Full original suite remains unproven.

The runner verifies source bytes against BOTH frozen checkout and pinned Git
blobs, stages exact source plus MIT license in a fresh owned directory and
checks the supplied manifest digest before execution. The original installed
runner uses a minimal node config; differences are disclosed in manifest and
stdout.json. It is not a general security sandbox or full-config equivalence.

stdout.json archives the actual runner report; stage-receipt.json and
vitest-results.json equal the retained originals with a final newline added
where absent. Coordinator verified one actual file and all assertions passed.
