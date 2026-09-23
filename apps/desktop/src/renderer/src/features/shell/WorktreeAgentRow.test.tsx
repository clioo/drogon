// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// PERF-03: the card rebuilds row objects on every App render, so the row
// memo needs its content comparator — fresh closures and fresh row/session
// objects with identical content must compare equal, while any rendered
// fact changing must compare unequal.
import { describe, expect, test } from "vitest";
import { render } from "@testing-library/react";
import { TooltipProvider } from "../../components/ui/tooltip";
import {
  areWorktreeAgentRowPropsEqual,
  WorktreeAgentRow,
  type WorktreeAgentRowProps,
} from "./WorktreeAgentRow";
import type { Session } from "../../../../shared/session-contract";
import type { WorktreeAgentRow as WorktreeAgentRowData } from "./worktree-agent-rows";

const session = (overrides: Partial<Session> = {}): Session => ({
  id: "s1",
  workspaceId: "w1",
  hostId: "h1",
  incarnation: "inc-1",
  command: "/bin/sh",
  args: [],
  cols: 80,
  rows: 24,
  verdict: "live",
  exitCode: null,
  createdAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

const row = (overrides: Partial<WorktreeAgentRowData> = {}): WorktreeAgentRowData => ({
  session: session(),
  state: "working",
  title: "Terminal 1",
  secondary: "Shell",
  stateLabel: "Working",
  relativeTime: "now",
  focused: false,
  ...overrides,
});

const props = (overrides: Partial<WorktreeAgentRowProps> = {}): WorktreeAgentRowProps => ({
  row: row(),
  disabled: false,
  onSelect: () => {},
  ...overrides,
});

describe("areWorktreeAgentRowPropsEqual", () => {
  test("fresh closures and fresh row/session objects with same content are equal", () => {
    // New function identities every time, like the card's rebuilt handlers.
    expect(areWorktreeAgentRowPropsEqual(props(), props())).toBe(true);
    expect(
      areWorktreeAgentRowPropsEqual(
        props({ onSelect: () => {}, onToggleChildren: () => {} }),
        props({ onSelect: () => {}, onToggleChildren: () => {} }),
      ),
    ).toBe(true);
  });

  test("any rendered row fact changing is unequal", () => {
    const previous = props();
    expect(areWorktreeAgentRowPropsEqual(previous, props({ disabled: true }))).toBe(false);
    expect(areWorktreeAgentRowPropsEqual(previous, props({ childCount: 2 }))).toBe(false);
    expect(
      areWorktreeAgentRowPropsEqual(previous, props({ childrenExpanded: true })),
    ).toBe(false);
    expect(
      areWorktreeAgentRowPropsEqual(previous, props({ reserveDisclosureGutter: true })),
    ).toBe(false);
    expect(areWorktreeAgentRowPropsEqual(previous, props({ isChildRow: true }))).toBe(
      false,
    );
    expect(
      areWorktreeAgentRowPropsEqual(previous, props({ row: row({ title: "Terminal 2" }) })),
    ).toBe(false);
    expect(
      areWorktreeAgentRowPropsEqual(previous, props({ row: row({ secondary: "Claude" }) })),
    ).toBe(false);
    expect(
      areWorktreeAgentRowPropsEqual(previous, props({ row: row({ relativeTime: "1m" }) })),
    ).toBe(false);
    expect(
      areWorktreeAgentRowPropsEqual(previous, props({ row: row({ focused: true }) })),
    ).toBe(false);
    expect(
      areWorktreeAgentRowPropsEqual(previous, props({ row: row({ state: "idle" }) })),
    ).toBe(false);
  });

  test("any session fact the row reads changing is unequal", () => {
    const previous = props();
    for (const overrides of [
      { id: "s2" },
      { harnessId: "claude" },
      // Issue #622: the glyph and title follow the observed harness too.
      { observedHarnessId: "claude" },
      { verdict: "exited" },
      { agentState: "idle" },
      { agentStateAt: "2026-01-01T00:01:00Z" },
      { cacheIdleAt: "2026-01-01T00:01:00Z" },
    ] as Partial<Session>[]) {
      expect(
        areWorktreeAgentRowPropsEqual(
          previous,
          props({ row: row({ session: session(overrides) }) }),
        ),
        JSON.stringify(overrides),
      ).toBe(false);
    }
  });

  test("identical reference is trivially equal", () => {
    const previous = props();
    expect(areWorktreeAgentRowPropsEqual(previous, previous)).toBe(true);
  });
});

function renderRow(rowData: Parameters<typeof WorktreeAgentRow>[0]["row"]) {
  return render(
    <TooltipProvider>
      <WorktreeAgentRow
        row={rowData}
        disabled={false}
        onSelect={() => {}}
      />
    </TooltipProvider>,
  );
}

describe("WorktreeAgentRow identity glyph (issue #622, B1)", () => {
  test("an observed-only session draws the harness mark; a plain shell draws the terminal glyph", () => {
    const observed = renderRow(
      row({
        session: session({ harnessId: null, observedHarnessId: "claude" }),
      }),
    );
    try {
      expect(
        observed.container.querySelector('[title="Claude"] svg:not(.lucide)'),
      ).not.toBeNull();
      expect(
        observed.container.querySelector("svg.lucide-terminal"),
      ).toBeNull();
    } finally {
      observed.unmount();
    }
    const shell = renderRow(row());
    try {
      expect(
        shell.container.querySelector('[title="Shell"] svg.lucide-terminal'),
      ).not.toBeNull();
    } finally {
      shell.unmount();
    }
  });
});
