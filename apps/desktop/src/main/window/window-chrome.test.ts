// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/main/window/createMainWindow.test.ts (window chrome per platform)
// Pure option builder: no Electron boot, no platform override needed.
import { describe, expect, it } from "vitest";
import {
  buildMainWindowChromeOptions,
  TITLEBAR_CSS_CENTER,
  TRAFFIC_LIGHT_RADIUS,
  TRAFFIC_LIGHT_X,
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
