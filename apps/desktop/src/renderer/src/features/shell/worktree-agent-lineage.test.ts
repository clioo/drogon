/* MIT Copyright (c) 2026 Lovecast Inc. Ported expectations from Orca's
   src/renderer/src/components/dashboard/agent-row-lineage-model coverage
   (WorktreeCardAgents tests + the model's own rules), adapted to
   session-keyed rows: explicit recorded parent, parent-absent fallback to
   root, cycle unwind, unreachable-row normalization, sibling order. */
import { describe, expect, test } from "vitest";
import type { Session } from "../../../../shared/session-contract";
import { buildWorktreeAgentRows } from "./worktree-agent-rows";
import {
  buildSessionLineageTree,
  buildWorktreeAgentRowTree,
  resolveRowParentSessionId,
} from "./worktree-agent-lineage";
import lineageSource from "./worktree-agent-lineage.ts?raw";

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

/* Issue #606: the tab strip needs this same tree, but its nodes are bare
   `{ session }` projections, not worktree card rows. The tree was made
   generic over what it actually reads rather than copied, so these pin that
   the shape-first export IS this function and that a minimal node works. */
describe("buildSessionLineageTree (the strip's reuse, #606)", () => {
  const node = (id: string, parentSessionId: string | null) => ({
    session: { id, parentSessionId },
  });

  test("is the very same function the worktree card folds with", () => {
    expect(buildSessionLineageTree).toBe(buildWorktreeAgentRowTree);
  });

  test("groups bare {session} nodes, with no card row fields at all", () => {
    const tree = buildSessionLineageTree([
      node("lead", null),
      node("kid", "lead"),
      node("solo", null),
    ]);
    expect(tree.rootRows.map((row) => row.session.id)).toEqual(["lead", "solo"]);
    expect(
      tree.childrenByParentSessionId.get("lead")?.map((row) => row.session.id),
    ).toEqual(["kid"]);
    expect([...tree.childSessionIds]).toEqual(["kid"]);
  });

  test("hands the caller back its own node objects, not copies", () => {
    // The strip maps results straight back to ids; a rebuilt node would
    // silently drop whatever a caller hung off its own shape.
    const kid = node("kid", "lead");
    const tree = buildSessionLineageTree([node("lead", null), kid]);
    expect(tree.childrenByParentSessionId.get("lead")?.[0]).toBe(kid);
  });

  test("keeps the dangling-parent rule for a leader that is not present", () => {
    const tree = buildSessionLineageTree([node("orphan", "gone")]);
    expect(tree.rootRows.map((row) => row.session.id)).toEqual(["orphan"]);
    expect(tree.childSessionIds.size).toBe(0);
  });

  test("treats an absent parentSessionId field as no parent", () => {
    const tree = buildSessionLineageTree([{ session: { id: "lone" } }]);
    expect(tree.rootRows.map((row) => row.session.id)).toEqual(["lone"]);
  });

  test("resolveRowParentSessionId reads a bare node too", () => {
    const lead = node("lead", null);
    const kid = node("kid", "lead");
    const byId = new Map([
      ["lead", lead],
      ["kid", kid],
    ]);
    expect(resolveRowParentSessionId(kid, byId)).toBe("lead");
    expect(resolveRowParentSessionId(lead, byId)).toBeUndefined();
    // A self-parent is not a parent.
    const selfish = node("selfish", "selfish");
    expect(
      resolveRowParentSessionId(selfish, new Map([["selfish", selfish]])),
    ).toBeUndefined();
  });
});

describe("the lineage tree is declared generically, not card-shaped (#606)", () => {
  // The strip reuses this tree with bare `{ session }` nodes. At runtime a
  // generic and a card-typed signature are the same function, so only the
  // source can pin that the reuse is type-legal rather than a cast.
  test("both entry points are generic over what they actually read", () => {
    expect(lineageSource).toContain("export type SessionLineageNode = {");
    expect(lineageSource).toContain(
      "session: { id: string; parentSessionId?: string | null };",
    );
    expect(lineageSource).toContain(
      "export function resolveRowParentSessionId<RowNode extends SessionLineageNode>(",
    );
    expect(lineageSource).toContain(
      "export function buildWorktreeAgentRowTree<RowNode extends SessionLineageNode>(",
    );
    // The card's own name still resolves to the same tree.
    expect(lineageSource).toContain(
      "export type WorktreeAgentRowTree = SessionLineageTree<WorktreeAgentRow>;",
    );
  });

  test("the walk inside the tree is generic too, not pinned to card rows", () => {
    // `markReachable` closes over the tree's own rows. Left annotated as a
    // WorktreeAgentRow it compiles for the card and silently rejects the
    // strip's bare nodes, so the reuse would only be a cast.
    expect(lineageSource).toContain("    row: RowNode,");
    expect(lineageSource).not.toContain("row: WorktreeAgentRow,");
  });
});
