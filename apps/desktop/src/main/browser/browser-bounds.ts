// Pure view-bounds math: clamps the renderer's placeholder rect into the
// window's content area so a stale/oversized rect can never push the guest
// view off-screen.

import type { BrowserBounds } from "../../shared/browser-contract";

export type ContentSize = { width: number; height: number };

/**
 * Returns the integer bounds to apply to the guest view. A zero-area rect
 * (panel hidden or unmounted) maps to null — the caller hides the view.
 * Otherwise the rect is rounded and clamped inside the content size.
 */
export function resolveViewBounds(
  rect: BrowserBounds,
  content: ContentSize,
): BrowserBounds | null {
  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height)
  )
    return null;
  if (rect.width <= 0 || rect.height <= 0) return null;
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  const maxX = Math.max(0, content.width - width);
  const maxY = Math.max(0, content.height - height);
  return {
    x: Math.min(Math.max(0, Math.floor(rect.x)), maxX),
    y: Math.min(Math.max(0, Math.floor(rect.y)), maxY),
    width: Math.min(width, Math.max(1, content.width)),
    height: Math.min(height, Math.max(1, content.height)),
  };
}
