# Root acceptance — identity/lease test preparation

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
