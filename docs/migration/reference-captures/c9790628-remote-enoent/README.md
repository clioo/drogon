# Original remote ENOENT baseline receipt

Coordinator execution: 2026-09-06 UTC, source
`c97906287bb7a390b25e2025b600d9fb3c25d9c3`, Node24.19.0,
original installed Vitest4.1.11 on macOS arm64. **7/7 passing, no skips**;
`testResults` contains one file (Vitest suite counts include its describe).
This is an isolated original unit baseline, not real SSH or rewrite proof.

Manifest: `tests/parity/baseline-capsules/remote-enoent-classification.json`,
digest `f83628d17c32c63ff9762622f681c56c0599d9c8aa587ee58c700d64e5212a53`.
Runner: `scripts/run-parity-baseline-capsule.mjs`, `--execute`, explicit digest,
source root `/Users/carlos/Documents/Drogon-mentu-session`, timeout30000ms,
label `coordinator-remote-enoent`. Explicit runtime paths are in `stdout.json`.
The inherited environment was cleared; only PATH (Node24 plus system binary
directories), LANG=en_US.UTF-8 and CI=1 were supplied. No HOME or credentials
were passed. No product effect beyond in-memory classification was reached.

Fresh stage (not reused or deleted):
`.preflight/parity-baseline/coordinator-remote-enoent-Mwk3fP/`.
All staged source/license bytes matched original bytes and manifest digests.
The archived receipt/results preserve the original JSON values, adding only
a trailing newline. They are not byte-identical archives; original files are
retained separately with the following hashes.

| File | Original SHA-256 | Archived SHA-256 |
| --- | --- | --- |
| stage-receipt.json | `92ef2dc0055fa4fb727c131dbf7a5044b6cc0a5604abd0a78e8c8d2bc7104437` | `3b6e6c257f4cd8a9ac86caf78765eb127a1bb1c67a10e4d2812907b87b7f03c5` |
| vitest-results.json | `cce2f2209b03d2adbb07460e783611e67aef38669dbddb3212b0c405f3b433b3` | `74dd0ec8cfc281855ea6d46921d696fbea767157fc3bb36c26eb806069ce02a1` |

`stdout.json` is the coordinator-observed runner report, formatted for review.
No original assertion was changed, no skipped case relabeled and no installed
preview, user session, remote host or experimental inference was touched.
