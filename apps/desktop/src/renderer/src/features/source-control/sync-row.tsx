// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/right-sidebar/source-control/sync/compare-summary.tsx
// (toolbar-button pattern and ahead copy) plus the push/pull/fetch half of
// commit/use-commit-flows and sync/use-status-refresh. Adapter: the sync
// row reports the daemon's upstream status and drives the git.push,
// git.pull and git.fetch RPCs; PR creation lives in the header toolbar
// (see create-pr-action.ts), and branch-compare and hosted review have no
// MVP backend and are not ported.
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

export function SyncRow({
  upstream,
  ahead,
  behind,
  busyKind,
  actionsAvailable,
  onPush,
  onPull,
  onFetch,
}: {
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  busyKind: SyncBusyKind;
  actionsAvailable: { pull: boolean; fetch: boolean };
  onPush: () => void;
  onPull: () => void;
  onFetch: () => void;
}): React.JSX.Element {
  const busy = busyKind !== null;
  const aheadCount = ahead ?? 0;
  const behindCount = behind ?? 0;
  const pushTitle = !upstream
    ? "No upstream branch: push from a terminal once to set one"
    : aheadCount > 0
      ? `Push ${aheadCount} commit${aheadCount === 1 ? "" : "s"} to ${upstream}`
      : `Already up to date with ${upstream}`;
  return (
    <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border">
      <span className="flex min-w-0 flex-1 items-center gap-1 text-xs text-muted-foreground">
        {upstream ? (
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
        disabled={busy || !upstream || aheadCount === 0}
        onClick={onPush}
        icon={<ArrowUp className="size-3.5" aria-hidden="true" />}
      />
      {actionsAvailable.pull && (
        <SyncRowButton
          label={busyKind === "pull" ? "Pulling…" : "Pull"}
          title={
            behindCount > 0
              ? `Pull ${behindCount} commit${behindCount === 1 ? "" : "s"} (fast-forward only)`
              : "Pull latest upstream changes (fast-forward only)"
          }
          busy={busyKind === "pull"}
          disabled={busy || !upstream}
          onClick={onPull}
          icon={<ArrowDown className="size-3.5" aria-hidden="true" />}
        />
      )}
      {actionsAvailable.fetch && (
        <SyncRowButton
          label={busyKind === "fetch" ? "Fetching…" : "Fetch"}
          title="Fetch upstream status without changing the worktree"
          busy={busyKind === "fetch"}
          disabled={busy || !upstream}
          onClick={onFetch}
          icon={<RefreshCw className="size-3.5" aria-hidden="true" />}
        />
      )}
    </div>
  );
}
