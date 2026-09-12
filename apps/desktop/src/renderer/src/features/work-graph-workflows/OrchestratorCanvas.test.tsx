// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Behavior tests: no session disables the whole graph honestly (Part 4);
// adversarial off/on renders the exact design-1/design-2 shapes and
// captions; the terminal node's own state is honest — dashed "never run"
// before anything happened, green only once the ledger actually reached
// "passed", and the ledger's own (already-tested) message when it stopped
// failing instead of a fabricated one; Run workflow is disabled with a
// reason when there is nothing automated to run.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type {
  GraphPolicy,
  OrchestratorRun,
} from "../../../../shared/graph-contract";
import type { Session } from "../../../../shared/session-contract";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
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
  it("refits when an off-mode run finishes after next-run testing was enabled", () => {
    installRadixJsdomStubs();
    const width = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(460);
    const content = vi
      .spyOn(HTMLElement.prototype, "scrollWidth", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.querySelector('[data-testid="orchestrator-test-node"]')
          ? 460
          : 224;
      });
    const main = {
      id: "orchestrator-main",
      title: "Main agent",
      harness: "pi",
      model: "fixture",
      prompt: "Task",
      enabled: true,
      dependsOn: [],
    };
    const run: OrchestratorRun = {
      id: "r",
      workspaceId: "ws",
      main,
      policy: policyWithAdversarial(false),
      status: "running",
      phase: "main",
      iteration: 1,
      startedAt: "now",
      updatedAt: "now",
      steps: [],
    };
    try {
      const props = {
        ...baseProps(),
        configuredMain: main,
        policy: policyWithAdversarial(true),
      };
      const view = render(<OrchestratorCanvas {...props} durableRun={run} />);
      expect(screen.queryByTestId("orchestrator-test-node")).toBeNull();
      expect(Number(screen.getByTestId("orchestrator-flow").style.zoom)).toBe(
        1,
      );
      view.rerender(
        <OrchestratorCanvas
          {...props}
          durableRun={{ ...run, status: "passed" }}
        />,
      );
      expect(screen.getByTestId("orchestrator-test-node")).toBeTruthy();
      expect(Number(screen.getByTestId("orchestrator-flow").style.zoom)).toBe(
        0.89,
      );
    } finally {
      width.mockRestore();
      content.mockRestore();
    }
  });
  it("labels the prior off-mode result as historical when previewing enabled QA", () => {
    installRadixJsdomStubs();
    const main = {
      id: "orchestrator-main",
      title: "Main agent",
      harness: "pi",
      model: "fixture",
      prompt: "Task",
      enabled: true,
      dependsOn: [],
    };
    const run: OrchestratorRun = {
      id: "r",
      workspaceId: "ws",
      main,
      policy: policyWithAdversarial(false),
      status: "passed",
      phase: "main",
      iteration: 1,
      startedAt: "now",
      updatedAt: "now",
      steps: [],
    };
    render(
      <OrchestratorCanvas
        {...baseProps()}
        configuredMain={main}
        policy={policyWithAdversarial(true)}
        durableRun={run}
      />,
    );
    expect(screen.getByTestId("orchestrator-terminal").textContent).toBe(
      "Last run: Completed",
    );
    expect(screen.getByTestId("orchestrator-test-node").dataset.active).toBe(
      "false",
    );
  });
  it("stacks the outer sequence in a narrow viewport while keeping test and review side by side", () => {
    installRadixJsdomStubs();
    const width = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(460);
    const content = vi
      .spyOn(HTMLElement.prototype, "scrollWidth", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.querySelector('[data-direction="vertical"]') ? 460 : 1000;
      });
    try {
      render(
        <OrchestratorCanvas
          {...baseProps()}
          policy={policyWithAdversarial(true)}
        />,
      );
      const sequence = screen.getByTestId("orchestrator-flow-sequence");
      expect(sequence.dataset.direction).toBe("vertical");
      expect(screen.getByTestId("orchestrator-test-node").parentElement).toBe(
        screen.getByTestId("orchestrator-review-node").parentElement,
      );
      expect(
        Number(screen.getByTestId("orchestrator-flow").style.zoom),
      ).toBeGreaterThanOrEqual(0.85);
    } finally {
      width.mockRestore();
      content.mockRestore();
    }
  });
  it("keeps active QA nodes visible when the next-run policy disables testing", () => {
    installRadixJsdomStubs();
    const main = {
      id: "orchestrator-main",
      title: "Main agent",
      harness: "pi",
      model: "fixture",
      prompt: "Task",
      enabled: true,
      dependsOn: [],
    };
    const run: OrchestratorRun = {
      id: "r",
      workspaceId: "ws",
      main,
      policy: policyWithAdversarial(true),
      status: "running",
      phase: "test",
      iteration: 2,
      startedAt: "now",
      updatedAt: "now",
      steps: [
        {
          nodeId: "test-2",
          phase: "test",
          iteration: 2,
          status: "running",
          runtime: { harness: "opencode", model: "provider/model" },
          isFallback: true,
          attempts: [],
        },
      ],
    };
    render(
      <OrchestratorCanvas
        {...baseProps()}
        configuredMain={main}
        policy={policyWithAdversarial(false)}
        durableRun={run}
      />,
    );
    expect(screen.getByTestId("orchestrator-test-node").textContent).toContain(
      "provider/model",
    );
    expect(screen.getByTestId("orchestrator-test-node").textContent).toContain(
      "Fallback",
    );
    expect(screen.getByTestId("orchestrator-review-node")).toBeTruthy();
    expect(
      screen.getByText(/Configuration changes apply to the next run/),
    ).toBeTruthy();
  });

  it("shows saving until the last automatic write settles", () => {
    installRadixJsdomStubs();
    render(
      <OrchestratorCanvas
        {...baseProps()}
        policy={policyWithAdversarial(false)}
        saveStatus="saving"
      />,
    );
    expect(screen.getByTestId("orchestrator-save-status").textContent).toBe(
      "Saving…",
    );
    expect(screen.queryByText("Saved automatically")).toBeNull();
  });
  beforeEach(() => {
    installRadixJsdomStubs();
    window.localStorage.clear();
  });
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

  it("the repeat caption shows the in-flight ledger's bound, not a bumped live policy value (DISHONEST-2)", () => {
    const ledger = {
      phase: "reviewing",
      maxCycles: 1,
      message: "Reviewing… cycle 1 of 1.",
    } as LoopLedger;
    render(
      <OrchestratorCanvas
        {...baseProps()}
        policy={policyWithAdversarial(true, 4)}
        loopLedger={ledger}
      />,
    );
    const caption = screen.getByTestId("orchestrator-repeat-caption");
    expect(caption.textContent).toContain("Repeat up to 1×");
    expect(caption.textContent).not.toContain("Repeat up to 4×");
    const pending = screen.getByTestId("orchestrator-repeat-pending");
    expect(pending.textContent).toContain("4×");
    expect(pending.textContent).toContain("next run");
  });

  it("the repeat caption reflects the live policy again once the loop reaches a terminal phase", () => {
    const ledger = {
      phase: "passed",
      maxCycles: 1,
      message: "Adversarial review passed on cycle 1.",
    } as LoopLedger;
    render(
      <OrchestratorCanvas
        {...baseProps()}
        policy={policyWithAdversarial(true, 4)}
        loopLedger={ledger}
      />,
    );
    expect(screen.getByTestId("orchestrator-repeat-caption").textContent).toBe(
      "Repeat up to 4×",
    );
    expect(screen.queryByTestId("orchestrator-repeat-pending")).toBeNull();
  });

  it("a session that disappears from later reads still renders exited/unverifiable, never the no-session view (FINDING fix)", () => {
    const { rerender } = render(
      <OrchestratorCanvas
        {...baseProps()}
        policy={policyWithAdversarial(false)}
        workspaceId="ws1"
      />,
    );
    expect(
      screen.getByTestId("orchestrator-main-agent").getAttribute("data-state"),
    ).toBe("live");
    // The daemon's session list drops a session once fully torn down: a
    // later read reports `mainSession: null`, not an object with verdict
    // "exited" — the exact repro from the adversarial audit's terminal
    // close finding.
    rerender(
      <OrchestratorCanvas
        {...baseProps()}
        mainSession={null}
        policy={policyWithAdversarial(false)}
        workspaceId="ws1"
      />,
    );
    expect(screen.queryByTestId("orchestrator-disabled")).toBeNull();
    const node = screen.getByTestId("orchestrator-main-agent");
    expect(node.getAttribute("data-state")).toBe("unverifiable");
    expect(node.textContent).toContain("Contact with this session was lost");
  });

  it("a session already observed exited stays exited after it disappears from later reads", () => {
    const exited: Session = { ...liveSession(), verdict: "exited" };
    const { rerender } = render(
      <OrchestratorCanvas
        {...baseProps()}
        mainSession={exited}
        policy={policyWithAdversarial(false)}
        workspaceId="ws1"
      />,
    );
    expect(
      screen.getByTestId("orchestrator-main-agent").getAttribute("data-state"),
    ).toBe("exited");
    rerender(
      <OrchestratorCanvas
        {...baseProps()}
        mainSession={null}
        policy={policyWithAdversarial(false)}
        workspaceId="ws1"
      />,
    );
    const node = screen.getByTestId("orchestrator-main-agent");
    expect(node.getAttribute("data-state")).toBe("exited");
    expect(node.textContent).toContain("exited");
  });

  it("switching workspaces never inherits a different workspace's last-known session", () => {
    const { rerender } = render(
      <OrchestratorCanvas
        {...baseProps()}
        policy={policyWithAdversarial(false)}
        workspaceId="ws1"
      />,
    );
    expect(
      screen.getByTestId("orchestrator-main-agent").getAttribute("data-state"),
    ).toBe("live");
    // Same component instance (no remount) — a DIFFERENT workspace that has
    // never had a session must render honestly disabled, never a stale
    // fact carried over from ws1.
    rerender(
      <OrchestratorCanvas
        {...baseProps()}
        mainSession={null}
        policy={policyWithAdversarial(false)}
        workspaceId="ws2"
      />,
    );
    expect(screen.getByTestId("orchestrator-disabled")).toBeTruthy();
    expect(screen.queryByTestId("orchestrator-main-agent")).toBeNull();
  });

  it("a session that exits survives an ACTUAL remount (a real reload, not just a re-render) via persisted last-known state", () => {
    // A plain in-memory `useRef` would NOT survive this — confirmed
    // empirically against the real packaged app: an externally-closed
    // session never reaches an already-mounted canvas without a reload,
    // and a reload wipes in-memory-only state exactly like the bug it
    // would otherwise fix. `unmount()` + a brand-new `render()` reproduces
    // that: no in-memory history at all, only `mainSession: null` and
    // whatever localStorage remembers.
    const first = render(
      <OrchestratorCanvas
        {...baseProps()}
        policy={policyWithAdversarial(false)}
        workspaceId="ws1"
      />,
    );
    expect(
      screen.getByTestId("orchestrator-main-agent").getAttribute("data-state"),
    ).toBe("live");
    first.unmount();
    render(
      <OrchestratorCanvas
        {...baseProps()}
        mainSession={null}
        policy={policyWithAdversarial(false)}
        workspaceId="ws1"
      />,
    );
    expect(screen.queryByTestId("orchestrator-disabled")).toBeNull();
    const node = screen.getByTestId("orchestrator-main-agent");
    expect(node.getAttribute("data-state")).toBe("unverifiable");
  });

  it("a persisted session from one workspace never leaks into a different workspace after a remount", () => {
    const first = render(
      <OrchestratorCanvas
        {...baseProps()}
        policy={policyWithAdversarial(false)}
        workspaceId="ws1"
      />,
    );
    first.unmount();
    render(
      <OrchestratorCanvas
        {...baseProps()}
        mainSession={null}
        policy={policyWithAdversarial(false)}
        workspaceId="ws2"
      />,
    );
    expect(screen.getByTestId("orchestrator-disabled")).toBeTruthy();
    expect(screen.queryByTestId("orchestrator-main-agent")).toBeNull();
  });

  it("clicking a live Main agent node opens the inspector with the harness-locked and delete-refused rules, and Stop session invokes the callback (Scenario 7)", () => {
    const onStop = vi.fn();
    render(
      <OrchestratorCanvas
        {...baseProps()}
        policy={policyWithAdversarial(false)}
        onStopMainSession={onStop}
      />,
    );
    expect(screen.queryByTestId("main-agent-inspector")).toBeNull();
    fireEvent.click(screen.getByTestId("orchestrator-main-agent"));
    const inspector = screen.getByTestId("main-agent-inspector");
    expect(inspector.textContent).toContain("claude");
    expect(screen.getByTestId("main-agent-harness-locked")).toBeTruthy();
    expect(screen.getByTestId("main-agent-delete-refused")).toBeTruthy();
    fireEvent.click(screen.getByTestId("main-agent-stop-session"));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("the inspector drops the harness-locked/delete-refused rules once the session has exited", () => {
    const exited: Session = { ...liveSession(), verdict: "exited" };
    render(
      <OrchestratorCanvas
        {...baseProps()}
        mainSession={exited}
        policy={policyWithAdversarial(false)}
      />,
    );
    fireEvent.click(screen.getByTestId("orchestrator-main-agent"));
    expect(screen.getByTestId("main-agent-inspector")).toBeTruthy();
    expect(screen.queryByTestId("main-agent-harness-locked")).toBeNull();
    expect(screen.queryByTestId("main-agent-delete-refused")).toBeNull();
    expect(screen.queryByTestId("main-agent-stop-session")).toBeNull();
  });

  it("the inspector still refuses harness/delete while merely unverifiable (loss of contact never proves exit)", () => {
    // isMentuMainSessionLive => false (agentState "exited"), but
    // verdict !== "exited" => the honest state is "unverifiable", not
    // "exited" — the gate must key off `!exited`, not the coarser `live`.
    const unverifiable: Session = {
      ...liveSession(),
      verdict: "live",
      agentState: "exited",
    } as Session;
    render(
      <OrchestratorCanvas
        {...baseProps()}
        mainSession={unverifiable}
        policy={policyWithAdversarial(false)}
      />,
    );
    expect(
      screen.getByTestId("orchestrator-main-agent").getAttribute("data-state"),
    ).toBe("unverifiable");
    fireEvent.click(screen.getByTestId("orchestrator-main-agent"));
    expect(screen.getByTestId("main-agent-harness-locked")).toBeTruthy();
    expect(screen.getByTestId("main-agent-delete-refused")).toBeTruthy();
  });

  // F0: before "Run workflow" launches anything, the canvas must disclose
  // which runtime will run and whether it is paid/external.
  it("shows no runtime disclosure at all when nothing automated is configured", () => {
    render(
      <OrchestratorCanvas
        {...baseProps()}
        policy={policyWithAdversarial(false)}
      />,
    );
    expect(screen.queryByTestId("orchestrator-runtime-disclosure")).toBeNull();
  });

  it("discloses the free local default honestly when no runtime is approved", () => {
    render(
      <OrchestratorCanvas
        {...baseProps()}
        policy={policyWithAdversarial(true)}
      />,
    );
    const disclosure = screen.getByTestId("orchestrator-runtime-disclosure");
    expect(disclosure.getAttribute("data-free-default")).toBe("true");
    expect(disclosure.textContent).toContain("free local model");
    expect(disclosure.textContent).not.toContain("paid");
  });

  it("discloses a paid/external runtime plainly before Run workflow can launch it", () => {
    const policy: GraphPolicy = {
      ...policyWithAdversarial(true),
      approvedRuntimes: [{ harness: "claude", model: "claude-sonnet-5" }],
    };
    render(<OrchestratorCanvas {...baseProps()} policy={policy} />);
    const disclosure = screen.getByTestId("orchestrator-runtime-disclosure");
    expect(disclosure.getAttribute("data-free-default")).toBe("false");
    expect(disclosure.textContent).toContain("claude/claude-sonnet-5");
    expect(disclosure.textContent).toContain("paid/external");
  });
});
