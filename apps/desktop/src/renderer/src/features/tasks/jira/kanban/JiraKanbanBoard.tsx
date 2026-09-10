// C09 Jira kanban board: lanes from real (site, status id) pairs, moves
// only through transitions Jira actually offers, honest data-coverage
// labeling, and pointer + keyboard parity for selection and transitions.
// Interaction primitives (selection core, drag payloads) come from the C02
// kanban seam; this component is the Jira domain surface, not a second
// board engine.
//
// MIT Copyright (c) 2026 Lovecast Inc.

import React, { useCallback, useMemo, useState } from "react";
import { ChevronDown, Inbox, RefreshCw, TriangleAlert } from "lucide-react";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../../components/ui/dropdown-menu";
import { Input } from "../../../../components/ui/input";
import { cn } from "../../cn";
import type { JiraIssue } from "../../../../../../shared/jira-contract";
import { getJiraStatusTone } from "../jira-status-tone";
import type { JiraPresetId } from "../../task-page-localized-options";
import {
  readWorkspaceDragDataIds,
  writeWorkspaceDragData,
} from "../../../kanban/drag-data";
import { getJiraIssueIdentity } from "./jira-issue-identity";
import type { JiraKanbanLane } from "./jira-kanban-columns";
import type { JiraKanbanBoardController } from "./use-jira-kanban-board";
import { JiraKanbanCard } from "./JiraKanbanCard";

const JIRA_KANBAN_PRESETS: { id: JiraPresetId; label: string }[] = [
  { id: "assigned", label: "Assigned" },
  { id: "reported", label: "Reported" },
  { id: "all", label: "All" },
  { id: "done", label: "Done" },
];

export type JiraKanbanBoardProps = {
  controller: JiraKanbanBoardController;
  showSiteContext: boolean;
  renderAssignmentSlot?: (issue: JiraIssue) => React.ReactNode;
};

