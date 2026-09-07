# Windows transport integration — awaiting Windows execution

ROOT integrated the six daemon source/test files from V1 `d175143`, including
the earlier `530b0e7`, `4fcf2ee`, `7f39ff6` and `bbecf18` corrections.
This does not integrate the separate launcher or opted-in model journey.

Reviewed corrections preserve overlapped buffers until completion, serialize
issue/cancel/handle-close ownership, capture last-error before releasing the
guard, and name the actual process TokenUser plus SYSTEM in the pipe DACL.
The TokenUser buffer is aligned; the Windows DACL test checks exact trustees.
Unix and Windows reuse the same generic connection/drain loop.

ROOT macOS check: `cargo test -p drogond --locked --offline --quiet` passes
56 tests; `cargo fmt --all -- --check` passes. Windows-gated behavior is not
executed on this host. The existing Windows CI job now builds the real native
binaries and runs the daemon suite, in addition to its existing compile and
desktop/pipe-fixture checks. Its result must be observed before Windows
acceptance; adding a job is not a passing result.

Known limits: data-directory and lock-file ACLs on Windows remain inherited,
not explicitly hardened like Unix permissions. Cross-process CLI shutdown and
cancel/reap acceptance remain held pending the V5 fixture cleanup corrections.
No Windows release, complete platform parity or new capability claim is made.
