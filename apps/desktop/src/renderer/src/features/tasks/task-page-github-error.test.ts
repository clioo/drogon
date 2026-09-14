import { describe, expect, test } from "vitest";
import {
  toGitHubTaskStartDisplayError,
  toGitHubTasksDisplayError,
} from "./task-page-github-error";

describe("toGitHubTasksDisplayError", () => {
  test("maps a missing gh binary to the install copy", () => {
    expect(
      toGitHubTasksDisplayError(
        "gh_unavailable",
        "gh executable could not be spawned (No such file or directory (os error 2)): install gh or check PATH",
      ),
    ).toBe("Could not load GitHub tasks. Install the GitHub CLI first, then try again.");
  });

  test("maps a signed-out gh to the authenticate copy", () => {
    expect(
      toGitHubTasksDisplayError(
        "gh_unauthenticated",
        "gh is not authenticated for this host (…): run `gh auth login`, then retry",
      ),
    ).toBe("Could not load GitHub tasks. Authenticate with GitHub first, then try again.");
  });

  test("passes real outages through untouched", () => {
    const message = "gh issue list exited with exit status: 1: HTTP 500 (https://api.github.com/...)";
    expect(toGitHubTasksDisplayError("io_error", message)).toBe(message);
  });
});

describe("toGitHubTaskStartDisplayError", () => {
  test("maps a missing gh binary to the start-flavoured install copy", () => {
    expect(toGitHubTaskStartDisplayError("gh_unavailable", "raw daemon text")).toBe(
      "Could not start the task. Install the GitHub CLI first, then try again.",
    );
  });

  test("passes other failures through untouched", () => {
    expect(toGitHubTaskStartDisplayError("no_github_remote", "raw daemon text")).toBe(
      "raw daemon text",
    );
  });
});