export function JiraKanbanBoard({
  controller,
  showSiteContext,
  renderAssignmentSlot,
}: JiraKanbanBoardProps) {
  const [menuIssueIdentity, setMenuIssueIdentity] = useState<string | null>(
    null,
  );
  const [activeIdentity, setActiveIdentity] = useState<string | null>(null);

  const focusCard = useCallback((identity: string) => {
    const card = document.querySelector<HTMLElement>(
      `[data-jira-card="${CSS.escape(identity)}"]`,
    );
    card?.focus();
  }, []);

  const moveFocus = useCallback(
    (fromIdentity: string, direction: "up" | "down" | "left" | "right") => {
      const { lanes } = controller;
      const laneIndex = lanes.findIndex((lane) =>
        lane.issueIdentities.includes(fromIdentity),
      );
      if (laneIndex === -1) return;
      const lane = lanes[laneIndex]!;
      const cardIndex = lane.issueIdentities.indexOf(fromIdentity);
      let nextIdentity: string | null = null;
      if (direction === "up" && cardIndex > 0) {
        nextIdentity = lane.issueIdentities[cardIndex - 1]!;
      } else if (
        direction === "down" &&
        cardIndex < lane.issueIdentities.length - 1
      ) {
        nextIdentity = lane.issueIdentities[cardIndex + 1]!;
      } else if (
        (direction === "left" && laneIndex > 0) ||
        (direction === "right" && laneIndex < lanes.length - 1)
      ) {
        const targetLane =
          lanes[direction === "left" ? laneIndex - 1 : laneIndex + 1]!;
        nextIdentity =
          targetLane.issueIdentities[
            Math.min(cardIndex, targetLane.issueIdentities.length - 1)
          ] ?? null;
      }
      if (nextIdentity) {
        setActiveIdentity(nextIdentity);
        focusCard(nextIdentity);
      }
    },
    [controller, focusCard],
  );

  const handleCardKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>, issue: JiraIssue) => {
      const identity = getJiraIssueIdentity(issue);
      switch (event.key) {
        case "ArrowUp":
        case "ArrowDown":
        case "ArrowLeft":
        case "ArrowRight": {
          event.preventDefault();
          moveFocus(
            identity,
            event.key.slice(5).toLowerCase() as
              "up" | "down" | "left" | "right",
          );
          return;
        }
        case "Enter": {
          // Keyboard parity for the transition menu (the kebab is the
          // pointer path to the same real transitions).
          event.preventDefault();
          setActiveIdentity(identity);
          setMenuIssueIdentity(identity);
          return;
        }
        case " ": {
          event.preventDefault();
          controller.selectOnly(identity);
          return;
        }
        case "Escape": {
          if (menuIssueIdentity !== null) {
            setMenuIssueIdentity(null);
          }
          return;
        }
      }
    },
    [controller, menuIssueIdentity, moveFocus],
  );

  const handleLaneDrop = useCallback(
    (event: React.DragEvent<HTMLElement>, lane: JiraKanbanLane) => {
      event.preventDefault();
      const identities = readWorkspaceDragDataIds(event.dataTransfer);
      for (const identity of identities) {
        const issue = controller.issues.find(
          (candidate) => getJiraIssueIdentity(candidate) === identity,
        );
        if (!issue) continue;
        controller.moveIssueToLane(issue, lane.identity);
      }
    },
    [controller],
  );

  const menuIssue = useMemo(
    () =>
      menuIssueIdentity === null
        ? null
        : (controller.issues.find(
            (issue) => getJiraIssueIdentity(issue) === menuIssueIdentity,
          ) ?? null),
    [controller.issues, menuIssueIdentity],
  );
  const menuTransitions =
    menuIssue !== null ? controller.getTransitions(menuIssue) : null;
  const menuPending =
    menuIssueIdentity !== null
      ? (controller.pendingByIdentity.get(menuIssueIdentity) ?? null)
      : null;

  return (
    <div
      data-jira-kanban-board
      className="flex min-h-0 flex-1 flex-col gap-2"
      aria-label="Jira kanban board"
    >
      {/* Toolbar: the existing Jira filters (preset + JQL), the board's own
          card filter, and the refresh control. */}
      <div
        className="flex flex-wrap items-center gap-2"
        data-jira-kanban-toolbar
      >
        <div
          className="flex items-center gap-1"
          role="tablist"
          aria-label="Jira filters"
        >
          {JIRA_KANBAN_PRESETS.map((entry) => (
            <Button
              key={entry.id}
              variant={controller.preset === entry.id ? "secondary" : "ghost"}
              size="sm"
              role="tab"
              aria-selected={controller.preset === entry.id}
              data-jira-kanban-preset={entry.id}
              onClick={() => controller.setPreset(entry.id)}
            >
              {entry.label}
            </Button>
          ))}
        </div>
        <Input
          value={controller.queryInput}
          onChange={(event) => controller.setQueryInput(event.target.value)}
          placeholder="Search with JQL…"
          aria-label="JQL query"
          data-jira-kanban-jql
          className="h-8 w-56"
        />
        <Input
          value={controller.cardFilter}
          onChange={(event) => controller.setCardFilter(event.target.value)}
          placeholder="Filter loaded cards…"
          aria-label="Filter loaded cards"
          data-jira-kanban-card-filter
          className="h-8 w-48"
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Refresh issues"
          data-jira-kanban-refresh
          onClick={controller.refresh}
        >
          <RefreshCw aria-hidden className="size-4" />
        </Button>
      </div>

      {/* Honest coverage: never is a page or partial cache the full set. */}
      <div
        className="flex items-center gap-2 text-xs text-muted-foreground"
        data-jira-kanban-coverage
      >
        <span data-jira-kanban-coverage-line>{controller.coverageLine}</span>
        {controller.filterLine ? (
          <span data-jira-kanban-filter-line>{controller.filterLine}</span>
        ) : null}
        {controller.staleData ? (
          <Badge variant="outline" data-jira-kanban-stale>
            Previously loaded issues — refresh to retry
          </Badge>
        ) : null}
        {controller.canLoadMore ? (
          <Button
            variant="outline"
            size="sm"
            className="h-6"
            data-jira-kanban-load-more
            disabled={controller.loading}
            onClick={controller.loadMore}
          >
            Load more <ChevronDown aria-hidden className="size-3.5" />
          </Button>
        ) : null}
      </div>

      {controller.error ? (
        <div
          role="alert"
          data-jira-kanban-error
          className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <TriangleAlert aria-hidden className="size-4 shrink-0" />
          <span>{controller.error}</span>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={controller.refresh}
          >
            Retry
          </Button>
        </div>
      ) : null}

      {controller.notice ? (
        <div
          role="status"
          data-jira-kanban-notice
          data-jira-kanban-notice-tone={controller.notice.tone}
          className={cn(
            "flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
            controller.notice.tone === "blocked"
              ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200"
              : "border-border/60 bg-muted/40 text-muted-foreground",
          )}
        >
          <TriangleAlert aria-hidden className="size-4 shrink-0" />
          <span data-jira-kanban-notice-message>
            {controller.notice.message}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={controller.dismissNotice}
          >
            Dismiss
          </Button>
        </div>
      ) : null}

      {controller.loading && controller.issues.length === 0 ? (
        <div
          data-jira-kanban-loading
          className="flex items-center gap-2 rounded-md border border-dashed px-3 py-6 text-sm text-muted-foreground"
        >
          <RefreshCw aria-hidden className="size-4 animate-spin" />
          Loading Jira issues…
        </div>
      ) : null}

      {!controller.loading &&
      controller.issues.length === 0 &&
      !controller.error ? (
        <div
          data-jira-kanban-empty
          className="flex flex-col items-center gap-2 rounded-md border border-dashed px-3 py-10 text-sm text-muted-foreground"
        >
          <Inbox aria-hidden className="size-6" />
          <p>No Jira issues match this filter.</p>
        </div>
      ) : null}

      {/* Lanes: horizontally scrollable, identity-keyed drop targets. */}
      <div
        className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2"
        data-jira-kanban-lanes
      >
        {controller.lanes.map((lane) => (
          <section
            key={lane.identity}
            data-jira-lane={lane.identity}
            data-jira-lane-status-id={lane.statusId}
            aria-label={`${lane.statusName} (${lane.issues.length})`}
            className="flex w-[260px] shrink-0 flex-col rounded-lg border bg-muted/20"
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => handleLaneDrop(event, lane)}
          >
            <header className="flex items-center gap-2 border-b px-2.5 py-2">
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                  getJiraStatusTone(lane.categoryKey),
                )}
              >
                {lane.statusName}
              </span>
              <Badge
                variant="outline"
                className="ml-auto px-1.5 text-[10px]"
                data-jira-lane-count
              >
                {lane.issues.length}
              </Badge>
            </header>
            <div
              role="list"
              className="flex flex-col gap-2 overflow-y-auto p-2"
            >
              {lane.issues.map((issue) => {
                const identity = getJiraIssueIdentity(issue);
                return (
                  <JiraKanbanCard
                    key={identity}
                    issue={issue}
                    laneIdentity={lane.identity}
                    selected={controller.selectedIdentities.has(identity)}
                    pending={controller.pendingByIdentity.get(identity) ?? null}
                    showSiteContext={showSiteContext}
                    active={
                      activeIdentity === identity ||
                      controller.selectedIdentities.has(identity)
                    }
                    renderAssignmentSlot={renderAssignmentSlot}
                    onSelectGesture={(event, selectedIdentity) =>
                      controller.updateSelectionForGesture(
                        event,
                        selectedIdentity,
                      )
                    }
                    onKeyDown={handleCardKeyDown}
                    onOpenTransitionsMenu={(menuTarget) => {
                      setActiveIdentity(getJiraIssueIdentity(menuTarget));
                      setMenuIssueIdentity(getJiraIssueIdentity(menuTarget));
                    }}
                    onRunTransition={controller.runTransition}
                    onOpenSession={controller.openSession}
                    openingSession={
                      controller.openingSessionIdentity === identity
                    }
                    transitionsMenuOpen={menuIssueIdentity === identity}
                    onDragStartCard={(event, draggedIdentity) => {
                      // Keep a multi-selection dragging together: the
                      // payload carries every selected identity (bounded,
                      // C02 drag-data) with the dragged card first.
                      const batch = controller.selectedIdentities.has(
                        draggedIdentity,
                      )
                        ? [
                            draggedIdentity,
                            ...[...controller.selectedIdentities].filter(
                              (id) => id !== draggedIdentity,
                            ),
                          ]
                        : [draggedIdentity];
                      writeWorkspaceDragData(event.dataTransfer, batch);
                    }}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {/* The real transition menu for the active card. Rendered once, keyed
          by composed identity; every item carries the exact transition id. */}
      {menuIssue ? (
        <DropdownMenu
          open={menuIssueIdentity === getJiraIssueIdentity(menuIssue)}
          onOpenChange={(open) => {
            if (!open) setMenuIssueIdentity(null);
          }}
        >
          <DropdownMenuTrigger asChild>
            <span
              data-jira-kanban-menu-anchor
              className="pointer-events-none fixed"
              style={{ left: 1, top: 1 }}
              aria-hidden
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            data-jira-kanban-transitions-menu
            align="start"
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            <DropdownMenuLabel>
              Transitions for {menuIssue.key}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {menuPending ? (
              <DropdownMenuItem disabled data-jira-transition-pending>
                {menuPending.state === "awaiting-reconciliation"
                  ? "Confirming with Jira…"
                  : `Moving via ${menuPending.transitionName}…`}
              </DropdownMenuItem>
            ) : menuTransitions === null ? (
              <DropdownMenuItem disabled data-jira-transition-loading>
                Loading transitions…
              </DropdownMenuItem>
            ) : menuTransitions.length === 0 ? (
              <DropdownMenuItem disabled data-jira-transition-none>
                Jira offers no transitions for this issue.
              </DropdownMenuItem>
            ) : (
              menuTransitions.map((transition) => (
                <DropdownMenuItem
                  key={transition.id}
                  data-jira-transition-id={transition.id}
                  title={`transition id ${transition.id}`}
                  onSelect={() => {
                    controller.runTransition(menuIssue, transition.id);
                    setMenuIssueIdentity(null);
                  }}
                >
                  <span>{transition.name}</span>
                  <span
                    className={cn(
                      "ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                      getJiraStatusTone(transition.to.categoryKey),
                    )}
                  >
                    {transition.to.name}
                  </span>
                </DropdownMenuItem>
              ))
            )}
            {menuPending?.state === "awaiting-reconciliation" ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  data-jira-transition-reconcile
                  onSelect={() => {
                    controller.retryReconciliation(menuIssue);
                    setMenuIssueIdentity(null);
                  }}
                >
                  Retry confirmation with Jira
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
