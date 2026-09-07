# WP-CAP-INT — Provider-integration contract preservation ports (V4-B2)

Source pin: `c97906287bb7a390b25e2025b600d9fb3c25d9c3`
(`/Users/carlos/Documents/Drogon-mentu-session`, read-only; every read used
`git -C <reference> show <pin>:<path>` from this worktree's cwd, never the
reference as cwd). Lovecast Inc. MIT provenance: `tests/parity/ports/LICENSE.orca`.

This package preserves the *descriptive* contracts of the seven-provider
integration surface (azure-devops, bitbucket, gitea, github, gitlab, jira,
linear, plus `shared/github` and `shared/linear`) and pins the
historically-pending obligations so they can neither pass silently nor
disappear. It follows the admitted WP-CAP-MENTU / WP-CAP-MEET port pattern
from checkpoint-001. It is **not** a completed port, an implementation, or an
acceptance claim.

## Layout

| Path | Contents | Binding status |
| --- | --- | --- |
| `source-baselines/manifest.json` | all 137 canonical test files (`parity-test-work-packages.json` WP-CAP-INT) with sha256; every hash cross-checked against the package manifest; revision proof; frozen-copy cross-check | recorded evidence |
| `jira-mutations/` | byte-identical `src/main/jira/jira-issue-mutations.test.ts` (6 cases; ordered issue writes) | blocked binding |
| `linear-teams/` | byte-identical `src/main/linear/teams.test.ts` (8 cases; four-permit limiter, early-release correction) | blocked binding |
| `github-auto-merge/` | byte-identical `src/shared/github/pull-request-auto-merge-availability.test.ts` (5 cases; GraphQL vs merge-queue distinction) | blocked binding |
| `gitlab-mr-rate-limit/` | byte-identical `src/main/gitlab/client-mr-auth-rate-limit.test.ts` (5 cases) | blocked binding |
| `bitbucket-status/` | byte-identical `src/main/bitbucket/status-no-decrypt.test.ts` (3 cases; no-credential-decrypt contract) | blocked binding |
| `github-identity-key/` | byte-identical `src/shared/github/repository-identity-key.test.ts` (1 case) | blocked binding |
| `pending-register/int-pending.contract.test.ts` | runnable register of historically-pending items (`it.todo`, never `pass`) + frozen-copy hash self-check | runs GREEN as a register |

## Rules this package follows

- Frozen files are byte-identical to the pinned blobs (sha256 verified at record
  time against both the reference blob and the package manifest; re-verified by
  the pending-register self-check on every run). Original relative import
  specifiers are preserved so each file runs unmodified once a real candidate
  module tree exists at those paths.
- A collection-time import failure is **test preparation, not behavioral RED**.
  No integration candidate modules exist in the rewrite; missing modules are
  reported as blocked bindings, never as passing, skipped, or failing product
  behavior.
- The bounded frozen selection covers every provider family and the exact
  findings root flagged (`docs/migration/e3-integrations-root-review.md`,
  `docs/migration/e3-integrations-correction-root-review.md`): Jira ordered
  writes (the corrected `jira.updateIssue` body anchors), Linear's
  early-permit-release correction, the GitHub GraphQL/CLI auto-merge split,
  GitLab MR auth/rate-limit handling, Bitbucket's no-decrypt status contract,
  and pure repository-identity keys.
- No mock, fixture, or adapter fabricates provider behavior. No network,
  accounts, credentials, endpoints or services were touched. Real provider
  CRUD/auth/SSH journeys remain open obligations (see the pending register).

## Runner

From the worktree root (Node 24 at
`/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`
is the repo-pinned runtime if needed):

```sh
node apps/desktop/node_modules/vitest/vitest.mjs run --root tests/parity/ports/WP-CAP-INT/pending-register
node apps/desktop/node_modules/vitest/vitest.mjs run --root tests/parity/ports/WP-CAP-INT/jira-mutations src/main/jira/jira-issue-mutations.test.ts
# (linear-teams / github-auto-merge / gitlab-mr-rate-limit / bitbucket-status / github-identity-key analogous)
```

Exact commands, counts and outcomes are recorded in each suite's `STATUS.md`.
