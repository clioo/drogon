// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page/github/ReviewerPicker.tsx —
// read-only adaptation. The source picker searches assignable users and
// requests reviews over gh write RPCs this repo's daemon does not serve, so
// the popover lists the PR's review state (decision) instead of offering
// reviewer search and request actions.
import { Check, ChevronDown, Minus, X } from "lucide-react";
import { PopoverContent } from "../../ui/popover";
import { cn } from "../../cn";
import type { PRReviewDecision } from "../../../../../../shared/tasks-contract";

function DecisionIcon({ decision }: { decision: PRReviewDecision | null | undefined }) {
  if (decision === "APPROVED") {
    return <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />;
  }
  if (decision === "CHANGES_REQUESTED") {
    return <X className="size-3.5 text-rose-600 dark:text-rose-300" />;
  }
  if (decision === "REVIEW_REQUIRED") {
    return <ChevronDown className="size-3.5 text-amber-600 dark:text-amber-300" />;
  }
  return <Minus className="size-3.5 text-muted-foreground" />;
}

function decisionRowLabel(decision: PRReviewDecision | null | undefined): string {
  if (decision === "APPROVED") {
    return "Approved";
  }
  if (decision === "CHANGES_REQUESTED") {
    return "Changes requested";
  }
  if (decision === "REVIEW_REQUIRED") {
    return "Review required";
  }
  return "No reviewers";
}

export function TaskPageGitHubReviewerPicker({
  decision,
}: {
  decision: PRReviewDecision | null | undefined;
}): React.JSX.Element {
  return (
    <PopoverContent
      className="flex w-[280px] flex-col overflow-hidden rounded-md border-border/70 p-0"
      align="start"
      side="bottom"
      sideOffset={6}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="border-b border-border/50 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        Reviewers
      </div>
      <div
        className={cn(
          "flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left text-[13px]",
        )}
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          <DecisionIcon decision={decision} />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {decisionRowLabel(decision)}
        </span>
      </div>
    </PopoverContent>
  );
}
