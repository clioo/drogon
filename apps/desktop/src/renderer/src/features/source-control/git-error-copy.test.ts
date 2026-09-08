// #136: daemon git failures must never surface command echoes or
// exit-status wrappers in the UI; the raw text stays in the console log.
import { describe, expect, test, vi } from "vitest";
import {
  NOT_A_GIT_REPOSITORY_COPY,
  sanitizeGitDetail,
  toGitDisplayError,
} from "./git-error-copy";

const RAW_NON_REPO =
  "git --no-pager -c core.quotePath=true status exited with exit status: 128: fatal: not a git repository…";

describe("toGitDisplayError", () => {
  test("maps a non-repository failure to the fork-style copy", () => {
    const logged: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
    try {
      expect(toGitDisplayError(RAW_NON_REPO, "Unable to load source control status.")).toBe(
        NOT_A_GIT_REPOSITORY_COPY,
      );
      // Raw text is kept in the logs, never rendered.
      expect(logged.flat().join(" ")).toContain("exited with exit status");
    } finally {
      spy.mockRestore();
    }
  });

  test("never returns exit-status or command-echo internals", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const raw of [
        RAW_NON_REPO,
        "git --no-pager push exited with exit status: 1: error: failed to push",
        "exited with exit status: 128",
        "",
      ]) {
        const shown = toGitDisplayError(raw, "Push failed.");
        expect(shown).not.toMatch(/exited with exit status/i);
        expect(shown).not.toMatch(/git\s+--no-pager/i);
      }
      expect(toGitDisplayError("", "Push failed.")).toBe("Push failed.");
    } finally {
      vi.restoreAllMocks();
    }
  });

  test("keeps readable daemon detail when it carries no internals", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(toGitDisplayError("authentication failed", "Push failed.")).toContain(
        "authentication failed",
      );
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("sanitizeGitDetail", () => {
  test("strips the fatal prefix but keeps its message", () => {
    expect(sanitizeGitDetail("fatal: authentication failed for origin")).toBe(
      "authentication failed for origin",
    );
  });
});
