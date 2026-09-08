// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/main/window/createMainWindow.test.ts (window chrome per platform)
// Pure option builder: no Electron boot, no platform override needed.
import { describe, expect, it, vi } from "vitest";
import {
  buildMainWindowChromeOptions,
  syncTrafficLightPosition,
  TITLEBAR_CSS_CENTER,
  trafficLightPositionForZoomFactor,
  TRAFFIC_LIGHT_RADIUS,
  TRAFFIC_LIGHT_X,
  zoomLevelToFactor,
} from "./window-chrome";

describe("buildMainWindowChromeOptions", () => {
  it("uses hiddenInset with inline traffic lights on macOS", () => {
    const options = buildMainWindowChromeOptions("darwin");
    expect(options.titleBarStyle).toBe("hiddenInset");
    expect(options.trafficLightPosition).toEqual({
      x: TRAFFIC_LIGHT_X,
      y: TITLEBAR_CSS_CENTER - TRAFFIC_LIGHT_RADIUS,
    });
    expect(options.frame).toBeUndefined();
  });

  it("uses hidden without a traffic-light position on Windows", () => {
    const options = buildMainWindowChromeOptions("win32");
    expect(options.titleBarStyle).toBe("hidden");
    expect(options.trafficLightPosition).toBeUndefined();
    expect(options.frame).toBeUndefined();
  });

  it("drops the native frame on Linux", () => {
    const options = buildMainWindowChromeOptions("linux");
    expect(options.frame).toBe(false);
    expect(options.trafficLightPosition).toBeUndefined();
  });

  it("pins the fork traffic-light offsets", () => {
    expect(TRAFFIC_LIGHT_X).toBe(16);
    expect(TITLEBAR_CSS_CENTER).toBe(18);
    expect(TRAFFIC_LIGHT_RADIUS).toBe(6);
  });
});

describe("traffic-light zoom sync (fork syncTrafficLightPosition)", () => {
  it("sits at y=12 for the default 1x zoom", () => {
    expect(trafficLightPositionForZoomFactor(1)).toEqual({ x: 16, y: 12 });
    expect(trafficLightPositionForZoomFactor(zoomLevelToFactor(0))).toEqual({
      x: 16,
      y: 12,
    });
  });

  it("scales the center with the fork's 1.2**level factor", () => {
    expect(zoomLevelToFactor(1)).toBeCloseTo(1.2, 10);
    expect(trafficLightPositionForZoomFactor(zoomLevelToFactor(1))).toEqual({
      x: 16,
      y: Math.round(18 * 1.2 - 6),
    });
  });

  it("repositions a live darwin window and ignores other platforms", () => {
    const window = {
      isDestroyed: () => false,
      setWindowButtonPosition: vi.fn(),
    };
    syncTrafficLightPosition(window, 1, "darwin");
    expect(window.setWindowButtonPosition).toHaveBeenCalledWith({ x: 16, y: 12 });

    window.setWindowButtonPosition.mockClear();
    syncTrafficLightPosition(window, 1, "linux");
    expect(window.setWindowButtonPosition).not.toHaveBeenCalled();
  });

  it("never touches a destroyed window", () => {
    const window = {
      isDestroyed: () => true,
      setWindowButtonPosition: vi.fn(),
    };
    syncTrafficLightPosition(window, 1, "darwin");
    expect(window.setWindowButtonPosition).not.toHaveBeenCalled();
  });
});
