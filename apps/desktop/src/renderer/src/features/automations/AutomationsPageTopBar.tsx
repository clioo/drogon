// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/automations/AutomationsPageTopBar.tsx.
// Adaptation: the owner-conflict notice has no local counterpart and is
// omitted; the pageView-driven breadcrumb stays literal. R8-O1's local-time
// note under the list heading is preserved (this build schedules in local
// time); breadcrumb views render the source's single-row header.
import { AutomationsPageBreadcrumb } from "./AutomationsPageBreadcrumb";
import { cn } from "./automation-class-names";

export function AutomationsPageTopBar({
  pageView,
  isDetailOpen,
  selectedAutomationName,
  runPageOrigin,
  showAutomationsList,
  showRunsDashboard,
  showAutomationDetails,
}: {
  pageView: "automations" | "runs" | "run";
  isDetailOpen: boolean;
  selectedAutomationName?: string;
  runPageOrigin: "automation" | "runs";
  showAutomationsList: () => void;
  showRunsDashboard: () => void;
  showAutomationDetails: () => void;
}): React.JSX.Element {
  const breadcrumbView =
    pageView === "runs" || pageView === "run"
      ? "runs-or-run"
      : isDetailOpen && selectedAutomationName
        ? "automation"
        : "list";
  return (
    <header
      className={cn(
        "shrink-0 px-3 pb-3 md:px-5",
        breadcrumbView === "list"
          ? // R8-O1 kept the local-time note under the list heading; the
            // breadcrumb views render the source's single-row header.
            "flex flex-col gap-1"
          : "flex items-center",
      )}
      style={{ paddingRight: "max(0.75rem, var(--window-controls-width, 0px))" }}
    >
      {breadcrumbView === "runs-or-run" ? (
        <AutomationsPageBreadcrumb
          current={pageView === "run" ? "run" : "runs"}
          onBackToAutomations={showAutomationsList}
          onBackToRuns={showRunsDashboard}
          automationName={runPageOrigin === "automation" ? selectedAutomationName : undefined}
          onBackToAutomation={showAutomationDetails}
        />
      ) : breadcrumbView === "automation" ? (
        <AutomationsPageBreadcrumb
          current="automation"
          automationName={selectedAutomationName}
          onBackToAutomations={showAutomationsList}
        />
      ) : (
        <>
          <h1 className="truncate text-base font-semibold leading-8">Automations</h1>
          <p className="text-sm text-muted-foreground">
            Local automations. Times are shown in your local time.
          </p>
        </>
      )}
    </header>
  );
}
