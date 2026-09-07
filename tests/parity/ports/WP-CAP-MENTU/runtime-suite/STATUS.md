# WP-CAP-MENTU / runtime-suite — status

- Original: `src/main/mentu/mentu-runtime.test.ts`
  (sha256 `32ad8767932ec2d609190543273b03dd069a9980b93782ad0285c61202231604`,
  pinned `c97906287bb7a390b25e2025b600d9fb3c25d9c3`).
- Port: byte-identical copy at `src/main/mentu/mentu-runtime.test.ts` here;
  hash verified against the pinned blob at record time and re-verified by the
  pending-register self-check. 12 cases, original relative imports preserved.
- Binding: **blocked** — `apps/desktop/src/main/mentu/` does not exist in the
  rewrite (no `mentu-runtime`, `mentu-runtime-identity`, or shared
  `child-process/run-process` / `wsl/wsl-runner` seam).
- Attempted run (repo runner, this worktree):

  ```sh
  node apps/desktop/node_modules/vitest/vitest.mjs run --root tests/parity/ports/WP-CAP-MENTU/runtime-suite src/main/mentu/mentu-runtime.test.ts
  ```

  Result: **FAIL at collection, 0 tests run** — cannot resolve `./mentu-runtime`.
  **Test preparation (blocked binding), not behavioral RED / skip / pass.**

- What the 12 cases pin once bound (M-groups from
  `docs/migration/audit-closure/e3-bridge/followup-bots-mentu.md`):
  M-capability probe argv/policy, M-missing (no install), M-discover recursive
  sorted JSON discovery, M-save + M-save-conflict + M-save-malformed guarded
  publication, **M-evidence (run/events/state/output/quarantine reading)**,
  **M-evidence-escape (symlink containment for outputs and quarantine)**,
  M-evidence-invalid required fields, M-argv (argv-only ops, no local run of
  SSH-owned workspaces, legacy run/resume/retry refusal), M-check-failed exit
  preservation, M-wsl guest-path routing.
