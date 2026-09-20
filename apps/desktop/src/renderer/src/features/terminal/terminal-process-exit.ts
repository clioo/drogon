// MIT Copyright (c) 2026 Lovecast Inc. Ported verbatim from
// src/renderer/src/components/terminal-pane/terminal-process-exit-restart.ts
// plus the PaneProcessExit shape from pty-connection-types.ts, narrowed to
// the MVP subset (single pane per tab; the Git Bash capacity reason is kept
// verbatim so the overlay copy stays exact).
//
// Drogon addition (`session-resumable`): an exited HARNESS session has a
// conversation behind it, and the harness's own resume verb reopens it. The
// pane must offer that instead of a plain Restart -- "Restart" relaunches the
// harness with no resume flag, which is a NEW conversation in a pane the user
// was working in (the owner contract: "abrirme la misma sesion").
import {
  resumableSessionFor,
  type SleepingResumeKind,
} from "./sleeping-session";
import type { HarnessId } from "../../../../shared/session-contract";

export type TerminalProcessExitReason =
  | "process-failed"
  | "process-completed"
  | "git-bash-console-capacity"
  // R16-AL2 (issue #228): offered after an explicit Retry connection click
  // re-listed the session and it is still `unverifiable` — the tab cannot
  // be revived by waiting. The overlay stays the fork's exited-overlay
  // structure; only the copy is adapted, and it never claims the session
  // exited (loss of contact is not exit).
  | "connection-unrecoverable"
  // SLEEPING (owner directive): the daemon holds no child for this session
  // but its harness supports resuming its own conversation, so the pane is
  // not dead — it is asleep. The primary action resumes THAT conversation
  // (`claude --resume <id>`) through the harness's own verb instead of
  // relaunching a blank tab; the copy never asserts an exit.
  | "session-sleeping"
  // A positively exited harness session whose conversation the harness can
  // reopen: the process is gone, but the work is not — the primary action
  // resumes the conversation instead of relaunching a fresh one.
  | "session-resumable"
  // A headless one-shot turn (a Bot's prompt, a Work Graph role) that ended
  // with exit 0: that IS the turn finishing, not a shell dying. Nothing waits
  // for input, and relaunching it would run the prompt again.
  | "turn-completed";

export type TerminalProcessExit = {
  exitCode: number | null;
  reason: TerminalProcessExitReason;
  /**
   * How well the reopen can name the conversation (`named`: the harness
   * reported exactly which one; `continue`: only its own most-recent
   * entrypoint is available). Only meaningful for the resume reasons, and
   * the copy is the only place it shows: the pane never promises the same
   * conversation when the harness cannot name one.
   */
  resumeKind?: SleepingResumeKind;
};

/**
 * Projects a Drogon session onto the overlay input. Returns null while the
 * session has not positively exited — loss of contact (unverifiable) never
 * shows the exit overlay.
 */
export function projectTerminalProcessExit(session: {
  id?: string;
  workspaceId?: string;
  verdict: "live" | "unverifiable" | "exited";
  exitCode?: number | null;
  args?: string[];
  harnessId?: HarnessId | null;
  causedByEventId?: string | null;
  agentSessionId?: string | null;
  agentSessionTranscriptPath?: string | null;
}): TerminalProcessExit | null {
  const exitCode = session.exitCode ?? null;
  // Unlike Orca's PTY lifecycle, Drogon restores durable completed rows.
  // They still need Restart/Close; hiding their overlay strands a dead pane.
  if (session.verdict !== "exited") return null;
  if (exitCode === 0 && isHeadlessTurn(session)) {
    return { exitCode: 0, reason: "turn-completed" };
  }
  // A harness session that reported a conversation can be RESUMED, not just
  // restarted: the pane's primary action names the same conversation through
  // the harness's own verb. A plain shell (no harness), a harness with no
  // resume verb, and a headless run (whose own flow owns its recovery, and
  // whose Restart re-runs the prompt) keep the restart semantics exactly as
  // they were.
  const resumable =
    !isHeadlessTurn(session) && session.id && session.workspaceId
      ? resumableSessionFor({
          id: session.id,
          workspaceId: session.workspaceId,
          verdict: session.verdict,
          harnessId: session.harnessId,
          agentSessionId: session.agentSessionId,
          agentSessionTranscriptPath: session.agentSessionTranscriptPath,
        })
      : null;
  if (resumable) {
    return {
      exitCode,
      reason: "session-resumable",
      resumeKind: resumable.resumeKind,
    };
  }
  return {
    exitCode,
    reason: exitCode === 0 ? "process-completed" : "process-failed",
  };
}

