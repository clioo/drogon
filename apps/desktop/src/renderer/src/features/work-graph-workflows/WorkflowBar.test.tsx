// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// F0: `WorkflowBar`'s "Send adversarial review" cost note must reflect the
// workspace's REAL Subagent policy, never a hardcoded "never billed" claim
// that goes false the instant any approved/fallback runtime is configured
// on the Orchestrator side (both surfaces share the one policy and the one
// loop engine — see `WorkGraphPane.tsx`).

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { WorkflowBar } from "./WorkflowBar";
import type { WorkflowEntry, WorkflowLibrary } from "./workflow-library";
import { DEFAULT_GRAPH_POLICY, type GraphPolicy } from "../../../../shared/work-graph-contract";

function workflow(overrides: Partial<WorkflowEntry["settings"]> = {}): WorkflowEntry {
  return {
    id: "wf1",
    name: "Main",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    nodes: [],
    settings: { adversarialReviewEnabled: true, maxReviewCycles: 3, ...overrides },
  } as unknown as WorkflowEntry;
}

function library(entry: WorkflowEntry): WorkflowLibrary {
  return { version: 1, selectedWorkflowId: entry.id, workflows: [entry] } as unknown as WorkflowLibrary;
}

const noop = {
  onSelect: vi.fn(),
  onCreate: vi.fn(async () => ({ ok: true as const, id: "wf1" })),
  onRename: vi.fn(async () => ({ ok: true as const, id: "wf1" })),
  onDelete: vi.fn(async () => ({ ok: true as const, id: "wf1" })),
  onSettingsChange: vi.fn(async () => ({ ok: true as const, id: "wf1" })),
};

describe("WorkflowBar cost note (F0)", () => {
  afterEach(cleanup);

  it("says free-local-only, never billed, when the policy has no approved/fallback runtime", () => {
    const entry = workflow();
    render(
      <WorkflowBar
        library={library(entry)}
        selected={entry}
        loop={null}
        interactive
        policy={DEFAULT_GRAPH_POLICY}
        {...noop}
      />,
    );
    const note = screen.getByTestId("workflow-bar-cost-note");
    expect(note.textContent).toContain("Free local model only");
    expect(note.textContent).toContain("never billed");
  });

  it("honestly discloses a paid/external runtime once one is approved anywhere in the policy", () => {
    const entry = workflow();
    const policy: GraphPolicy = {
      ...DEFAULT_GRAPH_POLICY,
      approvedRuntimes: [{ harness: "claude", model: "claude-sonnet-5" }],
    };
    render(
      <WorkflowBar
        library={library(entry)}
        selected={entry}
        loop={null}
        interactive
        policy={policy}
        {...noop}
      />,
    );
    const note = screen.getByTestId("workflow-bar-cost-note");
    expect(note.textContent).not.toContain("never billed");
    expect(note.textContent).toContain("NOT free-local-only");
  });

  it("also discloses when only the fallback (not an approved runtime) is the paid one", () => {
    const entry = workflow();
    const policy: GraphPolicy = {
      ...DEFAULT_GRAPH_POLICY,
      fallbackRuntime: { harness: "codex", model: "gpt-5.3-codex" },
    };
    render(
      <WorkflowBar
        library={library(entry)}
        selected={entry}
        loop={null}
        interactive
        policy={policy}
        {...noop}
      />,
    );
    const note = screen.getByTestId("workflow-bar-cost-note");
    expect(note.textContent).toContain("NOT free-local-only");
  });
});
