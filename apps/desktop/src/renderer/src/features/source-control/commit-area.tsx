// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/right-sidebar/source-control/commit/commit-area.tsx.
// Adapter: AI generation, hosted-review composers and failure-recovery
// launches have no MVP backend and are not ported. The chevron menu holds
// the reference dropdown rows (see commit-dropdown-items.ts); the previous
// port's amend toggle does not exist in the reference UI and was removed.
import React from "react";
import { CommitActionMenu, type CommitPrimaryAction } from "./commit-action-menu";
import { buildCommitDropdownItems } from "./commit-dropdown-items";
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
  /** A remote operation (push/pull/fetch) is running. */
  isSecondaryBusy: boolean;
  showComposer?: boolean;
  stagedCount: number;
  hasPartiallyStagedChanges: boolean;
  isBusy: boolean;
  /** Compare state for the dropdown rows and their labels. */
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  /** Create PR row gate, from resolveCreatePrToolbarAction. */
  createPrDisabled: boolean;
  createPrReason: string | null;
  onCommitMessageChange: (message: string) => void;
  onCommit: () => void;
  onCommitAndPush: () => void;
  onCommitAndSync: () => void;
  onPush: () => void;
  /** Fork's "Push before PR": push, then create the PR. */
  onPushBeforePr: () => void;
  /** Fork's "Fast-forward" row — this repo's pull is ff-only. */
  onFastForward: () => void;
  /** Fork's "Sync" row: pull, then push. */
  onSync: () => void;
  onFetch: () => void;
  onCreatePr: () => void;
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
  upstream,
  ahead,
  behind,
  createPrDisabled,
  createPrReason,
  onCommitMessageChange,
  onCommit,
  onCommitAndPush,
  onCommitAndSync,
  onPush,
  onPushBeforePr,
  onFastForward,
  onSync,
  onFetch,
  onCreatePr,
}: CommitAreaProps): React.JSX.Element {
  // Why: cap at 12 rows so a pasted multi-page message doesn't push the Commit button off-screen (textarea scrolls internally past that).
  const rows = getCommitMessageTextareaRows(commitMessage);
  const hasMessage = commitMessage.trim().length > 0;
  // Partially-staged files only warn via the row badges, they never block.
  void hasPartiallyStagedChanges;
  const canCommit = hasMessage && stagedCount > 0;
  const commitDisabled = isBusy || !canCommit;
  const primaryAction: CommitPrimaryAction = {
    kind: "commit",
    label: isCommitting ? "Committing…" : "Commit",
    title:
      stagedCount === 0
        ? "Stage changes and write a message to commit"
        : "Commit staged changes",
    disabled: commitDisabled,
  };
  const dropdownItems = buildCommitDropdownItems({
    hasMessage,
    canCommit,
    commitBusy: isBusy,
    syncBusy: isSecondaryBusy,
    hasUpstream: upstream != null,
    ahead: ahead ?? 0,
    behind: behind ?? 0,
    createPrDisabled: createPrDisabled || isBusy,
    createPrReason,
  });
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
          if (kind === "commit") onCommit();
          else if (kind === "commit-push") onCommitAndPush();
          else if (kind === "commit-sync") onCommitAndSync();
          else if (kind === "push") onPush();
          else if (kind === "create-pr") onCreatePr();
          else if (kind === "push-pr") onPushBeforePr();
          else if (kind === "fast-forward") onFastForward();
          else if (kind === "sync") onSync();
          else if (kind === "fetch") onFetch();
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
