// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc. Card-level proof for the compact
   "N agents" summary pill (the fork's worktree-card-compact-agents.tsx):
   the collapsed pill clusters same-state sessions with state dots and
   overlapping identity glyphs, expands into the real selectable rows
   through the grid-track expansion, and carries the source's aria
   disclosure labels. */
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Session } from "../../../../shared/session-contract";
import {
  CompactAgentExpansion,
  CompactAgentSummaryButton,
} from "./worktree-card-compact-agents";
import { TooltipProvider } from "../../components/ui/tooltip";
import { clearWorktreeAgentExpansionStateForTests } from "./worktree-card-agents-expansion-state";

afterEach(() => {
  cleanup();
  clearWorktreeAgentExpansionStateForTests();
});

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "s-1",
    workspaceId: "ws-1",
    hostId: "host-1",
    incarnation: "1",
    command: "/bin/zsh",
    args: [],
    cols: 80,
    rows: 24,
    verdict: "live",
    exitCode: null,
    createdAt: "2026-09-08T11:00:00.000Z",
    harnessId: "claude",
    ...overrides,
  };
}

function labelFor(item: Session): string {
  return item.harnessId === "pi" ? "Pi" : "Claude";
}

describe("CompactAgentSummaryButton", () => {
  test("collapsed pill names the clusters in aria and expands/collapses", () => {
    let expanded = false;
    const view = render(
      <TooltipProvider>
        <CompactAgentSummaryButton
          sessions={[
            session({ agentState: "working" }),
            session({ id: "b", agentState: "working" }),
          ]}
          labelFor={labelFor}
          subjectLabel="2 agents"
          expanded={expanded}
          onToggle={() => {
            expanded = !expanded;
          }}
        />
      </TooltipProvider>,
    );
    const toggle = screen.getByRole("button", { name: /^Expand 2 agents/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // Collapsed clusters read as the state sentence, like the source.
    expect(toggle.getAttribute("aria-label")).toContain("2 agents working");
    fireEvent.click(toggle);
    view.rerender(
      <TooltipProvider>
        <CompactAgentSummaryButton
          sessions={[
            session({ agentState: "working" }),
            session({ id: "b", agentState: "working" }),
          ]}
          labelFor={labelFor}
          subjectLabel="2 agents"
          expanded={expanded}
          onToggle={() => {
            expanded = !expanded;
          }}
        />
      </TooltipProvider>,
    );
    expect(
      screen.getByRole("button", { name: "Collapse 2 agents" }),
    ).toBeTruthy();
  });

  test("cluster dots and identity glyphs render per state group, capped at three groups", () => {
    const view = render(
      <TooltipProvider>
        <CompactAgentSummaryButton
          sessions={[
            session({ agentState: "working" }),
            session({ id: "b", agentState: "needs_input" }),
            session({ id: "c", harnessId: "pi", agentState: "exited" }),
            session({ id: "d", agentState: "idle" }),
          ]}
          labelFor={labelFor}
          subjectLabel="4 agents"
          expanded={false}
          onToggle={() => {}}
        />
      </TooltipProvider>,
    );
    // Three visible clusters (needs_input, working, exited); idle hides
    // behind the "+N" tail like the source's hiddenGroupAgentCount.
    const list = view.container.querySelector("span[aria-hidden]")!;
    const clusters = list.querySelectorAll(':scope > span[class*="bg-worktree-sidebar"]');
    expect(clusters.length).toBe(3);
    expect(view.container.textContent).toContain("+1");
    // Identity glyphs ride the clusters as overlapping icon circles.
    expect(
      view.container.querySelectorAll(".compact-agent-summary-button span.size-4").length,
    ).toBeGreaterThan(0);
  });
});

describe("CompactAgentExpansion", () => {
  test("keeps already-opened content mounted for the collapse transition", () => {
    const view = render(
      <CompactAgentExpansion expanded>
        <div>row-a</div>
      </CompactAgentExpansion>,
    );
    expect(view.container.textContent).toContain("row-a");
    view.rerender(
      <CompactAgentExpansion expanded={false}>
        <div>row-a</div>
      </CompactAgentExpansion>,
    );
    // Collapsed: content stays mounted (for the exit transition) but is
    // hidden and inert, exactly like the source's expansion grid.
    expect(view.container.textContent).toContain("row-a");
    const grid = view.container.querySelector(".compact-agent-expansion-grid")!;
    expect(grid.getAttribute("aria-hidden")).toBe("true");
    expect(grid.hasAttribute("inert")).toBe(true);
  });
});
