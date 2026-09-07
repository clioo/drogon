// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/right-sidebar/source-control/commit/commit-area.tsx.
// Adapter: the MVP action surface is Commit / Commit & Push / amend-last
// (via the chevron menu); AI generation, hosted-review composers and
// failure-recovery launches have no MVP backend and are not ported.
import React from "react";
import { CommitActionMenu, type CommitDropdownEntry, type CommitPrimaryAction } from "./commit-action-menu";
import { CommitMessageComposer } from "./commit-message-composer";
import { CommitNotices, type CommitNoticeTone } from "./commit-notices";
import { getCommitMessageTextareaRows } from "./commit-message-rows";

export type CommitAreaProps = {
  commitMessage: string;
  commitError: string | null;
  remoteActionError: string | null;
  prNotice: { message: string; tone: CommitNoticeTone } | null;
  prUrl: string | null;
  isCommitting: boolean;
  /** Commit & Push / amend chevron is busy (push or amend running). */
  isSecondaryBusy: boolean;
  showComposer?: boolean;
  stagedCount: number;
  hasPartiallyStagedChanges: boolean;
  isBusy: boolean;
  amend: boolean;
  canAmend: boolean;
  onCommitMessageChange: (message: string) => void;
  onCommit: () => void;
  onCommitAndPush: () => void;
  onToggleAmend: () => void;
};

export function CommitArea({
  commitMessage,
  commitError,
  remoteActionError,
  prNotice,
  prUrl,
  isCommitting,
  isSecondaryBusy,
  showComposer = true,
  stagedCount,
  hasPartiallyStagedChanges,
  isBusy,
  amend,
  canAmend,
  onCommitMessageChange,
  onCommit,
  onCommitAndPush,
  onToggleAmend,
}: CommitAreaProps): React.JSX.Element {
  // Why: cap at 12 rows so a pasted multi-page message doesn't push the Commit button off-screen (textarea scrolls internally past that).
  const rows = getCommitMessageTextareaRows(commitMessage);
  const hasMessage = commitMessage.trim().length > 0;
  // Amending needs no staged rows (it can also just rewrite the message);
  // partially-staged files only warn via the row badges, they never block.
  void hasPartiallyStagedChanges;
  const commitDisabled = isBusy || !hasMessage || (stagedCount === 0 && !amend);
  const primaryAction: CommitPrimaryAction = {
    kind: amend ? "amend" : "commit",
    label: isCommitting ? "Committing…" : amend ? "Amend" : "Commit",
    title: amend
      ? "Amend the previous commit with the staged changes"
      : stagedCount === 0
        ? "Stage changes and write a message to commit"
        : "Commit staged changes",
    disabled: commitDisabled,
  };
  const dropdownItems: CommitDropdownEntry[] = [
    {
      kind: "commit-push",
      id: "commit-push",
      label: "Commit & Push",
      hint: hasMessage ? undefined : "Write a message first",
      title: "Commit staged changes and push upstream",
      disabled: isBusy || !hasMessage || stagedCount === 0,
    },
    { kind: "separator", id: "sep-amend" },
    {
      kind: "amend",
      id: "amend",
      label: amend ? "✓ Amend last commit" : "Amend last commit",
      title: canAmend
        ? "Fold staged changes into the previous commit"
        : "No previous commit to amend",
      disabled: !canAmend || isBusy,
    },
  ];
  const describedBy = [
    commitError ? "commit-area-error" : null,
    remoteActionError ? "commit-area-remote-error" : null,
    prNotice ? "commit-area-create-pr-intent" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="px-3 pb-2">
      {showComposer ? (
        <CommitMessageComposer
          rows={rows}
          commitMessage={commitMessage}
          disabled={isBusy}
          onCommitMessageChange={onCommitMessageChange}
          describedBy={describedBy}
        />
      ) : null}
      <CommitActionMenu
        showComposer={showComposer}
        primaryAction={primaryAction}
        showSpinner={isCommitting}
        showChevronSpinner={isSecondaryBusy && !isCommitting}
        dropdownItems={dropdownItems}
        onPrimaryAction={onCommit}
        onDropdownAction={(kind) => {
          if (kind === "commit-push") onCommitAndPush();
          else if (kind === "amend") onToggleAmend();
        }}
      />
      <CommitNotices
        commitError={commitError}
        remoteActionError={remoteActionError}
        prNotice={prNotice}
        prUrl={prUrl}
      />
    </div>
  );
}

