// MIT Copyright (c) 2026 Lovecast Inc.
// The designer model's contract tests: add/edit/delete/connect produce the
// expected `intent`; cycles are refused; NO code path produces a payload
// with a `state` key; unknown fields (and unparseable nodes) survive a
// round-trip; auto-layout only ever moves what it is asked to move.

import { describe, expect, it } from "vitest";
import {
  addDesignerNode,
  applyAutoLayout,
  autoLayoutPositions,
  connectDesignerNodes,
  deleteDesignerNode,
  disconnectDesignerNodes,
  draftCycle,
  draftFromIntentNodes,
  designerNodeId,
  markDesignerSaved,
  toIntentPayload,
  updateDesignerNode,
  wouldCreateCycle,
} from "./work-graph-designer";

describe("work-graph-designer", () => {
  it("adding a node produces the expected intent payload", () => {
    const { draft, node } = addDesignerNode(empty(), {
      title: "Plan the migration",
      harness: "claude",
      model: "claude-sonnet-5",
      prompt: "Read the repo and plan.",
    });
    expect(node.id).toBe("plan-the-migration");
    expect(node.enabled).toBe(true);
    expect(node.dependsOn).toEqual([]);
    const { payload, issues } = toIntentPayload(draft);
    expect(issues).toEqual([]);
    expect(payload).toEqual({
      nodes: [
        {
          id: "plan-the-migration",
          title: "Plan the migration",
          harness: "claude",
          model: "claude-sonnet-5",
          dependsOn: [],
          prompt: "Read the repo and plan.",
          enabled: true,
        },
      ],
    });
    expect(Object.keys(payload)).toEqual(["nodes"]);
    expect("state" in payload).toBe(false);
  });

  it("ids dedupe with a numeric suffix and stay contract-sized", () => {
    const first = addDesignerNode(empty(), { title: "Build!" });
    const second = addDesignerNode(first.draft, { title: "Build!" });
    expect(second.node.id).toBe("build-2");
    const weird = addDesignerNode(second.draft, { title: "????" });
    expect(weird.node.id).toBe("node");
    expect(designerNodeId("x".repeat(80), new Set())).toBe("x".repeat(32));
  });

  it("renaming a never-saved node re-derives its id and remaps edges", () => {
    const a = addDesignerNode(empty(), { title: "Draft name" });
    const renamed = updateDesignerNode(a.draft, a.node.id, { title: "Final name" });
    expect(renamed.nodes[0].id).toBe("final-name");
    // An edge drawn before the rename follows the new id.
    const b = addDesignerNode(renamed, { title: "B" });
    const connected = connectDesignerNodes(b.draft, "final-name", b.node.id).draft;
    const renamedAgain = updateDesignerNode(connected, "final-name", { title: "One more" });
    expect(renamedAgain.nodes.find((node) => node.id === "b")?.dependsOn).toEqual(["one-more"]);
  });

  it("a saved node keeps its id forever, whatever the rename", () => {
    const seeded = draftFromIntentNodes([
      { id: "n1", title: "Old title", harness: "shell", model: "", dependsOn: [], prompt: "p", enabled: true },
    ]);
    const renamed = updateDesignerNode(seeded, "n1", { title: "New title" });
    expect(renamed.nodes[0].id).toBe("n1");
  });

  it("a node keeps its stable uid across a rename that re-derives its id", () => {
    // The uid is the UI's React identity: a provisional rename churns the
    // id per keystroke, and the focused editor must survive it.
    const a = addDesignerNode(empty(), { title: "Draft name" });
    const renamed = updateDesignerNode(a.draft, a.node.id, { title: "Final name" });
    expect(renamed.nodes[0].id).toBe("final-name");
    expect(renamed.nodes[0].uid).toBe(a.node.uid);
    // Saved nodes and loaded nodes carry uids too, distinct per node.
    const saved = markDesignerSaved(renamed);
    expect(saved.nodes[0].uid).toBe(a.node.uid);
    const loaded = draftFromIntentNodes([
      { id: "x", title: "X", harness: "shell", model: "", dependsOn: [], prompt: "p", enabled: true },
      { id: "y", title: "Y", harness: "shell", model: "", dependsOn: [], prompt: "p", enabled: true },
    ]);
    expect(loaded.nodes[0].uid).not.toBe(loaded.nodes[1].uid);
  });

  it("the uid is renderer-local bookkeeping and never rides in the intent payload", () => {
    const { draft } = addDesignerNode(empty(), { title: "Plan", prompt: "do it" });
    const { payload, issues } = toIntentPayload(draft);
    expect(issues).toEqual([]);
    expect("uid" in payload.nodes[0]).toBe(false);
  });

  it("editing a node changes exactly that node's fields", () => {
    const { draft } = addDesignerNode(empty(), { title: "One" });
    const withTwo = addDesignerNode(draft, { title: "Two" });
    const edited = updateDesignerNode(withTwo.draft, withTwo.node.id, {
      model: "m",
      prompt: "do the thing",
      enabled: false,
    });
    const [one, two] = edited.nodes;
    expect(one.model).toBe("");
    expect(two.model).toBe("m");
    expect(two.prompt).toBe("do the thing");
    expect(two.enabled).toBe(false);
    expect(one.enabled).toBe(true);
  });

  it("deleting a node removes every edge that named it", () => {
    const a = addDesignerNode(empty(), { title: "A" });
    const b = addDesignerNode(a.draft, { title: "B" });
    const connected = connectDesignerNodes(b.draft, a.node.id, b.node.id).draft;
    const afterDelete = deleteDesignerNode(connected, a.node.id);
    expect(afterDelete.nodes.map((node) => node.id)).toEqual(["b"]);
    expect(afterDelete.nodes[0].dependsOn).toEqual([]);
  });

  it("connecting produces the dependency edge B dependsOn A", () => {
    const a = addDesignerNode(empty(), { title: "A" });
    const b = addDesignerNode(a.draft, { title: "B" });
    const { draft, refusal } = connectDesignerNodes(b.draft, a.node.id, b.node.id);
    expect(refusal).toBeNull();
    expect(draft.nodes.find((node) => node.id === "b")?.dependsOn).toEqual(["a"]);
    const { payload } = toIntentPayload(draft);
    expect(payload.nodes[1]).toMatchObject({ id: "b", dependsOn: ["a"] });
  });

  it("refuses self edges, duplicates and unknown ids without mutating", () => {
    const a = addDesignerNode(empty(), { title: "A" });
    const b = addDesignerNode(a.draft, { title: "B" });
    const self = connectDesignerNodes(b.draft, a.node.id, a.node.id);
    expect(self.refusal?.kind).toBe("self");
    expect(self.draft).toBe(b.draft);
    const first = connectDesignerNodes(b.draft, a.node.id, b.node.id);
    const duplicate = connectDesignerNodes(first.draft, a.node.id, b.node.id);
    expect(duplicate.refusal?.kind).toBe("duplicate");
    expect(duplicate.draft).toBe(first.draft);
    const unknown = connectDesignerNodes(b.draft, "ghost", b.node.id);
    expect(unknown.refusal?.kind).toBe("unknown");
  });

  it("refuses the edge that would close a cycle", () => {
    const a = addDesignerNode(empty(), { title: "A" });
    const b = addDesignerNode(a.draft, { title: "B" });
    const ab = connectDesignerNodes(b.draft, a.node.id, b.node.id).draft;
    // B already reaches A through the drawn edge; A → B would close a loop.
    expect(wouldCreateCycle(ab.nodes, b.node.id, a.node.id)).toBe(true);
    const closing = connectDesignerNodes(ab, b.node.id, a.node.id);
    expect(closing.refusal?.kind).toBe("cycle");
    expect(closing.refusal?.message).toMatch(/cycle/i);
    expect(closing.draft).toBe(ab);
    expect(draftCycle(ab)).toBeNull();
  });

  it("disconnect removes exactly the one edge", () => {
    const a = addDesignerNode(empty(), { title: "A" });
    const b = addDesignerNode(a.draft, { title: "B" });
    const c = addDesignerNode(b.draft, { title: "C" });
    let draft = connectDesignerNodes(c.draft, a.node.id, b.node.id).draft;
    draft = connectDesignerNodes(draft, a.node.id, c.node.id).draft;
    draft = disconnectDesignerNodes(draft, a.node.id, b.node.id);
    expect(draft.nodes.find((node) => node.id === "b")?.dependsOn).toEqual([]);
    expect(draft.nodes.find((node) => node.id === "c")?.dependsOn).toEqual(["a"]);
  });

  it("never produces a state key, whatever the draft carries", () => {
    const seeded = draftFromIntentNodes([
      {
        id: "n1",
        title: "N one",
        harness: "shell",
        model: "",
        dependsOn: [],
        prompt: "p",
        enabled: true,
        // A hostile/naive caller pasting a whole document's halves in:
        state: { nodes: [{ id: "n1", status: "running" }] },
      },
    ]);
    // The designer strips node-level `state` keys with an honest issue:
    // no shape of payload it produces ever carries the daemon's half.
    const { payload, issues } = toIntentPayload(seeded);
    expect(issues.some((issue) => issue.includes("state"))).toBe(false);
    expect(seeded.issues.some((issue) => issue.message.includes("`state`"))).toBe(true);
    expect("state" in payload).toBe(false);
    expect("state" in (payload.nodes[0] as Record<string, unknown>)).toBe(false);
  });

  it("unknown node fields survive a parse→serialize round-trip", () => {
    const seeded = draftFromIntentNodes([
      {
        id: "n1",
        title: "N one",
        harness: "shell",
        model: "",
        dependsOn: [],
        prompt: "p",
        enabled: true,
        futureNodeKey: { ui: "extension" },
      },
    ]);
    const edited = updateDesignerNode(seeded, "n1", { title: "Renamed" });
    const { payload, issues } = toIntentPayload(edited);
    expect(issues).toEqual([]);
    expect(payload.nodes[0]).toMatchObject({
      id: "n1",
      title: "Renamed",
      futureNodeKey: { ui: "extension" },
    });
  });

  it("preserves nodes it cannot parse instead of silently deleting them", () => {
    const seeded = draftFromIntentNodes([
      {
        id: "editable",
        title: "Editable",
        harness: "shell",
        model: "",
        dependsOn: [],
        prompt: "p",
        enabled: true,
      },
      { id: "from-the-future", title: "", harness: "" },
    ]);
    expect(seeded.preservedNodes).toHaveLength(1);
    expect(
      seeded.issues.some((issue) => issue.message.includes("preserved")),
    ).toBe(true);
    const { payload } = toIntentPayload(seeded);
    expect(payload.nodes).toHaveLength(2);
    expect(payload.nodes[1]).toEqual({ id: "from-the-future", title: "", harness: "" });
  });

  it("auto-layout assigns layered positions and only runs when asked", () => {
    const a = addDesignerNode(empty(), { title: "A", position: { x: 500, y: 500 } });
    const b = addDesignerNode(a.draft, { title: "B" });
    const connected = connectDesignerNodes(b.draft, a.node.id, b.node.id).draft;
    // Nothing reflows implicitly: positions stay where they were.
    expect(connected.nodes[0].position).toEqual({ x: 500, y: 500 });
    const planned = autoLayoutPositions(connected);
    expect(planned.get("a")).toEqual({ x: 24, y: 24 });
    expect(planned.get("b")?.x).toBeGreaterThan(planned.get("a")!.x);
    const applied = applyAutoLayout(connected);
    expect(applied.nodes[0].position).toEqual({ x: 24, y: 24 });
    expect(applied.nodes[1].position).toEqual(planned.get("b"));
  });

  it("validation issues name the authoring mistakes before any save", () => {
    const { draft } = addDesignerNode(empty(), { title: "One", prompt: "p" });
    // A blank title can arrive through an edit; the save refuses it.
    const broken = updateDesignerNode(draft, "one", { title: "   " });
    const issues = toIntentPayload(broken).issues;
    expect(issues.some((issue) => issue.includes("title"))).toBe(true);
    const noPrompt = addDesignerNode(empty(), { title: "Two" });
    expect(
      toIntentPayload(noPrompt.draft).issues.some((issue) =>
        issue.includes("prompt"),
      ),
    ).toBe(true);
  });
});

function empty() {
  return draftFromIntentNodes([]);
}
