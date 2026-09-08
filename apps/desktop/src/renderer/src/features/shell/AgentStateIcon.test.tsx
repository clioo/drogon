// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Parity test against the fork's AgentStateDot/AgentWorkingSpinner test
// cases (src/renderer/src/components/AgentStateDot.test.ts: question-glyph
// contrast floor, working spinner, unverifiable dashed ring) plus the
// shared tooltip copy; asserts glyph, token, aria-label and keyframe
// contract on the local AgentStateIcon.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AgentState } from "../../../../shared/session-contract";
import { AgentStateIcon } from "./AgentStateIcon";
import { agentStateLabel } from "./agent-state";

vi.mock("../../components/ui/tooltip", async () => {
  const { createElement } = await import("react");
  return {
    Tooltip: ({ children }: { children: React.ReactNode }) =>
      createElement(React.Fragment, null, children),
    TooltipTrigger: ({ children }: { children: React.ReactElement }) => children,
    TooltipContent: ({
      children,
    }: {
      children: React.ReactNode;
    }) =>
      createElement(
        "span",
        { "data-state-indicator-tooltip": String(children) },
        null,
      ),
  };
});

function renderMarkup(state: AgentState): string {
  return renderToStaticMarkup(React.createElement(AgentStateIcon, { state }));
}

const ALL_STATES: AgentState[] = [
  "working",
  "idle",
  "needs_input",
  "exited",
  "unknown",
];

describe("AgentStateIcon", () => {
  it("renders working as the fork's yellow compositor spinner", () => {
    const markup = renderMarkup("working");

    expect(markup).toContain("border-yellow-500");
    expect(markup).toContain("border-t-transparent");
    expect(markup).toContain("agent-working-spinner");
    expect(markup).toContain("data-agent-spinner");
    // Why: under reduced motion the top border is filled so the static ring
    // reads as a complete marker, not a broken partial spinner.
    expect(markup).toContain("motion-reduce:border-t-yellow-500");
    expect(markup).toContain('aria-label="Working"');
    expect(markup).not.toContain("text-amber-500");
  });

  it("renders needs_input as the shared question glyph on the token", () => {
    const markup = renderMarkup("needs_input");

    // One token across tabs and cards — never a raw hue.
    expect(markup).toContain("text-agent-question");
    expect(markup).toContain("<svg");
    expect(markup).toContain('aria-label="Waiting for input"');
    expect(markup).not.toContain("text-amber-500");
    expect(markup).not.toContain("data-agent-spinner");
  });

  it("renders idle as the fork's quiet grey dot", () => {
    const markup = renderMarkup("idle");

    expect(markup).toContain("rounded-full");
    expect(markup).toContain("bg-neutral-500/40");
    expect(markup).toContain('aria-label="Idle"');
    expect(markup).not.toContain("data-agent-spinner");
    expect(markup).not.toContain("text-emerald-500");
  });

  it("renders unknown as an amber dashed ring, never the spinner", () => {
    const markup = renderMarkup("unknown");

    expect(markup).toContain("lucide-circle-dashed");
    expect(markup).toContain("text-amber-500");
    expect(markup).toContain('aria-label="No recent update"');
    expect(markup).not.toContain("data-agent-spinner");
  });

  it("renders exited as a quiet grey dot with its own label", () => {
    const markup = renderMarkup("exited");

    expect(markup).toContain("rounded-full");
    expect(markup).toContain("bg-neutral-500/40");
    expect(markup).toContain('aria-label="Exited"');
    expect(markup).not.toContain("data-agent-spinner");
  });

  it.each(ALL_STATES)("labels %s with the shared hover tooltip", (state) => {
    const markup = renderMarkup(state);

    expect(markup).toContain(
      `data-state-indicator-tooltip="${agentStateLabel(state)}"`,
    );
    expect(markup).not.toContain(" title=");
  });

  it("keeps the question token above the contrast floor in both themes", () => {
    const css = readFileSync(
      join(__dirname, "../../assets/main.css"),
      "utf8",
    );
    const lightTheme = css.match(/:root\s*\{(?<body>[\s\S]*?)\n\}/)?.groups?.body;
    const darkTheme = css.match(/\.dark\s*\{(?<body>[\s\S]*?)\n\}/)?.groups?.body;

    expect(lightTheme).toContain("--agent-question: var(--color-orange-600)");
    expect(darkTheme).toContain("--agent-question: var(--color-orange-500)");
  });

  it("is backed by a steps(12) keyframe animation in main.css", () => {
    const css = readFileSync(
      join(__dirname, "../../assets/main.css"),
      "utf8",
    );

    const rule = css.match(/\.agent-working-spinner\s*\{[^}]*\}/)?.[0];
    expect(rule).toBeDefined();
    expect(rule).toContain(
      "animation: agent-spinner-rotate 1s steps(12, end) infinite",
    );
    expect(css).toContain("@keyframes agent-spinner-rotate");

    const reducedMotionBlock = css.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.agent-working-spinner\s*\{[^}]*\}/,
    )?.[0];
    expect(reducedMotionBlock).toContain("animation: none");
  });
});
