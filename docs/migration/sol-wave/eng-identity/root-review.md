# Root acceptance — identity/lease test preparation

## Independent follow-up: 2026-09-06, 16:30 UTC

Root reran the delivered native claim suite: 39 passed, zero failed/ignored on
macOS. The actual-source signer verifier still matches 20/20 vectors with ten
source/license files verified. New Windows normalization tests execute as pure
string tests only; three Windows filesystem cases are compiled out here. Neither
passing result proves Windows runtime parity or live ownership admission.

Root reviewed the production raw-PathBuf metadata ordering and namespaced output
seam. The leaf's round-3 report asserts an ordinary long-path Node failure and
calls a purported acceptance divergence deliberate. No native comparison was
executed, so that assertion is not accepted or authorized as a product change.
Guidance `msg_331781e06369` plus one terminal nudge requires preserving the
native-platform comparison gap. Await the settled Sol report; do not advertise
an integrated capability or rewrite report uncertainty as proven equivalence.

Next dependency Task `task_3e6a87184b23` is queued, not launched: Sol/Kimi will
implement the full provider-record/handle-chain slice of
`docs/migration/native-session-authority-contract.md`, with disjoint ownership
and original tests. Runtime/store integration remains root-owned and incomplete.

## Native module review: 2026-09-06, 15:58 UTC

Root independently ran `cargo test -p drogon-core --test claim_identity --locked`:
32 passed, zero failed/ignored, on this macOS working tree. This is the actual
production module included by the test path, not yet a public core export or RPC
integration. The prior fixture leak has been removed in the delivered test file.

Root's `scripts/verify-native-claim-source-vectors.mjs` additionally executes the
actual pinned original signer, bundled in memory from the admitted isolated source
closure. All 20 vectors match key ID, identity digest and worktree digest. The
manifest digest and ten source files are verified, nine bundle inputs are confined
to that manifest, external imports are Node built-ins, and bundle writes are off.
Vector SHA256 remains
`5c7c6df9ffa53f0b63a1d65dd299f91e404da26c326f197aa0f62c474d73c949`.
This local verifier needs the retained source capsule/dependencies; it is not a
portable CI runner. It proves signing compatibility for these inputs, not every
canonicalization or platform case. Historical behavioral RED remains worker/lead
reported evidence; root did not recreate the earlier stub run.

Integration is held for a concrete Windows path-representation review. Rust's
official `std::fs::canonicalize` documentation specifies extended-length Windows
output; source uses Node `realpathSync`, normalize and en-US lowercase. Blindly
lowercasing Rust output is not sufficient evidence of identical signed bytes.
Sol-ENG Task `task_d89e59c757b6` must delegate source-backed investigation,
regressions and any required correction to Kimi, including normal drive, UNC,
explicit namespace and symlink distinctions. Do not claim Windows execution from
macOS string tests. Also correct the source-race commentary: separate Node
processes can race despite synchronous calls within each process.

Primary references: https://doc.rust-lang.org/std/fs/fn.canonicalize.html and
https://raw.githubusercontent.com/nodejs/node/v24.19.0/lib/fs.js.
The original parent settled; root release returned retained/external with no
process action before acknowledging its completion. No registration, new
capability advertisement, packaged installation or whole-session parity follows.

## Follow-up admission: 2026-09-06, 15:23 UTC

The earlier zero-baseline checkpoint below is superseded for source execution.
Root verified the three manifest/receipt/result digests and reran the read-only
`identity-leases/source-baselines/verify-source-baselines.mjs`: 3 admitted suites,
7 passed cases, 18 statically mapped assertion evaluations, one retained setup
failure with zero collected cases. Staged source and the four lease dependency
trees match. This does not make the candidate bindings valid or implement leases.
The launcher `run-lease-baseline.mjs` executes on import/no arguments and has no
dry-check mode; do not use it for verification. The separate verifier is read-only.
Its CLI safety should follow the CAP runner's explicit-execution contract later.

The completed follow-up was manual before the user correction reached the lead;
do not describe it as Kimi work. The next native claim Task delegates from the
outset to Kimi at depth two, under `native-claim-identity-contract.md`.

## Earlier preparation checkpoint

2026-09-06. Task `task_3a25101232c0`, Dispatch `ctx_fbdc4abdbcad` settled.
Root read the complete lead report and execution evidence, then independently
checked every original source hash and literal test body with
`scripts/check-frozen-test-ports.mjs`. All three assigned suites preserve their
bodies; claim/lease import regions changed, provider-transition is byte-identical.
Together with the earlier four Bots suites, the frozen manifest checks 7/7.
This proves preservation, not import binding equivalence or test execution.

Accept preparation only: 7 original cases / 18 assertion evaluations mapped,
zero admitted source baselines and zero candidate-bound suites at this checkpoint.
The original-cwd child execution is rejected; ignored cache modification remains
recorded rather than repaired outside ownership. A repeated runner-scope violation
is not acceptable evidence, even if the tests report PASS. The follow-up is assigned
directly to Sol without another child, using isolated source capsules.

Release receipt `4536e2fe-03fe-45d0-a057-3e81972f4c9d` returned
`retained / external_terminal / processAction:none` before acknowledgment of
`delivery_4d59f1e9e52c`. No force-close was performed. The same exact Sol terminal
accepted fresh Task `task_89679cbd932d`, Dispatch `ctx_170956f4bd2f`, receipt
`c6a89dac-289e-4036-9258-e0fd99e2b6a5` (ready/input_accepted, no residuals).

Next required evidence is all three original baseline outcomes, isolated and
unweakened, plus assertion-to-Rust observable mappings. Durable ownership,
fencing and lease persistence belong in Rust; old TypeScript import names do not
authorize a parallel stateful backend. Shared contract ratification and real
candidate failures precede implementation. E5 remains held and audit stays 11/12.
