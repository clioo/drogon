# WP-CAP-MENTU / catalogs (skills) — status

- Originals: `src/shared/agent-skill-sharing-contract.test.ts`
  (sha256 `6755dc9e58eb62727b93f7c710fd4b416bcc665fc5aad7524c17fc50b79d84ef`,
  2 cases) plus the recorded catalog sources in
  `../source-baselines/manifest.json` (`agent-skill-sharing-contract.ts`,
  `mentu-session-pi-profile.ts`, `mentu-session-input-snapshots.ts`,
  `mentu-runtime-identity.ts` — Pi provider routes, configured-skill-byte
  snapshots overriding caller digests, and runner identity pinning).
- Port: byte-identical copy at `src/shared/agent-skill-sharing-contract.test.ts`
  here; hash verified against the pinned blob at record time and re-verified by
  the pending-register self-check.
- Placement note: the skills/provider catalog half of the task's
  "account/provider/skills catalogs" group is recorded under WP-CAP-MENTU
  because Mentu session review/policy digests consume exactly these surfaces
  (see `docs/migration/parity-skill-provider-catalog.md` for the registry
  census and its WP-ENG-CLI / WP-ENG-PLUGINS / WP-CAP-INT implementation
  ownership, which this port does not claim).
- Binding: **blocked** — `apps/desktop/src/shared/agent-skill-sharing-contract`
  does not exist in the rewrite.
- Attempted run (repo runner, this worktree):

  ```sh
  node apps/desktop/node_modules/vitest/vitest.mjs run --root tests/parity/ports/WP-CAP-MENTU/catalogs src/shared/agent-skill-sharing-contract.test.ts
  ```

  Result: **FAIL at collection, 0 tests run** — cannot resolve
  `./agent-skill-sharing-contract`. **Test preparation (blocked binding), not
  behavioral RED / skip / pass.**

- What the 2 cases pin once bound: Windows discovery-cwd acceptance without
  POSIX assumptions, and rejection of arbitrary source paths / more than 512
  explicit selectors.
