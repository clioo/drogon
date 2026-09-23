// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
   F1/R1 cross-surface regression: the SAME old-daemon session (harness-less
   shell carrying PTY-clock `working`, with and without an observed
   harness — plus a launched session without turn proof) drives the agent
   row, the card sentence, the tab badge and the summary pill — no surface
   may spin a Working claim for an unproven turn. A hook-proven launched
   `working` control proves genuine turns still render Working. */
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Tooltip } from "radix-ui";
import type { Session } from "../../../../shared/session-contract";
import { TabBar } from "./TabBar";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import { TooltipProvider } from "../../components/ui/tooltip";
import { beforeEach } from "vitest";
import { buildWorktreeAgentRows } from "./worktree-agent-rows";
import {
  worktreeActivityGlyph,
  worktreeActivitySentence,
} from "./worktree-card-activity";
import {
  cardDotState,
  summarizeCardAgentStates,
} from "./worktree-card-agent-summary";
import {
  CompactAgentSummaryButton,
} from "./worktree-card-compact-agents";

beforeEach(installRadixJsdomStubs);
afterEach(cleanup);

function shellSession(overrides: Partial<Session> = {}): Session {
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
    agentState: "working",
    agentStateAt: "2026-09-08T11:59:00.000Z",
    harnessId: null,
    observedHarnessId: null,
    ...overrides,
  };
}

function renderStrip(sessions: Session[]) {
  return render(
    <Tooltip.Provider>
      <TabBar
        sessions={sessions}
        activeSessionId={sessions[0]?.id ?? ""}
        browserTabs={[]}
        activeBrowserTabId={null}
        editorTabs={[]}
        activeEditorTabId={null}
        mentuOpen={false}
        mentuActive={false}
        onSelectMentu={() => {}}
        onCloseMentu={() => {}}
        harnesses={[]}
        workspaceId="ws-1"
        hostId="host-1"
        newTerminalShortcut=""
        newBrowserShortcut=""
        closeDisabled={false}
        retryDisabled={false}
        createDisabled={false}
        stripOrder={[]}
        pinnedIds={[]}
        customTitles={{}}
        onOrderChange={() => {}}
        onTogglePin={() => {}}
        onCloseOthers={() => {}}
        onCloseToRight={() => {}}
        onCloseToLeft={() => {}}
        onCommitTitle={() => {}}
        onCopyText={() => {}}
        onSelectSession={() => {}}
        onSelectBrowserTab={() => {}}
        onSelectEditorTab={() => {}}
        onCloseSession={() => {}}
        onCloseBrowserTab={() => {}}
        onCloseEditorTab={() => {}}
        onRetrySession={() => {}}
        onCreateTerminal={() => {}}
        onLaunchHarness={() => Promise.resolve(false)}
        onNewBrowserTab={() => {}}
      />
    </Tooltip.Provider>,
  );
}

function renderPill(sessions: Session[]) {
  return render(
    <TooltipProvider>
      <CompactAgentSummaryButton
        sessions={sessions}
        labelFor={() => "Shell"}
        subjectLabel={`${sessions.length} agent${sessions.length === 1 ? "" : "s"}`}
        expanded={false}
        onToggle={() => {}}
      />
    </TooltipProvider>,
  );
}

describe("one old-daemon shell session on every surface", () => {
  for (const observed of [null, "pi" as const]) {
    test(`no surface spins for harness-less working${observed ? " with an observed harness" : ""}`, () => {
      const item = shellSession(
        observed ? { observedHarnessId: observed } : {},
      );
      const sessions = [item];

      // Row derivation: unknown, never Working.
      const rows = buildWorktreeAgentRows(sessions, {
        nowMs: Date.parse("2026-09-08T12:00:00.000Z"),
      });
      expect(rows.map((row) => row.state)).toEqual(["unknown"]);

      // Card sentence + glyph: no spinner. A pure shell names its session;
      // an observed harness is a known agent, so it stays a named agent
      // that is not reporting — recognized, never hidden, never Working.
      expect(worktreeActivitySentence(sessions)).toBe(
        observed ? "1 AGENT NOT REPORTING" : "1 TERMINAL SESSION",
      );
      expect(worktreeActivityGlyph(sessions)).toBeNull();

      // Summary pill derivation: not reporting, never working.
      expect(cardDotState(sessions)).toBe("unknown");
      expect(summarizeCardAgentStates(sessions)).toBe(
        "1 session not reporting",
      );

      // Rendered tab badge: the unknown ring, never the spinner.
      const strip = renderStrip(sessions);
      expect(
        strip.container.querySelector("[data-agent-spinner]"),
        "tab badge must not spin for an unproven turn",
      ).toBeNull();
      expect(
        strip.container.querySelector('[aria-label="Working"]'),
        "no Working marker may ride the tab",
      ).toBeNull();
      expect(
        strip.container.querySelector('[aria-label="No recent update"]'),
        "the tab states the silence instead",
      ).not.toBeNull();
      strip.unmount();

      // Rendered summary pill: no spinner cluster, not-reporting label.
      const pill = renderPill(sessions);
      expect(
        pill.container.querySelector("[data-agent-spinner]"),
        "summary pill must not spin for an unproven turn",
      ).toBeNull();
      expect(
        pill.container.querySelector('[aria-label="Working"]'),
      ).toBeNull();
      const toggle = screen.getByRole("button");
      expect(toggle.getAttribute("aria-label")).toContain("not reporting");
      pill.unmount();
    });
  }

  test("an old-daemon launched working spins nothing on any surface", () => {
    // The R1 correction: a launched idle repaint is indistinguishable on
    // old wire, so missing proof never makes an agent Working — launch or
    // not. The launched row is a named agent that is not reporting.
    const item = shellSession({ harnessId: "pi" });
    const sessions = [item];

    expect(
      buildWorktreeAgentRows(sessions, {
        nowMs: Date.parse("2026-09-08T12:00:00.000Z"),
      }).map((row) => row.state),
    ).toEqual(["unknown"]);
    expect(worktreeActivitySentence(sessions)).toBe("1 AGENT NOT REPORTING");
    expect(worktreeActivityGlyph(sessions)).toBeNull();
    expect(cardDotState(sessions)).toBe("unknown");

    const strip = renderStrip(sessions);
    expect(
      strip.container.querySelector("[data-agent-spinner]"),
      "an unproven launched turn must not spin the tab",
    ).toBeNull();
    strip.unmount();
  });

  test("a hook-proven launched working still spins the tab and names the agent turn", () => {
    const item = shellSession({
      harnessId: "pi",
      agentStateAuthority: "hook",
    });
    const sessions = [item];

    expect(
      buildWorktreeAgentRows(sessions, {
        nowMs: Date.parse("2026-09-08T12:00:00.000Z"),
      }).map((row) => row.state),
    ).toEqual(["working"]);
    expect(worktreeActivitySentence(sessions)).toBe("1 AGENT WORKING");
    expect(worktreeActivityGlyph(sessions)).toBe("working");

    const strip = renderStrip(sessions);
    expect(
      strip.container.querySelector("[data-agent-spinner]"),
      "a proven turn keeps the tab spinner",
    ).not.toBeNull();
    strip.unmount();
  });
});
