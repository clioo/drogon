// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/right-sidebar/source-control/panel/branch-context-row.tsx.
// Adapter: branch-compare/base-ref/hosted-review flows have no MVP backend,
// so the row shows HEAD identity plus the daemon's upstream ahead/behind
// and the uncommitted line total. DOM, classes and ARIA follow the source's
// branch-identity and stat nodes.
import React from "react";
import { Loader2 } from "lucide-react";
import { Tooltip } from "radix-ui";
import { SourceControlBranchLineTotalChip } from "./branch-line-total-chip";

function HeadIdentity({ branchHead }: { branchHead: string }): React.JSX.Element {
  // Why: focusable + tooltip so truncated long branch names stay discoverable.
  // `block` is load-bearing: `truncate` clips nothing on an inline box, so an
  // inline span here let long names run under the line-total chip.
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span
          className="block min-w-0 max-w-full truncate rounded-sm font-mono text-[10.5px] font-medium text-foreground/90 outline-none focus-visible:ring-1 focus-visible:ring-ring"
          tabIndex={0}
          aria-label={`Current branch: ${branchHead}`}
          data-testid="source-control-head-identity"
        >
          {branchHead}
        </span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side="bottom" sideOffset={6} className="tooltip max-w-72 break-all font-mono">
          {branchHead}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function UpstreamStat({ label, title }: { label: string; title: string }): React.JSX.Element {
  // Why: aria-label on an unfocusable span is never announced, so tabIndex
  // also lets keyboard users open the tooltip.
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span
          className="shrink-0 rounded-sm tabular-nums text-muted-foreground/70 outline-none focus-visible:ring-1 focus-visible:ring-ring"
          tabIndex={0}
          aria-label={title}
        >
          {label}
        </span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side="bottom" sideOffset={6} className="tooltip">
          {title}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function SourceControlBranchContextRow({
  branchHead,
  upstream,
  ahead,
  behind,
  lineTotalAdded,
  lineTotalRemoved,
  loading,
  onRefresh,
}: {
  branchHead: string | null;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  lineTotalAdded: number;
  lineTotalRemoved: number;
  loading?: boolean;
  onRefresh?: () => void;
}): React.JSX.Element | null {
  if (!branchHead) {
    return (
      <div className="min-w-0 text-[11px] text-muted-foreground">
        {loading ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden="true" />
            <span className="sr-only">Loading branch status</span>
          </span>
        ) : (
          "no branch"
        )}
      </div>
    );
  }

  const stats: React.ReactNode[] = [];
  if (upstream) {
    if (ahead !== null && ahead > 0) {
      stats.push(
        <UpstreamStat
          key="ahead"
          label={`↑${ahead}`}
          title={`${ahead} commit${ahead === 1 ? "" : "s"} ahead of ${upstream}`}
        />,
      );
    }
    if (behind !== null && behind > 0) {
      stats.push(
        <UpstreamStat
          key="behind"
          label={`↓${behind}`}
          title={`${behind} commit${behind === 1 ? "" : "s"} behind ${upstream}`}
        />,
      );
    }
    if (stats.length === 0) {
      stats.push(
        <UpstreamStat key="synced" label="✓" title={`Up to date with ${upstream}`} />,
      );
    }
  }
  void onRefresh;

  return (
    <div
      className="min-w-0 text-[11px] text-muted-foreground"
      role="group"
      aria-label={upstream ? `${branchHead} → ${upstream}` : `Current branch: ${branchHead}`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* Why: the line total belongs beside HEAD — it measures this branch's work. */}
        {/* Why: gap-2 (not gap-1.5) — an ellipsis butting against the colored
            counts reads as part of the branch name. */}
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex min-w-0 flex-1 items-center">
            <HeadIdentity branchHead={branchHead} />
          </span>
          <SourceControlBranchLineTotalChip added={lineTotalAdded} removed={lineTotalRemoved} />
        </div>
        {upstream && (
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 text-muted-foreground">→</span>
            <span className="min-w-0 max-w-full truncate rounded-sm font-mono text-[10.5px] font-medium text-foreground/90">
              {upstream}
            </span>
            {stats}
          </div>
        )}
      </div>
    </div>
  );
}
