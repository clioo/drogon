// MIT Copyright (c) 2026 Lovecast Inc.
// The Run Recipe delegation seam. The owner's design: the UI never runs a
// recipe itself — it hands the workspace's MAIN agent session a
// deterministic prompt, and the agent orchestrates the run through
// `drogon-cli mentu run`. This module owns the two things that decision
// needs: which session is "main", and how the prompt is delivered without
// typing into a dead or mid-turn TUI.
//
// Delivery reuses the exact transport the terminal pane's paste path uses
// (`window.drogon.write`, i.e. the daemon's `session.write`, the same RPC
// `drogon-cli terminal send` wraps) rather than simulating keystrokes: the
// PTY echoes the text, so the prompt becomes a VISIBLE turn in the session,
// and the user can read exactly what he delegated.

import type { Result, Session } from "../../../../shared/session-contract";

/** How long to wait for a busy/quiet-unobserved main session to reach a
 *  state where typing cannot land inside someone else's turn. */
export const MENTU_DISPATCH_WAIT_MS = 30_000;
export const MENTU_DISPATCH_POLL_MS = 1_000;

export type MentuDispatchDeps = {
  sessions: (
    workspaceId: string,
  ) => Promise<Result<{ sessions: Session[] }>>;
  write: (input: {
    sessionId: string;
    incarnation: string;
    text: string;
  }) => Promise<Result<unknown>>;
};

export function defaultMentuDispatchDeps(): MentuDispatchDeps {
  return {
    sessions: (workspaceId) => window.drogon.sessions(workspaceId),
    write: (input) => window.drogon.write(input),
  };
}

/**
 * The workspace's main agent session.
 *
 * "Main" means: an agent session (one a harness launched), preferring the
 * session the user is currently looking at, and preferring a live one. A
 * plain shell never qualifies: an agent prompt written into a shell would
 * be executed as a command, and a recipe run must never be attributable to
 * a stray keystroke. An exited agent session is still RETURNED (rather than
 * hidden as "no session") when it is all the workspace has, so the
 * dispatcher can say honestly that the session died instead of pretending
 * the workspace never had one.
 */
export function pickMentuMainSession(
  sessions: readonly Session[],
  activeSessionId: string | null,
): Session | null {
  const agents = sessions.filter((session) => Boolean(session.harnessId));
  if (agents.length === 0) return null;
  const preferred = (pool: readonly Session[]): Session | null => {
    const active = pool.find((session) => session.id === activeSessionId);
    if (active) return active;
    const newest = [...pool].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    );
    return newest.at(-1) ?? null;
  };
  const alive = agents.filter((session) => isMentuMainSessionLive(session));
  return preferred(alive) ?? preferred(agents);
}

/** Whether a session picked by [`pickMentuMainSession`] can be typed into at
 *  all; false means it may be shown, but never written to. */
export function isMentuMainSessionLive(session: Session | null): boolean {
  return (
    session !== null &&
    session.verdict !== "exited" &&
    session.agentState !== "exited"
  );
}

export type MentuRunPromptInput = {
  workspaceId: string;
  recipeId: string;
  /** Kept for callers/tests that already resolved it; the approval id is
   *  what the daemon checks, so the hash is not repeated on the wire. */
  contentHash: string;
  approvalId: string;
};

/**
 * Upper bound for the delivered text, in UTF-8 bytes.
 *
 * A PTY in canonical (cooked) mode — which is what any plain shell running
 * as a "harness" fixture is, and what a TUI falls back to before it sets
 * raw mode — buffers a line up to the kernel's MAX_CANON (1024 bytes on
 * macOS). A longer line overflows that buffer and the terminating Enter is
 * lost, so the prompt never becomes a turn. Staying under 900 bytes keeps
 * the delivery seam honest for every harness, not just raw-mode TUIs.
 */
export const MENTU_RUN_PROMPT_MAX_BYTES = 900;

/**
 * The exact text delivered to the main session. Deterministic: the same
 * approval, recipe and workspace always produce byte-identical text, so a
 * screenshot or a terminal log is reproducible evidence.
 *
 * Deliberately ONE line: it is written to a PTY, and an embedded newline
 * would be read as Enter and submit a half-finished turn. Kept under
 * [`MENTU_RUN_PROMPT_MAX_BYTES`] for the canonical-mode reason above.
 */
export function composeMentuRunPrompt(input: MentuRunPromptInput): string {
  const run =
    `drogon-cli mentu run --workspace ${input.workspaceId} --recipe ${input.recipeId} ` +
    `--approval ${input.approvalId} --follow --timeout-ms 900000`;
  return [
    `Drogon Work Graph run request for recipe "${input.recipeId}" in workspace "${input.workspaceId}"`,
    `(approved, approval ${input.approvalId}).`,
    `You are the orchestrator: do not edit the recipe and do not run its steps by hand.`,
    `If you have not read it this session, run drogon-cli skills get --topic drogon-cli first,`,
    `then run and follow it to the end with: ${run}.`,
    `When it settles, report here the run id, every step's status, and the failing step's error;`,
    `stop it with drogon-cli mentu cancel --run <RUN-ID>.`,
    `The daemon records the run, so Evidence and Metrics in the Work Graph tab fill in while it runs.`,
  ].join(" ");
}

