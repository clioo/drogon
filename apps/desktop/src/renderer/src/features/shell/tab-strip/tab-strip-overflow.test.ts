// MIT Copyright (c) 2026 Lovecast Inc.
// Test cases ported from Orca's
// src/renderer/src/components/tab-bar/tab-strip-scroll-metrics.test.ts
// (no-overflow when tabs fit, chevron/edge state at start/middle/end,
// 1px rounding sliver tolerance), adapted to the local overflow model.
import { describe, expect, it } from "vitest";
import {
  computeTabStripOverflow,
  type TabStripOverflowState,
} from "./tab-strip-overflow";

function metrics(
  scrollWidth: number,
  clientWidth: number,
  scrollLeft: number,
): TabStripOverflowState {
  return computeTabStripOverflow({ scrollWidth, clientWidth, scrollLeft });
}

describe("computeTabStripOverflow", () => {
  it("reports no overflow when tabs fit", () => {
    expect(metrics(400, 500, 0)).toEqual({
      hasOverflow: false,
      canScrollStart: false,
      canScrollEnd: false,
    });
  });

  it("reports chevron state at the start, middle and end", () => {
    expect(metrics(1000, 500, 0).canScrollEnd).toBe(true);
    expect(metrics(1000, 500, 0).canScrollStart).toBe(false);
    const middle = metrics(1000, 500, 250);
    expect(middle.hasOverflow).toBe(true);
    expect(middle.canScrollStart).toBe(true);
    expect(middle.canScrollEnd).toBe(true);
    expect(metrics(1000, 500, 500).canScrollEnd).toBe(false);
  });

  it("ignores a 1px rounding sliver", () => {
    expect(metrics(501, 500, 0).hasOverflow).toBe(false);
  });
});
