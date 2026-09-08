// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/use-task-page-global-effects.ts (the Escape
// slice only: this repo's GitHub-only Tasks page has no fork modals,
// Linear/Jira dialogs or preflights to guard).
//
// Why window-level capture (fork `useTaskPageGlobalEffects`): the page's
// Close affordance promises `Close · Esc`, and Escape must work no matter
// where focus sits — after opening the page from the sidebar the focus is
// still on the nav button, so a Frame-level onKeyDown never sees the key.
//
// Adaptations to this repo: the fork unmounts the page when another view
// is active, while Drogon keeps it mounted (display:none) for session
// keep-alive — so the handler first checks that the page host is actually
// visible. The fork's `activeModal !== 'none'` guard becomes a DOM check:
// this repo surfaces modals as dialogs/palettes, and those own Escape.
import { useEffect } from "react";

const OVERLAY_OWNERS_ESCAPE_SELECTOR = [
  // Fork verbatim: open menus/popovers/selects own Escape (capture-phase
  // leave would steal it from Radix otherwise).
  '[data-slot="dropdown-menu-content"]',
  '[data-slot="popover-content"]',
  '[data-slot="select-content"]',
  '[role="menu"]',
  // Adapted from the fork's activeModal guard: confirmation dialogs and
  // the command/quick-open palettes own Escape while open.
  '[role="dialog"]',
  ".command-palette-overlay",
].join(", ");

const INPUT_OWNERS_ESCAPE_SELECTOR =
  'input, textarea, select, [contenteditable="true"], [contenteditable=""]';

/** Chromium's layout-aware visibility (display:none while another page is
 *  routed). No layout engine (jsdom) reads as visible so tests exercise
 *  the handler path. */
function isHostVisible(host: Element): boolean {
  return typeof host.checkVisibility === "function"
    ? host.checkVisibility()
    : true;
}

/** The App keep-alive host for the Tasks page (App.tsx section). Single
 *  source of truth shared by the host element and this visibility check. */
export const TASKS_PAGE_HOST_TESTID = "tasks-page-host";
export const TASKS_PAGE_HOST_SELECTOR = `[data-testid="${TASKS_PAGE_HOST_TESTID}"]`;

export function useTaskPageGlobalEscape({
  closeTaskPage,
  hostSelector,
}: {
  closeTaskPage: () => void;
  /** The element whose visibility decides whether the page owns Escape
   *  (the keep-alive host stays mounted while display:none). */
  hostSelector: string;
}): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      // Keep-alive host hidden: another page is active, it owns Escape.
      const host = document.querySelector(hostSelector);
      if (!host || !isHostVisible(host)) return;
      // Open overlays own Escape first (fork's modal/menu guard).
      if (document.querySelector(OVERLAY_OWNERS_ESCAPE_SELECTOR)) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      // Fork semantics: Escape first blurs a focused input so typing
      // focus never accidentally closes the whole page; the second
      // Escape closes once focus is outside an input.
      if (target.closest(INPUT_OWNERS_ESCAPE_SELECTOR)) {
        event.preventDefault();
        target.blur();
        return;
      }
      event.preventDefault();
      closeTaskPage();
    };
    // Why capture: tooltips can consume Escape before bubble listeners
    // see it (fork verbatim).
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [closeTaskPage, hostSelector]);
}
