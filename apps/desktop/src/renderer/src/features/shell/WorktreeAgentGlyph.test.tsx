// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Sidebar-local glyph proof (owner's guide 2026-09-21): Codex renders the
// recognizable OpenAI knot — never the boxed letter the shared menu icon
// falls back to — Pi renders the shipped pi.dev geometry in a frame
// cropped to its own ink — never the padded 800 canvas that read tiny —
// every other harness delegates to the shared menu icon byte-for-byte, and
// null stays empty so the row keeps its truthful Terminal fallback. Each
// glyph is aria-hidden with the row's own label intact, and theme color
// rides currentColor.
import { describe, expect, test } from "vitest";
import { render } from "@testing-library/react";
import { TooltipProvider } from "../../components/ui/tooltip";
import type { Session } from "../../../../shared/session-contract";
import { HarnessMenuIcon } from "./TabCreateMenuIcons";
import { OpenAIIcon } from "../settings/agent-openai-icon";
import {
  SIDEBAR_PI_BOWL_PATH,
  SIDEBAR_PI_LEG_PATH,
  SIDEBAR_PI_VIEW_BOX,
  SidebarProviderGlyph,
} from "./WorktreeAgentGlyph";
import { WorktreeAgentRow } from "./WorktreeAgentRow";
import type { WorktreeAgentRow as WorktreeAgentRowData } from "./worktree-agent-rows";

const OPENAI_KNOT_HEAD = "M9.205 8.658v-2.26";

function glyphSvg(harnessId: Parameters<typeof SidebarProviderGlyph>[0]["harnessId"]) {
  const { container } = render(
    <SidebarProviderGlyph harnessId={harnessId} displayName="Codex" size={13} />,
  );
  return container;
}

describe("SidebarProviderGlyph", () => {
  test("codex renders the recognizable OpenAI knot, never the boxed letter", () => {
    const { container } = render(<OpenAIIcon size={13} />);
    const expectedKnot = container.querySelector("svg path")?.getAttribute("d");
    expect(expectedKnot?.startsWith(OPENAI_KNOT_HEAD)).toBe(true);

    const sidebar = glyphSvg("codex");
    const knot = sidebar.querySelector("svg path")?.getAttribute("d");
    expect(knot).toBe(expectedKnot);
    // The shared menu icon's letter fallback is what the sidebar replaces.
    expect(sidebar.querySelector("svg text")).toBeNull();

    const { container: shared } = render(
      <HarnessMenuIcon harnessId="codex" displayName="Codex" size={13} />,
    );
    expect(shared.querySelector("svg text")?.textContent).toBe("C");
    expect(sidebar.innerHTML).not.toBe(shared.innerHTML);
  });

  test("pi renders the shipped geometry in a cropped frame", () => {
    const sidebar = glyphSvg("pi");
    const svg = sidebar.querySelector("svg") as SVGElement;
    expect(svg.getAttribute("viewBox")).toBe(SIDEBAR_PI_VIEW_BOX);
    expect(svg.getAttribute("viewBox")).not.toBe("0 0 800 800");
    const paths = [...sidebar.querySelectorAll("svg path")];
    expect(paths.map((path) => path.getAttribute("d"))).toEqual([
      SIDEBAR_PI_BOWL_PATH,
      SIDEBAR_PI_LEG_PATH,
    ]);
    // The frame hugs the ink: 165..635 on the shipped 800 canvas.
    const [x, y, width, height] = SIDEBAR_PI_VIEW_BOX.split(" ").map(Number);
    expect([x, y, width, height]).toEqual([165, 165, 470, 470]);
    expect(x).toBeLessThanOrEqual(166);
    expect(y).toBeLessThanOrEqual(166);
    expect(x + width).toBeGreaterThanOrEqual(634);
    expect(y + height).toBeGreaterThanOrEqual(634);
  });

  test("claude, opencode and antigravity delegate to the shared menu icon unchanged", () => {
    for (const harnessId of ["claude", "opencode", "antigravity"] as const) {
      const { container: sidebar } = render(
        <SidebarProviderGlyph harnessId={harnessId} displayName={harnessId} size={13} />,
      );
      const { container: shared } = render(
        <HarnessMenuIcon harnessId={harnessId} displayName={harnessId} size={13} />,
      );
      // The wrapper adds only the aria-hidden span; the svg itself is the
      // shared branding byte-for-byte, so menus and tabs cannot drift.
      expect(sidebar.querySelector("svg")?.outerHTML).toBe(
        shared.querySelector("svg")?.outerHTML,
      );
    }
  });

  test("null renders nothing, keeping the row's Terminal fallback truthful", () => {
    const { container } = render(
      <SidebarProviderGlyph harnessId={null} displayName="Shell" size={13} />,
    );
    expect(container.innerHTML).toBe("");
  });

  test("every glyph is aria-hidden and honors size and currentColor", () => {
    for (const harnessId of ["codex", "pi", "claude"] as const) {
      const { container, unmount } = render(
        <SidebarProviderGlyph harnessId={harnessId} displayName={harnessId} size={13} />,
      );
      expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
      const svg = container.querySelector("svg") as SVGElement;
      expect(svg.getAttribute("width")).toBe("13");
      expect(svg.getAttribute("height")).toBe("13");
      // Theme color rides currentColor, never a hardcoded sidebar fill: the
      // knot fills currentColor and the Pi paths fill currentColor. Claude
      // keeps its shipped two-tone starburst via delegation (pinned above).
      if (harnessId !== "claude") {
        expect(container.innerHTML).toContain("currentColor");
      }
      unmount();
    }
  });
});

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

function agentRow(sessionId: string, harnessId: Session["harnessId"]): WorktreeAgentRowData {
  return {
    session: session({ id: sessionId, harnessId }),
    state: "idle",
    title: "Idle",
    secondary: "",
    stateLabel: "Idle",
    relativeTime: "now",
    focused: false,
  };
}

describe("WorktreeAgentRow sidebar glyphs", () => {
  const renderRow = (row: WorktreeAgentRowData) =>
    render(
      <TooltipProvider>
        <WorktreeAgentRow row={row} disabled={false} onSelect={() => {}} />
      </TooltipProvider>,
    );

  test("a codex row carries the knot and keeps its accessible label", () => {
    const { container } = renderRow(agentRow("codex-1", "codex"));
    const row = container.querySelector('[data-worktree-agent-row="codex-1"]') as HTMLElement;
    const knot = row.querySelector(".shell-worktree-agent-glyph svg path")?.getAttribute("d");
    expect(knot?.startsWith(OPENAI_KNOT_HEAD)).toBe(true);
    expect(row.querySelector(".shell-worktree-agent-glyph svg text")).toBeNull();
    expect(row.getAttribute("aria-label")?.length).toBeGreaterThan(0);
  });

  test("a pi row carries the cropped frame", () => {
    const { container } = renderRow(agentRow("pi-1", "pi"));
    const row = container.querySelector('[data-worktree-agent-row="pi-1"]') as HTMLElement;
    expect(
      row.querySelector(".shell-worktree-agent-glyph svg")?.getAttribute("viewBox"),
    ).toBe(SIDEBAR_PI_VIEW_BOX);
  });

  test("a harness-less row keeps the native Terminal glyph", () => {
    const { container } = renderRow(agentRow("sh-1", null));
    const row = container.querySelector('[data-worktree-agent-row="sh-1"]') as HTMLElement;
    const glyph = row.querySelector(".shell-worktree-agent-glyph svg") as SVGElement;
    expect(glyph?.outerHTML).toContain("lucide-terminal");
  });
});
