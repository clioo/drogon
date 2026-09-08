// @vitest-environment jsdom
// Narrow-width status-bar tiers (#209): fork thresholds and per-segment
// collapse decisions at full, compact and icon-only widths.
import { describe, expect, test, vi } from "vitest";
import {
  observeStatusBarContainer,
  STATUS_BAR_COMPACT_BELOW_WIDTH,
  STATUS_BAR_ICON_ONLY_BELOW_WIDTH,
  statusBarCollapseForWidth,
  statusBarDensityForWidth,
} from "./status-bar-narrow";

describe("status bar density tiers", () => {
  test("fork thresholds: compact below 900, icon-only below 500", () => {
    expect(STATUS_BAR_COMPACT_BELOW_WIDTH).toBe(900);
    expect(STATUS_BAR_ICON_ONLY_BELOW_WIDTH).toBe(500);
    expect(statusBarDensityForWidth(1440)).toBe("full");
    expect(statusBarDensityForWidth(900)).toBe("full");
    expect(statusBarDensityForWidth(899)).toBe("compact");
    expect(statusBarDensityForWidth(760)).toBe("compact");
    expect(statusBarDensityForWidth(500)).toBe("compact");
    expect(statusBarDensityForWidth(499)).toBe("icon-only");
  });

  test("full width keeps every label and minibar", () => {
    expect(statusBarCollapseForWidth(1440)).toEqual({
      density: "full",
      compact: false,
      iconOnly: false,
      showProviderMiniBars: true,
      showAllProviderWindows: true,
      showProviderLabels: true,
      showDaemonLabel: true,
      showAwakeLabel: true,
      showMemoryLabel: true,
    });
  });

  test("760px compacts: no minibars, daemon collapses to icon + dot", () => {
    const collapse = statusBarCollapseForWidth(760);
    expect(collapse.density).toBe("compact");
    expect(collapse.compact).toBe(true);
    expect(collapse.iconOnly).toBe(false);
    expect(collapse.showProviderMiniBars).toBe(false);
    expect(collapse.showAllProviderWindows).toBe(false);
    expect(collapse.showDaemonLabel).toBe(false);
    // Text labels survive compact; only icons go below 500.
    expect(collapse.showProviderLabels).toBe(true);
    expect(collapse.showAwakeLabel).toBe(true);
    expect(collapse.showMemoryLabel).toBe(true);
  });

  test("icon-only hides every text label", () => {
    const collapse = statusBarCollapseForWidth(499);
    expect(collapse.density).toBe("icon-only");
    expect(collapse.showProviderMiniBars).toBe(false);
    expect(collapse.showProviderLabels).toBe(false);
    expect(collapse.showDaemonLabel).toBe(false);
    expect(collapse.showAwakeLabel).toBe(false);
    expect(collapse.showMemoryLabel).toBe(false);
  });
});

describe("status bar container observer", () => {
  test("forwards content width changes and observes the node", () => {
    const seen: {
      widths: number[];
      observed: Element | null;
      callback:
        ((entries: { contentRect: { width: number } }[]) => void) | null;
    } = { widths: [], observed: null, callback: null };
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(
          cb: (entries: { contentRect: { width: number } }[]) => void,
        ) {
          seen.callback = cb;
        }
        observe(node: Element): void {
          seen.observed = node;
        }
        disconnect(): void {}
        unobserve(): void {}
      },
    );
    try {
      const node = document.createElement("footer");
      const observer = observeStatusBarContainer(node, (width) =>
        seen.widths.push(width),
      );
      expect(seen.observed).toBe(node);
      expect(seen.callback).not.toBeNull();
      seen.callback?.([{ contentRect: { width: 760 } }]);
      expect(seen.widths).toEqual([760]);
      expect(observer).not.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
