// #136: daemon git failures must never surface command echoes or
// exit-status wrappers in the UI; the raw text stays in the console log.
import { describe, expect, test, vi } from "vitest";
import {
  NOT_A_GIT_REPOSITORY_COPY,
  PR_CREATE_FALLBACK_COPY,
  sanitizeGitDetail,
  toGitDisplayError,
  toPrCreateDisplayError,
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

describe("toPrCreateDisplayError", () => {
  // #176: New PR/Create PR failures must never dump raw `gh` stderr — the
  // fork copy goes to the UI, the raw text only to the logs.
  const RAW_NO_REMOTES =
    "gh pr create --title Update index.html --body  exited with exit status: 1: no git remotes found";

  function loggedRaw(fn: () => void): string {
    const logged: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
    try {
      fn();
      return logged.flat().join(" ");
    } finally {
      spy.mockRestore();
    }
  }

  test("maps the no-remote failure to fork copy with a next step", () => {
    let shown = "";
    const logs = loggedRaw(() => {
      shown = toPrCreateDisplayError(RAW_NO_REMOTES);
    });
    expect(shown).toContain(PR_CREATE_FALLBACK_COPY);
    expect(shown).toContain("no remote");
    expect(shown).toContain("git remote add");
    expect(shown).not.toMatch(/gh\s+pr\s+create/i);
    expect(shown).not.toMatch(/exited with exit status/i);
    // Raw text is kept in the logs, never rendered.
    expect(logs).toContain("no git remotes found");
  });

  test("maps auth and missing-binary failures without raw internals", () => {
    const logs = loggedRaw(() => {
      expect(
        toPrCreateDisplayError(
          "gh is not authenticated for this host (To authenticate, run `gh auth login`): run `gh auth login`, then retry",
        ),
      ).toContain("Authenticate with GitHub");
      expect(
        toPrCreateDisplayError(
          "gh executable could not be spawned (No such file or directory): install gh or check PATH",
        ),
      ).toContain("Install the GitHub CLI");
    });
    expect(logs).toContain("gh auth login");
  });

  test("keeps a readable gh detail but never the argv or wrapper", () => {
    const logs = loggedRaw(() => {
      for (const raw of [
        "gh pr create --title Fix: a: b --body  exited with exit status: 1: HTTP 422: Validation Failed",
        "gh pr create --title T --body  exited with exit status: 1: fatal: no upstream configured for branch",
        "gh pr create --title T --body  exited with exit status: 1:",
        "",
      ]) {
        const shown = toPrCreateDisplayError(raw);
        expect(shown).toContain(PR_CREATE_FALLBACK_COPY);
        expect(shown).not.toMatch(/gh\s+pr\s+create/i);
        expect(shown).not.toMatch(/exited with exit status/i);
        expect(shown).not.toMatch(/^Error: gh\b/i);
      }
      // A title containing colons must not leak half the argv into the UI.
      expect(
        toPrCreateDisplayError(
          "gh pr create --title Fix: a: b --body  exited with exit status: 1: HTTP 422: Validation Failed",
        ),
      ).toContain("Validation Failed");
      expect(toPrCreateDisplayError("")).toBe(PR_CREATE_FALLBACK_COPY);
    });
    expect(logs).toContain("HTTP 422");
  });
});

describe("sanitizeGitDetail", () => {
  test("strips the fatal prefix but keeps its message", () => {
    expect(sanitizeGitDetail("fatal: authentication failed for origin")).toBe(
      "authentication failed for origin",
    );
  });
});
