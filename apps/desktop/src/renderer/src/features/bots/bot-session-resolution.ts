// MIT Copyright (c) 2026 Lovecast Inc.
//
// Pure decision for the Bot "Open session" click (Defect 1). The host owns
// liveness, but the renderer must not decide "resume or dispatch a fresh
// session" by searching the SELECTED workspace's session list: a Bot's
// session runs in the Bot's own home workspace, so that lookup misses on the
// first click and the app silently opened a SECOND session ("cuando le doy
// click me abre una segunda sesión"). The daemon now projects the recorded
// link's own workspaceId/incarnation/verdict onto `bot.snapshot`, so the
// decision is workspace-independent and authoritative.
//
// The distinction that fixes the bug is `unknown`: a recorded session whose
// liveness is not established must NEVER fall through to "open a new one".
// `null` used to mean both "no record" and "don't know yet", and the caller
// dispatched on the second meaning.
//
// An `unverifiable` verdict is NOT focusable either. The daemon derives it
// from the DURABLE session row: a session it currently holds a running child
// for always reports `live` (`session::current_verdict` reads the handle's
// own exit code). So `unverifiable` positively means this daemon instance has
// no child for that id -- typically a row recovered after a daemon restart or
// an app upgrade. Focusing such a row opened a blank terminal, could never
// produce output (`session.read` has no handle to read) and could never be
// stopped (`session.stop` had nothing to kill), which is exactly the owner's
// "la sesión no inicia / el botón de stop no funciona" report. The honest
// response is `reopen`: start a session that resumes the harness's own prior
// conversation. The liveness rule still holds -- reopening never rewrites
// loss of contact as `exited`.
//
// Precedence, in the order the rules run: a POSITIVE live verdict (focus,
// dispatching nothing) > the daemon's positive "the recorded link is gone"
// fact > the latched provider conversation (a reopen that names it) > a
// renderer-side session copy > the record's own exited/unverifiable
// projection > `unknown`. Liveness leads because every later rule dispatches
// a new Drogon session: with the latched conversation ranked first, a healthy
// Bot's click reopened its own live conversation in a SECOND tab ("multiples
// ventanas apuntando a la misma sesión"). The only place the missing-fact
// yields to the latched conversation is a record the daemon resolved to
// nothing, where there is no live session left to duplicate.
import type {
  BotSessionResolution,
  BotsPanelBot,
  BotsPanelSession,
} from "../../../../shared/bot-contract";
import type { Session } from "../../../../shared/session-contract";

function recordedHarnessId(recorded: BotsPanelSession): string | null {
  return recorded.harness.length > 0 ? recorded.harness : null;
}

/**
 * Resolve the click against the daemon's own facts.
 *
 * `observed` is the fresh session-list entry for the recorded session when
 * the current view happens to list that workspace (an even fresher verdict
 * than the snapshot's projection); pass `null` otherwise. `hostId` is the
 * live connection's host, used only when projecting a focusable session from
 * the record (the observed entry carries its own host).
 */
