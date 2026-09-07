import { createElement } from "react";
import type { ReactNode } from "react";
import type { MentuBridge } from "../../../../shared/mentu-contract";
import type { Workspace } from "../../../../shared/session-contract";
import { MentuPanel } from "./MentuPanel";

// PanelDescriptor factory for the Mentu tab, mirroring
// automations-panel-descriptor.ts's shape: the descriptor carries only the
// bridge; the live workspace flows in through the host mount props at
// render time.

export type MentuPanelHostProps = {
  session: unknown;
  workspace: Workspace;
  status: {
    hostId: string;
    serviceInstanceId: string;
    protocol: 1;
    capabilities: string[];
    version: string;
  };
};

export type MentuPanelDescriptorInput = {
  routeId: string;
  title: string;
  bridge: MentuBridge;
  capability?: string;
};

export type MentuPanelDescriptor = {
  id: string;
  title: string;
  component: (hostProps: MentuPanelHostProps) => ReactNode;
  capability?: string;
};

export function createMentuPanelDescriptor(
  input: MentuPanelDescriptorInput,
): MentuPanelDescriptor {
  if (!input.routeId || !input.routeId.trim()) {
    throw new Error("route id must be non-empty");
  }
  const component = (hostProps: MentuPanelHostProps): ReactNode =>
    createElement(MentuPanel, {
      bridge: input.bridge,
      workspaceId: hostProps.workspace.id,
      variant: "tab",
    });
  const descriptor: MentuPanelDescriptor = {
    id: input.routeId,
    title: input.title,
    component,
  };
  if (input.capability !== undefined) descriptor.capability = input.capability;
  return descriptor;
}
