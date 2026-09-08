// MIT Copyright (c) 2026 Lovecast Inc.
// Ported sections from the Orca reference (read-only):
//   src/renderer/src/components/settings/GeneralWorkspaceSettingsSection.tsx
//     (Workspace subsection; the "Ask Before Deleting Workspaces" and "Ask
//      Before Deleting Automations" switches with their stable
//      general-skip-delete-*-confirm wrapper ids and verbatim copy)
//   src/renderer/src/components/settings/GeneralPane.tsx
//     (the CLI section renders inside General, between Editor and Updates;
//      this repo's ./cli-section keeps its honest read-only probe)
//   src/renderer/src/components/settings/GeneralSupportSection.tsx
//     ("Support Drogon" subsection with the star row)
// Adapted: no zustand store — the switches read/write the live preference
// seams their dialogs already share (DeleteWorktreeSkipConfirmOption and
// AutomationDeleteDialogs helpers), so Settings and the dialogs can never
// diverge; the star button opens the repo URL through the shell bridge
// (this repo has no gh-star IPC). Rows the MVP cannot back (workspace
// directory, external worktrees, nesting, Open in apps, tab order, pinned
// confirm, autosave, diff/editor display, updates, WSL runtime) are
// omitted, never dead switches.
import { useState } from "react";
import { Star } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  openRepoUrl,
  windowShellOpenExternal,
} from "../landing/github-star";
import {
  setConfirmAutomationDelete,
  shouldConfirmAutomationDelete,
} from "../automations/AutomationDeleteDialogs";
import {
  readSkipDeleteWorktreeConfirm,
  writeSkipDeleteWorktreeConfirm,
} from "../shell/DeleteWorktreeSkipConfirmOption";
import { CliSection } from "./cli-section";
import {
  SettingsRow,
  SettingsSection,
  SettingsSubsectionHeader,
  SettingsSwitchRow,
} from "./settings-rows";

function readAskBeforeDeleteWorkspaces(): boolean {
  try {
    if (typeof localStorage === "undefined") return true;
    return !readSkipDeleteWorktreeConfirm(localStorage);
  } catch {
    return true;
  }
}

function writeAskBeforeDeleteWorkspaces(ask: boolean): void {
  try {
    if (typeof localStorage === "undefined") return;
    writeSkipDeleteWorktreeConfirm(!ask, localStorage);
  } catch {
    // Best-effort preference write; the dialog still works per-open.
  }
}

function openDrogonRepo(): void {
  try {
    if (typeof window === "undefined") return;
    void openRepoUrl(windowShellOpenExternal(window.drogon));
  } catch {
    // Best-effort external open; staying on the page is the fallback.
  }
}

export function GeneralSection(): React.JSX.Element {
  const [askBeforeDeleteWorkspaces, setAskBeforeDeleteWorkspaces] =
    useState(readAskBeforeDeleteWorkspaces);
  const [askBeforeDeleteAutomations, setAskBeforeDeleteAutomations] =
    useState(shouldConfirmAutomationDelete);

  return (
    <SettingsSection
      id="general"
      title="General"
      description="Workspace defaults, app setup, and maintenance."
    >
      <div className="divide-y divide-border/40">
        <div className="space-y-2 pb-4">
          <SettingsSubsectionHeader
            title="Workspace"
            description="Configure where new workspaces are created."
          />
          <div
            id="general-skip-delete-worktree-confirm"
            className="scroll-mt-6"
          >
            <SettingsSwitchRow
              label="Ask Before Deleting Workspaces"
              description="Show a confirmation before deleting a workspace from the context menu. Failed deletes still surface a Force Delete fallback."
              checked={askBeforeDeleteWorkspaces}
              onChange={(next) => {
                setAskBeforeDeleteWorkspaces(next);
                writeAskBeforeDeleteWorkspaces(next);
              }}
            />
          </div>
          <div
            id="general-skip-delete-automation-confirm"
            className="scroll-mt-6"
          >
            <SettingsSwitchRow
              label="Ask Before Deleting Automations"
              description="Show a confirmation before deleting automations and their run history."
              checked={askBeforeDeleteAutomations}
              onChange={(next) => {
                setAskBeforeDeleteAutomations(next);
                setConfirmAutomationDelete(next);
              }}
            />
          </div>
        </div>
        <div className="space-y-2 py-4">
          <CliSection />
        </div>
        <div className="space-y-2 pt-4">
          <SettingsSubsectionHeader title="Support Drogon" />
          <SettingsRow
            label="Star Drogon on GitHub"
            control={
              <Button
                variant="default"
                size="sm"
                onClick={openDrogonRepo}
                className="shrink-0 gap-1.5"
              >
                <Star className="size-3.5 fill-amber-400 text-amber-400" />
                Star
              </Button>
            }
          />
        </div>
      </div>
    </SettingsSection>
  );
}
