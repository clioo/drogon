# Foundation correction admission follow-up

Root review, 2026-09-06. The pre-existing uncommitted corrections documented in
`core-review-corrections.md` are preserved, not discarded or attributed to a new
leaf. Source review found two concrete blockers before admitting that complete
diff. This is a queued follow-up after the active provider-record task, not a
fourth concurrent lane or permission to edit that task's files.

## Host-specific accept errors

`drogond/src/server.rs::is_fatal_accept_error` currently matches numeric errno
values 9/22/88/45 across all Unix hosts. Root inspected pinned libc 0.2.189:
Apple ENOTSOCK=38, ENOTSUP=45, EOPNOTSUPP=102; Linux GNU x86_64 ENOTSOCK=88,
EOPNOTSUPP=95 and EL2NSYNC=45. The current mixed list is not portable.
Reuse the already-declared Unix libc dependency, using host constants and safe
classification rather than another manually enumerated table. Preserve bounded
backoff, healthy-accept counter reset, connection limits and surfaced failure.
Correct comments that currently say transient errors never end the loop despite
the retry limit. Test all fatal categories on the host, representative transient
ones, threshold exhaustion and reset after successful accept. Record Linux as
unexecuted if no real Linux run is available; macOS alone is not Linux proof.

## Environment isolation in native tests

The new `child_environment_is_stripped_of_runtime_control_context` test mutates
process-wide environment with unsafe set/remove calls while other test threads
can spawn sessions and read that environment. Its safety comment does not prove
the absence of such concurrent reads. Run the probe in an owned subprocess with
explicit environment configured before spawn; do not mutate the parent test
process environment. Preserve inherited values and prove ORCA_* and DROGON_*
are both absent in the actual PTY child. Use an exact isolated test entry and a
bounded completion/cleanup path, never kill by a shared name or arbitrary PID.

The simulated-recovery test also leaves a 30-second child after dropping Engine.
Retain a cleanup-capable original handle until assertions finish, or use an owned
fixture process with exact cleanup, without claiming that a second Engine object
is real process-death recovery. Existing exact-incarnation and unknown-versus-
unverifiable assertions must remain. Stronger genuine crash recovery stays open.

## Delegation and verification

Sol-ENG must delegate to the same approved non-OpenAI leaf after its current task
settles; no manual Sol implementation. Exclusive follow-up leaf files:
`crates/drogond/src/server.rs`, `crates/drogond/tests/server.rs`,
`crates/drogon-core/tests/engine.rs`, and additive evidence under
`tests/parity/ports/WP-ENG-RUNTIME/foundation-admission/`.
Preserve all existing dirty work in those files and change only these findings.
Root retains core/lib registration, manifests/lockfile, session production code,
Git and integration. Sol writes only its scoped review report.

Capture assertion-level RED before corrections and focused GREEN afterwards.
Use locked Cargo commands; do not execute active, incomplete sibling suites.
Final root admission additionally requires descriptor-release/retained-output,
exit-observation, session-persistence and daemon tests with actual owned PTYs and
temporary stores. No user service/profile, installed app, network or inference
operation is needed. Existing Windows support gaps are not solved by this patch.
