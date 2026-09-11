// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from orca-drogon: src/renderer/src/components/meetings/
// use-meetings-page-escape.ts. The fork's `hasVisibleOverlay()` helper
// becomes this repo's DOM overlay selectors plus the keep-alive host check,
// exactly the adaptation the Tasks page already made
// (features/tasks/task-page-global-escape.ts): Drogon keeps a page mounted
// with `display: none` while another route is active, so the handler must
// confirm its host is the visible one before closing anything.
import { useEffect } from "react";

const OVERLAY_OWNERS_ESCAPE_SELECTOR = [
  '[data-slot="dropdown-menu-content"]',
  '[data-slot="popover-content"]',
  '[data-slot="select-content"]',
  '[role="menu"]',
  '[role="dialog"]',
  ".command-palette-overlay",
].join(", ");

const INPUT_OWNERS_ESCAPE_SELECTOR =
  'input, textarea, select, [contenteditable="true"], [contenteditable=""]';

function isHostVisible(host: Element): boolean {
  return typeof host.checkVisibility === "function" ? host.checkVisibility() : true;
}

export function useMeetingsPageEscape({
  onClose,
  hostSelector,
}: {
  onClose: (() => void) | undefined;
  hostSelector: string;
}): void {
  useEffect(() => {
    if (!onClose) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      const host =
        typeof document === "undefined"
          ? null
          : document.querySelector(hostSelector);
      if (host && !isHostVisible(host)) return;
      const target = event.target;
      if (
        target instanceof Element &&
        (target.matches(OVERLAY_OWNERS_ESCAPE_SELECTOR) ||
          target.closest(OVERLAY_OWNERS_ESCAPE_SELECTOR))
      ) {
        return;
      }
      if (
        target instanceof Element &&
        (target.matches(INPUT_OWNERS_ESCAPE_SELECTOR) ||
          target.closest(INPUT_OWNERS_ESCAPE_SELECTOR))
      ) {
        return;
      }
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [hostSelector, onClose]);
}
