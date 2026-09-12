// Sleeping sessions: the first-class state Orca gives a pane whose process is
// gone but whose provider conversation is still resumable, ported to Drogon's
// session model (owner directive: "no tratar una sesion sin proceso como
// muerta; tiene un estado SLEEPING y se reanuda con el verbo propio del
// harness").
//
// Where the states come from on this side of the contract:
// - `live`: the daemon holds a running child for the session.
// - `unverifiable`: the daemon positively holds NO child for it (a held,
//   running child always reports `live`), typically a row recovered after a
//   daemon restart or an app upgrade. Loss of contact is never exit.
// - `exited`: a positively observed process exit — NOT sleeping; there is
//   nothing left to resume in the pane's own lifecycle.
//
// A sleeping session is an `unverifiable` one launched by a harness that has
// its own resume verb. How strong the resume is depends on what the harness
// reported (see `resumeKind`):
// - `named`: the exact provider conversation is known, so the reopen runs
//   `claude --resume <id>` (and the equivalents) — the owner's contract.
// - `continue`: the harness can reopen something but reported no identity, so
//   the best available answer is its own most-recent entrypoint. Honest, but
//   never presented as the same conversation.
// - `none`: the harness has no resume mechanism at all; a reopen is a NEW
//   session and the UI must say so.
//
// Deliberately NOT ported from the source reference's sleeping-record model
// (`src/renderer/src/lib/sleeping-agent-pane-ownership.ts`):
// `isPassiveCompletedHibernationEvidence` excludes a finished, non-quit record
// from resuming, and `origin: 'worktree-sleep' | 'quit' | 'live'` plus
// `interrupted` describe WHICH local event captured the record. Drogon captures
// nothing at close time — its records are the daemon's own durable rows and its
// hook-reported turn fact — so there is no origin to weigh, and porting "a
// finished turn never resumes" would refuse exactly the owner's case (an
// unverifiable session whose last turn concluded). The reference's provider
// identity/argv machinery, which is the part that matters here, IS ported:
// `getAgentResumeArgv` lives in `drogon-harness`'s launch planner and in
// `drogon_core::claim_identity::resume`.
import type { Session } from "../../../../shared/session-contract";
import { RESUMABLE_TUI_AGENTS } from "../../../../shared/persistence-contracts/agent-session-resume";

/** How well a sleeping session's conversation can be named on reopen. */
export type SleepingResumeKind = "named" | "continue" | "none";

export type SleepingSession = {
  sessionId: string;
  workspaceId: string;
  harnessId: string;
  /** The exact provider conversation the harness reported, when it did. */
  agentSessionId: string | null;
  agentSessionTranscriptPath: string | null;
  resumeKind: SleepingResumeKind;
};

/** The harnesses whose own CLI has a resume verb this app can drive. */
export function harnessCanResume(
  harnessId: string | null | undefined,
): harnessId is string {
  return (
    typeof harnessId === "string" &&
    (RESUMABLE_TUI_AGENTS as readonly string[]).includes(harnessId)
  );
}

/**
 * Whether the reported identity is enough to name ONE conversation.
 *
 * Pi is the exception that makes this more than a null check: `pi --session`
 * takes the session FILE it wrote, not the id, so an id without a transcript
 * path cannot name anything (the reference's `getAgentResumeArgv` returns
 * `null` for exactly this case). Every other resumable harness resumes by id.
 */
export function namesOneConversation(input: {
  harnessId: string;
  agentSessionId: string | null | undefined;
  agentSessionTranscriptPath?: string | null;
}): boolean {
  const id = input.agentSessionId?.trim();
  if (!id) return false;
  if (input.harnessId === "pi") {
    return Boolean(input.agentSessionTranscriptPath?.trim());
  }
  return true;
}

/** The session-record subset the sleeping projection reads. The two identity
 *  fields stay optional so a caller holding a `Session` (where they are
 *  additive-optional for older daemons) can pass it directly. */
export type SleepingSessionRecord = Pick<
  Session,
  "id" | "workspaceId" | "verdict" | "harnessId"
> & {
  agentSessionId?: string | null;
  agentSessionTranscriptPath?: string | null;
};

/**
 * The sleeping projection of a session, or `null` when it is not sleeping.
 * Pure: the caller renders whatever this returns, never its own guess.
 */
export function sleepingSessionFor(
  session: SleepingSessionRecord,
): SleepingSession | null {
  // An exited session is positively gone; the recovery overlay owns it.
  if (session.verdict !== "unverifiable") return null;
  const harnessId = session.harnessId ?? null;
  // A plain shell has no conversation to resume: its "reopen" is a new shell.
  if (!harnessId || !harnessCanResume(harnessId)) return null;
  const agentSessionId = session.agentSessionId?.trim() || null;
  const agentSessionTranscriptPath = session.agentSessionTranscriptPath?.trim() || null;
  const resumeKind: SleepingResumeKind = namesOneConversation({
    harnessId,
    agentSessionId,
    agentSessionTranscriptPath,
  })
    ? "named"
    : "continue";
  return {
    sessionId: session.id,
    workspaceId: session.workspaceId,
    harnessId,
    agentSessionId,
    agentSessionTranscriptPath,
    resumeKind,
  };
}

/**
 * The banner a resume launch must raise, or `null` when the launch was not
 * a verified resume at all (so a fresh tab never claims a restore). Ported
 * contract from the reference's `agentResumeUnavailable`: main (there: the
 * Electron main process; here: the daemon) is the one that decides whether
 * the requested conversation can actually be opened, and when it declines,
 * the pane says it started fresh.
 *
 * Honesty over fidelity (owner rule: "a fresh start must say it started
 * fresh"):
 * - `fresh` -> `resume-unavailable`: the daemon declined (nothing to
 *   resume, or the recorded transcript is gone) and a NEW conversation
 *   started.
 * - `resumed` -> `restored`: the daemon verified the locator (its
 *   persisted transcript exists) before claiming anything.
 * - `continued` / `resume-unverified` -> `null`: the daemon could not
 *   confirm the restoration up front (`continued` is the CLI's own
 *   most-recent entrypoint after a degraded resume, `resume-unverified`
 *   an id-only locator with nothing to check). No banner is raised -- the
 *   harness's own output is the only honest confirmation left.
 */
export function restoredBannerReason(
  agentResume: Session["agentResume"],
): "restored" | "resume-unavailable" | null {
  if (agentResume === "fresh") return "resume-unavailable";
  if (agentResume === "resumed") return "restored";
  return null;
}
