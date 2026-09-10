// @vitest-environment jsdom
// Bot-session persistence fix: `mergeSessionsForBots` is what lets the
// sidebar's Chats section (and the Gap-2 resume check) see a Bot's session
// regardless of which workspace is currently selected -- see
// bot-session-visibility.ts's header comment for the defect this closes.
import { describe, expect, test } from "vitest";
import type { Session } from "../../../../shared/session-contract";
import { mergeSessionsForBots } from "./bot-session-visibility";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "sess-1",
    workspaceId: "ws-a",
    hostId: "host-1",
    incarnation: "inc-1",
    command: "pi",
    args: [],
    cols: 80,
    rows: 24,
    verdict: "live",
    exitCode: null,
    createdAt: "2026-09-10T10:00:00.000Z",
    ...overrides,
  };
}

describe("mergeSessionsForBots", () => {
  test("keeps a session that only the host-wide poll knows about", () => {
    // The exact shape of Defect 2: Arya's session lives in her own
    // workspace, which is not the currently selected one -- the
    // per-workspace list (`currentWorkspaceSessions`) is empty for it, but
    // the merge must still surface her session from the host-wide poll.
    const arya = session({ id: "arya-sess", workspaceId: "ws-arya" });
    const merged = mergeSessionsForBots([arya], []);
    expect(merged).toEqual([arya]);
  });

  test("the current workspace's own copy wins over a stale host-wide one", () => {
    const stale = session({ id: "sess-1", agentState: "idle" });
    const fresh = session({ id: "sess-1", agentState: "working" });
    const merged = mergeSessionsForBots([stale], [fresh]);
    expect(merged).toEqual([fresh]);
  });

  test("unions sessions from both sources with no duplicates", () => {
    const hostWide = [
      session({ id: "sess-a", workspaceId: "ws-a" }),
      session({ id: "sess-b", workspaceId: "ws-b" }),
    ];
    const current = [session({ id: "sess-b", workspaceId: "ws-b", agentState: "working" })];
    const merged = mergeSessionsForBots(hostWide, current);
    expect(merged.map((s) => s.id).sort()).toEqual(["sess-a", "sess-b"]);
    expect(merged.find((s) => s.id === "sess-b")?.agentState).toBe("working");
  });

  test("an empty host-wide poll never drops the current workspace's sessions", () => {
    const current = [session({ id: "sess-1" })];
    expect(mergeSessionsForBots([], current)).toEqual(current);
  });
});
