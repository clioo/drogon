// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/automations/use-automations-page-escape.ts.
// Adaptations to this repo: the fork's store modal registry is this
// surface's editor/delete dialog state; there are no external-run pages;
// and the fork unmounts the page on view switches while Drogon keeps it
// mounted (display:none) for keep-alive — so, like
// features/tasks/task-page-global-escape.ts, the handler first checks
// that the page host is actually visible.
import { useEffect } from "react";
import type { AutomationPaneTab } from "./automation-detail-tab-navigation";

/** The App keep-alive host for the Automations page (App.tsx section).
 *  Single source of truth shared by the host element and this visibility
 *  check. */
export const AUTOMATIONS_PAGE_HOST_TESTID = "automations-page-host";
export const AUTOMATIONS_PAGE_HOST_SELECTOR = `[data-testid="${AUTOMATIONS_PAGE_HOST_TESTID}"]`;

/** Chromium's layout-aware visibility (display:none while another page is
 *  routed). No layout engine (jsdom) reads as visible so tests exercise
 *  the handler path. */
function isHostVisible(host: Element): boolean {
  return typeof host.checkVisibility === "function"
    ? host.checkVisibility()
    : true;
}

export function useAutomationsPageEscape({
  editorOpen,
  deleteTarget,
  isDetailOpen,
  pageView,
  runPageOrigin,
  setPageView,
  setActivePaneTab,
  setIsDetailOpen,
  clearRunDetail,
  onClose,
}: {
  /** Create/edit dialog open (fork createOpen): it owns Escape. */
  editorOpen: boolean;
  /** Delete confirmation pending (fork deleteTarget): it owns Escape. */
  deleteTarget: boolean;
  isDetailOpen: boolean;
  pageView: "automations" | "runs" | "run";
  runPageOrigin: "runs" | "automation";
  setPageView: (view: "automations" | "runs" | "run") => void;
  setActivePaneTab: (tab: AutomationPaneTab) => void;
  setIsDetailOpen: (open: boolean) => void;
  /** Clears the open run detail (fork setSelectedAutomationRunPageId(null)). */
  clearRunDetail: () => void;
  /** Closes the whole page (fork closeAutomationsPage). */
  onClose?: () => void;
}): void {
  useEffect(() => {
    // Fork: while a dialog owns the page the listener is not even attached.
    if (editorOpen || deleteTarget) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) {
        return;
      }
      // Keep-alive host hidden: another page is active, it owns Escape.
      const host = document.querySelector(AUTOMATIONS_PAGE_HOST_SELECTOR);
      if (!host || !isHostVisible(host)) {
        return;
      }
      // Fork field guards (composing, modifiers, clear-value fields,
      // overlays). The input branch is handled BELOW (fork blurs fields),
      // so shouldHandleAutomationDetailEscapeKey's input early-out is
      // reproduced here without the input clause.
      if (
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }
      const target = event.target;
      if (target instanceof Element) {
        if (target.getAttribute("data-escape-clears-value") === "true") {
          return;
        }
        if (target.closest('[role="dialog"], [role="menu"], [role="listbox"]')) {
          return;
        }
      }
      // Fork: Esc first blurs a focused field; only the next Esc leaves.
      if (
        target instanceof HTMLElement &&
        (target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement ||
          target.isContentEditable)
      ) {
        event.preventDefault();
        target.blur();
        return;
      }
      if (pageView === "run") {
        event.preventDefault();
        clearRunDetail();
        if (runPageOrigin === "automation") {
          setPageView("automations");
          setIsDetailOpen(true);
          setActivePaneTab("runs");
        } else {
          setPageView("runs");
          setIsDetailOpen(false);
          setActivePaneTab("overview");
        }
        return;
      }
      if (isDetailOpen) {
        event.preventDefault();
        setIsDetailOpen(false);
        setActivePaneTab("overview");
        return;
      }
      if (pageView === "runs") {
        event.preventDefault();
        setPageView("automations");
        return;
      }
      event.preventDefault();
      onClose?.();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [
    editorOpen,
    deleteTarget,
    isDetailOpen,
    pageView,
    runPageOrigin,
    setPageView,
    setActivePaneTab,
    setIsDetailOpen,
    clearRunDetail,
    onClose,
  ]);
}
