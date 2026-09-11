// MIT Copyright (c) 2026 Lovecast Inc.
// Pure tests over the workflow library: create/select/rename/delete,
// settings persistence shape, the parse/serialize round trip, and the
// honest-failure path for a file this build cannot read as a library
// (never a crash, never a silent overwrite).

import { describe, expect, it } from "vitest";
import {
  MAX_WORKFLOWS,
  createWorkflow,
  defaultWorkflowSettings,
  deleteWorkflow,
  emptyLibrary,
  findWorkflow,
  parseWorkflowLibrary,
  renameWorkflow,
  selectWorkflow,
  serializeWorkflowLibrary,
  updateWorkflowLoop,
  updateWorkflowNodes,
  updateWorkflowSettings,
} from "./workflow-library";

const NOW = "2026-09-11T12:00:00.000Z";

describe("createWorkflow", () => {
  it("creates a workflow with default settings and selects it", () => {
    const result = createWorkflow(emptyLibrary(), "Ship it", [], NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workflow.name).toBe("Ship it");
    expect(result.workflow.settings).toEqual(defaultWorkflowSettings());
    expect(result.library.selectedWorkflowId).toBe(result.workflow.id);
    expect(result.library.workflows).toHaveLength(1);
  });

  it("refuses a blank name", () => {
    const result = createWorkflow(emptyLibrary(), "   ", [], NOW);
    expect(result.ok).toBe(false);
  });

  it("refuses past MAX_WORKFLOWS, never silently drops the oldest", () => {
    let library = emptyLibrary();
    for (let index = 0; index < MAX_WORKFLOWS; index += 1) {
      const result = createWorkflow(library, `wf ${index}`, [], NOW);
      expect(result.ok).toBe(true);
      if (result.ok) library = result.library;
    }
    const overflow = createWorkflow(library, "one too many", [], NOW);
    expect(overflow.ok).toBe(false);
    expect(library.workflows).toHaveLength(MAX_WORKFLOWS);
  });
});

describe("selecting and reading which one is selected", () => {
  it("selecting an unknown id is a no-op, never a silent invalid selection", () => {
    const created = createWorkflow(emptyLibrary(), "A", [], NOW);
    if (!created.ok) throw new Error("setup failed");
    const next = selectWorkflow(created.library, "does-not-exist");
    expect(next.selectedWorkflowId).toBe(created.workflow.id);
  });

  it("findWorkflow resolves the exact selected entry", () => {
    const a = createWorkflow(emptyLibrary(), "A", [], NOW);
    if (!a.ok) throw new Error("setup failed");
    const b = createWorkflow(a.library, "B", [], NOW);
    if (!b.ok) throw new Error("setup failed");
    const selected = selectWorkflow(b.library, a.workflow.id);
    expect(findWorkflow(selected, selected.selectedWorkflowId)?.name).toBe("A");
  });
});

describe("rename / delete", () => {
  it("renames without touching other fields", () => {
    const created = createWorkflow(emptyLibrary(), "A", [], NOW);
    if (!created.ok) throw new Error("setup failed");
    const renamed = renameWorkflow(created.library, created.workflow.id, "  B  ", "later");
    expect(findWorkflow(renamed, created.workflow.id)?.name).toBe("B");
    expect(findWorkflow(renamed, created.workflow.id)?.updatedAt).toBe("later");
  });

  it("deleting the selected workflow selects the first remaining one, or null if none", () => {
    const a = createWorkflow(emptyLibrary(), "A", [], NOW);
    if (!a.ok) throw new Error("setup failed");
    const b = createWorkflow(a.library, "B", [], NOW);
    if (!b.ok) throw new Error("setup failed");
    // b.workflow is selected (creation selects the new one).
    const afterDeleteB = deleteWorkflow(b.library, b.workflow.id);
    expect(afterDeleteB.selectedWorkflowId).toBe(a.workflow.id);
    const afterDeleteA = deleteWorkflow(afterDeleteB, a.workflow.id);
    expect(afterDeleteA.selectedWorkflowId).toBeNull();
    expect(afterDeleteA.workflows).toHaveLength(0);
  });

  it("deleting a non-selected workflow leaves the selection alone", () => {
    const a = createWorkflow(emptyLibrary(), "A", [], NOW);
    if (!a.ok) throw new Error("setup failed");
    const b = createWorkflow(a.library, "B", [], NOW);
    if (!b.ok) throw new Error("setup failed");
    const selected = selectWorkflow(b.library, a.workflow.id);
    const after = deleteWorkflow(selected, b.workflow.id);
    expect(after.selectedWorkflowId).toBe(a.workflow.id);
  });
});

