// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/automations/AutomationRunHistory.tsx.
// Adaptation: rows are this repo's AutomationRunView (scheduled time,
// trigger, detail, status); usage/workspace columns have no MVP source and
// are omitted. Header, count label, keyboard nav and empty copy stay literal.
import { useEffect, useRef, useState } from "react";
import { cn } from "./automation-class-names";
import type { AutomationRunView } from "../../../../shared/automation-contract";
import {
  formatAutomationRunCountLabel,
  projectAutomationRunHistory,
  type AutomationRunStatusVariant,
} from "./automation-run-history-projection";
import {
  getAutomationRunHistoryArrowTarget,
  isAutomationRunHistoryArrowKey,
  shouldHandleAutomationRunHistoryKey,
} from "./automation-run-history-keyboard-navigation";

function StatusBadge({
  label,
  variant,
}: {
  label: string;
  variant: AutomationRunStatusVariant;
}): React.JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        variant === "secondary" &&
          "border-transparent bg-secondary text-secondary-foreground",
        variant === "outline" && "text-muted-foreground",
        variant === "destructive" &&
          "border-transparent bg-destructive text-destructive-foreground",
        variant === "dot" && "text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

export function AutomationRunHistory({
  runs,
  automationId,
  now,
  onOpenRun,
}: {
  runs: AutomationRunView[];
  automationId: string;
  now: number;
  /** Source behavior: a row click (or Enter) selects and opens the run. */
  onOpenRun?: (run: AutomationRunView) => void;
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedRunState, setSelectedRunState] = useState<{
    automationId: string;
    runId: string | null;
  }>(() => ({
    automationId,
    runId: null,
  }));
  const projected = projectAutomationRunHistory(runs, now);
  const runCountLabel = formatAutomationRunCountLabel(runs);

  const selectedRunId =
    selectedRunState.automationId === automationId ? selectedRunState.runId : null;
  const selectedRun =
    projected.find((entry) => entry.run.id === selectedRunId) ?? projected[0] ?? null;

  const findRunRow = (runId: string): HTMLElement | null =>
    containerRef.current?.querySelector<HTMLElement>(
      `[data-automation-run-id="${runId}"]`,
    ) ?? null;

  useEffect(() => {
    if (runs.length === 0) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!shouldHandleAutomationRunHistoryKey(event)) {
        return;
      }

      if (event.key === "Enter") {
        if (selectedRun) {
          event.preventDefault();
          setSelectedRunState({ automationId, runId: selectedRun.run.id });
          onOpenRun?.(selectedRun.run);
        }
        return;
      }

      if (isAutomationRunHistoryArrowKey(event.key)) {
        const targetRun = getAutomationRunHistoryArrowTarget({
          runs,
          selectedRunId: selectedRun?.run.id ?? null,
          key: event.key,
        });
        if (targetRun) {
          event.preventDefault();
          setSelectedRunState({ automationId, runId: targetRun.id });
          findRunRow(targetRun.id)?.focus?.({ preventScroll: true });
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [automationId, onOpenRun, runs, selectedRun]);

  useEffect(() => {
    if (!selectedRunId) {
      return;
    }
    const element = findRunRow(selectedRunId);
    if (element && typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRunId]);

  return (
    <div
      ref={containerRef}
      className="rounded-md border border-border/50 bg-muted/20 shadow-sm"
      data-testid="automation-history"
    >
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
        <div className="text-sm font-medium">Run history</div>
        <div className="text-xs text-muted-foreground">{runCountLabel}</div>
      </div>
      <div className="min-h-[18rem] min-w-0">
        <div className="grid grid-cols-[minmax(9rem,1fr)_minmax(6rem,.6fr)_minmax(10rem,1.1fr)_minmax(6rem,auto)] gap-3 border-b border-border/50 px-3 py-1.5 text-[11px] font-medium uppercase text-muted-foreground">
          <div>Run</div>
          <div>Trigger</div>
          <div>Detail</div>
          <div>Status</div>
        </div>
        <div className="divide-y divide-border/50">
          {projected.map((entry) => (
            <button
              key={entry.run.id}
              type="button"
              data-automation-run-id={entry.run.id}
              data-testid={`history-run-${entry.run.id}`}
              data-current={selectedRun?.run.id === entry.run.id}
              className={cn(
                "grid w-full grid-cols-[minmax(9rem,1fr)_minmax(6rem,.6fr)_minmax(10rem,1.1fr)_minmax(6rem,auto)] items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                selectedRun?.run.id === entry.run.id && "bg-accent text-accent-foreground",
              )}
              onClick={() => {
                setSelectedRunState({ automationId, runId: entry.run.id });
                onOpenRun?.(entry.run);
              }}
            >
              <div className="min-w-0">
                <div className="truncate">{entry.scheduledLabel}</div>
              </div>
              <div className="min-w-0 truncate capitalize text-muted-foreground">
                {entry.run.trigger}
              </div>
              <div
                className="min-w-0 truncate text-muted-foreground"
                title={entry.detailLabel}
              >
                {entry.detailLabel}
              </div>
              <div className="flex justify-start">
                <StatusBadge label={entry.statusLabel} variant={entry.statusVariant} />
              </div>
            </button>
          ))}
          {projected.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No runs yet.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
