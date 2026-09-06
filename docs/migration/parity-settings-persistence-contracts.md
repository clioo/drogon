# Settings persistence — reviewed central contracts

Frozen source c9790628;13 bounded contracts SP01–SP13 in the JSON companion,
with15 file hashes and symbol anchors. This closes the previously unread
profile-preparation body gap, not the214-field UI/consumer mapping gate.
Mentu Navigator located renderer persistence; the coordinator verified the
actual function bodies and followed explicit main-process paths.

## Preserve these distinctions

- Settings update returns mutated in-memory state and schedules a save.
  The1s debounce has a5s maximum pending delay, not a5s durability guarantee.
  Waiting on pendingWrite does not automatically await a still-armed timer.
- Renderer updates cannot grant plugin consent, trusted directories or
  server preference through the generic settings handler. Dedicated owners
  and validation must survive the new CLI/IPC boundary.
- Remote visibility defaults belong to their server. Local settings and
  remote updates are split and can partially succeed; this is not one atomic
  transaction. Unsupported servers must not inherit client defaults silently.
- Defaults, persisted values and migrations have ordered precedence.
  Explicit false, absent and migration stamps are different states.
  Keep existing launch overrides and old-profile opt-outs.
- Primary serialization separates cache/host partitions and protected slots.
  Async/sync writes use generation and hash guards with durable replacement;
  directory sync remains platform-dependent. Do not promise encryption for
  every setting or atomicity for the entire state lifecycle.

## Evidence

Two original suites ran unchanged:13 durable byte/error cases and1 synchronous
fsync/rename-order case,14 pass/no skips. They use real temporary files on this
Mac; receipts are in reference-captures/c9790628-durable-file-write and
reference-captures/c9790628-durable-file-write-syscall-proof.

The Store round-trip test body was separately read: actual temp-file reload,
mock safeStorage, local/remote partition assertions and second reload equality.
It was not executed here. The overlapping runtime-switch test was also read,
not executed; it uses mocked transport. Neither increases the passing count.

No source assertions, product files, personal data or settings were edited.
No power-loss test, candidate parity, real SSH, Windows/Linux, package or UI
acceptance occurred. E2 still requires remaining per-field routes/classification;
test ports must preserve all original assertions, not substitute these13
contracts for the complete suite.
