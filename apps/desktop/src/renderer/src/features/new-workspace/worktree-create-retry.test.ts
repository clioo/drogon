import { describe, expect, test } from "vitest";
import {
  CLIENT_WORKTREE_CREATE_MAX_ATTEMPTS,
  getClientWorktreeCreateCandidate,
  isRetryableWorktreeCreateConflict,
} from "./worktree-create-retry";

describe("worktree create retry policy (the fork's client-side suffix retry)", () => {
  test("attempt 0 keeps the value; later attempts suffix -2, -3, …", () => {
    expect(getClientWorktreeCreateCandidate("feature", 0)).toBe("feature");
    expect(getClientWorktreeCreateCandidate("feature", 1)).toBe("feature-2");
    expect(getClientWorktreeCreateCandidate("feature", 2)).toBe("feature-3");
  });

  test("the daemon's branch and folder conflicts are retryable", () => {
    expect(
      isRetryableWorktreeCreateConflict(
        "branch 'bugfix-test-1' already exists; choose a new worktree name and use Base ref to start from this branch",
      ),
    ).toBe(true);
    expect(
      isRetryableWorktreeCreateConflict(
        "a worktree with this name already exists",
      ),
    ).toBe(true);
    expect(
      isRetryableWorktreeCreateConflict(
        "Branch name must not start with \"-\"",
      ),
    ).toBe(false);
    expect(isRetryableWorktreeCreateConflict("git timed out")).toBe(false);
  });

  test("the attempt budget matches the source's policy", () => {
    expect(CLIENT_WORKTREE_CREATE_MAX_ATTEMPTS).toBe(25);
  });
});
