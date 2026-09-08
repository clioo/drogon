// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page/github/MergeCell.tsx — read-only
// adaptation. The source cell merges and toggles auto-merge over gh write
// RPCs this repo's daemon does not serve, so the pill renders the
// mergeability the daemon fetches (`mergeable`) with the source's tones and
// the dropdown keeps only the real action: opening the GitHub merge box.
import { GitMerge, ExternalLink } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../../ui/dropdown-menu";
import { Tooltip, TooltipTrigger, TooltipContent } from "../../ui/tooltip";
import { cn } from "../../cn";
import type { TaskPageWorkItem } from "../../task-page-model";

function mergePresentation(item: TaskPageWorkItem): {
  label: string;
  tone: string;
  tooltip: string;
} {
  if (item.state === "merged") {
    return {
      label: "Merged",
      tone: "border-border/60 bg-background/70 text-muted-foreground",
      tooltip: "This pull request is already merged",
    };
  }
  if (item.state === "closed") {
    return {
      label: "Closed",
      tone: "border-border/60 bg-background/70 text-muted-foreground",
      tooltip: "This pull request is closed",
    };
  }
  switch (item.mergeable) {
    case "MERGEABLE":
      return {
        label: "Mergeable",
        tone: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200",
        tooltip: "This pull request can be merged",
      };
    case "CONFLICTING":
      return {
        label: "Conflicting",
        tone: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200",
        tooltip: "This pull request has merge conflicts",
      };
    default:
      return {
        label: "Merge status unknown",
        tone: "border-border/60 bg-background/70 text-muted-foreground",
        tooltip: "GitHub has not reported mergeability for this pull request yet",
      };
  }
}

export function PRMergeCell({
  item,
}: {
  item: TaskPageWorkItem;
}): React.JSX.Element {
  if (item.type !== "pr") {
    return <span className="text-[11px] text-muted-foreground">Issue</span>;
  }
  const presentation = mergePresentation(item);
  return (
    <DropdownMenu modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={(event) => event.stopPropagation()}
              className={cn(
                "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition hover:brightness-110",
                presentation.tone,
              )}
            >
              <GitMerge className="size-3" />
              <span className="truncate">{presentation.label}</span>
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {presentation.tooltip}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuItem onSelect={() => window.open(item.url, "_blank", "noopener")}>
          <ExternalLink className="size-4" />
          Open GitHub merge box
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
