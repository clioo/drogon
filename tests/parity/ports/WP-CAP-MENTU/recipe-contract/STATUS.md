# WP-CAP-MENTU / recipe-contract — status

- Original: `src/shared/mentu-recipe-contract.test.ts`
  (sha256 `d5dc7fd5999e487c0f54e5d27a79f1fbd4e2fffe2a3c2a6ee09ae4edcb5a0418`,
  pinned `c97906287bb7a390b25e2025b600d9fb3c25d9c3`).
- Port: byte-identical copy at `src/shared/mentu-recipe-contract.test.ts` in
  this directory; sha256 verified equal to the pinned blob at record time and
  re-verified by `pending-register/mentu-pending.contract.test.ts` on each run.
  7 cases, original relative imports preserved.
- Binding: **blocked** — candidate modules
  `apps/desktop/src/shared/mentu-recipe-*` / run-status do not exist anywhere in
  the rewrite (verified by repo search 2026-09-07). The only Mentu surfaces in
  the rewrite are the type-only extractions
  `apps/desktop/src/shared/persistence-contracts/mentu-pane-types.ts` and
  `mentu-session-state-types.ts`, which carry no runtime behavior to bind.
- Attempted run (repo runner, this worktree, Node 24 vitest 5.0.0):

  ```sh
  node apps/desktop/node_modules/vitest/vitest.mjs run --root tests/parity/ports/WP-CAP-MENTU/recipe-contract src/shared/mentu-recipe-contract.test.ts
  ```

  Result: **FAIL at collection, 0 tests run** — cannot resolve
  `./mentu-recipe-contract`. Recorded as **test preparation (blocked binding),
  not behavioral RED, not a skip, and not a pass**.

- What the 7 cases pin once bound: checked-in recipe acceptance, public schema
  validation with unknown-field retention, optional `type`/compound children,
  malformed known-field rejection with raw retention, unsafe label/dependency/
  cycle rejection, object-shape verify requirements, and local evidence being
  distinct from formal Commitment Protocol records (R-status).