/** A daemon-run headless launch: the prompt rides in argv (`-p`, `run
 *  --model`, `exec`), so the process ends when the turn does. Mirrors the
 *  argv shapes `monitorLaunchPrompt` reads; an interactive launch has none. */
export function isHeadlessTurn(session: {
  args?: string[];
  harnessId?: string | null;
  causedByEventId?: string | null;
}): boolean {
  if (session.causedByEventId) return true;
  const args = session.args ?? [];
  switch (session.harnessId) {
    case "pi":
      return args.includes("-p");
    case "claude": {
      const delimiter = args.indexOf("--");
      return delimiter > 0 && args[delimiter - 1] === "-p";
    }
    case "opencode":
      return args.includes("run") && args.includes("--model");
    case "codex":
      return args.includes("exec");
    case "antigravity":
      return args.length >= 2 && args.at(-2) === "-p";
    default:
      return false;
  }
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
  if (exit.reason === "session-sleeping") {
    return {
      title: "This session is sleeping",
      detail:
        exit.resumeKind === "named"
          ? "Drogon holds no process for this session, but its conversation is still there. Resume opens the same conversation with the harness's own resume command, or close the tab."
          : "Drogon holds no process for this session, but its harness can reopen a conversation. Resume reopens the most recent conversation in this folder, or close the tab.",
    };
  }
  if (exit.reason === "session-resumable") {
    // Honesty: the exit IS real (unlike sleeping), so the exit code stays;
    // what changes is the offer -- the conversation is still there, and
    // Resume names it rather than relaunching a blank one. A harness that
    // reported no identity cannot be claimed to reopen the same one.
    return {
      title: "Terminal exited",
      detail:
        exit.resumeKind === "named"
          ? `The shell process ended with exit code ${String(exit.exitCode)}. Its output is preserved. Resume opens the same conversation with the harness's own resume command, or close the tab.`
          : `The shell process ended with exit code ${String(exit.exitCode)}. Its output is preserved. Resume reopens the most recent conversation in this folder, or close the tab.`,
    };
  }
  if (exit.reason === "turn-completed") {
    return {
      title: "Turn finished",
      detail:
        "This headless turn ended with exit code 0. Its output stays here and nothing is waiting for input.",
    };
  }
  return {
    title: "Terminal exited",
    detail: `The shell process ended with exit code ${String(exit.exitCode)}. Its output is preserved.`,
  };
}

/**
 * The overlay's primary action label. A sleeping session is resumed, not
 * restarted: the same conversation comes back, so calling the button
 * "Restart" would read as "start a new one". An exited harness session with
 * a conversation behind it is the same offer -- the process is gone, the
 * work is not.
 */
export function terminalProcessExitActionLabel(
  exit: TerminalProcessExit,
): string {
  return exit.reason === "session-sleeping" || exit.reason === "session-resumable"
    ? "Resume session"
    : "Restart";
}

/** Whether the overlay's primary action is a resume (rather than a plain
 *  relaunch). The App's restart handler reads this so the button it rendered
 *  is the action it performs -- one projection, no drift. */
export function terminalProcessExitOffersResume(
  exit: TerminalProcessExit,
): boolean {
  return exit.reason === "session-sleeping" || exit.reason === "session-resumable";
}
