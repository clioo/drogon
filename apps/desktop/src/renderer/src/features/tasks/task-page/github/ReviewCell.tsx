// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page/github/ReviewCell.tsx — read-only
// adaptation. The source cell opens the reviewer picker to request reviews
// over gh write RPCs this repo's daemon does not serve, so the trigger
// renders the source's decision label (Approved / Changes requested /
// Reviewers / No reviewers) and the popover is the read-only
// ReviewerPicker: the decision state, never invented reviewer names.
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Popover, PopoverTrigger } from "../../ui/popover";
import { cn } from "../../cn";
import { getGitHubPRReviewLabel } from "../../task-page-github-pr-review";
import type { TaskPageWorkItem } from "../../task-page-model";
import { TaskPageGitHubReviewerPicker } from "./ReviewerPicker";

export function PRReviewCell({
  item,
}: {
  item: TaskPageWorkItem;
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (item.type !== "pr") {
    return <span className="text-[11px] text-muted-foreground">Issue</span>;
  }
  const label = getGitHubPRReviewLabel(item.reviewDecision);
  const decided =
    item.reviewDecision === "APPROVED" || item.reviewDecision === "CHANGES_REQUESTED";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(event) => event.stopPropagation()}
          className={cn(
            "inline-flex h-7 max-w-full items-center justify-center gap-1 text-[12px] font-medium transition hover:brightness-110",
            decided
              ? "rounded-full border border-border/40 bg-background/70 px-1.5 text-muted-foreground hover:text-foreground"
              : "min-w-7 text-muted-foreground hover:text-foreground",
          )}
          aria-label={`Reviewers: ${label}`}
          title={label}
        >
          <span className="truncate">{decided ? label : "-"}</span>
          {decided ? <ChevronDown className="size-3 shrink-0 text-muted-foreground" /> : null}
        </button>
      </PopoverTrigger>
      <TaskPageGitHubReviewerPicker decision={item.reviewDecision} />
    </Popover>
  );
}
