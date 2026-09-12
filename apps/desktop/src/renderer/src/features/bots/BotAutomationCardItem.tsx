/* MIT Copyright (c) 2026 Lovecast Inc.
 * One card in the redesigned AUTOMATIONS column (owner-design mockup):
 * name, Active/Paused chip, Run now, then a two-column grid of uppercase
 * labelled fields — SCHEDULE, TIMEZONE, HARNESS & MODEL, NEXT RUN, LAST
 * RUN, WORKSPACE — the prompt in a quoted box, and a footer with the run
 * count on the left and the real automation id on the right.
 * Honesty contract: every cell comes from the joined real scheduler
 * record (`automation.list`) or the bot's own history; a missing join
 * renders "—" instead of a plausible value. The mockup's "View run
 * history →" link is omitted (no cross-page navigation seam in this
 * build); the run count and id carry the same evidence. */

import { Play } from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import type { AutomationSummary } from "../../../../shared/automation-contract";
import type {
  BotsPanelHistoryEntry,
  BotsPanelResponsibility,
} from "./bots-panel-contracts";
import {
  formatAutomationDateTimeWithRelative,
  formatAutomationRelativeTime,
  getAutomationRunStatusLabel,
} from "../automations/automation-page-parts";
import { botHarnessLabel } from "./bots-page-model";

/** Right-hand evidence line for one history row: the run's real status
 *  verdict and ordinal (`completed · run 3`), or the honest fallback for
 *  orphaned rows. Moved from the old card-level history section — the
 *  redesigned automation card owns its own runs. */
function historyDetail(entry: BotsPanelHistoryEntry): string {
  if (
    entry.automationRunNumber !== null &&
    entry.automationRunNumber !== undefined
  ) {
    const ordinal = `run ${entry.automationRunNumber}`;
    return entry.automationRunStatus
      ? `${entry.automationRunStatus} · ${ordinal}`
      : `${entry.automationName ?? "automation"} · ${ordinal}`;
  }
  if (entry.run.recipe?.runId) {
    return `Work Graph run ${entry.run.recipe.runId}`;
  }
  return "Recorded";
}

function GridCell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="mt-1 truncate text-sm text-foreground">{children}</div>
    </div>
  );
}

export function BotAutomationCardItem({
  responsibility,
  automation,
  botId,
  history,
  historyLimit = 3,
  busy,
  onRun,
}: {
  responsibility: BotsPanelResponsibility;
  botId: string;
  /** The real scheduler record joined by automationId; null when the
   *  record is gone or the automation namespace is unavailable — the grid
   *  then renders honest dashes over the fields only the store has. */
  automation: AutomationSummary | null;
  /** This automation's run evidence, newest first (the snapshot's order
   *  is preserved, never re-sorted). */
  history: BotsPanelHistoryEntry[];
  historyLimit?: number;
  busy: boolean;
  onRun: () => void;
}) {
  const enabled = automation?.enabled ?? responsibility.enabled;
  const statusLabel = enabled ? "Active" : "Paused";
  return (
    <div
      data-testid={`bot-automation-${responsibility.id}`}
      className="rounded-lg border border-border px-3 py-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 truncate text-sm font-medium">
          {responsibility.name}
        </span>
        <Badge variant={enabled ? "secondary" : "outline"}>{statusLabel}</Badge>
        <Button
          variant="outline"
          size="xs"
          className="ml-auto"
          aria-label={`Run ${responsibility.name}`}
          data-bot-id={botId}
          data-responsibility-id={responsibility.id}
          disabled={busy || !responsibility.enabled}
          onClick={onRun}
        >
          <Play />
          Run now
        </Button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
        <GridCell label="Schedule">
          {automation ? (
            <span className="font-mono text-xs">{automation.cron}</span>
          ) : (
            "—"
          )}
        </GridCell>
        <GridCell label="Timezone">
          {automation?.timezone ?? "—"}
        </GridCell>
        <GridCell label="Harness & model">
          {automation
            ? `${botHarnessLabel(automation.harness)} · ${automation.model ?? "default"}`
            : "—"}
        </GridCell>
        <GridCell label="Next run">
          {automation && automation.enabled && automation.nextRunAt
            ? formatAutomationDateTimeWithRelative(automation.nextRunAt)
            : "—"}
        </GridCell>
        <GridCell label="Last run">
          {automation?.lastRun ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                aria-hidden
                className={
                  automation.lastRun.status === "completed"
                    ? "size-2 shrink-0 rounded-full bg-emerald-500"
                    : automation.lastRun.status === "dispatch_failed"
                      ? "size-2 shrink-0 rounded-full bg-destructive"
                      : "size-2 shrink-0 rounded-full bg-muted-foreground/50"
                }
              />
              <span className="truncate">
                {getAutomationRunStatusLabel(automation.lastRun.status)}
                {automation.lastRunAt
                  ? ` · ${formatAutomationRelativeTime(automation.lastRunAt) ?? ""}`
                  : ""}
              </span>
            </span>
          ) : (
            "No runs yet"
          )}
        </GridCell>
        <GridCell label="Workspace">
          {/* The scheduler record's workspace id is shown only as the
              honest id fragment — the display name lives with the host's
              workspace list, which this read does not fetch. */}
          {automation?.workspaceId ? (
            <span className="font-mono text-xs">
              {automation.workspaceId.slice(0, 8)}
            </span>
          ) : (
            "—"
          )}
        </GridCell>
      </div>
      {responsibility.instructions ? (
        <blockquote className="mt-3 rounded-md bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
          “{responsibility.instructions}”
        </blockquote>
      ) : null}
      {history.length ? (
        <div className="mt-3 space-y-1.5">
          {history.slice(0, historyLimit).map((entry) => (
            <div
              key={entry.run.id}
              data-testid={`history-${entry.run.id}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs"
            >
              <span className="min-w-0 truncate text-muted-foreground">
                {entry.responsibilityName ?? "Removed responsibility"}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {historyDetail(entry)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2">
        <span className="text-xs text-muted-foreground">
          {history.length === 1 ? "1 run" : `${history.length} runs`}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {automation?.id ??
            (responsibility.trigger.kind === "scheduled"
              ? responsibility.trigger.automationId
              : "")}
        </span>
      </div>
    </div>
  );
}

export default BotAutomationCardItem;
