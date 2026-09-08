import { describe, expect, it } from "vitest";
import { planEditorRehydrate } from "./editor-rehydrate";

describe("planEditorRehydrate (R16-AJ, fixes #215)", () => {
  it("returns stored paths in order, minus already-open ones", () => {
    expect(
      planEditorRehydrate({
        storedPaths: ["a.txt", "b.txt", "c.txt"],
        openPaths: ["b.txt"],
      }),
    ).toEqual(["a.txt", "c.txt"]);
  });

  it("dedupes stored doubles and accepts a set of open paths", () => {
    expect(
      planEditorRehydrate({
        storedPaths: ["a.txt", "a.txt", "b.txt"],
        openPaths: new Set(["b.txt"]),
      }),
    ).toEqual(["a.txt"]);
  });

  it("returns nothing when everything is already open", () => {
    expect(
      planEditorRehydrate({
        storedPaths: ["a.txt"],
        openPaths: ["a.txt"],
      }),
    ).toEqual([]);
  });
});
