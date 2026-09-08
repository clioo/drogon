// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/automations/AutomationRunsTable.tsx.
// Adaptation: no @tanstack/react-virtual in this repo, so rows render
// directly (the source's row height/overscan only bound its virtualized
// window; the visible DOM for small histories is identical). Column grid,
// row copy, empty/loading states and the near-bottom load-more trigger
// stay literal.
import { useEffect, useRef } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { Badge } from "../../components/ui/badge";
import type { AutomationRunsDashboardEntry } from "./automation-runs-dashboard-model";
import { AUTOMATION_RUNS_LOCAL_HOST_LABEL } from "./automation-runs-dashboard-model";
import {
  formatAutomationDateTimeWithRelative,
  getAutomationRunStatusLabel,
  getAutomationRunStatusVariant,
} from "./automation-page-parts";

const RUN_ROW_HEIGHT_PX = 59;

export function AutomationRunsTable({
  entries,
  loading,
  hasMore,
  onLoadMore,
  onOpenRun,
}: {
  entries: readonly AutomationRunsDashboardEntry[];
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onOpenRun: (entry: AutomationRunsDashboardEntry) => void;
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadMoreRequestedRef = useRef(false);
  useEffect(() => {
    if (!loading) {
      loadMoreRequestedRef.current = false;
    }
  }, [loading]);

  return (
    <div className="flex min-h-[18rem] flex-col overflow-hidden rounded-lg border border-border/60 bg-card">
      <div className="grid shrink-0 grid-cols-[minmax(11rem,1.4fr)_minmax(10rem,1fr)_minmax(5rem,.55fr)_minmax(8rem,.8fr)_minmax(7rem,auto)] gap-3 border-b border-border/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        <div>Automation</div>
        <div>Triggered</div>
        <div>Trigger</div>
        <div>Host</div>
        <div>Status</div>
      </div>
      <div
        ref={scrollRef}
        className="scrollbar-sleek h-[calc(100vh-21rem)] min-h-[15rem] overflow-auto"
        onScroll={(event) => {
          const { clientHeight, scrollHeight, scrollTop } = event.currentTarget;
          const nearEnd = scrollHeight - scrollTop - clientHeight < RUN_ROW_HEIGHT_PX * 10;
          if (hasMore && !loading && nearEnd && !loadMoreRequestedRef.current) {
            loadMoreRequestedRef.current = true;
            onLoadMore();
          }
        }}
      >
        {loading && entries.length === 0 ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading runs…
          </div>
        ) : entries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
            <div className="text-sm font-medium">No runs yet</div>
            <div className="text-xs text-muted-foreground">
              Runs appear here after an automation is triggered.
            </div>
          </div>
        ) : (
          <div className="relative w-full">
            {entries.map((entry) => (
              <div key={entry.key} className="border-b border-border/50">
                <button
                  type="button"
                  data-testid="automation-runs-row"
                  className="grid w-full grid-cols-[minmax(11rem,1.4fr)_minmax(10rem,1fr)_minmax(5rem,.55fr)_minmax(8rem,.8fr)_minmax(7rem,auto)] items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  onClick={() => onOpenRun(entry)}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 truncate font-medium">
                      <span className="truncate">{entry.run.automationName}</span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {entry.run.title}
                    </div>
                  </div>
                  <div className="min-w-0 truncate text-xs">
                    {formatAutomationDateTimeWithRelative(entry.run.scheduledFor)}
                  </div>
                  <div className="capitalize text-xs text-muted-foreground">
                    {entry.run.trigger}
                  </div>
                  <div className="min-w-0 truncate text-xs">
                    {AUTOMATION_RUNS_LOCAL_HOST_LABEL}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant={getAutomationRunStatusVariant(entry.run.status)}>
                      {getAutomationRunStatusLabel(entry.run.status)}
                    </Badge>
                    <ChevronRight className="size-3.5 text-muted-foreground" />
                  </div>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
