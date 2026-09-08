// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/main/window/createMainWindow.ts (titleBarStyle per platform,
//     Linux frame:false, darwin trafficLightPosition)
//   src/main/window/main-window-visual-lifecycle.ts (TITLEBAR_CSS_CENTER,
//     TRAFFIC_LIGHT_RADIUS, TRAFFIC_LIGHT_X)
// Pure per-platform BrowserWindow chrome options so the frameless/windowed
// choice stays unit-testable without booting Electron.
import type { BrowserWindowConstructorOptions } from "electron";

// Why: titlebar content center sits ~18 CSS px from top (x zoom); traffic
// lights are ~12px tall, so top edge = center - 6.
export const TITLEBAR_CSS_CENTER = 18;
export const TRAFFIC_LIGHT_RADIUS = 6;
export const TRAFFIC_LIGHT_X = 16;

/**
 * Window chrome options matching the fork's createMainWindow: macOS
 * hiddenInset keeps the native traffic lights inside our custom titlebar,
 * Windows hidden removes the OS title bar so it doesn't double up, Linux
 * drops the native frame (it ignores titleBarStyle hidden) so the renderer
 * draws its own. No other window behavior lives here.
 */
export function buildMainWindowChromeOptions(
  platform: NodeJS.Platform,
): BrowserWindowConstructorOptions {
  return {
    // Why: macOS 'hiddenInset' keeps native traffic lights in our custom
    // titlebar; Windows 'hidden' removes the OS title bar so it doesn't
    // double up.
    titleBarStyle:
      platform === "darwin"
        ? "hiddenInset"
        : platform === "win32"
          ? "hidden"
          : undefined,
    // Why: Linux ignores titleBarStyle 'hidden'; frame:false drops the
    // native frame so we don't get a double title bar (renderer draws
    // its own).
    ...(platform === "linux" ? { frame: false } : {}),
    // Why: initial position for 1x zoom; syncTrafficLightPosition() adjusts
    // on zoom change.
    ...(platform === "darwin"
      ? {
          trafficLightPosition: {
            x: TRAFFIC_LIGHT_X,
            y: TITLEBAR_CSS_CENTER - TRAFFIC_LIGHT_RADIUS,
          },
        }
      : {}),
  };
}
