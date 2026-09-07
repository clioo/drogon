# WP-CAP-INT / github-auto-merge — status

- Original: `src/shared/github/pull-request-auto-merge-availability.test.ts`
  (sha256 `c1748277f90cc9129064df583a1f0e0e194e48e9d5f8116049da8847f5815c3c`,
  5 cases, pinned `c97906287bb7a390b25e2025b600d9fb3c25d9c3`).
- Port: byte-identical copy at the mirrored path in this directory; sha256
  verified equal to the pinned blob at record time and re-verified by
  `pending-register/int-pending.contract.test.ts` on each run. Original
  relative import specifier preserved.
- Binding: **blocked** —
  `apps/desktop/src/shared/github/pull-request-auto-merge-availability` does
  not exist in the rewrite (verified by repo search 2026-09-07).
- Attempted run (repo runner, this worktree, pinned Node24 vitest 5.0.0):

  ```sh
  node apps/desktop/node_modules/vitest/vitest.mjs run --root tests/parity/ports/WP-CAP-INT/github-auto-merge src/shared/github/pull-request-auto-merge-availability.test.ts
  ```

  Result: **FAIL at collection, 0 tests run** — `Cannot find module
  './pull-request-auto-merge-availability'`. Recorded as **test preparation
  (blocked binding), not behavioral RED, not a skip, and not a pass**.

- What the 5 cases pin once bound: `canEnableGitHubPRAutoMerge` /
  `canShowGitHubPRAutoMergeControl` distinguish directly-mergeable PRs
  (control hidden — nothing to enable) from requirement-blocked PRs (control
  shown and enable-able); merge-queue-required branches keep the control
  visible for merge-when-ready even though the queue itself cannot be
  toggled; an already-enabled auto-merge stays visible so a user can disable
  it; and closed, draft, disallowed, conflicting, or CI-unstable PRs suppress
  the control entirely — pinning the GraphQL merge-state distinction from
  the CLI auto-merge split. No real GitHub API or PR is touched.
