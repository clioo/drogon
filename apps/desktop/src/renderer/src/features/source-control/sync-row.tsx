// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/right-sidebar/source-control/sync/compare-summary.tsx
// (toolbar-button pattern and ahead copy) plus the push/pull/fetch half of
// commit/use-commit-flows, sync/use-status-refresh and
// source-control-dropdown-remote-items.ts (the no-upstream gating: pull
// disabled with the publish-first title, fetch never gated). Adapter: the
// sync row reports the daemon's upstream status and drives the git.push,
// git.pull and git.fetch RPCs; PR creation lives in the header toolbar
// (see create-pr-action.ts), and branch-compare and hosted review have no
// MVP backend and are not ported. Push stays disabled without an upstream
// (the daemon runs a plain `git push` with no --set-upstream to back the
// fork's enabled publish affordance); the title still states the fix.
// #176: a repo with no remote at all is a third state (not "No upstream")
// with every remote action disabled and the shared reason title.
import React from "react";
import { ArrowDown, ArrowUp, Loader2, RefreshCw } from "lucide-react";
import { Tooltip } from "radix-ui";
import { Button } from "../../components/ui/button";

export type SyncBusyKind = "push" | "pull" | "fetch" | "pr" | null;

export function SyncRowButton({
  label,
  title,
  busy,
  disabled,
  onClick,
  icon,
}: {
  label: string;
  title: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}): React.JSX.Element {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span className="inline-flex">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-[11px]"
            disabled={disabled}
            title={title}
            aria-label={label}
            onClick={onClick}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : icon}
            {label}
          </Button>
        </span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side="top" sideOffset={6} className="tooltip max-w-72">
          {title}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/**
 * Disabled reason for every remote action when the repo has no remote at
 * all (see #176): states the fix, never a raw CLI error. Shared by
 * push/pull/fetch and the header toolbar's Create PR so the row tells one
 * story.
 */
export const NO_REMOTE_SYNC_TITLE =
  "No remote configured for this repository — add one with git remote add, then retry";

export function SyncRow({
  upstream,
  ahead,
  behind,
  busyKind,
  actionsAvailable,
  hasRemote = null,
  onPush,
  onPull,
  onFetch,
}: {
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  busyKind: SyncBusyKind;
  actionsAvailable: { pull: boolean; fetch: boolean };
  /**
   * Whether the repo has any remote configured (#176). Null means unknown
   * (older daemon): the row falls back to the upstream-only states and
   * never claims "No remote" it cannot prove.
   */
  hasRemote?: boolean | null;
  onPush: () => void;
  onPull: () => void;
  onFetch: () => void;
}): React.JSX.Element {
  const busy = busyKind !== null;
  // #176: no remote at all is a different state from no upstream on an
  // existing remote — the fork distinguishes them (hasUpstream gates pull;
  // fetch is never gated on the upstream), and "No upstream" misdiagnoses
  // a repo with nothing to be upstream on.
  const noRemote = hasRemote === false;
  const aheadCount = ahead ?? 0;
  const behindCount = behind ?? 0;
  const pushTitle = noRemote
    ? NO_REMOTE_SYNC_TITLE
    : !upstream
      ? "No upstream branch: push from a terminal once to set one"
      : aheadCount > 0
        ? `Push ${aheadCount} commit${aheadCount === 1 ? "" : "s"} to ${upstream}`
        : `Already up to date with ${upstream}`;
  return (
    <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border">
      <span className="flex min-w-0 flex-1 items-center gap-1 text-xs text-muted-foreground">
        {noRemote ? (
          <span>No remote</span>
        ) : upstream ? (
          <>
            <ArrowUp className="size-3 shrink-0" aria-hidden="true" />
            <span className="tabular-nums">{aheadCount}</span>
            <ArrowDown className="size-3 shrink-0" aria-hidden="true" />
            <span className="tabular-nums">{behindCount}</span>
            <span className="min-w-0 truncate font-mono text-[10.5px]" title={upstream}>
              {upstream}
            </span>
          </>
        ) : (
          <span>No upstream</span>
        )}
      </span>
      <SyncRowButton
        label={busyKind === "push" ? "Pushing…" : "Push"}
        title={pushTitle}
        busy={busyKind === "push"}
        disabled={busy || noRemote || !upstream || aheadCount === 0}
        onClick={onPush}
        icon={<ArrowUp className="size-3.5" aria-hidden="true" />}
      />
      {actionsAvailable.pull && (
        <SyncRowButton
          label={busyKind === "pull" ? "Pulling…" : "Pull"}
          title={
            noRemote
              ? NO_REMOTE_SYNC_TITLE
              : !upstream
                ? "Publish the branch first to pull commits"
                : behindCount > 0
                  ? `Pull ${behindCount} commit${behindCount === 1 ? "" : "s"} (fast-forward only)`
                  : "Pull latest upstream changes (fast-forward only)"
          }
          busy={busyKind === "pull"}
          disabled={busy || noRemote || !upstream}
          onClick={onPull}
          icon={<ArrowDown className="size-3.5" aria-hidden="true" />}
        />
      )}
      {actionsAvailable.fetch && (
        <SyncRowButton
          label={busyKind === "fetch" ? "Fetching…" : "Fetch"}
          title={noRemote ? NO_REMOTE_SYNC_TITLE : "Fetch from remote without merging"}
          busy={busyKind === "fetch"}
          disabled={busy || noRemote}
          onClick={onFetch}
          icon={<RefreshCw className="size-3.5" aria-hidden="true" />}
        />
      )}
    </div>
  );
}
