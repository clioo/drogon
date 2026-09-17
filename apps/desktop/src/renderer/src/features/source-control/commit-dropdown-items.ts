// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/right-sidebar/source-control-dropdown-items.ts,
// source-control-dropdown-remote-items.ts and
// source-control-dropdown-labels.ts (labels, titles, disabled ladders and
// row order). Adapter: this repo's git surface is commit / push (plain,
// force-with-lease, publish) / pull --ff-only / fetch / gh pr create. The
// fork's Fast-forward row maps to this repo's ff-only pull; Sync maps to
// pull-then-push. The reference menu's amend entry does not exist upstream
// at all — the previous Drogon port invented it and it has been removed.
// Intentionally not ported (#332): the merge-mode Pull row (pull stays
// ff-only on purpose — a panel click must never invent a merge commit),
// Rebase from Base (rewrites history with no conflict-resolution UX in the
// panel), and the Abort merge / rebase pair with in-progress detection (no
// in-app producer for those states while pull stays ff-only and no rebase
// backend exists; terminal users have the CLI). Pure functions,
// unit-tested.
import type { CommitDropdownEntry } from "./commit-action-menu";

/** Source copy (source-control-dropdown-remote-items.ts). */
const NO_UPSTREAM_PUSH_REASON = "Upstream required. Publish your branch first.";
const NO_UPSTREAM_PULL_REASON = "Pulling requires an upstream. Publish your branch first.";
const NO_UPSTREAM_SYNC_REASON = "Sync requires an upstream. Publish your branch first.";
const REMOTE_BUSY_REASON = "Finish the current remote action first.";
const NO_REMOTE_PUBLISH_REASON = "No remote configured. Add one with git remote add first.";
const HAS_UPSTREAM_PUBLISH_REASON = "This branch already tracks an upstream.";

/** Ported from source-control-dropdown-labels.ts. */
export function formatCountLabel(base: string, count: number): string {
  return count > 0 ? `${base} (${count})` : base;
}

/** Ported from source-control-dropdown-labels.ts. */
export function formatSyncLabel(base: string, ahead: number, behind: number): string {
  if (ahead === 0 && behind === 0) {
    return base;
  }
  return `${base} (↓${behind} ↑${ahead})`;
}

/** Ported from source-control-dropdown-labels.ts (Push row title). */
export function describePushCount(ahead: number): string {
  return `Push ${ahead} commit${ahead === 1 ? "" : "s"}`;
}

export type CommitDropdownState = {
  /** Trimmed commit message is non-empty. */
  hasMessage: boolean;
  /** Staged rows exist and a message is present (source canCommit). */
  canCommit: boolean;
  /** A commit or staging operation is in flight (busy !== null). */
  commitBusy: boolean;
  /** A remote operation is in flight (syncBusy !== null). */
  syncBusy: boolean;
  hasUpstream: boolean;
  /** Any remote configured (false disables Publish; unknown treated as true by callers). */
  hasRemotes: boolean;
  /** Resolved compare counts (null treated as 0, like the source). */
  ahead: number;
  behind: number;
  /** Create PR row from resolveCreatePrToolbarAction. */
  createPrDisabled: boolean;
  createPrReason: string | null;
};

/**
 * The chevron menu rows in the source's order. Every row renders even when
 * disabled (with its title reason), like the source — the only hidden row
 * is "Push before PR", which appears only while ahead of upstream.
 */
