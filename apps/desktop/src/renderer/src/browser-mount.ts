// Mount adapter for the Browser panel (features/browser, journey J4).
// Binds the real factory through the route-panel-contract boundary,
// mirroring files-mount.ts. Registers nothing on import.

import type { BrowserBridge } from "../../shared/browser-contract";
import {
  BROWSER_PANEL_ID,
  createBrowserPanelDescriptor,
} from "./features/browser/browser-panel-descriptor";
import { windowBrowserBridge } from "./features/browser/browser-bridge";
import { registerRoute, routeId } from "./route-panel-contract";
import type { PanelDescriptor, RouteRegistry } from "./route-panel-contract";

/** Branded route id for the Browser panel. */
export const BROWSER_ROUTE_ID = routeId(BROWSER_PANEL_ID);

export { windowBrowserBridge };

/**
 * The granted `window.drogon.browser.*` namespace, typed without editing
 * the coordinator-owned DesktopBridge. Prefer `windowBrowserBridge()`.
 */
export function browserBridge(): BrowserBridge {
  return windowBrowserBridge();
}

/** Registers the Browser route (local feature: no service capability gate). */
export function registerBrowserRoute(
  registry: RouteRegistry,
  bridge: BrowserBridge,
): RouteRegistry {
  const factory = createBrowserPanelDescriptor({ bridge });
  const descriptor: PanelDescriptor = {
    ...factory,
    id: BROWSER_ROUTE_ID,
  };
  return registerRoute(registry, descriptor);
}
