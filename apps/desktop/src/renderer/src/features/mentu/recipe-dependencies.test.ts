// MIT Copyright (c) 2026 Lovecast Inc.
// Tests for the ported dependency validation/ordering
// (`recipe-dependencies.ts`) and the shared run-status projection
// (`run-status.ts`).

import { describe, expect, it } from "vitest";
import type { MentuStep } from "../../../../shared/mentu-contract";
import { orderStepsByDependency, validateRecipeDependencies } from "./recipe-dependencies";
import { statusLabel, statusToneClass } from "./run-status";

function step(label: string, dependsOn: string[] = []): MentuStep {
  return {
    label,
    backend: "shell",
    description: null,
    dependsOn,
    timeoutSeconds: null,
    verifyCommands: [],
  };
}

describe("validateRecipeDependencies", () => {
  it("accepts a clean DAG", () => {
    const issues: { path: string; message: string }[] = [];
    validateRecipeDependencies([step("lint"), step("build", ["lint"])], "recipe", issues);
    expect(issues).toEqual([]);
  });

  it("flags unknown dependencies and cycles", () => {
    const issues: { path: string; message: string }[] = [];
    validateRecipeDependencies(
      [step("a", ["ghost"]), step("b", ["c"]), step("c", ["b"])],
      "recipe",
      issues,
    );
    expect(issues).toContainEqual({
      path: "recipe.a",
      message: "unknown dependency: ghost",
    });
    expect(issues.some((issue) => issue.message.startsWith("dependency cycle includes"))).toBe(
      true,
    );
  });
});

describe("orderStepsByDependency", () => {
  it("orders dependencies before dependents", () => {
    const ordered = orderStepsByDependency([
      step("test", ["build"]),
      step("build", ["lint"]),
      step("lint"),
    ]);
    expect(ordered).toEqual(["lint", "build", "test"]);
  });

  it("keeps every label exactly once on cycles", () => {
    const ordered = orderStepsByDependency([step("a", ["b"]), step("b", ["a"])]);
    expect([...ordered].sort()).toEqual(["a", "b"]);
  });
});

describe("run status projection", () => {
  it("labels every status exactly once", () => {
    expect(statusLabel("running")).toBe("Running…");
    expect(statusLabel("succeeded")).toBe("Succeeded");
    expect(statusLabel("failed")).toBe("Failed");
    expect(statusLabel("cancelled")).toBe("Cancelled");
    expect(statusLabel("unavailable")).toBe("Unavailable");
    expect(statusLabel(undefined)).toBe("");
  });

  it("tones failures destructive and successes emerald", () => {
    expect(statusToneClass("succeeded")).toContain("emerald");
    expect(statusToneClass("failed")).toBe("text-destructive");
    expect(statusToneClass("unavailable")).toBe("text-destructive");
    expect(statusToneClass("cancelled")).toBe("text-muted-foreground");
    expect(statusToneClass("running")).toBe("text-foreground");
  });
});