export type MentuDispatchFailure =
  | { kind: "no-session" }
  | { kind: "list-failed"; message: string }
  | { kind: "session-exited"; sessionId: string }
  | { kind: "session-busy"; sessionId: string; agentState: string }
  | { kind: "session-needs-input"; sessionId: string }
  | { kind: "write-failed"; sessionId: string; message: string };

export type MentuDispatchResult =
  | { ok: true; sessionId: string; waitedMs: number }
  | { ok: false; failure: MentuDispatchFailure };

export function describeMentuDispatchFailure(
  failure: MentuDispatchFailure,
): string {
  switch (failure.kind) {
    case "no-session":
      return "No agent session is open in this workspace. Open a Claude, Pi, OpenCode or Codex session and run the recipe again — the prompt has to reach an agent that can run drogon-cli.";
    case "list-failed":
      return `Could not read this workspace's sessions: ${failure.message}`;
    case "session-exited":
      return `The workspace's main agent session (${failure.sessionId}) has exited; start a new agent session and run the recipe again.`;
    case "session-needs-input":
      return `The workspace's main agent session (${failure.sessionId}) is waiting for input. Answer it in the terminal first, then run the recipe.`;
    case "session-busy":
      return `The workspace's main agent session (${failure.sessionId}) stayed ${failure.agentState} for the whole wait; the prompt was NOT sent, because typing into a mid-turn TUI can be read as keystrokes. Run the recipe again once the agent is idle.`;
    case "write-failed":
      return `The prompt could not be delivered to the main agent session (${failure.sessionId}): ${failure.message}`;
  }
}

/**
 * Waits for a state where writing is safe, then writes `prompt` plus one
 * carriage return (Enter) into the workspace's main agent session.
 *
 * States:
 * - no agent session at all -> `no-session`, nothing written.
 * - the main session exited -> `session-exited`, nothing written.
 * - `needs_input` (a permission prompt, a question) -> refused, nothing
 *   written: the text would answer that prompt instead of starting a turn.
 * - `idle` -> deliver.
 * - `working` (mid-turn) or `unknown` (no output observed yet, so idleness
 *   was never established) -> poll until idle, bounded by `waitMs`. If the
 *   deadline passes the dispatch is REFUSED with the observed state, never
 *   a blind write into a busy TUI.
 */
export async function dispatchMentuRunPrompt(
  deps: MentuDispatchDeps,
  input: {
    workspaceId: string;
    activeSessionId: string | null;
    prompt: string;
    waitMs?: number;
    pollMs?: number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<MentuDispatchResult> {
  const waitMs = input.waitMs ?? MENTU_DISPATCH_WAIT_MS;
  const pollMs = input.pollMs ?? MENTU_DISPATCH_POLL_MS;
  const sleep =
    input.sleep ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));
  const deadline = Date.now() + waitMs;
  let lastState: string | null = null;

  for (;;) {
    let listed: Result<{ sessions: Session[] }>;
    try {
      listed = await deps.sessions(input.workspaceId);
    } catch (error) {
      return {
        ok: false,
        failure: {
          kind: "list-failed",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
    if (!listed.ok) {
      return {
        ok: false,
        failure: { kind: "list-failed", message: listed.error.message },
      };
    }
    const session = pickMentuMainSession(
      listed.result.sessions,
      input.activeSessionId,
    );
    if (!session) return { ok: false, failure: { kind: "no-session" } };
    const agentState = session.agentState ?? "unknown";
    if (session.verdict === "exited" || agentState === "exited") {
      return { ok: false, failure: { kind: "session-exited", sessionId: session.id } };
    }
    if (agentState === "needs_input") {
      return {
        ok: false,
        failure: { kind: "session-needs-input", sessionId: session.id },
      };
    }
    if (agentState === "idle") {
      let written: Result<unknown>;
      try {
        written = await deps.write({
          sessionId: session.id,
          incarnation: session.incarnation,
          text: `${input.prompt}\r`,
        });
      } catch (error) {
        written = {
          ok: false,
          error: {
            code: "internal_error",
            message: error instanceof Error ? error.message : String(error),
            retryable: false,
          },
        };
      }
      if (!written.ok) {
        return {
          ok: false,
          failure: {
            kind: "write-failed",
            sessionId: session.id,
            message: written.error.message,
          },
        };
      }
      return {
        ok: true,
        sessionId: session.id,
        waitedMs: Math.max(0, waitMs - Math.max(0, deadline - Date.now())),
      };
    }
    lastState = agentState;
    if (Date.now() >= deadline) {
      return {
        ok: false,
        failure: {
          kind: "session-busy",
          sessionId: session.id,
          agentState: lastState ?? "unknown",
        },
      };
    }
    await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
  }
}
