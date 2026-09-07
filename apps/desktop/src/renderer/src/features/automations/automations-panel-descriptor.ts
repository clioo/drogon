import { createElement } from "react";
import type { ReactNode } from "react";
import type { AutomationBridge } from "../../../../shared/automation-contract";
import type {
  Harness,
  Result,
  Workspace,
} from "../../../../shared/session-contract";
import { AutomationsPanel } from "./AutomationsPanel";

// PanelDescriptor factory for the Automations page, mirroring the Files
// factory shape: the descriptor carries only the bridge and loaders; the
// live workspace/status flow in through the host mount props at render
// time, never from registration-time snapshots.

export type AutomationsPanelHostProps = {
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

export type AutomationsPanelDescriptorInput = {
  routeId: string;
  title: string;
  bridge: AutomationBridge;
  listWorkspaces: () => Promise<Result<{ workspaces: Workspace[] }>>;
  listHarnesses: () => Promise<
    Result<{ hostId: string; harnesses: Harness[] }>
  >;
  capability?: string;
  restoreState?: unknown;
  onFocus?: (routeId: string) => void;
  onCleanup?: (routeId: string) => void;
};

export type AutomationsPanelDescriptor = {
  id: string;
  title: string;
  component: (hostProps: AutomationsPanelHostProps) => ReactNode;
  capability?: string;
  restoreState?: unknown;
  onFocus?: (routeId: string) => void;
  onCleanup?: (routeId: string) => void;
};

export function createAutomationsPanelDescriptor(
  input: AutomationsPanelDescriptorInput,
): AutomationsPanelDescriptor {
  if (!input.routeId || !input.routeId.trim()) {
    throw new Error("route id must be non-empty");
  }
  const component = (hostProps: AutomationsPanelHostProps): ReactNode =>
    createElement(AutomationsPanel, {
      bridge: input.bridge,
      workspace: hostProps.workspace,
      status: hostProps.status,
      listWorkspaces: input.listWorkspaces,
      listHarnesses: input.listHarnesses,
    });
  const descriptor: AutomationsPanelDescriptor = {
    id: input.routeId,
    title: input.title,
    component,
  };
  if (input.capability !== undefined) descriptor.capability = input.capability;
  if (input.restoreState !== undefined)
    descriptor.restoreState = input.restoreState;
  if (input.onFocus !== undefined) descriptor.onFocus = input.onFocus;
  if (input.onCleanup !== undefined) descriptor.onCleanup = input.onCleanup;
  return descriptor;
}
