// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/automations/AutomationsDetailPane.tsx.
// Adaptation: local automation only (no external branch, no host recovery);
// the back button, Overview/Runs tabs with run count, Escape handling and
// tab arrow navigation stay literal.
import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "../../components/ui/button";
import { cn } from "./automation-class-names";
import type {
  AutomationRunView,
  AutomationSummary,
} from "../../../../shared/automation-contract";
import { AutomationDetail } from "./AutomationDetail";
import { AutomationRunHistory } from "./AutomationRunHistory";
import {
  getAutomationDetailNextTab,
  shouldHandleAutomationDetailEscapeKey,
  shouldHandleAutomationDetailTabArrowKey,
  type AutomationPaneTab,
} from "./automation-detail-tab-navigation";

export function AutomationsDetailPane({
  selected,
  workspaceName,
  runs,
  runsLoading,
  runsError,
  activePaneTab,
  relativeNow,
  running,
  onActivePaneTabChange,
  onRunNow,
  onEdit,
  onToggle,
  onDelete,
  onBackToList,
  onOpenRun,
}: {
  selected: AutomationSummary | null;
  workspaceName: string;
  runs: AutomationRunView[];
  runsLoading: boolean;
  runsError: string | null;
  activePaneTab: AutomationPaneTab;
  relativeNow: number;
  running: boolean;
  onActivePaneTabChange: (tab: AutomationPaneTab) => void;
  onRunNow: (automation: AutomationSummary) => void;
  onEdit: (automation: AutomationSummary) => void;
  onToggle: (automation: AutomationSummary) => void;
  onDelete: (automation: AutomationSummary) => void;
  onBackToList: () => void;
  /** Source behavior: opening a run navigates to the run details page. */
  onOpenRun?: (run: AutomationRunView) => void;
}): React.JSX.Element {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      // Why: dialogs above the pane (editor, delete confirm) already
      // consumed Escape; never navigate the list underneath them.
      if (event.defaultPrevented) {
        return;
      }
      if (shouldHandleAutomationDetailEscapeKey(event)) {
        event.preventDefault();
        onBackToList();
        return;
      }

      if (!selected) {
        return;
      }

      if (shouldHandleAutomationDetailTabArrowKey(event)) {
        const nextTab = getAutomationDetailNextTab({
          currentTab: activePaneTab,
          key: event.key as "ArrowLeft" | "ArrowRight",
          canAccessRuns: Boolean(selected),
        });
        if (nextTab && nextTab !== activePaneTab) {
          event.preventDefault();
          onActivePaneTabChange(nextTab);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activePaneTab, onActivePaneTabChange, onBackToList, selected]);

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex flex-1 flex-col">
        <div
          className="flex shrink-0 items-center gap-2 border-b border-border/50 px-5 py-2"
          data-contextual-tour-target="automations-runs"
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onBackToList}
            aria-label="All automations"
            title="All automations"
            className="size-8 [&_svg]:size-4"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div role="tablist" aria-label="Automation detail" className="flex h-8 items-center gap-1">
            {(["overview", "runs"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={activePaneTab === tab}
                onClick={() => onActivePaneTabChange(tab)}
                className={cn(
                  "rounded-sm px-3 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  activePaneTab === tab
                    ? "bg-muted text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab === "overview" ? "Overview" : "Runs"}{" "}
                {tab === "runs" ? (
                  <span className="text-xs text-muted-foreground">{runs.length}</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        <div
          role="tabpanel"
          className="automations-table-container min-h-0 flex-1 overflow-auto p-5"
        >
          {activePaneTab === "overview" ? (
            <AutomationDetail
              automation={selected}
              workspaceName={workspaceName}
              now={relativeNow}
              running={running}
              onRunNow={onRunNow}
              onEdit={onEdit}
              onToggle={onToggle}
              onDelete={onDelete}
            />
          ) : selected ? (
            runsLoading ? (
              <p className="text-sm text-muted-foreground">Loading history…</p>
            ) : runsError !== null ? (
              <p role="alert" className="text-sm text-destructive">
                {runsError}
              </p>
            ) : (
              <AutomationRunHistory
                runs={runs}
                automationId={selected.id}
                now={relativeNow}
                onOpenRun={onOpenRun}
              />
            )
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select an automation to view runs.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
