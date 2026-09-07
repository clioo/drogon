import { createElement } from "react";
import type { PanelProps } from "../../route-panel-contract";
import type { BrowserBridge } from "./browser-bridge";
import { BrowserPanel } from "./browser-panel";

export const BROWSER_PANEL_ID = "browser";
export const BROWSER_PANEL_TITLE = "Browser";

/**
 * Descriptor factory for the Browser panel: builds the descriptor from the
 * caller-supplied bridge only and registers/mounts nothing. The workspace
 * arrives via PanelProps at mount time.
 */
export function createBrowserPanelDescriptor(input: {
  bridge: BrowserBridge;
}): {
  id: string;
  title: string;
  component: (props: PanelProps) => React.ReactNode;
} {
  const { bridge } = input;
  return {
    id: BROWSER_PANEL_ID,
    title: BROWSER_PANEL_TITLE,
    component: (props: PanelProps) =>
      createElement(BrowserPanel, {
        bridge,
        workspaceId: props.workspace.id,
      }),
  };
}
