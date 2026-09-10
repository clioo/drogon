// C09 Jira kanban card: one issue on the board. Pointer and keyboard paths
// share one anatomy — the card button selects (click / Space), Enter opens
// the real transition menu, the kebab button is the pointer path to the
// same menu, and drag/drop posts the lane's status id through the plan
// validator. A pending move renders as a separate overlay state; the card
// never pretends a move landed before the server says so.
//
// MIT Copyright (c) 2026 Lovecast Inc.

import React from "react";
import { ArrowRight, Loader2, MoreHorizontal, Play } from "lucide-react";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import { cn } from "../../cn";
import type { JiraIssue } from "../../../../../../shared/jira-contract";
import { getJiraStatusTone } from "../jira-status-tone";
import { composeJiraIssueIdentity } from "./jira-issue-identity";
import type { JiraPendingMove } from "./jira-kanban-moves";

export type JiraKanbanCardProps = {
  issue: JiraIssue;
  laneIdentity: string;
  /** Selected state keyed by composed identity, not by card position. */
  selected: boolean;
  pending: JiraPendingMove | null;
  showSiteContext: boolean;
  /** Roving tabindex: only the active card is in the tab order. */
  active: boolean;
  /** Assignment slot owned by C11 — rendered verbatim, no second system. */
  renderAssignmentSlot?: (issue: JiraIssue) => React.ReactNode;
  onSelectGesture: (
    event: React.MouseEvent<HTMLElement>,
    identity: string,
  ) => boolean;
  onKeyDown: (
    event: React.KeyboardEvent<HTMLElement>,
    issue: JiraIssue,
  ) => void;
  onOpenTransitionsMenu: (issue: JiraIssue) => void;
  onRunTransition: (issue: JiraIssue, transitionId: string) => void;
  onOpenSession: (issue: JiraIssue) => void;
  openingSession: boolean;
  transitionsMenuOpen: boolean;
  onDragStartCard: (
    event: React.DragEvent<HTMLElement>,
    identity: string,
  ) => void;
};

export function JiraKanbanCard({
  issue,
  laneIdentity,
  selected,
  pending,
  showSiteContext,
  active,
  renderAssignmentSlot,
  onSelectGesture,
  onKeyDown,
  onOpenTransitionsMenu,
  onOpenSession,
  openingSession,
  transitionsMenuOpen,
  onDragStartCard,
}: JiraKanbanCardProps) {
  const identity = composeJiraIssueIdentity(issue.siteId ?? null, issue.id);
  const isPending = pending !== null;
  const awaitingConfirmation = pending?.state === "awaiting-reconciliation";
  return (
    <div
      data-jira-card={identity}
      data-jira-card-lane={laneIdentity}
      data-jira-pending={pending ? pending.state : undefined}
      role="listitem"
      aria-selected={selected}
      className={cn(
        "group relative rounded-md border bg-card text-card-foreground shadow-sm transition-colors",
        selected && "border-primary/60 ring-1 ring-primary/40",
        isPending && "opacity-80",
      )}
      tabIndex={active ? 0 : -1}
      aria-label={`${issue.key}: ${issue.title}`}
      onClick={(event) => {
        onSelectGesture(event, identity);
      }}
      onKeyDown={(event) => onKeyDown(event, issue)}
      draggable={!isPending}
      onDragStart={(event) => onDragStartCard(event, identity)}
    >
      <div className="flex items-start gap-2 p-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <a
              href={issue.url}
              target="_blank"
              rel="noreferrer"
              data-jira-card-key={issue.key}
              className="font-mono text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {issue.key}
            </a>
            {showSiteContext && issue.siteName ? (
              <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                {issue.siteName}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 line-clamp-3 text-sm leading-snug">
            {issue.title}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span
              data-jira-card-status={issue.status.id}
              className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                getJiraStatusTone(issue.status.categoryKey),
              )}
            >
              {issue.status.name}
            </span>
            {pending ? (
              <span
                data-jira-card-pending-chip
                className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-200"
              >
                <Loader2 aria-hidden className="size-3 animate-spin" />
                {awaitingConfirmation
                  ? "Confirming with Jira…"
                  : `Moving to ${pending.transitionName}…`}
              </span>
            ) : null}
          </div>
          {renderAssignmentSlot ? (
            <div
              data-jira-card-assignment-slot
              className="mt-2"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {renderAssignmentSlot(issue)}
            </div>
          ) : null}
        </div>
        <div
          className="flex flex-col items-center gap-1"
          onClick={(event) => event.stopPropagation()}
        >
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={`Transitions for ${issue.key}`}
            data-jira-card-menu-trigger
            disabled={isPending}
            onClick={(event) => {
              event.stopPropagation();
              onOpenTransitionsMenu(issue);
            }}
          >
            {transitionsMenuOpen ? (
              <ArrowRight aria-hidden className="size-3.5" />
            ) : (
              <MoreHorizontal aria-hidden className="size-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={`Open session for ${issue.key}`}
            data-jira-card-open-session
            disabled={openingSession}
            onClick={(event) => {
              event.stopPropagation();
              onOpenSession(issue);
            }}
          >
            {openingSession ? (
              <Loader2 aria-hidden className="size-3.5 animate-spin" />
            ) : (
              <Play aria-hidden className="size-3.5" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
