// MIT Copyright (c) 2026 Lovecast Inc.
// Gap 3 (task_926fddc5e769): the sidebar's "Chats" section lists Bots that
// have a session. This module is the pure projection from the daemon-owned
// facts (the Bot snapshot's `currentSession` link and the live session
// list) to the row data the section renders. It never invents a session:
// a Bot whose recorded session is not in the live list is skipped, and
// liveness comes from `botSessionState` (the daemon verdict wins over a
// hook-derived agent state), never from a hook guess.
import type { BotsPanelBot } from "../../../../shared/bot-contract";
import type {
  AgentState,
  HarnessId,
  Session,
} from "../../../../shared/session-contract";
import { botSessionState, botSessionTitle } from "../bots/bot-session-chrome";

export type SidebarBotSession = {
  botId: string;
  sessionId: string;
  displayName: string;
  /** The harness the live session actually runs; null when neither the
   *  session nor the record carries one (never guessed). */
  harnessId: HarnessId | null;
  /** Daemon-owned verdict, mapped exactly as the session header uses it. */
  state: AgentState;
  workspaceId: string;
  /** Tab-title parity: "<Bot name> · <Harness>", or the bare Bot name when
   *  no harness is known rather than a dangling separator. */
  title: string;
};

export function buildSidebarBotSessions(
  bots: readonly BotsPanelBot[],
  sessions: readonly Session[],
): SidebarBotSession[] {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const rows: SidebarBotSession[] = [];
  for (const bot of bots) {
    const recorded = bot.currentSession;
    if (!recorded) continue;
    const session = sessionsById.get(recorded.sessionId);
    // A recorded link this daemon does not observe (restarted/evicted) is
    // not a session we can truthfully list or focus: skip it.
    if (!session) continue;
    const recordedHarness =
      recorded.harness && recorded.harness.length > 0
        ? (recorded.harness as HarnessId)
        : null;
    const harnessId =
      (session.harnessId as HarnessId | null | undefined) ?? recordedHarness;
    rows.push({
      botId: bot.id,
      sessionId: session.id,
      displayName: bot.displayIdentity.displayName,
      harnessId,
      state: botSessionState(session),
      workspaceId: session.workspaceId,
      title: harnessId
        ? botSessionTitle(bot.displayIdentity.displayName, harnessId)
        : bot.displayIdentity.displayName,
    });
  }
  return rows;
}