describe("settings and node sync", () => {
  it("updateWorkflowSettings merges the patch, keeping the rest", () => {
    const created = createWorkflow(emptyLibrary(), "A", [], NOW);
    if (!created.ok) throw new Error("setup failed");
    const updated = updateWorkflowSettings(
      created.library,
      created.workflow.id,
      { adversarialReviewEnabled: true },
      "later",
    );
    const workflow = findWorkflow(updated, created.workflow.id);
    expect(workflow?.settings.adversarialReviewEnabled).toBe(true);
    expect(workflow?.settings.maxReviewCycles).toBe(defaultWorkflowSettings().maxReviewCycles);
  });

  it("updateWorkflowNodes keeps the saved workflow in sync with the live graph", () => {
    const created = createWorkflow(emptyLibrary(), "A", [], NOW);
    if (!created.ok) throw new Error("setup failed");
    const nodes = [{ id: "n1", title: "T", harness: "shell", prompt: "echo hi" }];
    const updated = updateWorkflowNodes(created.library, created.workflow.id, nodes, "later");
    expect(findWorkflow(updated, created.workflow.id)?.nodes).toEqual(nodes);
  });

  it("updateWorkflowLoop rides the ledger along without this module interpreting it", () => {
    const created = createWorkflow(emptyLibrary(), "A", [], NOW);
    if (!created.ok) throw new Error("setup failed");
    const ledger = { phase: "reviewing", cycle: 2 };
    const updated = updateWorkflowLoop(created.library, created.workflow.id, ledger, "later");
    expect(findWorkflow(updated, created.workflow.id)?.lastLoop).toEqual(ledger);
  });
});

describe("parse / serialize round trip and honest failure", () => {
  it("round-trips through JSON exactly", () => {
    // A fully-formed node (every contract field explicit) so the parse's
    // defaulting cannot introduce a spurious diff against the pre-parse
    // value — the point of this test is the JSON round trip, not defaulting.
    const created = createWorkflow(
      emptyLibrary(),
      "A",
      [
        {
          id: "n1",
          title: "Node 1",
          harness: "shell",
          model: "",
          dependsOn: [],
          prompt: "echo hi",
          enabled: true,
        },
      ],
      NOW,
    );
    if (!created.ok) throw new Error("setup failed");
    const raw = serializeWorkflowLibrary(created.library);
    const parsed = parseWorkflowLibrary(raw);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.library).toEqual(created.library);
  });

  it("parsing then re-serializing is idempotent even from a minimal node (defaults settle)", () => {
    const created = createWorkflow(
      emptyLibrary(),
      "A",
      [{ id: "n1", title: "Node 1", harness: "shell", prompt: "echo hi" }],
      NOW,
    );
    if (!created.ok) throw new Error("setup failed");
    const once = parseWorkflowLibrary(serializeWorkflowLibrary(created.library));
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const twice = parseWorkflowLibrary(serializeWorkflowLibrary(once.library));
    expect(twice.ok).toBe(true);
    if (twice.ok) expect(twice.library).toEqual(once.library);
  });

  it("reports not-JSON honestly instead of throwing", () => {
    const result = parseWorkflowLibrary("not json{{{");
    expect(result.ok).toBe(false);
  });

  it("reports a structurally different file (e.g. graph.json's shape) as invalid, never crashes", () => {
    const result = parseWorkflowLibrary(
      JSON.stringify({ version: 1, intent: { nodes: [] }, state: { updatedAt: "", nodes: [] } }),
    );
    expect(result.ok).toBe(false);
  });
});
