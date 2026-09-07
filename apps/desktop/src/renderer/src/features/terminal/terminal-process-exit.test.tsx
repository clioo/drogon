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
});
