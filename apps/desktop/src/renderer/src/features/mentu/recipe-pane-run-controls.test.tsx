// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Gating tests for the ported run controls: the Review → Approve & run
// two-phase flow, the runtime/graph gates, and the Retry/Cancel states,
// exactly as the fork gates them, adapted to content-hash approval.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { MentuApproval, MentuRun } from "../../../../shared/mentu-contract";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import type { MentuReview } from "./recipe-pane-controller";
import { RunControls } from "./recipe-pane-run-controls";

beforeEach(installRadixJsdomStubs);
afterEach(cleanup);

const HASH = "b".repeat(64);

function review(): MentuReview {
  return {
    recipeName: "demo",
    contentHash: HASH,
    stepCount: 2,
    steps: [
      { label: "build", backend: "shell" },
      { label: "test", backend: "shell" },
    ],
    runner: "mentu-recipes-fixture 0.4.0",
  };
}

function terminalRun(): MentuRun {
  return {
    id: "run-1",
    workspaceId: "ws",
    recipeId: "demo",
    approvalId: "approval-1",
    mentuRunId: null,
    status: "failed",
    startedAt: "t",
    endedAt: "t",
    steps: [],
    error: "boom",
    retryOf: null,
  };
}

function controls(overrides: Partial<Parameters<typeof RunControls>[0]> = {}) {
  return {
    review: null,
    owner: "ws",
    runtimeAvailable: true,
    dependencyGraphValid: true,
    operationRunning: false,
    busy: false,
    run: null,
    approval: null as MentuApproval | null,
    onStageReview: () => {},
    onApproveAndRun: () => {},
    onRetry: () => {},
    onCancel: () => {},
    onClearReview: () => {},
    ...overrides,
  };
}

describe("RunControls gating", () => {
  it("starts at Review Run and stages the review on click", () => {
    const onStageReview = vi.fn();
    render(<RunControls {...controls({ onStageReview })} />);
    fireEvent.click(screen.getByTestId("mentu-run"));
    expect(onStageReview).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("mentu-review")).toBe(null);
  });

  it("shows Approve & run with the review scope once staged", () => {
    render(<RunControls {...controls({ review: review() })} />);
    expect(screen.getByText("Review before execution")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByText("demo")).toBeTruthy();
    expect(screen.getByText("Approve & run")).toBeTruthy();
    expect(screen.getByText("Dismiss review")).toBeTruthy();
  });

  it("marks the review Approved once the hash is bound", () => {
    const approval: MentuApproval = {
      id: "approval-1",
      workspaceId: "ws",
      recipeId: "demo",
      contentHash: HASH,
      approvedAt: "t",
    };
    render(<RunControls {...controls({ review: review(), approval })} />);
    expect(screen.getByText("Approved")).toBeTruthy();
  });

  it("blocks execution while the runtime or graph is unavailable", () => {
    const { rerender } = render(<RunControls {...controls({ runtimeAvailable: false })} />);
    expect((screen.getByTestId("mentu-run") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Mentu is unavailable on this execution host.")).toBeTruthy();
    rerender(
      <RunControls {...controls({ runtimeAvailable: true, dependencyGraphValid: false })} />,
    );
    expect((screen.getByTestId("mentu-run") as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByText("Run blocked until dependency cycles and references are resolved."),
    ).toBeTruthy();
  });

  it("shows Cancel while running and Retry once failed", () => {
    const running: MentuRun = { ...terminalRun(), status: "running", error: null };
    const { rerender } = render(<RunControls {...controls({ run: running, operationRunning: true })} />);
    expect(screen.getByTestId("mentu-cancel")).toBeTruthy();
    expect(screen.queryByTestId("mentu-retry")).toBe(null);
    const onRetry = vi.fn();
    rerender(<RunControls {...controls({ run: terminalRun(), onRetry })} />);
    fireEvent.click(screen.getByTestId("mentu-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Latest run run-1: Failed")).toBeTruthy();
  });

  it("dismisses the staged review", () => {
    const onClearReview = vi.fn();
    render(<RunControls {...controls({ review: review(), onClearReview })} />);
    fireEvent.click(screen.getByText("Dismiss review"));
    expect(onClearReview).toHaveBeenCalledTimes(1);
  });
});
