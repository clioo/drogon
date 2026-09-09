// MIT Copyright (c) 2026 Lovecast Inc.
// R16-BF2 push semantics: idempotent, out-of-order-safe application of one
// pushed session-state change (fork pushes agent state to the card/badge;
// this build merges the push through the same row projection as the poller).
import { describe, expect, it } from "vitest";
import type { Session } from "../../../../shared/session-contract";
import { applySessionStatePush } from "./session-state-push";

const row = (
  id: string,
  agentState: Session["agentState"],
  agentStateAt: Session["agentStateAt"],
): Session => ({
  id,
  workspaceId: "w-1",
  hostId: "h-1",
  incarnation: "inc-1",
  command: "/bin/sh",
  args: [],
  cols: 80,
  rows: 24,
  verdict: "live",
  exitCode: null,
  createdAt: "2026-09-08T07:00:00Z",
  agentState,
  agentStateAt,
});

describe("applySessionStatePush", () => {
  it("updates live title/cache metadata, preserves it on legacy polls, and applies clears", () => {
    const items = [row("a", "working", "2026-09-08T07:00:00Z")];
    const event = { sessionId: "a", workspaceId: "w-1", agentState: "working" as const, agentStateAt: items[0]!.agentStateAt! };
    const metadata = { agentPromptPreview: "Refactor auth", cacheIdleAt: "2026-09-08T07:00:01Z" };
    const updated = applySessionStatePush(items, { ...event, ...metadata });
    expect(updated.applied).toBe(true);
    expect(updated.sessions[0]).toMatchObject(metadata);
    expect(applySessionStatePush(updated.sessions, event).sessions).toBe(updated.sessions);
    expect(applySessionStatePush(updated.sessions, { ...event, ...metadata }).applied).toBe(false);
    expect(applySessionStatePush(updated.sessions, { ...event, cacheIdleAt: null }).sessions[0]!.cacheIdleAt).toBeNull();
  });
  it("applies a fresh transition to the matching row only", () => {
    const items = [
      row("a", "unknown", null),
      row("b", "working", "2026-09-08T07:00:00Z"),
    ];
    const outcome = applySessionStatePush(items, {
      sessionId: "b",
      workspaceId: "w-1",
      agentState: "idle",
      agentStateAt: "2026-09-08T07:00:00Z",
    });
    expect(outcome.applied).toBe(true);
    expect(outcome.unknown).toBe(false);
    expect(outcome.sessions[0]).toBe(items[0]);
    expect(outcome.sessions[1]).toEqual({
      ...items[1],
      agentState: "idle",
      agentStateAt: "2026-09-08T07:00:00Z",
    });
  });

  it("reports unknown sessions so the caller refetches instead of inventing rows", () => {
    const items = [row("a", "working", "2026-09-08T07:00:00Z")];
    const outcome = applySessionStatePush(items, {
      sessionId: "zzz",
      workspaceId: "w-1",
      agentState: "working",
      agentStateAt: "2026-09-08T07:00:00Z",
    });
    expect(outcome).toEqual({ applied: false, unknown: true, sessions: items });
  });

  it("ignores exact duplicates by reference", () => {
    const items = [row("a", "working", "2026-09-08T07:00:00Z")];
    const outcome = applySessionStatePush(items, {
      sessionId: "a",
      workspaceId: "w-1",
      agentState: "working",
      agentStateAt: "2026-09-08T07:00:00Z",
    });
    expect(outcome.applied).toBe(false);
    expect(outcome.unknown).toBe(false);
    expect(outcome.sessions).toBe(items);
  });

  it("ignores stale stamps over newer truth", () => {
    const items = [row("a", "idle", "2026-09-08T07:00:05Z")];
    const outcome = applySessionStatePush(items, {
      sessionId: "a",
      workspaceId: "w-1",
      agentState: "working",
      agentStateAt: "2026-09-08T07:00:01Z",
    });
    expect(outcome.applied).toBe(false);
    expect(outcome.sessions).toBe(items);
  });

  it("lets a sub-second wait clear win over its own wait stamp", () => {
    const items = [row("a", "needs_input", "2026-09-08T07:00:05Z")];
    const outcome = applySessionStatePush(items, {
      sessionId: "a",
      workspaceId: "w-1",
      agentState: "working",
      agentStateAt: "2026-09-08T07:00:01Z",
    });
    expect(outcome.applied).toBe(true);
    expect(outcome.sessions[0]?.agentState).toBe("working");
  });

  it("always applies exited, and a restart stamp on top of it", () => {
    const live = [row("a", "working", "2026-09-08T07:00:05Z")];
    const exited = applySessionStatePush(live, {
      sessionId: "a",
      workspaceId: "w-1",
      agentState: "exited",
      agentStateAt: null,
    });
    expect(exited.applied).toBe(true);
    expect(exited.sessions[0]?.agentState).toBe("exited");
    const restarted = applySessionStatePush(exited.sessions, {
      sessionId: "a",
      workspaceId: "w-1",
      agentState: "working",
      agentStateAt: "2026-09-08T07:01:00Z",
    });
    expect(restarted.applied).toBe(true);
    expect(restarted.sessions[0]?.agentState).toBe("working");
  });

  it("applies same-stamp state moves like the working/idle decay", () => {
    const items = [row("a", "working", "2026-09-08T07:00:05Z")];
    const outcome = applySessionStatePush(items, {
      sessionId: "a",
      workspaceId: "w-1",
      agentState: "idle",
      agentStateAt: "2026-09-08T07:00:05Z",
    });
    expect(outcome.applied).toBe(true);
    expect(outcome.sessions[0]?.agentState).toBe("idle");
  });
});
