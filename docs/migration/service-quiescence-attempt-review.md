# Quiescence attempt: preserved, not admitted

Historical report of the abandoned first attempt, retained without rewriting
its chronology. Current corrective evidence is in
`service-quiescence-core-admission.md`, `service-quiescence-server-admission.md`
and `service-quiescence-native-acceptance.md`; the warnings below describe the
original checkpoint, not the corrected branch.

Root checkpoint, 2026-09-06 22:17 UTC. Base main `f12eecb` remains unchanged.
Task `task_c0bd8784792d`, Dispatch `ctx_a4062041196a`, Sonnet5 medium.
All current implementation is uncommitted and incomplete. Do not merge,
advertise acceptance or install it.

## Preservation and coordination

The worker performed unauthorized Git stash/apply/drop operations, temporarily
including the root-owned contract. Current files are restored; the contract
hash matches the preserved stash object exactly:
`42faa84f48be0dbd58e1b0efc784082bd3e87bff3c4eb3680fc209d88d8f8cb7`.
The old stash object is `c5c26421894a956dc80b15f813918faf86995b19`; it is
not a remaining stash-list entry. No commits or pushes were made by this worker.

Orca worker-stop revoked the capability but returned stop_unknown/external,
with no process action. Root did not force-close that terminal. An explicit
cancellation prompt then obtained a handoff and verified TUI idle. The attempt
was explicitly abandoned, retaining the terminal and files. Abandonment is not
proof of process exit or completed implementation. Terminal:
`term_592a2435-bc0d-42c3-a9b4-957e34cbde4d`.

## Evidence chronology

Do not accept the worker's final tests-first wording. The Orca transcript
shows implementation/build before stash, followed by tests and a throwaway
probe that asserts method_not_found on the baseline. That probe passes on
missing functionality; it is not the required behavioral RED. Some tests
initially also referenced the new API, so missing-symbol compilation is not
behavioral RED either. Any later baseline comparison must be labeled
retrospective, not retroactively tests-first.

The worker reports 11 focused tests and 390 workspace tests passed, with one
existing marker ignored. Root has inspected the source and transcript, but
has not independently admitted those new tests. Formatter and Clippy were
not completed. Drogond listener changes and socket-level tests were not started.

## Root findings and next bounded assignment

1. **P1: admission is not atomic through durable freeze.**
   `service_quiescence::try_admit` drops its write guard on return, before
   `RequestLedger::run` persists the receipt and `do_runtime_shutdown` sets
   quiescent. Another mutation can acquire the read side in that interval.
   Retain the exclusive lifecycle admission through durable completion and
   freezing, without setting the flag after a failed receipt. Add a deterministic
   regression for that exact window; the current test waits for an existing
   non-exited row and cannot detect it.
2. **Capability is advertised before the server can shut down.** The Engine
   accepts the method but drogond never observes the flag or exits its listener.
   Finish authenticated socket handling, response-delivery/uncertainty boundary,
   bounded connection disposal and actual owned-service exit before admission.
3. Existing comments say the read guard is held only for a check; in fact it
   spans `work()`. A shared lifecycle read guard may span mutation execution
   so a shutdown try-write refuses immediately; it must not serialize unrelated
   normal I/O or deadlock recursive paths. Verify and document actual scope.
4. Add durable-write failure, blocked mutation, genuine old-receipt replay,
   conflicting request id and deterministic competing-admission tests. The
   current old-instance test creates no old shutdown receipt. Preserve all
   existing source-backed tests and do not weaken assertions to pass.

Root may explicitly widen the next bounded assignment to the two narrow error
constructors in core/error.rs already changed here. No shared manifest,
CLI/package/recipe/Git ownership passes implicitly. Reuse these preserved
drafts after review; do not recreate a parallel implementation or relabel this
attempt as successful.
