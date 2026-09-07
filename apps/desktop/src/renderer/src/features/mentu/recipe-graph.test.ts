// MIT Copyright (c) 2026 Lovecast Inc.
// Tests for the ported recipe dependency DAG (`recipe-graph.ts`): depth
// projection, unknown/duplicate dependency issues, cycle detection and the
// per-step attempt-record helpers over daemon run records.

import { describe, expect, it } from "vitest";
import type { MentuStep, MentuStepRun } from "../../../../shared/mentu-contract";
import {
  buildRecipeGraph,
  groupStepAttempts,
  nodeRunRecord,
  stepAttemptRecords,
} from "./recipe-graph";

function step(overrides: Partial<MentuStep> = {}): MentuStep {
  return {
    label: "build",
    backend: "shell",
    description: null,
    dependsOn: [],
    timeoutSeconds: null,
    verifyCommands: [],
    ...overrides,
  };
}

function stepRun(overrides: Partial<MentuStepRun> = {}): MentuStepRun {
  return {
    label: "build",
    backend: "shell",
    status: "succeeded",
    exitCode: 0,
    durationSeconds: 4,
    attempts: 1,
    outputPath: "build.stdout",
    errorPath: "build.stderr",
    error: null,
    verification: null,
    ...overrides,
  };
}

describe("buildRecipeGraph", () => {
  it("projects steps with dependency depths", () => {
    const graph = buildRecipeGraph([
      step({ label: "lint" }),
      step({ label: "build", dependsOn: ["lint"] }),
      step({ label: "test", dependsOn: ["build"] }),
    ]);
    expect(graph.valid).toBe(true);
    expect(graph.cycle).toBe(null);
    expect(graph.issues).toEqual([]);
    const depth = new Map(graph.nodes.map((node) => [node.label, node.depth]));
    expect(depth.get("lint")).toBe(0);
    expect(depth.get("build")).toBe(1);
    expect(depth.get("test")).toBe(2);
  });

  it("reports unknown dependencies and stays invalid", () => {
    const graph = buildRecipeGraph([step({ label: "build", dependsOn: ["missing"] })]);
    expect(graph.valid).toBe(false);
    expect(graph.issues).toEqual(["build: unknown dependency missing"]);
  });

  it("reports duplicate labels", () => {
    const graph = buildRecipeGraph([step({ label: "build" }), step({ label: "build" })]);
    expect(graph.valid).toBe(false);
    expect(graph.issues).toEqual(["Duplicate dependency label: build"]);
  });

  it("detects dependency cycles and drops the nodes", () => {
    const graph = buildRecipeGraph([
      step({ label: "a", dependsOn: ["b"] }),
      step({ label: "b", dependsOn: ["a"] }),
    ]);
    expect(graph.valid).toBe(false);
    expect(graph.cycle).not.toBe(null);
    expect(graph.nodes).toEqual([]);
  });

  it("handles an empty recipe", () => {
    const graph = buildRecipeGraph([]);
    expect(graph.valid).toBe(true);
    expect(graph.nodes).toEqual([]);
  });
});

describe("attempt records", () => {
  const records = [
    stepRun({ label: "build", attempts: 2, exitCode: 0 }),
    stepRun({ label: "lint", attempts: 1, exitCode: 0 }),
    stepRun({ label: "build", attempts: 1, exitCode: 1 }),
  ];

  it("groups by label preserving first-seen order, oldest attempt first", () => {
    const groups = groupStepAttempts(records);
    expect(groups.map((group) => group.label)).toEqual(["build", "lint"]);
    expect(groups[0]?.attempts.map((attempt) => attempt.attempts)).toEqual([1, 2]);
  });

  it("returns every attempt for a label oldest first", () => {
    expect(stepAttemptRecords(records, "build").map((step) => step.attempts)).toEqual([1, 2]);
  });

  it("returns the newest attempt for a label", () => {
    expect(nodeRunRecord(records, "build")?.exitCode).toBe(0);
    expect(nodeRunRecord(records, "missing")).toBe(null);
    expect(nodeRunRecord(null, "build")).toBe(null);
  });
});
