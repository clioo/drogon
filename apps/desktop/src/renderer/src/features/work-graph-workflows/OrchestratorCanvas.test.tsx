// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Behavior tests: no session disables the whole graph honestly (Part 4);
// adversarial off/on renders the exact design-1/design-2 shapes and
// captions; the terminal node's own state is honest — dashed "never run"
// before anything happened, green only once the ledger actually reached
// "passed", and the ledger's own (already-tested) message when it stopped
// failing instead of a fabricated one; Run workflow is disabled with a
// reason when there is nothing automated to run.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { GraphPolicy } from "../../../../shared/graph-contract";
import type { Session } from "../../../../shared/session-contract";
import type { LoopLedger } from "./adversarial-loop";
import { OrchestratorCanvas } from "./OrchestratorCanvas";

function policyWithAdversarial(
  enabled: boolean,
  maxIterations = 3,
): GraphPolicy {
  return {
    approvedRuntimes: [],
    fallbackRuntime: null,
    adversarial: { enabled, maxIterations },
    delegate: false,
  };
}

function liveSession(): Session {
  return {
    id: "s1",
    workspaceId: "ws1",
    hostId: "host",
    incarnation: "inc-1",
    command: "claude",
    args: [],
    cols: 80,
    rows: 24,
    verdict: "live",
    exitCode: null,
    createdAt: "2026-01-01T00:00:00Z",
    harnessId: "claude",
  } as Session;
}

function baseProps() {
  return {
    mainSession: liveSession(),
    loopLedger: null as LoopLedger | null,
    onRunWorkflow: () => {},
    canRun: true,
    runDisabledReason: null,
    saveStatus: "saved" as const,
    saveError: null,
  };
}

describe("OrchestratorCanvas", () => {
  afterEach(cleanup);

  it("disables the whole graph honestly when there is no session", () => {
    render(
      <OrchestratorCanvas
        {...baseProps()}
        mainSession={null}
        policy={policyWithAdversarial(false)}
      />,
    );
    expect(screen.getByTestId("orchestrator-disabled")).toBeTruthy();
    expect(screen.queryByTestId("orchestrator-main-agent")).toBeNull();
  });

  it("design-1: adversarial off shows Ready to run and the no-subagents caption", () => {
    render(
      <OrchestratorCanvas
        {...baseProps()}
        policy={policyWithAdversarial(false)}
      />,
    );
    expect(
      screen.getByTestId("orchestrator-main-agent").getAttribute("data-state"),
    ).toBe("live");
    expect(screen.queryByTestId("orchestrator-test-node")).toBeNull();
    const terminal = screen.getByTestId("orchestrator-terminal");
    expect(terminal.textContent).toContain("Ready to run");
    expect(
      screen.getByTestId("orchestrator-no-subagents-caption").textContent,
    ).toBe("No optional subagents enabled");
  });

  it("design-2: adversarial on shows the loop with both role nodes and the repeat caption", () => {
    render(
      <OrchestratorCanvas
        {...baseProps()}
        policy={policyWithAdversarial(true, 10)}
      />,
    );
    expect(screen.getByTestId("orchestrator-test-node")).toBeTruthy();
    expect(screen.getByTestId("orchestrator-review-node")).toBeTruthy();
    expect(screen.getByTestId("orchestrator-repeat-caption").textContent).toBe(
      "Repeat up to 10×",
    );
  });

  it("a never-run terminal renders dashed, not a fabricated green check", () => {
    render(
      <OrchestratorCanvas
        {...baseProps()}
        policy={policyWithAdversarial(true)}
        loopLedger={null}
      />,
    );
    expect(
      screen.getByTestId("orchestrator-terminal").getAttribute("data-state"),
    ).toBe("never-run");
  });

  it("a passed ledger renders the terminal as genuinely ready", () => {
    const ledger = {
      phase: "passed",
      message: "Adversarial review passed on cycle 2.",
    } as LoopLedger;
    render(
      <OrchestratorCanvas
        {...baseProps()}
        policy={policyWithAdversarial(true)}
        loopLedger={ledger}
      />,
    );
    const terminal = screen.getByTestId("orchestrator-terminal");
    expect(terminal.getAttribute("data-state")).toBe("ready");
    expect(terminal.textContent).toContain("Ready to merge");
  });

  it("a stopped-failing ledger shows the reducer's own message, never a fabricated one", () => {
    const ledger = {
      phase: "stopped_failing",
      message: "Stopped after 3 review cycles, still failing.",
    } as LoopLedger;
    render(
      <OrchestratorCanvas
        {...baseProps()}
        policy={policyWithAdversarial(true)}
        loopLedger={ledger}
      />,
    );
    const terminal = screen.getByTestId("orchestrator-terminal");
    expect(terminal.getAttribute("data-state")).toBe("failed");
    expect(terminal.textContent).toBe(
      "Stopped after 3 review cycles, still failing.",
    );
  });

  it("an exited session renders honestly, never as live", () => {
    const exited: Session = { ...liveSession(), verdict: "exited" };
    render(
      <OrchestratorCanvas
        {...baseProps()}
        mainSession={exited}
        policy={policyWithAdversarial(false)}
      />,
    );
    const node = screen.getByTestId("orchestrator-main-agent");
    expect(node.getAttribute("data-state")).toBe("exited");
    expect(node.textContent).toContain("exited");
  });

  it("Run workflow shows the honest disabled reason via its title", () => {
    render(
      <OrchestratorCanvas
        {...baseProps()}
        policy={policyWithAdversarial(false)}
        canRun={false}
        runDisabledReason="No optional subagents enabled — nothing to run automatically."
      />,
    );
    const button = screen.getByTestId(
      "orchestrator-run-workflow",
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe(
      "No optional subagents enabled — nothing to run automatically.",
    );
  });

  it("a failed save never shows the automatic-save checkmark", () => {
    render(
      <OrchestratorCanvas
        {...baseProps()}
        policy={policyWithAdversarial(false)}
        saveStatus="error"
        saveError="workspace not found"
      />,
    );
    const status = screen.getByTestId("orchestrator-save-status");
    expect(status.textContent).toContain("Save failed");
    expect(status.textContent).toContain("workspace not found");
    expect(status.textContent).not.toContain("Saved automatically");
  });
});
