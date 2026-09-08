// Automations page entry: thin wrapper over the local-automation page
// surface (features/automations, journey J7). The reference ships the
// Automations experience as a page, not a workspace panel, so the legacy
// table/form/history markup now lives in AutomationsPageSurface and this
// module only forwards the bridge and loaders.
import type { AutomationBridge } from "../../../../shared/automation-contract";
import type {
  Harness,
  Result,
  Status,
  Workspace,
} from "../../../../shared/session-contract";
import { AutomationsPageSurface } from "./AutomationsPageSurface";

export type AutomationsPanelProps = {
  bridge: AutomationBridge;
  workspace: Workspace;
  status: Status;
  listWorkspaces: () => Promise<Result<{ workspaces: Workspace[] }>>;
  listHarnesses: () => Promise<
    Result<{ hostId: string; harnesses: Harness[] }>
  >;
  /** Top-level Escape closes the page (fork closeAutomationsPage). */
  onClose?: () => void;
};

export function AutomationsPanel({
  bridge,
  workspace,
  status,
  listWorkspaces,
  onClose,
}: AutomationsPanelProps) {
  return (
    <AutomationsPageSurface
      bridge={bridge}
      workspace={workspace}
      status={status}
      listWorkspaces={listWorkspaces}
      onClose={onClose}
    />
  );
}
