# WP-CAP-MEET / catalogs (accounts) — status

- Originals:
  `src/renderer/src/components/settings/accounts-search.test.ts`
  (sha256 `9cee20c8fa73c97fec3ff858f4c2997143788390fd88c6a3c60d551e4c7f3e29`,
  3 cases) and
  `src/renderer/src/components/settings/provider-account-scope.test.ts`
  (sha256 `eb77435a3f5788d959ae8ab5bc7750caa4710aa67f59e468ae5a64f9e476d0bc`,
  5 cases), both at pinned `c97906287bb7a390b25e2025b600d9fb3c25d9c3`.
- Ports: byte-identical copies at the mirrored paths here; hashes verified
  against the pinned blobs at record time and re-verified by the
  pending-register self-check.
- Placement note: the account-catalog half of the task's
  "account/provider/skills catalogs" group is recorded here because meetings/
  speech availability joins account/provider state (voice/speech model section,
  provider account scope). Implementation ownership remains WP-CAP-INT /
  WP-CAP-DEVICE per the audit allocation; this port claims none of it.
  The skills/provider half is recorded under `WP-CAP-MENTU/catalogs/`.
- Binding: **blocked** — neither
  `apps/desktop/src/renderer/src/components/settings/accounts-search` nor
  `provider-account-scope` exists in the rewrite. Additionally, the frozen
  `accounts-search.test.ts` mocks `@/i18n/i18n` and `@/i18n/localized-catalog`,
  which require the source repo's vitest `@` path alias once candidate modules
  exist; no alias config is introduced here (that wiring belongs to the
  implementation owner).
- Attempted run (repo runner, this worktree):

  ```sh
  node apps/desktop/node_modules/vitest/vitest.mjs run --root tests/parity/ports/WP-CAP-MEET/catalogs src/renderer/src/components/settings/accounts-search.test.ts src/renderer/src/components/settings/provider-account-scope.test.ts
  ```

  Result: **FAIL at collection, 0 tests run** — cannot resolve the candidate
  modules. **Test preparation (blocked binding), not behavioral RED / skip /
  pass.**

- What the 8 cases pin once bound: the MiniMax session-cookie search entry and
  its Settings search-index keywords/roll-up; provider accounts described as
  client-owned without an active runtime and remote-server-owned with one;
  provider API budgets host-scoped; owning-server naming once the saved-server
  list resolves, with the label kept bare before that.
