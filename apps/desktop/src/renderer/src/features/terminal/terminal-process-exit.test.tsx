// MIT Copyright (c) 2026 Lovecast Inc. Drogon-new tests for the adapted
// terminal-process-exit.ts projection plus the ported
// TerminalProcessExitOverlay.tsx (rendered with renderToString: no DOM
// harness exists in this repo).
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  describeTerminalProcessExit,
  projectTerminalProcessExit,
} from "./terminal-process-exit";
import { TerminalProcessExitOverlay } from "./TerminalProcessExitOverlay";

describe("projectTerminalProcessExit", () => {
  it("stays null until exit is positively observed", () => {
    expect(
      projectTerminalProcessExit({ verdict: "live", exitCode: null }),
    ).toBeNull();
    // Loss of contact is never proof of exit.
    expect(
      projectTerminalProcessExit({ verdict: "unverifiable", exitCode: null }),
    ).toBeNull();
  });

  it("does not present a successful exit as a process failure", () => {
    expect(projectTerminalProcessExit({ verdict: "exited", exitCode: 0 })).toBeNull();
  });

  it("projects exited sessions with their code", () => {
    expect(
      projectTerminalProcessExit({ verdict: "exited", exitCode: 7 }),
    ).toEqual({ exitCode: 7, reason: "process-failed" });
  });
});

describe("describeTerminalProcessExit", () => {
  it("keeps the source's exit-code copy", () => {
    const described = describeTerminalProcessExit({
      exitCode: 7,
      reason: "process-failed",
    });
    expect(described.title).toBe("Terminal exited");
    expect(described.detail).toContain("exit code 7");
  });

  it("keeps the Git Bash capacity copy", () => {
    const described = describeTerminalProcessExit({
      exitCode: 1,
      reason: "git-bash-console-capacity",
    });
    expect(described.title).toBe("Git Bash console limit reached");
    expect(described.detail).toContain("128-console limit");
  });

  it("offers the recovery copy without ever claiming an exit (issue #228)", () => {
    const described = describeTerminalProcessExit({
      exitCode: null,
      reason: "connection-unrecoverable",
    });
    expect(described.title).toBe("Could not reconnect to terminal");
    expect(described.detail).toContain("could not re-establish");
    // Honesty: loss of contact is not exit, so the copy must not assert a
    // shell exit code for a session that was never observed to exit.
    expect(described.detail).not.toContain("exit code");
  });
});

describe("TerminalProcessExitOverlay", () => {
  it("renders the alert with restart and close actions", () => {
    const html = renderToString(
      createElement(TerminalProcessExitOverlay, {
        processExit: { exitCode: 7, reason: "process-failed" },
        onRestart: () => {},
        onClose: () => {},
      }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Terminal exited");
    expect(html).toContain("exit code 7");
    expect(html).toContain("Restart");
    expect(html).toContain("Close");
  });

  it("explains the Git Bash limit", () => {
    const html = renderToString(
      createElement(TerminalProcessExitOverlay, {
        processExit: {
          exitCode: 1,
          reason: "git-bash-console-capacity",
          startup: null,
        } as unknown as { exitCode: 1; reason: "git-bash-console-capacity" },
        onRestart: vi.fn(),
        onClose: vi.fn(),
      }),
    );
    expect(html).toContain("128-console limit");
  });

  it("renders the recovery offer with the same restart/close actions (issue #228)", () => {
    const onRestart = vi.fn();
    const html = renderToString(
      createElement(TerminalProcessExitOverlay, {
        processExit: { exitCode: null, reason: "connection-unrecoverable" },
        onRestart,
        onClose: vi.fn(),
      }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Could not reconnect to terminal");
    expect(html).toContain("Restart");
    expect(html).toContain("Close");
  });
});
