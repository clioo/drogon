/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/tab-bar/tab-strip-overflow-navigation.ts
   (step size, vertical-wheel remap) and
   src/renderer/src/components/tab-bar/tab-strip-scroll-metrics.ts
   (overflow metrics). Adapter: metrics trimmed to the chevron state the
   strip renders; the scroll indicator thumb is out of scope. */

export type TabStripOverflowState = {
  hasOverflow: boolean;
  canScrollStart: boolean;
  canScrollEnd: boolean;
};

const OVERFLOW_EPSILON_PX = 1;
const TAB_STRIP_SCROLL_FRACTION = 0.75;
const TAB_STRIP_MIN_SCROLL_STEP_PX = 120;

export function computeTabStripOverflow(
  el: Pick<HTMLElement, "scrollWidth" | "clientWidth" | "scrollLeft">,
): TabStripOverflowState {
  const maxScrollLeft = Math.max(0, el.scrollWidth - el.clientWidth);
  const hasOverflow = maxScrollLeft > OVERFLOW_EPSILON_PX;
  return {
    hasOverflow,
    canScrollStart: hasOverflow && el.scrollLeft > OVERFLOW_EPSILON_PX,
    canScrollEnd:
      hasOverflow && el.scrollLeft < maxScrollLeft - OVERFLOW_EPSILON_PX,
  };
}

export function tabStripFadeClass(
  state: Pick<
    TabStripOverflowState,
    "hasOverflow" | "canScrollStart" | "canScrollEnd"
  >,
): string {
  if (!state.hasOverflow) return "";
  const classes: string[] = [];
  if (state.canScrollStart) classes.push("terminal-tab-strip--fade-start");
  if (state.canScrollEnd) classes.push("terminal-tab-strip--fade-end");
  return classes.join(" ");
}

export function scrollTabStripByStep(
  el: HTMLElement,
  direction: "start" | "end",
  behavior: ScrollBehavior = "smooth",
): void {
  const step = Math.max(
    TAB_STRIP_MIN_SCROLL_STEP_PX,
    el.clientWidth * TAB_STRIP_SCROLL_FRACTION,
  );
  el.scrollBy({ left: direction === "start" ? -step : step, behavior });
}
