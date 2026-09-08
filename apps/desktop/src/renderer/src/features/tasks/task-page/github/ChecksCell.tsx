// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page/github/ChecksCell.tsx — read-only
// adaptation. The source lazily loads per-row checks over `gh pr checks`
// when a row scrolls into view; this repo's daemon already rolls the
// `statusCheckRollup` into the list response, so the cell renders the same
// pill (icon + label + tone) directly from that summary with no lazy load.
import { CheckCircle2, AlertCircle, Clock3, Minus } from "lucide-react";
import { cn } from "../../cn";
import { getChecksPillTone, getChecksLabel } from "../../task-page-checks-pill";
import type { TaskPageWorkItem } from "../../task-page-model";

export function PRChecksCell({
  item,
}: {
  item: TaskPageWorkItem;
}): React.JSX.Element {
  if (item.type !== "pr") {
    return <span className="text-[11px] text-muted-foreground">Issue</span>;
  }
  const summary = item.checks;
  const Icon =
    summary?.state === "success"
      ? CheckCircle2
      : summary?.state === "failure"
        ? AlertCircle
        : summary?.state === "pending"
          ? Clock3
          : Minus;
  const label = getChecksLabel(item);
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
        getChecksPillTone(item),
      )}
      title={label}
    >
      <Icon className="size-3" />
      <span className="truncate">{label}</span>
    </span>
  );
}
