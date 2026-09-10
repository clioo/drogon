// MIT Copyright (c) 2026 Lovecast Inc.
// C11: the compact local-Bot badge for task rows (Tasks list and C09 Kanban
// cards) and the detail header. Deliberately distinct from Jira's remote
// assignee — a Bot glyph and "Local" wording, never the Jira user avatar —
// because the assignment lives only in Drogon and never touches the Jira
// assignee field. Unassigned renders nothing so list rows stay clean.
import { Bot, BotOff } from "lucide-react";

import { cn } from "../../../lib/utils";
import {
  assignmentStatus,
  type TaskBotAssignment,
} from "./bot-assignment-state";

export function BotAssignmentBadge({
  assignment,
  className,
}: {
  assignment: TaskBotAssignment | null | undefined;
  className?: string;
}): React.JSX.Element | null {
  const status = assignmentStatus(assignment);
  if (status.kind === "unassigned") {
    return null;
  }

  const local = "Local Bot — the Jira assignee is not changed";
  if (status.kind === "bot-deleted") {
    return (
      <span
        role="status"
        aria-label={`Assigned Bot ${status.botName} no longer exists. Reassign or unassign.`}
        title={`Assigned Bot ${status.botName} no longer exists. History is kept; reassign or unassign.`}
        className={cn(
          "inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-2 text-[11px] font-medium text-destructive",
          className,
        )}
      >
        <BotOff className="size-3" aria-hidden />
        <span className="max-w-32 truncate">{status.botName}</span>
      </span>
    );
  }

  return (
    <span
      role="status"
      aria-label={`Local Bot: ${status.botName}. ${local}.`}
      title={`${status.botName} — ${local}.`}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-border bg-muted/60 px-2 text-[11px] font-medium text-foreground",
        className,
      )}
    >
      <Bot className="size-3 text-muted-foreground" aria-hidden />
      <span className="max-w-32 truncate">{status.botName}</span>
    </span>
  );
}
