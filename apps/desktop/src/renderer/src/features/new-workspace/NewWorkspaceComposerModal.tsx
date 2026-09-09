/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/NewWorkspaceComposerModal.tsx (adapter: this
   repo's Project/Worktree RPC contract and harness list drive the card; the
   add-project affordance closes the composer and opens the add dialog
   instead of layering the fork's hosted AddRepoDialog, and the agent
   settings gear navigates to Settings → Agents instead of opening the
   fork's nested AgentSettingsDialog — Drogon has neither dialog. The
   fork's Quick Session footer button maps to the daemon-owned scratch
   project RPC instead of a folder project's primary action). */
import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import type {
  Harness,
  HarnessId,
  HarnessLaunchInput,
  Workspace,
} from "../../../../shared/session-contract";
import type { HarnessAgentDefault } from "../../settings-store";
import type { ProjectGroup } from "../shell/project-adapter";
import { NewWorkspaceComposer } from "./NewWorkspaceComposer";
import {
  composerPrimaryActionLabel,
  initialComposerProjectId,
  type ComposerAgentSelection,
} from "./composer-submit";
import {
  getWorkspaceComposerInitialFocusTarget,
  isScreenSubmitShortcut,
  shouldAllowComposerEnterSubmitTarget,
} from "./composer-submit-shortcut";

/**
 * New-workspace composer modal: the fork's quick-create surface. Opens from
 * Landing, Cmd+N, the palette and the Projects header "+"; a per-project "+"
 * preselects that project. The title follows the selected project kind —
 * "Create worktree" for git, "Create workspace" for a folder. Escape or the
 * close button dismisses without creating anything; Cmd/Ctrl+Enter submits.
 */
export function NewWorkspaceComposerModal({
  groups,
  workspaces,
  initialProjectId,
  disabled,
  harnesses,
  defaultHarnessId,
  harnessDefaults,
  onSubmitWorktree,
  onLaunchAgent,
  onCreateQuickSession,
  onSelectWorkspace,
  onAddProject,
  onOpenAgentSettings,
  onSetDefaultAgent,
  onClose,
}: {
  groups: ProjectGroup[];
  workspaces: Workspace[];
  initialProjectId: string | null;
  disabled: boolean;
  /** Listed harnesses for the composer's Agent combobox. */
  harnesses: Harness[];
  defaultHarnessId: string;
  /** Stored per-harness defaults driving the chained agent launch. */
  harnessDefaults: Record<string, HarnessAgentDefault>;
  /** Resolves a verbatim daemon error, or null on success (then closes). */
  onSubmitWorktree: (input: {
    projectId: string;
    name: string;
    baseRef?: string;
    branch?: string;
    note?: string;
    parentWorktreeId?: string;
    sparse?: string[];
    setupScript?: string;
    waitForSetup?: boolean;
    agent: ComposerAgentSelection;
  }) => Promise<string | null>;
  onCreateQuickSession?: (input: {
    name: string;
    agent: ComposerAgentSelection;
  }) => Promise<string | null>;
  onLaunchAgent: (launch: HarnessLaunchInput) => Promise<string | null>;
  onSelectWorkspace: (workspaceId: string) => void;
  /** Closes the composer and opens the add-project dialog. */
  onAddProject: () => void;
  /** Closes the composer and opens Settings → Agents. */
  onOpenAgentSettings: () => void;
  /** Persists the default agent ("blank" clears the preference). */
  onSetDefaultAgent: (next: HarnessId | "blank") => void;
  onClose: () => void;
}) {
  const [projectId, setProjectId] = useState<string | null>(() =>
    initialComposerProjectId(groups, initialProjectId),
  );
  // #355 fork parity (the fork's initial-project-group effect): the modal
  // can mount before the project view answers (a fresh-boot Landing →
  // Create workspace) with an initialProjectId whose group has not landed
  // yet — adopt it when the group arrives instead of leaving the combobox
  // empty until the user re-picks. Deliberately scoped to the explicit
  // preselect: opening without one does not auto-pick (composer default).
  const initialProjectAppliedRef = useRef(false);
  useEffect(() => {
    if (initialProjectAppliedRef.current || initialProjectId === null) return;
    if (!groups.some((group) => group.project.id === initialProjectId)) return;
    initialProjectAppliedRef.current = true;
    setProjectId(initialProjectId);
  }, [groups, initialProjectId]);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  // The card owns submit/createDisabled; the modal's Cmd/Ctrl+Enter chord
  // reads them through this handle (the fork keeps both in one hook).
  const submitHandleRef = useRef<{
    submit: () => void;
    createDisabled: boolean;
  } | null>(null);
  const selected =
    groups.find((group) => group.project.id === projectId)?.project ?? null;
  const primaryActionLabel = composerPrimaryActionLabel(selected);

  // Cmd/Ctrl+Enter submits. Escape belongs to the dialog's dismissable layer:
  // the page-style "blur the focused field first" rule assumes the user chose
  // that field, but this dialog auto-focuses the name input on open, so handling
  // Escape here swallowed every first press and left the composer stuck open.
  // Radix also closes only the topmost layer, so nested popovers/selects/dialogs
  // keep their own Escape without needing a guard here.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Why: workspace creation is screen-local submit behavior, not a
      // user-configurable app command.
      if (!isScreenSubmitShortcut(event)) {
        return;
      }
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      if (!shouldAllowComposerEnterSubmitTarget(target, composerRef.current)) {
        return;
      }
      const handle = submitHandleRef.current;
      if (!handle || handle.createDisabled) {
        return;
      }
      event.preventDefault();
      handle.submit();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden sm:max-w-lg"
        onOpenAutoFocus={(event) => {
          // Why: Radix's FocusScope fires this once the dialog has mounted.
          // preventDefault stops it from focusing whatever first-tabbable it
          // picks (close button), and we instead focus the name/source field
          // so users can start typing immediately.
          event.preventDefault();
          const content = event.currentTarget as HTMLElement;
          getWorkspaceComposerInitialFocusTarget(content)?.focus({
            preventScroll: true,
          });
        }}
      >
        <DialogHeader className="gap-1">
          <DialogTitle className="text-base font-semibold">
            {primaryActionLabel}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Choose the project, workspace name, and agent before creating the
            workspace.
          </DialogDescription>
        </DialogHeader>
        <NewWorkspaceComposer
          // Why: the scroll container clips children (overflow-y-auto forces
          // overflow-x to auto), while Orca's standard field focus ring paints
          // 3px outside the control and the ghost "Advanced" disclosure pulls
          // its padded hover highlight ~8px left to align its label with the
          // field labels. Inset px-2 so both stay fully visible instead of
          // clipped at the edge.
          containerClassName="min-h-0 flex-1 overflow-y-auto px-2 scrollbar-sleek"
          groups={groups}
          workspaces={workspaces}
          projectId={projectId}
          disabled={disabled}
          nameInputRef={nameInputRef}
          composerRef={composerRef}
          harnesses={harnesses}
          defaultHarnessId={defaultHarnessId}
          harnessDefaults={harnessDefaults}
          onProjectChange={setProjectId}
          onSubmitWorktree={onSubmitWorktree}
          onLaunchAgent={onLaunchAgent}
          onCreateQuickSession={onCreateQuickSession}
          onSelectWorkspace={onSelectWorkspace}
          onAddProject={onAddProject}
          onOpenAgentSettings={onOpenAgentSettings}
          onSetDefaultAgent={onSetDefaultAgent}
          onClose={onClose}
          submitHandleRef={submitHandleRef}
        />
      </DialogContent>
    </Dialog>
  );
}
