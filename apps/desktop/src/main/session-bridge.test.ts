import { describe, expect, it } from "vitest";
import { isolateSessionList } from "./session-bridge";

const live = {
  id: "live-1",
  workspaceId: "w1",
  hostId: "h1",
  incarnation: "inc-1",
  command: "/bin/sh",
  args: [],
  cols: 80,
  rows: 24,
  verdict: "live",
  exitCode: null,
  createdAt: "2026-09-08T06:00:00Z",
  agentState: "idle",
  agentStateAt: "2026-09-08T06:01:00Z",
};

// Issue #222: an exited session that still carries its last agent-state
// timestamp is honest history and must validate, not fail the list.
const exitedWithHistory = {
  id: "exited-1",
  workspaceId: "w1",
  hostId: "h1",
  incarnation: "inc-2",
  command: "/bin/sh",
  args: [],
  cols: 80,
  rows: 24,
  verdict: "exited",
  exitCode: 1,
  createdAt: "2026-09-08T05:00:00Z",
  agentState: "exited",
  agentStateAt: "2026-09-08T05:30:00Z",
};

describe("isolateSessionList", () => {
  it("accepts an exited session that carries its last timestamp", () => {
    const isolated = isolateSessionList({ sessions: [live, exitedWithHistory] });
    expect(isolated.warnings).toEqual([]);
    expect(isolated.sessions.map((item) => item.id)).toEqual([
      "live-1",
      "exited-1",
    ]);
    expect(isolated.sessions[1]?.agentState).toBe("exited");
    expect(isolated.sessions[1]?.agentStateAt).toBe("2026-09-08T05:30:00Z");
  });

  it("isolates a malformed record and keeps the rest with one warning", () => {
    const malformed = { ...live, id: "bad-9", cols: 0 };
    const isolated = isolateSessionList({
      sessions: [live, malformed, exitedWithHistory],
    });
    expect(isolated.sessions.map((item) => item.id)).toEqual([
      "live-1",
      "exited-1",
    ]);
    expect(isolated.warnings).toHaveLength(1);
    expect(isolated.warnings[0]).toContain("bad-9");
  });

  it("reports a missing sessions array instead of throwing", () => {
    const isolated = isolateSessionList({ ok: true });
    expect(isolated.sessions).toEqual([]);
    expect(isolated.warnings).toHaveLength(1);
  });
});
