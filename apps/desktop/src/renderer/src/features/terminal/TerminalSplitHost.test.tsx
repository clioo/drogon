// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc. Tests for TerminalSplitHost (the
// Split Terminal Right subset of issue #129): single vs split layout, the
// fork's divider with resize behavior, focus routing between panes and the
// per-pane header entry points. TerminalPane itself is real and tested
// elsewhere; it is stubbed here so the host wiring is what these tests
// prove.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Session } from "../../../../shared/session-contract";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";

vi.mock("./TerminalPane", () => ({
  TerminalPane: ({
    session,
    restoredBannerReason,
    onDismissRestoredBanner,
  }: {
    session: Session;
    restoredBannerReason?: string | null;
    onDismissRestoredBanner?: () => void;
  }) => (
    <div
      data-testid={`stub-pane-${session.id}`}
      data-restored-banner={restoredBannerReason ?? ""}
    >
      <button
        type="button"
        data-testid={`dismiss-${session.id}`}
        onClick={() => onDismissRestoredBanner?.()}
      />
    </div>
  ),
}));

import { TerminalSplitHost } from "./TerminalSplitHost";
import { TooltipProvider } from "../../components/ui/tooltip";
import type { TerminalSplit } from "./terminal-split";

installRadixJsdomStubs();
afterEach(cleanup);

function session(id: string): Session {
  return {
    id,
    hostId: "local",
    workspaceId: "ws-1",
    incarnation: "1",
    command: "",
    args: [],
    cols: 80,
    rows: 24,
    verdict: "live",
    exitCode: null,
    createdAt: "2026-09-08T00:00:00.000Z",
    agentState: "idle",
  };
}

type HostProps = Parameters<typeof TerminalSplitHost>[0];

const BASE = {
  rootId: "root",
  split: null,
  revision: 0,
  fontSize: 13,
  canSplit: true,
  onError: () => {},
  onSession: () => {},
  onSplitRight: () => {},
  onClosePane: () => {},
  onFocusPane: () => {},
  onResize: () => {},
} as const;

function renderHost(props: HostProps) {
  return render(
    <TooltipProvider>
      <TerminalSplitHost {...props} />
    </TooltipProvider>,
  );
}

const SPLIT: TerminalSplit = {
  rootId: "root",
  panes: ["root", "second"],
  activePaneId: "second",
  sizes: [0.5, 0.5],
};

describe("TerminalSplitHost", () => {
  it("renders one pane with the split entry point while single", () => {
    renderHost({ ...BASE, panes: [session("root")] });
    expect(screen.getByTestId("stub-pane-root")).toBeTruthy();
    expect(screen.queryByTestId("stub-pane-second")).toBeNull();
    expect(screen.queryByTestId("terminal-split-divider")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Split Terminal Right" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close Pane" })).toBeNull();
  });

  it("renders two live panes with divider and close entry points while split", () => {
    renderHost({
      ...BASE,
      split: SPLIT,
      panes: [session("root"), session("second")],
    });
    expect(screen.getByTestId("stub-pane-root")).toBeTruthy();
    expect(screen.getByTestId("stub-pane-second")).toBeTruthy();
    const divider = screen.getByTestId("terminal-split-divider");
    expect(divider.getAttribute("role")).toBe("separator");
    expect(divider.getAttribute("aria-orientation")).toBe("vertical");
    expect(screen.getAllByRole("button", { name: "Close Pane" })).toHaveLength(
      2,
    );
    // The second pane shows no split trigger: the tab already holds two.
    expect(
      screen.queryByRole("button", { name: "Split Terminal Right" }),
    ).toBeNull();
  });

  it("marks the focused pane for the fork's reveal rules", () => {
    const { container } = renderHost({
      ...BASE,
      split: SPLIT,
      panes: [session("root"), session("second")],
    });
    const panes = container.querySelectorAll(
      ".terminal-split-pane[data-terminal-pane-id]",
    );
    expect(panes).toHaveLength(2);
    expect(panes[0].hasAttribute("data-active-pane")).toBe(false);
    expect(panes[1].getAttribute("data-terminal-pane-id")).toBe("second");
    expect(panes[1].hasAttribute("data-active-pane")).toBe(true);
  });

  it("routes focus between panes", () => {
    const onFocusPane = vi.fn();
    const { container } = renderHost({
      ...BASE,
      split: SPLIT,
      panes: [session("root"), session("second")],
      onFocusPane,
    });
    const first = container.querySelector(
      '.terminal-split-pane[data-terminal-pane-id="root"]',
    );
    expect(first).toBeTruthy();
    fireEvent.focusIn(first!);
    expect(onFocusPane).toHaveBeenCalledWith("root");
  });

  it("fires the split and close entry points per pane", () => {
    const onSplitRight = vi.fn();
    renderHost({
      ...BASE,
      panes: [session("root")],
      onSplitRight,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Split Terminal Right" }),
    );
    expect(onSplitRight).toHaveBeenCalledWith("root");

    const onClosePane = vi.fn();
    renderHost({
      ...BASE,
      split: SPLIT,
      panes: [session("root"), session("second")],
      onClosePane,
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Close Pane" })[1]);
    expect(onClosePane).toHaveBeenCalledWith("second");
  });

  it("resizes with the keyboard on the divider", () => {
    const onResize = vi.fn();
    renderHost({
      ...BASE,
      split: { ...SPLIT, sizes: [0.5, 0.5] },
      panes: [session("root"), session("second")],
      onResize,
    });
    const divider = screen.getByTestId("terminal-split-divider");
    fireEvent.keyDown(divider, { key: "ArrowLeft" });
    expect(onResize).toHaveBeenCalledWith(0.45);
    fireEvent.keyDown(divider, { key: "ArrowRight" });
    expect(onResize).toHaveBeenCalledWith(0.55);
  });
});

describe("TerminalSplitHost resume banner routing", () => {
  it("raises each pane's own resume banner and never a neighbour's", () => {
    // The banner belongs to the pane whose launch produced it: a resumed
    // pane must not paint its restore onto a sibling that was never
    // resumed, and a pane with no resume gets nothing.
    const { container } = renderHost({
      ...BASE,
      panes: [session("root"), session("second")],
      split: { ...SPLIT, sizes: [0.5, 0.5] },
      restoredBannerReasonFor: (sessionId) =>
        sessionId === "second" ? "resume-unavailable" : null,
    });
    expect(
      container.querySelector('[data-testid="stub-pane-root"]')?.getAttribute(
        "data-restored-banner",
      ),
    ).toBe("");
    expect(
      container.querySelector('[data-testid="stub-pane-second"]')?.getAttribute(
        "data-restored-banner",
      ),
    ).toBe("resume-unavailable");
  });

  it("dismisses the banner for the pane the user touched", () => {
    const onDismissRestoredBanner = vi.fn();
    renderHost({
      ...BASE,
      panes: [session("root"), session("second")],
      split: { ...SPLIT, sizes: [0.5, 0.5] },
      restoredBannerReasonFor: () => "restored",
      onDismissRestoredBanner,
    });
    // The pane's own dismissal is routed with the pane's session id -- so a
    // restore on the right pane can never retire the left pane's banner.
    fireEvent.click(screen.getByTestId("dismiss-second"));
    expect(onDismissRestoredBanner).toHaveBeenCalledWith("second");
  });
});