export function resolveBotSession(input: {
  bot: BotsPanelBot;
  observed: Session | null;
  hostId: string;
}): BotSessionResolution {
  const recorded = input.bot.currentSession;
  if (!recorded) return { kind: "open" };
  const observed = input.observed;

  // LIVENESS COMES FIRST. A session this daemon says is RUNNING is focused,
  // never reopened: the reopen path dispatches a NEW Drogon session (a new
  // row, a new tab) that resumes the same provider conversation, which is
  // exactly the owner's report -- "ya tengo una sesión abierta de este bot
  // [y] termina abriendome otra ventana [...] multiples ventanas apuntando a
  // la misma sesión". The latched conversation id below is a RECOVERY for a
  // record whose session is gone or unverifiable, so it must never outrank a
  // positive live verdict; the daemon latches that id as soon as the harness
  // reports it, so ordering it first turned every click on a healthy Bot
  // into a duplicate.
  //
  // The daemon's positive "the recorded link is gone" fact still wins over
  // any renderer-side copy (a stale tab-strip entry or a host-wide poll
  // cached across a daemon restart can still claim `live`), so the focus
  // candidates are only consulted when that fact is absent. The projection
  // and the missing fact are mutually exclusive daemon-side: a record it
  // resolved to NOTHING carries no verdict at all.
  if (!recorded.recordedSessionMissing) {
    // The observed list entry is the freshest copy of the same session.
    if (observed && observed.verdict === "live") {
      return {
        kind: "focus",
        session: {
          sessionId: observed.id,
          incarnation: observed.incarnation,
          workspaceId: observed.workspaceId,
          hostId: observed.hostId,
          harnessId: observed.harnessId ?? recordedHarnessId(recorded),
        },
      };
    }
    // Workspace-independent fallback: the daemon's own projection on the
    // record, which is what makes the first click from another workspace
    // focus instead of dispatch (Defect 1). A `live` projection that lacks
    // the facts a focus needs is `unknown` and stops here -- a running
    // session the renderer cannot address is still a running session, so it
    // may not fall through to a reopen either.
    if (recorded.verdict === "live") {
      if (!recorded.incarnation || !recorded.workspaceId) {
        return { kind: "unknown" };
      }
      return {
        kind: "focus",
        session: {
          sessionId: recorded.sessionId,
          incarnation: recorded.incarnation,
          workspaceId: recorded.workspaceId,
          hostId: input.hostId,
          harnessId: recordedHarnessId(recorded),
        },
      };
    }
  }

  // Next: the harness-reported provider conversation the record latched. A
  // reopen that names THAT conversation is safe no matter what else is
  // stale: the worst case is the same conversation coming back (never two
  // live processes on different conversations), and it is the
  // bot-record-alone recovery -- the durable row can be gone entirely
  // (closed, or a daemon restart) with the record as the only source.
  if (recorded.agentSessionId) {
    return {
      kind: "reopen",
      sessionId: recorded.sessionId,
      harnessId: recordedHarnessId(recorded),
      resumeByIdentity: "bot-record",
    };
  }

  // Next: the daemon's POSITIVE "the recorded link is gone" fact -- before
  // any renderer-side session copy. A stale local copy (a tab-strip entry,
  // a host-wide poll cached across a daemon restart) can still name the
  // recorded session with verdict exited/unverifiable and would shadow the
  // phantom into a `reopen` whose "will reopen its most recent
  // conversation" notice describes an intention -- the daemon has already
  // positively resolved the link to NOTHING and the record latched NO
  // conversation, so there is nothing to name: the honest answer is the
  // fresh open plus the gone-session notice. Liveness stays owned by the
  // host: when the daemon could NOT resolve the link (older build, snapshot
  // pending), `recordedSessionMissing` is absent and every rule below
  // stands unchanged.
  if (recorded.recordedSessionMissing) {
    return {
      kind: "open",
      notice:
        "This Bot's previous session is gone -- Drogon has no record of it anymore, so there is nothing to reopen. Starting a new conversation.",
    };
  }

  if (observed) {
    if (observed.verdict === "exited" || observed.verdict === "unverifiable") {
      return {
        kind: "reopen",
        sessionId: observed.id,
        harnessId: observed.harnessId ?? recordedHarnessId(recorded),
        // The daemon reads the provider id off the session row this names.
        resumeByIdentity:
          observed.agentSessionId || recorded.agentSessionId ? "session" : null,
      };
    }
    // A `live` entry was already focused above; this only catches a list
    // entry whose verdict is outside the union (an older build). Focus is
    // the answer that cannot duplicate, so the defensive branch stands.
    return {
      kind: "focus",
      session: {
        sessionId: observed.id,
        incarnation: observed.incarnation,
        workspaceId: observed.workspaceId,
        hostId: observed.hostId,
        harnessId: observed.harnessId ?? recordedHarnessId(recorded),
      },
    };
  }

  // Not in the current view's list: fall back to the daemon's projection on
  // the record. `exited` is a positive exit observation; `unverifiable` is
  // the daemon stating it holds no running child for the id (see the module
  // comment) -- both are `reopen`, and neither is proof of exit.
  const verdict = recorded.verdict;
  if (verdict === "exited" || verdict === "unverifiable") {
    return {
      kind: "reopen",
      sessionId: recorded.sessionId,
      harnessId: recordedHarnessId(recorded),
      resumeByIdentity: recorded.agentSessionId ? "bot-record" : null,
    };
  }
  // A `live` projection never reaches here: it is resolved (focus, or
  // `unknown` when it lacks the facts a focus needs) by the liveness block
  // at the top.
  //
  // A recorded link with no projected verdict (an older daemon build, or
  // -- the dead end this closes -- a Drogon session row that no longer
  // exists because the user closed that tab).
  //
  // The duplicate-prevention instinct is kept: a record whose liveness is
  // not established must never silently open a SECOND session. Without a
  // latched provider conversation and without a daemon-positive missing
  // fact, there is nothing to name and nothing positively gone, so the
  // refusal stands.
  // No projection at all (an older daemon build): the daemon COULD still
  // hold a live session this renderer cannot see, so the conservative
  // refusal stands -- but it must name a control that actually works (the
  // card's "New session" button), never a refresh that cannot change the
  // answer.
  return { kind: "unknown" };
}
