/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/worktree-card-compact-agents.tsx
   (CompactAgentExpansion and CompactAgentSummaryButton: the collapsed
   "N agents" pill with per-state dot clusters over overlapping identity
   icons, and the grid-track animated expansion reveal).
   Adapter: the source clusters AgentIcon glyphs per agent type; this
   repo's contract carries no agent-type catalog, so the cluster icons are
   the sessions' harness icons (the same identity glyph the agent rows
   use). Classes, copy, aria labels and disclosure behaviour are the
   source's verbatim. */
import React, { useCallback, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";
import type { Session } from "../../../../shared/session-contract";
import { AgentStateIcon } from "./AgentStateIcon";
import { HarnessMenuIcon } from "./TabCreateMenuIcons";
import {
  buildCardSummaryGroups,
  summarizeAgentsForAria,
  summarizeSessionIdentities,
  type SummarySessionGroup,
} from "./worktree-card-agent-summary";

function stopActivationKeyPropagation(e: React.KeyboardEvent): void {
  // Why: the surrounding worktree list handles Enter/Space as row activation.
  // Focused nested buttons need those keys to stay local.
  if (e.key === "Enter" || e.key === " ") {
    e.stopPropagation();
  }
}

type CompactAgentExpansionProps = {
  expanded: boolean;
  contentClassName?: string;
  children: React.ReactNode;
};

export function CompactAgentExpansion({
  expanded,
  contentClassName,
  children,
}: CompactAgentExpansionProps): React.JSX.Element {
  const hasRenderedChildrenRef = useRef(expanded);
  if (expanded) {
    // Why: keep already-opened content mounted for the collapse transition
    // without paying an extra Effect-driven render on first expansion.
    hasRenderedChildrenRef.current = true;
  }
  const shouldRenderChildren = expanded || hasRenderedChildrenRef.current;

  return (
    <div
      className={cn(
        "compact-agent-expansion-grid",
        expanded && "compact-agent-expansion-grid-expanded",
      )}
      aria-hidden={!expanded}
      inert={!expanded}
    >
      <div className="min-h-0 overflow-hidden">
        {shouldRenderChildren && (
          <div
            className={cn(
              "compact-agent-expansion-content flex flex-col gap-0.5 pt-0.5",
              contentClassName,
            )}
          >
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

/** The identity glyph shown inside a summary cluster (the source's
 *  AgentIcon slot — this repo's harness icon, or the plain shell glyph). */
function SummaryIdentityIcon({
  session,
}: {
  session: Session;
}): React.JSX.Element {
  return (
    <span className="inline-flex size-4 items-center justify-center rounded-full border border-worktree-sidebar-border/70 bg-worktree-sidebar">
      {session.harnessId ? (
        <HarnessMenuIcon
          harnessId={session.harnessId}
          displayName=""
          size={13}
        />
      ) : null}
    </span>
  );
}

type CompactAgentSummaryButtonProps = {
  sessions: Session[];
  /** Identity label for a session (harness display name). */
  labelFor: (session: Session) => string;
  subjectLabel: string;
  expanded: boolean;
  onToggle: () => void;
};

export function CompactAgentSummaryButton({
  sessions,
  labelFor,
  subjectLabel,
  expanded,
  onToggle,
}: CompactAgentSummaryButtonProps): React.JSX.Element {
  const groups: SummarySessionGroup[] = buildCardSummaryGroups(sessions);
  const visibleGroups = groups.slice(0, 3);
  const hiddenGroupSessionCount = groups
    .slice(visibleGroups.length)
    .reduce((count, group) => count + group.sessions.length, 0);
  const agentIdentitySummary = summarizeSessionIdentities(sessions, labelFor);
  const summary = summarizeAgentsForAria(sessions, subjectLabel);
  const stopPointerPropagation = useCallback((e: React.SyntheticEvent) => {
    e.stopPropagation();
  }, []);
  const handleToggle = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      onToggle();
    },
    [onToggle],
  );
  return (
    <button
      type="button"
      draggable={false}
      className={cn(
        "compact-agent-summary-button group/agent-summary flex h-6 w-full min-w-0 items-center gap-1 rounded-sm",
        "px-1 text-left text-[11px] leading-none text-muted-foreground",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-worktree-sidebar-ring",
        // Why: worktree-sidebar-accent is near-white in light mode and dark in dark
        // mode, so hover lightening needs a theme-specific token mix.
        "hover:bg-worktree-sidebar-accent/55 dark:hover:bg-worktree-sidebar-foreground/[0.035]",
        // Why: expanded is a tree header inside the card, so only the
        // standalone collapsed pill gets a resting surface and border.
        expanded
          ? "compact-agent-summary-button-expanded"
          : "border border-worktree-sidebar-border/70 bg-worktree-sidebar-accent/35",
      )}
      aria-label={
        expanded
          ? `Collapse ${subjectLabel}`
          : `Expand ${subjectLabel}. ${summary}. ${agentIdentitySummary}`
      }
      aria-expanded={expanded}
      onClick={handleToggle}
      onKeyDown={stopActivationKeyPropagation}
      onMouseDown={stopPointerPropagation}
      onPointerDown={stopPointerPropagation}
      onDragStart={stopPointerPropagation}
    >
      {expanded ? (
        <span className="min-w-0 flex-1 truncate px-1 font-medium text-muted-foreground">
          {subjectLabel}
        </span>
      ) : (
        <>
          <span
            className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden"
            aria-hidden
          >
            {visibleGroups.map((group) => {
              const iconSessions = selectSummaryGroupIconSessions(group.sessions, 3);
              const hiddenIconCount = Math.max(
                0,
                group.sessions.length - iconSessions.length,
              );
              return (
                <span
                  key={group.state}
                  className="inline-flex min-w-0 shrink-0 items-center gap-0.5 rounded-sm bg-worktree-sidebar/70 px-1 py-0.5"
                >
                  <AgentStateIcon state={group.state} size={10} />
                  {/* Why: same-state session identities read as one status cluster;
                      overlapping them saves width without merging different states. */}
                  <span className="inline-flex shrink-0 items-center -space-x-0.5 pl-0.5">
                    {iconSessions.map((session) => (
                      <SummaryIdentityIcon key={session.id} session={session} />
                    ))}
                  </span>
                  {hiddenIconCount > 0 && (
                    <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
                      +{hiddenIconCount}
                    </span>
                  )}
                </span>
              );
            })}
            {hiddenGroupSessionCount > 0 && (
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
                +{hiddenGroupSessionCount}
              </span>
            )}
          </span>
        </>
      )}
      <ChevronDown
        className={cn(
          "size-3 shrink-0 transition-transform duration-150",
          !expanded && "-rotate-90",
        )}
        aria-hidden
      />
    </button>
  );
}

/** The source's `selectSummaryGroupIconAgents`: at most `maxCount` identity
 *  icons per state cluster, diverse by harness, majority first. */
function selectSummaryGroupIconSessions(
  sessions: Session[],
  maxCount: number,
): Session[] {
  const groups = new Map<string, { sessions: Session[]; firstIndex: number }>();
  sessions.forEach((session, index) => {
    const key = session.harnessId ?? "unknown";
    const group = groups.get(key);
    if (group) {
      group.sessions.push(session);
    } else {
      groups.set(key, { sessions: [session], firstIndex: index });
    }
  });
  const sortedGroups = [...groups.values()].sort(
    (a, b) => b.sessions.length - a.sessions.length || a.firstIndex - b.firstIndex,
  );
  const selected: Session[] = [];
  for (const group of sortedGroups) {
    if (selected.length >= maxCount) {
      break;
    }
    selected.push(group.sessions[0]!);
  }
  return selected;
}
