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
  terminalProcessExitActionLabel,
  terminalProcessExitOffersResume,
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

  it("keeps recovery actions for restored successful exits without classifying them as failures", () => {
    const processExit = projectTerminalProcessExit({ verdict: "exited", exitCode: 0 });
    expect(processExit).toEqual({ exitCode: 0, reason: "process-completed" });
    const html = renderToString(createElement(TerminalProcessExitOverlay, {
      processExit: processExit!, onRestart: () => {}, onClose: () => {},
    }));
    expect(html).toContain("exit code 0");
    expect(html).toContain("Restart");
    expect(html).toContain("Close");
  });

  it("projects exited sessions with their code", () => {
    expect(
      projectTerminalProcessExit({ verdict: "exited", exitCode: 7 }),
    ).toEqual({ exitCode: 7, reason: "process-failed" });
  });

  // The owner's report: a harness session that died mid-run (exit 1) offered
  // only "Restart", which relaunches the harness with no resume flag -- a NEW
  // conversation in a pane the user was working in.
  it("offers a RESUME for an exited harness session that reported a conversation", () => {
    expect(
      projectTerminalProcessExit({
        id: "sess-1",
        workspaceId: "ws-1",
        verdict: "exited",
        exitCode: 1,
        harnessId: "pi",
        agentSessionId: "01a0c0f6-5b60-72e7-8dc5-a9ed89ce5409",
        agentSessionTranscriptPath:
          "/Users/x/.pi/agent/sessions/--Users-x-ws--/2026-09-20T22-36-05Z_01a0c0f6.jsonl",
      }),
    ).toEqual({ exitCode: 1, reason: "session-resumable", resumeKind: "named" });
  });

  it("says a resume can only reach the folder's most recent conversation when no identity was reported", () => {
    expect(
      projectTerminalProcessExit({
        id: "sess-1",
        workspaceId: "ws-1",
        verdict: "exited",
        exitCode: 1,
        harnessId: "claude",
        agentSessionId: null,
      }),
    ).toEqual({
      exitCode: 1,
      reason: "session-resumable",
      resumeKind: "continue",
    });
  });

  it("keeps Restart for a plain shell and for a headless turn that failed", () => {
    expect(
      projectTerminalProcessExit({
        id: "sess-1",
        workspaceId: "ws-1",
        verdict: "exited",
        exitCode: 1,
        harnessId: null,
      }),
    ).toEqual({ exitCode: 1, reason: "process-failed" });
    // A headless one-shot run's recovery belongs to its own flow (Restart
    // re-runs the prompt); it is never offered an interactive resume.
    expect(
      projectTerminalProcessExit({
        id: "sess-1",
        workspaceId: "ws-1",
        verdict: "exited",
        exitCode: 1,
        harnessId: "pi",
        args: ["-p", "do the thing"],
        agentSessionId: "conv-1",
      }),
    ).toEqual({ exitCode: 1, reason: "process-failed" });
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
    // A non-sleeping session is restarted, not resumed.
    expect(
      terminalProcessExitActionLabel({
        exitCode: null,
        reason: "connection-unrecoverable",
      }),
    ).toBe("Restart");
  });

  it("says a process-less session is SLEEPING and offers to resume it (owner directive)", () => {
    const described = describeTerminalProcessExit({
      exitCode: null,
      reason: "session-sleeping",
      resumeKind: "named",
    });
    expect(described.title).toBe("This session is sleeping");
    expect(described.detail).toContain("Resume opens the same conversation");
    // Honesty: sleeping is not exit and not a failed reconnect.
    expect(described.detail).not.toContain("exit code");
    expect(described.detail).not.toContain("Could not re-establish");
    // The primary action resumes the same conversation; calling it
    // "Restart" would read as starting a new one.
    expect(
      terminalProcessExitActionLabel({ exitCode: null, reason: "session-sleeping" }),
    ).toBe("Resume session");
  });

  it("never claims the SAME conversation when the harness named none", () => {
    const described = describeTerminalProcessExit({
      exitCode: null,
      reason: "session-sleeping",
      resumeKind: "continue",
    });
    expect(described.detail).not.toContain("the same conversation");
    expect(described.detail).toContain("most recent conversation in this folder");
  });

  it("keeps the exit code and offers the conversation for an exited resumable session", () => {
    const described = describeTerminalProcessExit({
      exitCode: 1,
      reason: "session-resumable",
      resumeKind: "named",
    });
    expect(described.title).toBe("Terminal exited");
    expect(described.detail).toContain("exit code 1");
    expect(described.detail).toContain("Resume opens the same conversation");
    expect(
      terminalProcessExitActionLabel({
        exitCode: 1,
        reason: "session-resumable",
        resumeKind: "named",
      }),
    ).toBe("Resume session");
    // The unnamed shape is the same offer with honest copy.
    expect(
      describeTerminalProcessExit({
        exitCode: 1,
        reason: "session-resumable",
        resumeKind: "continue",
      }).detail,
    ).not.toContain("the same conversation");
  });

  it("tells the restart handler which offers are resumes", () => {
    expect(
      terminalProcessExitOffersResume({ exitCode: 1, reason: "session-resumable" }),
    ).toBe(true);
    expect(
      terminalProcessExitOffersResume({ exitCode: null, reason: "session-sleeping" }),
    ).toBe(true);
    expect(
      terminalProcessExitOffersResume({ exitCode: 1, reason: "process-failed" }),
    ).toBe(false);
    expect(
      terminalProcessExitOffersResume({ exitCode: 0, reason: "process-completed" }),
    ).toBe(false);
    expect(
      terminalProcessExitOffersResume({ exitCode: 0, reason: "turn-completed" }),
    ).toBe(false);
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

  it("renders the sleeping overlay with the resume action label", () => {
    const html = renderToString(
      createElement(TerminalProcessExitOverlay, {
        processExit: { exitCode: null, reason: "session-sleeping" },
        onRestart: vi.fn(),
        onClose: vi.fn(),
      }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("This session is sleeping");
    expect(html).toContain("Resume session");
    expect(html).not.toContain(">Restart<");
    expect(html).toContain("Close");
  });

  it("renders the exited resumable overlay with Resume instead of Restart", () => {
    const html = renderToString(
      createElement(TerminalProcessExitOverlay, {
        processExit: {
          exitCode: 1,
          reason: "session-resumable",
          resumeKind: "named",
        },
        onRestart: vi.fn(),
        onClose: vi.fn(),
      }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Terminal exited");
    expect(html).toContain("exit code 1");
    expect(html).toContain("Resume session");
    expect(html).not.toContain(">Restart<");
    expect(html).toContain("Close");
  });

  it("still offers only Restart for a plain failed shell", () => {
    const html = renderToString(
      createElement(TerminalProcessExitOverlay, {
        processExit: { exitCode: 1, reason: "process-failed" },
        onRestart: vi.fn(),
        onClose: vi.fn(),
      }),
    );
    expect(html).toContain("Restart");
    expect(html).not.toContain("Resume session");
  });
});
