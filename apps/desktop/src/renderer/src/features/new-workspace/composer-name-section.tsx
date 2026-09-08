/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/new-workspace/NewWorkspaceComposerNameSection.tsx
   with the plain-input rendering of smart-workspace-name-input-surface.tsx
   (adapter: the source's SmartWorkspaceNameField smart-source tabs — GitHub,
   GitLab, Linear, Jira, Branch — are not ported because Drogon has none of
   those source backends; the field renders the source's plain name input
   chrome; the label and placeholder are explicit because this repo's
   worktree contract creates a new branch and exposes an existing branch
   through Advanced → Base ref. The fork's "Reuse branch" row is omitted:
   it only renders when a smart branch source is selected, which cannot
   happen here). */
import React from "react";
import { CaseSensitive, Search } from "lucide-react";
import { Input } from "../../components/ui/input";

type NewWorkspaceComposerNameSectionProps = {
  nameInputRef: React.RefObject<HTMLInputElement | null>;
  name: string;
  onNameValueChange: (value: string) => void;
  selectedRepoIsGit: boolean;
  onNamePlainEnter: () => void;
};

export function NewWorkspaceComposerNameSection({
  nameInputRef,
  name,
  onNameValueChange,
  selectedRepoIsGit,
  onNamePlainEnter,
}: NewWorkspaceComposerNameSectionProps): React.JSX.Element {
  // The source's ActiveInputIcon: Search in Smart mode (git projects),
  // CaseSensitive in plain text mode (folder projects).
  const ModeIcon = selectedRepoIsGit ? Search : CaseSensitive;
  return (
    <div className="min-w-0 space-y-1" data-contextual-tour-target="workspace-creation-name">
      <label className="block min-w-0 truncate text-xs font-medium text-muted-foreground">
        {selectedRepoIsGit ? "New branch name" : "Workspace name"}{" "}
        <span className="text-muted-foreground/70">[Optional]</span>
      </label>
      <div className="relative min-w-0">
        <ModeIcon
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          ref={nameInputRef}
          data-workspace-name-input="true"
          value={name}
          onChange={(event) => onNameValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key !== "Enter" ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey ||
              event.nativeEvent.isComposing
            ) {
              return;
            }
            event.preventDefault();
            onNamePlainEnter();
          }}
          placeholder={
            selectedRepoIsGit ? "e.g. feature/my-worktree" : "Workspace name"
          }
          // Why: match adjacent comboboxes' solid background in light mode.
          className="h-9 bg-background pl-8 text-sm"
        />
      </div>
      {selectedRepoIsGit ? (
        <p className="text-[11px] text-muted-foreground">
          To start from an existing branch, enter it in Advanced → Base ref.
        </p>
      ) : null}
    </div>
  );
}
