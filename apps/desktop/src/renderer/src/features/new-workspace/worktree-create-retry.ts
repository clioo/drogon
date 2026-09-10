/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/shared/new-workspace/worktree-create-retry-policy.ts (the client-side
   suffix retry when a create conflicts with an existing branch or folder).
   Adapter: this repo's daemon reports the two conflicts the composer can
   hit — a taken branch ("branch 'x' already exists") and a taken worktree
   folder ("a worktree with this name already exists") — so the retryable
   patterns match those messages. The generated creature-name tier walk is
   not ported: this repo's suggestion happens once per submit, so the plain
   `name-2`, `name-3` candidates cover the shared policy. */

export const CLIENT_WORKTREE_CREATE_MAX_ATTEMPTS = 25;

const RETRYABLE_WORKTREE_CREATE_CONFLICT_PATTERNS = [
  /branch '.*' already exists/i,
  /a worktree with this name already exists/i,
];

export function getClientWorktreeCreateCandidate(
  value: string,
  attempt: number,
): string {
  return attempt === 0 ? value : `${value}-${attempt + 1}`;
}

export function isRetryableWorktreeCreateConflict(
  message: string,
): boolean {
  return RETRYABLE_WORKTREE_CREATE_CONFLICT_PATTERNS.some((pattern) =>
    pattern.test(message),
  );
}
