# Provider runtime source review

Root accepts the two finite **PI-JOIN-RUNTIME / PI-JOIN-REQUEST-GUARD** source joins, with the corrections below. This is not whole E3/E5 acceptance or product parity. [Machine evidence](e3-provider-runtime-root-review.json) includes hashes, lifecycle receipts and exact test results.

Verified42 pinned files,46 ranges, eight input hashes, eight contracts, four reused pointers, sixteen allocation pointers and all47 inherited gates. All9037 original file allocations/46 packages remain unchanged. Root read the eight contracts and independently checked the significant owning implementations; SQLite reuses the previously accepted concrete Database body.

## Corrections governing implementation

- **Cancellation ordering:** lock setup creates directories, resolves identity and cleans orphan records before the first abort check. Preserve this source characterization; abort-before-effects, if corrected, needs separate assertions.
- **Diagnostic timing:** unreadable Chromium metrics are coalesced every60 seconds, not five. PID-addressed attempt/refusal records use a distinct five-second interval. Actual exported reader is `readOrcaChromiumProcessPids`.
- **Recovery ordering:** the claimant record is written before the owner witness is renamed, then the in-process claim becomes active. Crash tests must target that exact sequence.
- **Network lifetime:** no-state default guard allows requests; failed proxy application can still fulfill the startup barrier. Login credential matching does not inspect readiness. Normal profile deletion retains guards; failed-profile/route cleanup removes them. Native listener effects and races remain unverified.
- **Liveness:** resolved kill promises and bounded retry counts do not prove process exit or elapsed-time bounds. Preserve host-scoped `live / unverifiable / exited` and all native execution gates.

## Executed baseline

The complete unchanged original proxy request guard suite passed **5/5**, zero failures/skips/todo, with Node24.19.0 and original Vitest4.1.11. Actual queue/readiness/retry code ran against synthetic Session methods. No network, credentials, Electron instance or provider operation was used. Root reopened all five results and rehashed eight source/test files and LICENSE. This does not prove native listener registration or rewritten-product GREEN. See [the manifest](../../tests/parity/baseline-capsules/electron-proxy-request-guard.json).

The integrations95-method correction is still active. Once reviewed, root reconciles whole E3/E5 source acceptance without reopening accepted inventories. Audit remains10/12=83.3%, delta0, medium-low confidence; deadline risk high/no defensible ETA. Actual Sol implementation begins only after the full source-audit gate.