export function buildCommitDropdownItems(
  state: CommitDropdownState,
): CommitDropdownEntry[] {
  const {
    hasMessage,
    canCommit,
    commitBusy,
    syncBusy,
    hasUpstream,
    hasRemotes,
    ahead,
    behind,
    createPrDisabled,
    createPrReason,
  } = state;
  const remoteBusy = syncBusy || commitBusy;

  const commitTitle = hasMessage
    ? "Commit staged changes"
    : "Write a commit message to commit";

  const commitPushTitle = syncBusy
    ? REMOTE_BUSY_REASON
    : !hasUpstream
      ? NO_UPSTREAM_PUSH_REASON
      : hasMessage
        ? "Commit staged changes and push upstream"
        : "Write a commit message first";

  const commitSyncTitle = syncBusy
    ? REMOTE_BUSY_REASON
    : !hasUpstream
      ? NO_UPSTREAM_PUSH_REASON
      : hasMessage
        ? "Commit, pull from upstream, then push back upstream"
        : "Write a commit message first";

  const pushTitle = !hasUpstream
    ? NO_UPSTREAM_PUSH_REASON
    : `${describePushCount(ahead)} upstream`;

  const publishTitle = syncBusy
    ? REMOTE_BUSY_REASON
    : hasUpstream
      ? HAS_UPSTREAM_PUBLISH_REASON
      : !hasRemotes
        ? NO_REMOTE_PUBLISH_REASON
        : "Publish this branch to origin and track it as upstream";

  const forcePushTitle = syncBusy
    ? REMOTE_BUSY_REASON
    : !hasUpstream
      ? NO_UPSTREAM_PUSH_REASON
      : "Rewrite the upstream branch with your local history, refusing when the remote moved first";

  const items: CommitDropdownEntry[] = [
    {
      kind: "commit",
      id: "commit",
      label: "Commit",
      title: commitTitle,
      disabled: !canCommit || commitBusy,
    },
    {
      kind: "commit-push",
      id: "commit-push",
      label: "Commit & Push",
      hint: hasMessage ? undefined : "Write a message first",
      title: commitPushTitle,
      disabled: !canCommit || remoteBusy || !hasUpstream,
    },
    {
      kind: "commit-sync",
      id: "commit-sync",
      label: "Commit & Sync",
      title: commitSyncTitle,
      disabled: !canCommit || remoteBusy || !hasUpstream,
    },
    { kind: "separator", id: "sep-push" },
    {
      kind: "push",
      id: "push",
      label: formatCountLabel("Push", ahead),
      title: pushTitle,
      disabled: remoteBusy || !hasUpstream,
    },
    {
      kind: "publish",
      id: "publish",
      label: "Publish Branch",
      title: publishTitle,
      disabled: remoteBusy || hasUpstream || !hasRemotes,
    },
    {
      kind: "force-push",
      id: "force-push",
      label: "Force Push",
      title: forcePushTitle,
      disabled: remoteBusy || !hasUpstream,
    },
    { kind: "separator", id: "sep-review" },
    {
      kind: "create-pr",
      id: "create-pr",
      label: "Create PR",
      title: createPrReason ?? "Create a pull request for the current branch",
      disabled: createPrDisabled,
    },
  ];

  if (ahead > 0) {
    items.push({
      kind: "push-pr",
      id: "push-pr",
      label: "Push before PR",
      title: !hasUpstream
        ? NO_UPSTREAM_PUSH_REASON
        : remoteBusy
          ? REMOTE_BUSY_REASON
          : "Push your branch before creating the PR.",
      disabled: remoteBusy || !hasUpstream,
    });
  }

  items.push(
    { kind: "separator", id: "sep-sync" },
    {
      kind: "fast-forward",
      id: "fast-forward",
      label: formatCountLabel("Fast-forward", behind),
      title: !hasUpstream
        ? NO_UPSTREAM_PULL_REASON
        : "Update this branch to its latest remote state without creating a merge commit",
      disabled: syncBusy || !hasUpstream,
    },
    {
      kind: "sync",
      id: "sync",
      label: formatSyncLabel("Sync", ahead, behind),
      title: !hasUpstream
        ? NO_UPSTREAM_SYNC_REASON
        : syncBusy
          ? REMOTE_BUSY_REASON
          : ahead > 0
            ? "Fetch and pull any remote changes, then push your local changes"
            : "Fetch and pull any remote changes",
      disabled: syncBusy || !hasUpstream,
    },
    { kind: "separator", id: "sep-fetch" },
    {
      kind: "fetch",
      id: "fetch",
      label: "Fetch",
      title: "Fetch the latest remote state for this branch without changing local files",
      disabled: syncBusy,
    },
  );

  return items;
}
