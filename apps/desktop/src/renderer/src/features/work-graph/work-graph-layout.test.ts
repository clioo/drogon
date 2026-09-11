// MIT Copyright (c) 2026 Lovecast Inc.
// Layout tests: the intent DAG layers by longest path, names resolved
// dependencies, and refuses (never silently reorders) on cycles.

import { describe, expect, it } from "vitest";
import type { WorkGraphIntentNode } from "../../../../shared/work-graph-contract";
import { buildWorkGraphLayout, dependencyTitles } from "./work-graph-layout";

function node(overrides: Partial<WorkGraphIntentNode> & { id: string }): WorkGraphIntentNode {
  return {
    title: overrides.id,
    harness: "pi",
    model: null,
    dependsOn: [],
    prompt: "",
    enabled: true,
    ...overrides,
  };
}

describe("buildWorkGraphLayout", () => {
  it("layers a diamond DAG by longest path", () => {
    const layout = buildWorkGraphLayout([
      node({ id: "leader", title: "Leader" }),
      node({ id: "left", title: "Left", dependsOn: ["leader"] }),
      node({ id: "right", title: "Right", dependsOn: ["leader"] }),
      node({ id: "join", title: "Join", dependsOn: ["left", "right"] }),
    ]);
    expect(layout.cycle).toBeNull();
    expect(layout.issues).toEqual([]);
    const depths = new Map(layout.nodes.map((n) => [n.id, n.depth]));
    expect(depths.get("leader")).toBe(0);
    expect(depths.get("left")).toBe(1);
    expect(depths.get("right")).toBe(1);
    expect(depths.get("join")).toBe(2);
  });

  it("keeps every child of the leader one layer below it, whatever the file order", () => {
    const layout = buildWorkGraphLayout([
      node({ id: "c", dependsOn: ["a"] }),
      node({ id: "leader" }),
      node({ id: "a", dependsOn: ["leader"] }),
    ]);
    const depths = new Map(layout.nodes.map((n) => [n.id, n.depth]));
    expect(depths.get("leader")).toBe(0);
    expect(depths.get("a")).toBe(1);
    expect(depths.get("c")).toBe(2);
  });

  it("reports a cycle instead of rendering an invented order", () => {
    const layout = buildWorkGraphLayout([
      node({ id: "a", title: "A", dependsOn: ["b"] }),
      node({ id: "b", title: "B", dependsOn: ["a"] }),
    ]);
    expect(layout.cycle).not.toBeNull();
    expect(layout.nodes).toEqual([]);
  });

  it("names unknown and self dependencies as issues, dropping only the broken edge", () => {
    const layout = buildWorkGraphLayout([
      node({ id: "a", title: "A", dependsOn: ["ghost"] }),
      node({ id: "b", title: "B", dependsOn: ["b"] }),
    ]);
    expect(layout.issues).toEqual(["A: unknown dependency ghost", "B: depends on itself"]);
    expect(layout.nodes.find((n) => n.id === "a")?.dependencies).toEqual([]);
  });

  it("reports duplicate ids once and keeps the first node", () => {
    const layout = buildWorkGraphLayout([
      node({ id: "a", title: "First" }),
      node({ id: "a", title: "Second" }),
    ]);
    expect(layout.issues).toEqual(["Duplicate node id: a"]);
    expect(layout.nodes).toHaveLength(1);
    expect(layout.nodes[0].title).toBe("First");
  });

  it("resolves dependency titles through dependencyTitles", () => {
    const layout = buildWorkGraphLayout([
      node({ id: "leader", title: "Plan the work" }),
      node({ id: "child", title: "Child", dependsOn: ["leader"] }),
    ]);
    const child = layout.nodes.find((n) => n.id === "child")!;
    expect(dependencyTitles(layout, child)).toEqual(["Plan the work"]);
  });
});
