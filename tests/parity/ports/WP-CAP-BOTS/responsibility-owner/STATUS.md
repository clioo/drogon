# WP-CAP-BOTS / responsibility-owner — test-preparation status

Scope: this leaf owns only this subtree
(`tests/parity/ports/WP-CAP-BOTS/responsibility-owner/**`). No product
implementation, dependency install, Git operation, service launch, or recipe
edit was performed. Read-only against the pinned legacy reference; the
Drogon-rewrite tree was only read (search) and this subtree written.

## Source pin verification

- Legacy reference: `/Users/carlos/Documents/Drogon-mentu-session`
  (read-only, per AGENTS.md).
- Pinned commit: `c97906287bb7a390b25e2025b600d9fb3c25d9c3`.
- `git rev-parse HEAD` in that checkout == the pin; `git cat-file -t <pin>` ==
  `commit`. The checkout's working tree was already at this exact commit
  (only an unrelated untracked plan file present, not touched).
- Entry test file `src/main/bots/bot-responsibility-owner.test.ts` sha256
  `f4ae1f7e05c58cb3019c61777b0599821243535c378bb420b13c11e582edef6f`, matching
  both `HEAD` and the pin (identical content).

## Source baseline (reproduced, not assumed)

```
cd /Users/carlos/Documents/Drogon-mentu-session
node_modules/.bin/vitest run src/main/bots/bot-responsibility-owner.test.ts \
  --config config/vitest.config.ts --reporter=verbose
```

Result: **1 file passed (1), 11 tests passed (11)**, ~167ms. All 11 case
titles are listed in `binding-status.json`.

## Candidate interface search (Drogon-rewrite, this repo)

Searched `apps/desktop/src/**`, `crates/**`, `pnpm-workspace.yaml`, and root
`package.json`. **No Bot/responsibility-owner domain module exists anywhere
in the rewrite** (no `bots`, `bot-service`, `bot-persistence`,
`drogon-bot-contract`, `automation-run-writer`, or
`bot-automation-dispatch-context`). The only matches are staged copies of the
legacy reference under `.preflight/**`, which are not rewrite candidates and
were excluded.

This is a **blocked binding** (missing import/interface) for the entire
capability group, not a behavioral RED result, per AGENTS.md and
`docs/migration/sol-test-wave.md`.

## Port artifact

`src/main/bots/bot-responsibility-owner.test.ts` in this subtree is a
byte-identical copy of the pinned original (sha256 matches above), frozen
ahead of implementation per `docs/migration/parity-test-porting.md` §3.
Original relative import specifiers are preserved unchanged so the file can
run unmodified once a real candidate module tree exists at those exact
relative paths. No assertion was weakened, no case was skipped, and no
mock/adapter was created to fake product behavior.

## Attempted execution (evidence, not a pass)

```
cd tests/parity/ports/WP-CAP-BOTS/responsibility-owner
/Users/carlos/Documents/Drogon-rewrite/apps/desktop/node_modules/.bin/vitest \
  run --root . src/main/bots/bot-responsibility-owner.test.ts --reporter=verbose
```

(Used the already-installed `apps/desktop` vitest 5.0.0 binary read-only; no
dependency install performed.)

Result: **FAIL at collection time, 0 tests run** —
`Error: Cannot find module './bot-responsibility-owner' ... code
ERR_MODULE_NOT_FOUND`. This confirms the blocked binding directly rather than
asserting it from search alone. It is explicitly **not** recorded as
behavioral RED, a skip, or a pass.

## Case count / map

11/11 original assertion groups preserved and mapped 1:1 in
`binding-status.json` → `assertionToPortMap`, each with source line range,
exercised export(s), the exact original assertions, and its binding gap.

## Limitations

- Nothing beyond import-resolution could be exercised read-only — there is no
  candidate to run assertions against.
- Whether this domain will be reused in TypeScript or translated to Rust is
  undecided in any document available to this leaf; the port artifact and map
  are written to remain valid either way.
- This status does not claim coverage of scheduler execution, disk
  persistence durability, or a live reactive-event adapter — only that the
  frozen 11 assertions are preserved and currently blocked.

## What's left (root/parent-owned)

- Decide the candidate implementation target (TS reuse vs Rust translate) for
  the Bot/responsibility-owner domain.
- Once a candidate exists at the relative paths this port expects, re-run this
  exact file unmodified and record RED → implementation → GREEN per the
  tests-first gate.
- Parent review recorded in `docs/migration/sol-wave/cap-bots/` (parent-owned,
  not written by this leaf).
