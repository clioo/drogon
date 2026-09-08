/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/new-workspace/NewWorkspaceComposerAdvancedSection.tsx.
   Adapter: branch/note/parent/setup/sparse values feed Drogon's additive
   worktree/project RPCs; the existing Drogon Base ref remains as an extra
   git-only field because the earlier MVP has no fork smart-source picker. */
import React from "react";
import { cn } from "../../lib/utils";
import type { SparsePresetResult } from "../../../../shared/project-contract";
import type { Worktree } from "../../../../shared/session-contract";
import { Switch } from "../../components/ui/switch";
import { ComposerParentWorktreePicker } from "./composer-parent-worktree-picker";
import { ComposerSparseCheckout } from "./composer-sparse-checkout";

const ADVANCED_INPUT_CLASS =
  "w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function NewWorkspaceComposerAdvancedSection({
  advancedOpen,
  selectedRepoIsGit,
  baseRefInputId,
  baseRef,
  onBaseRefChange,
  defaultBaseRef,
  branchName,
  branchNameInputId,
  onBranchNameChange,
  parentWorktrees,
  parentWorktreeId,
  onParentWorktreeChange,
  note,
  onNoteChange,
  setupScript,
  runSetup,
  onRunSetupChange,
  waitForSetup,
  onWaitForSetupChange,
  sparsePresets,
  selectedSparsePresetId,
  onSparseSelectPreset,
  onSaveSparsePreset,
}: {
  advancedOpen: boolean;
  selectedRepoIsGit: boolean;
  baseRefInputId: string;
  baseRef: string;
  onBaseRefChange: (value: string) => void;
  defaultBaseRef: string | null;
  branchName: string;
  branchNameInputId: string;
  onBranchNameChange: (value: string) => void;
  parentWorktrees: readonly Worktree[];
  parentWorktreeId: string | null;
  onParentWorktreeChange: (id: string | null) => void;
  note: string;
  onNoteChange: (value: string) => void;
  setupScript: string | null;
  runSetup: boolean;
  onRunSetupChange: (value: boolean) => void;
  waitForSetup: boolean;
  onWaitForSetupChange: (value: boolean) => void;
  sparsePresets: readonly SparsePresetResult[];
  selectedSparsePresetId: string | null;
  onSparseSelectPreset: (preset: SparsePresetResult | null) => void;
  onSaveSparsePreset: (input: {
    id?: string;
    name: string;
    directories: string[];
  }) => Promise<SparsePresetResult | null>;
}): React.JSX.Element {
  const hasSetup = selectedRepoIsGit && Boolean(setupScript?.trim());
  return (
    <div
      className={cn(
        "grid overflow-hidden transition-[grid-template-rows] duration-200 ease-out",
        !advancedOpen && "!mt-2",
        advancedOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
      )}
      aria-hidden={!advancedOpen}
      inert={!advancedOpen}
    >
      <div className="min-h-0">
        <div
          className={cn(
            "space-y-4 px-1 pt-1 pb-3 transition-[opacity,transform] duration-150 ease-out",
            advancedOpen
              ? "translate-y-0 opacity-100 delay-200"
              : "-translate-y-1 opacity-0 delay-0",
          )}
        >
          {selectedRepoIsGit ? (
            <div className="space-y-1">
              <label
                htmlFor={branchNameInputId}
                className="text-xs font-medium text-muted-foreground"
              >
                Branch name
              </label>
              <input
                id={branchNameInputId}
                type="text"
                value={branchName}
                onChange={(event) => onBranchNameChange(event.target.value)}
                placeholder="feature/my-branch"
                className={ADVANCED_INPUT_CLASS}
              />
            </div>
          ) : null}

          {selectedRepoIsGit ? (
            <ComposerParentWorktreePicker
              worktrees={parentWorktrees}
              value={parentWorktreeId}
              onChange={onParentWorktreeChange}
              disabled={!advancedOpen}
            />
          ) : null}

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              Note
            </label>
            <textarea
              value={note}
              onChange={(event) => onNoteChange(event.target.value)}
              aria-label="Note"
              placeholder="Write a note"
              rows={1}
              className={`${ADVANCED_INPUT_CLASS} max-h-40 resize-none overflow-y-auto scrollbar-sleek [field-sizing:content]`}
            />
          </div>

          {hasSetup ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-medium text-muted-foreground">
                  Setup script
                </label>
                <span className="rounded border border-border/50 bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  local settings
                </span>
              </div>
              <div className="rounded-md border border-border/60 bg-muted/40 shadow-inner">
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-[12px] leading-5 text-foreground/90 scrollbar-sleek">
                  {setupScript}
                </pre>
              </div>
              <div className="rounded-md border border-border/60 bg-muted/25">
                <div className="flex items-center justify-between gap-3 p-3">
                  <span className="text-xs font-medium text-foreground">
                    Run setup command
                  </span>
                  <Switch
                    checked={runSetup}
                    onCheckedChange={onRunSetupChange}
                    aria-label="Run setup command"
                  />
                </div>
                <div className="flex items-start justify-between gap-3 p-3">
                  <span
                    className={cn(
                      "min-w-0 space-y-1",
                      !runSetup && "opacity-50",
                    )}
                  >
                    <span className="block text-xs font-medium text-foreground">
                      Wait for setup to complete before starting agent
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      Turn this on when setup installs dependencies, MCP
                      servers, or config files the agent needs during startup.
                    </span>
                  </span>
                  <Switch
                    checked={waitForSetup}
                    disabled={!runSetup}
                    onCheckedChange={onWaitForSetupChange}
                    aria-label="Wait for setup to complete before starting agent"
                  />
                </div>
              </div>
            </div>
          ) : null}

          {selectedRepoIsGit ? (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Sparse checkout
              </label>
              <ComposerSparseCheckout
                presets={sparsePresets}
                selectedPresetId={selectedSparsePresetId}
                onSelectPreset={onSparseSelectPreset}
                onSavePreset={onSaveSparsePreset}
              />
            </div>
          ) : null}

          {selectedRepoIsGit ? (
            <div className="space-y-1">
              <label
                htmlFor={baseRefInputId}
                className="text-xs font-medium text-muted-foreground"
              >
                Base ref{" "}
                <span className="text-muted-foreground/70">(optional)</span>
              </label>
              <input
                id={baseRefInputId}
                type="text"
                value={baseRef}
                onChange={(event) => onBaseRefChange(event.target.value)}
                placeholder={defaultBaseRef ?? "repo default"}
                className={ADVANCED_INPUT_CLASS}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
