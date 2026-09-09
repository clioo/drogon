// MIT Copyright (c) 2026 Lovecast Inc. Ported verbatim from
// src/renderer/src/components/terminal-pane/terminal-process-exit-restart.ts
// plus the PaneProcessExit shape from pty-connection-types.ts, narrowed to
// the MVP subset (single pane per tab; the Git Bash capacity reason is kept
// verbatim so the overlay copy stays exact).
export type TerminalProcessExitReason =
  | "process-failed"
  | "process-completed"
  | "git-bash-console-capacity"
  // R16-AL2 (issue #228): offered after an explicit Retry connection click
  // re-listed the session and it is still `unverifiable` — the tab cannot
  // be revived by waiting. The overlay stays the fork's exited-overlay
  // structure; only the copy is adapted, and it never claims the session
  // exited (loss of contact is not exit).
  | "connection-unrecoverable";

export type TerminalProcessExit = {
  exitCode: number | null;
  reason: TerminalProcessExitReason;
};

/**
 * Projects a Drogon session onto the overlay input. Returns null while the
 * session has not positively exited — loss of contact (unverifiable) never
 * shows the exit overlay.
 */
export function projectTerminalProcessExit(session: {
  verdict: "live" | "unverifiable" | "exited";
  exitCode: number | null;
}): TerminalProcessExit | null {
  // Unlike Orca's PTY lifecycle, Drogon restores durable completed rows.
  // They still need Restart/Close; hiding their overlay strands a dead pane.
  if (session.verdict !== "exited") return null;
  return {
    exitCode: session.exitCode,
    reason: session.exitCode === 0 ? "process-completed" : "process-failed",
  };
}

/** Pure copy projection for the overlay (title + detail), kept beside the
 *  component so tests pin the strings without rendering. */
export function describeTerminalProcessExit(exit: TerminalProcessExit): {
  title: string;
  detail: string;
} {
  if (exit.reason === "git-bash-console-capacity") {
    return {
      title: "Git Bash console limit reached",
      detail:
        "Git Bash reached its 128-console limit. Close unused Git Bash terminals, then restart this terminal.",
    };
  }
  if (exit.reason === "connection-unrecoverable") {
    return {
      title: "Could not reconnect to terminal",
      detail:
        "Drogon could not re-establish this terminal's session. Its output is preserved. Restart relaunches it with the same command, or close the tab.",
    };
  }
  return {
    title: "Terminal exited",
    detail: `The shell process ended with exit code ${String(exit.exitCode)}. Its output is preserved.`,
  };
}
