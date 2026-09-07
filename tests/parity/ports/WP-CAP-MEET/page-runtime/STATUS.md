# WP-CAP-MEET / page-runtime — status

- Original: `src/renderer/src/components/meetings/meetings-page-runtime.test.ts`
  (sha256 `8216a4fe327ae82e2afeb68af7a735735fed4e5c27c4a643bc40f9bd3a380502`,
  pinned `c97906287bb7a390b25e2025b600d9fb3c25d9c3`).
- Port: byte-identical copy at
  `src/renderer/src/components/meetings/meetings-page-runtime.test.ts` here;
  hash verified against the pinned blob at record time and re-verified by
  `pending-register/meet-pending.contract.test.ts` on each run. 2 cases,
  original relative imports preserved.
- Binding: **blocked, twice over**:
  1. Candidate modules `apps/desktop/src/renderer/src/components/meetings/` and
     `apps/desktop/src/shared/drogon-meeting-contract` do not exist in the
     rewrite (repo search 2026-09-07).
  2. The source file declares `@vitest-environment happy-dom`; `happy-dom` (and
     `@testing-library/react`) are not installed in this worktree and no
     dependency install was authorized. This is the same disclosed
     missing-test-environment condition as the WP-CAP-BOTS `bots-page` port.
- Attempted run (repo runner, this worktree):

  ```sh
  node apps/desktop/node_modules/vitest/vitest.mjs run --root tests/parity/ports/WP-CAP-MEET/page-runtime src/renderer/src/components/meetings/meetings-page-runtime.test.ts
  ```

  Result: **FAIL at worker start, 0 tests run** —
  `Cannot find package 'happy-dom'` while starting the vitest forks worker
  (the source file's `@vitest-environment happy-dom` directive resolves before
  any import, so the candidate-module block is masked until the environment
  dependency is installed by an authorized process). **Test preparation
  (blocked environment + blocked binding), not behavioral RED / skip / pass.**

- What the 2 cases pin once bound: the companion transcript opens through a
  local read-only editor tab (`openFile` with `readOnly: true`, explicit
  external-path authorization, `suppressActiveRuntimeFallback`), and Q&A is
  asked through Drogon after mounting instead of invoking a companion provider
  (`launchAgentInNewTab` with the meeting workspace key and folder cwd).
