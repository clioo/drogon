import { describe, expect, it } from "vitest";
import { mentuStore } from "./mentu-store";

describe("mentuStore", () => {
  it("defaults to an empty state for a workspace never written to", () => {
    expect(mentuStore.get("never-seen")).toEqual({
      selectedRecipeId: null,
      draftSource: "",
      activeRunId: null,
      mode: "graph",
      selectedNodeId: null,
    });
  });

  it("patches only the given fields, keeping the rest", () => {
    const ws = `ws-${Math.random()}`;
    mentuStore.set(ws, { selectedRecipeId: "hello" });
    mentuStore.set(ws, { draftSource: "{}" });
    expect(mentuStore.get(ws)).toEqual({
      selectedRecipeId: "hello",
      draftSource: "{}",
      activeRunId: null,
      mode: "graph",
      selectedNodeId: null,
    });
  });

  it("shares the inspector mode and selected node across mounts", () => {
    const ws = `ws-${Math.random()}`;
    mentuStore.set(ws, { mode: "metrics", selectedNodeId: "step:build" });
    expect(mentuStore.get(ws).mode).toBe("metrics");
    expect(mentuStore.get(ws).selectedNodeId).toBe("step:build");
  });

  it("keeps state isolated per workspace id", () => {
    const a = `ws-a-${Math.random()}`;
    const b = `ws-b-${Math.random()}`;
    mentuStore.set(a, { selectedRecipeId: "recipe-a" });
    mentuStore.set(b, { selectedRecipeId: "recipe-b" });
    expect(mentuStore.get(a).selectedRecipeId).toBe("recipe-a");
    expect(mentuStore.get(b).selectedRecipeId).toBe("recipe-b");
  });

  it("notifies subscribers on every set, and stops after unsubscribe", () => {
    const ws = `ws-${Math.random()}`;
    let notifications = 0;
    const unsubscribe = mentuStore.subscribe(() => {
      notifications += 1;
    });
    mentuStore.set(ws, { activeRunId: "run-1" });
    expect(notifications).toBe(1);
    unsubscribe();
    mentuStore.set(ws, { activeRunId: "run-2" });
    expect(notifications).toBe(1);
  });
});
