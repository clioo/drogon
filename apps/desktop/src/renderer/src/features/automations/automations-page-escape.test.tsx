// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc. Escape precedence cases parallel the
// fork's AutomationsPage.escape-precedence.test.tsx over the port in
// automations-page-escape.ts (from use-automations-page-escape.ts):
// run → back per origin, detail → list,
// runs → automations, top level → close; dialogs and fields own Escape
// first; a hidden keep-alive host never handles it (#270).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  AUTOMATIONS_PAGE_HOST_TESTID,
  useAutomationsPageEscape,
} from "./automations-page-escape";

afterEach(cleanup);

function Harness(props: {
  editorOpen?: boolean;
  deleteTarget?: boolean;
  isDetailOpen?: boolean;
  pageView?: "automations" | "runs" | "run";
  runPageOrigin?: "runs" | "automation";
  onClose?: () => void;
  spies?: {
    setPageView?: (view: "automations" | "runs" | "run") => void;
    setActivePaneTab?: (
      tab: import("./automation-detail-tab-navigation").AutomationPaneTab,
    ) => void;
    setIsDetailOpen?: (open: boolean) => void;
    clearRunDetail?: () => void;
  };
}) {
  const spies = props.spies ?? {};
  useAutomationsPageEscape({
    editorOpen: props.editorOpen ?? false,
    deleteTarget: props.deleteTarget ?? false,
    isDetailOpen: props.isDetailOpen ?? false,
    pageView: props.pageView ?? "automations",
    runPageOrigin: props.runPageOrigin ?? "runs",
    setPageView: spies.setPageView ?? (() => {}),
    setActivePaneTab: spies.setActivePaneTab ?? (() => {}),
    setIsDetailOpen: spies.setIsDetailOpen ?? (() => {}),
    clearRunDetail: spies.clearRunDetail ?? (() => {}),
    onClose: props.onClose,
  });
  return null;
}

function renderHarness(props: Parameters<typeof Harness>[0]) {
  return render(
    <div data-testid={AUTOMATIONS_PAGE_HOST_TESTID}>
      <Harness {...props} />
    </div>,
  );
}

describe("useAutomationsPageEscape (fork use-automations-page-escape)", () => {
  it("closes the page from the top-level automations view", () => {
    const onClose = vi.fn();
    renderHarness({ onClose });
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("leaves the runs dashboard for the automations list before closing", () => {
    const onClose = vi.fn();
    const setPageView = vi.fn();
    renderHarness({ onClose, pageView: "runs", spies: { setPageView } });
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(setPageView).toHaveBeenCalledWith("automations");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes an open detail pane before the page", () => {
    const onClose = vi.fn();
    const setIsDetailOpen = vi.fn();
    const setActivePaneTab = vi.fn();
    renderHarness({
      onClose,
      isDetailOpen: true,
      spies: { setIsDetailOpen, setActivePaneTab },
    });
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(setIsDetailOpen).toHaveBeenCalledWith(false);
    expect(setActivePaneTab).toHaveBeenCalledWith("overview");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("returns from a run page per origin (automation detail)", () => {
    const onClose = vi.fn();
    const clearRunDetail = vi.fn();
    const setPageView = vi.fn();
    const setIsDetailOpen = vi.fn();
    const setActivePaneTab = vi.fn();
    renderHarness({
      onClose,
      pageView: "run",
      runPageOrigin: "automation",
      spies: { clearRunDetail, setPageView, setIsDetailOpen, setActivePaneTab },
    });
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(clearRunDetail).toHaveBeenCalledTimes(1);
    expect(setPageView).toHaveBeenCalledWith("automations");
    expect(setIsDetailOpen).toHaveBeenCalledWith(true);
    expect(setActivePaneTab).toHaveBeenCalledWith("runs");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("returns from a run page per origin (runs dashboard)", () => {
    const onClose = vi.fn();
    const clearRunDetail = vi.fn();
    const setPageView = vi.fn();
    const setIsDetailOpen = vi.fn();
    const setActivePaneTab = vi.fn();
    renderHarness({
      onClose,
      pageView: "run",
      runPageOrigin: "runs",
      spies: { clearRunDetail, setPageView, setIsDetailOpen, setActivePaneTab },
    });
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(clearRunDetail).toHaveBeenCalledTimes(1);
    expect(setPageView).toHaveBeenCalledWith("runs");
    expect(setIsDetailOpen).toHaveBeenCalledWith(false);
    expect(setActivePaneTab).toHaveBeenCalledWith("overview");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("lets the editor dialog own Escape", () => {
    const onClose = vi.fn();
    renderHarness({ onClose, editorOpen: true });
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("lets the delete confirmation own Escape", () => {
    const onClose = vi.fn();
    renderHarness({ onClose, deleteTarget: true });
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("blurs a focused field first instead of closing", () => {
    const onClose = vi.fn();
    renderHarness({ onClose });
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(input);
    input.remove();
  });

  it("ignores Escape while the keep-alive host is hidden", () => {
    // jsdom has no layout engine: stub Chromium's checkVisibility so the
    // display:none host reads as hidden like it does in the app.
    Object.defineProperty(HTMLElement.prototype, "checkVisibility", {
      configurable: true,
      value() {
        return this.style.display !== "none";
      },
    });
    try {
      const onClose = vi.fn();
      render(
        <div data-testid={AUTOMATIONS_PAGE_HOST_TESTID} style={{ display: "none" }}>
          <Harness onClose={onClose} />
        </div>,
      );
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, "checkVisibility");
    }
  });

  it("ignores Escape when the host is not mounted at all", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
