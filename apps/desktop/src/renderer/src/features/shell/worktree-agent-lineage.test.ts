/* MIT Copyright (c) 2026 Lovecast Inc. Ported expectations from Orca's
   src/renderer/src/components/dashboard/agent-row-lineage-model coverage
   (WorktreeCardAgents tests + the model's own rules), adapted to
   session-keyed rows: explicit recorded parent, parent-absent fallback to
   root, cycle unwind, unreachable-row normalization, sibling order. */
import { describe, expect, test } from "vitest";
import type { Session } from "../../../../shared/session-contract";
import { buildWorktreeAgentRows } from "./worktree-agent-rows";
import {
  buildWorktreeAgentRowTree,
  resolveRowParentSessionId,
} from "./worktree-agent-lineage";

function session(id: string, parentSessionId?: string): Session {
  return {
    id,
    workspaceId: "ws-1",
    hostId: "host-1",
    incarnation: "1",
    command: "/bin/zsh",
    args: [],
    cols: 80,
    rows: 24,
    verdict: "live",
    exitCode: null,
    createdAt: "2026-09-08T11:00:00.000Z",
    agentState: "idle",
    agentStateAt: "2026-09-08T11:59:00.000Z",
    harnessId: "pi",
    parentSessionId: parentSessionId ?? null,
  };
}

/** Rows in the card's deterministic order (creation order, then id). */
function rowsOf(...sessions: Session[]) {
  return buildWorktreeAgentRows(sessions, { nowMs: Date.parse("2026-09-08T12:00:00Z") });
}

describe("buildWorktreeAgentRowTree", () => {
  test("a row without a recorded parent is a root", () => {
    const rows = rowsOf(session("a"), session("b"));
    const tree = buildWorktreeAgentRowTree(rows);
    expect(tree.rootRows.map((r) => r.session.id)).toEqual(["a", "b"]);
    expect(tree.childrenByParentSessionId.size).toBe(0);
    expect(tree.childSessionIds.size).toBe(0);
  });

  test("a row with a recorded parent in the set nests under it", () => {
    const rows = rowsOf(session("parent"), session("child-1", "parent"), session("child-2", "parent"));
    const tree = buildWorktreeAgentRowTree(rows);
    expect(tree.rootRows.map((r) => r.session.id)).toEqual(["parent"]);
    expect(
      tree.childrenByParentSessionId.get("parent")?.map((r) => r.session.id),
    ).toEqual(["child-1", "child-2"]);
    expect(tree.childSessionIds.has("child-1")).toBe(true);
    expect(tree.childSessionIds.has("child-2")).toBe(true);
  });

  test("siblings keep the card's row order", () => {
    const older = session("older-child", "parent");
    const newer = {
      ...session("newer-child", "parent"),
      createdAt: "2026-09-08T11:30:00.000Z",
    };
    const rows = rowsOf(newer, session("parent"), older);
    const tree = buildWorktreeAgentRowTree(rows);
    expect(tree.rootRows.map((r) => r.session.id)).toEqual(["parent"]);
    expect(
      tree.childrenByParentSessionId.get("parent")?.map((r) => r.session.id),
    ).toEqual(["older-child", "newer-child"]);
  });

  test("grandchildren nest one level deeper under their own parent", () => {
    const rows = rowsOf(
      session("lead"),
      session("worker", "lead"),
      session("worker-child", "worker"),
    );
    const tree = buildWorktreeAgentRowTree(rows);
    expect(tree.rootRows.map((r) => r.session.id)).toEqual(["lead"]);
    expect(
      tree.childrenByParentSessionId.get("lead")?.map((r) => r.session.id),
    ).toEqual(["worker"]);
    expect(
      tree.childrenByParentSessionId.get("worker")?.map((r) => r.session.id),
    ).toEqual(["worker-child"]);
  });

  test("a parent outside the row set renders the child flat (dangling parent)", () => {
    const rows = rowsOf(session("a"), session("b", "elsewhere"));
    const tree = buildWorktreeAgentRowTree(rows);
    expect(tree.rootRows.map((r) => r.session.id)).toEqual(["a", "b"]);
    expect(tree.childrenByParentSessionId.size).toBe(0);
  });

  test("a self-parent never nests", () => {
    const rows = rowsOf(session("a", "a"));
    const tree = buildWorktreeAgentRowTree(rows);
    expect(tree.rootRows.map((r) => r.session.id)).toEqual(["a"]);
  });

  test("a closed cycle unwinds to flat roots instead of hiding rows", () => {
    const rows = rowsOf(session("a", "b"), session("b", "a"));
    const tree = buildWorktreeAgentRowTree(rows);
    expect(tree.rootRows.map((r) => r.session.id)).toEqual(["a", "b"]);
    expect(tree.childrenByParentSessionId.size).toBe(0);
  });

  test("rows unreachable from any root normalize back to roots", () => {
    // a is a genuine root; b -> c -> b forms a cycle disconnected from
    // it: the fork's model keeps the reachable tree and lifts the
    // unreachable rows to roots instead of hiding them.
    const rows = rowsOf(session("a"), session("b", "c"), session("c", "b"));
    const tree = buildWorktreeAgentRowTree(rows);
    expect(tree.rootRows.map((r) => r.session.id)).toEqual(["a", "b", "c"]);
    expect(tree.childrenByParentSessionId.size).toBe(0);
  });

  test("an absent parentSessionId resolves to no parent", () => {
    const rows = rowsOf(session("a"));
    const byId = new Map(rows.map((r) => [r.session.id, r]));
    expect(resolveRowParentSessionId(rows[0], byId)).toBeUndefined();
  });
});
