// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/automations/AutomationsPageBreadcrumb.tsx.
// Literal port (translate() inlined to its English fallbacks; the Buttons
// and copy match the source exactly).
import React from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "../../components/ui/button";

export function AutomationsPageBreadcrumb({
  current,
  onBackToAutomations,
  onBackToRuns,
  automationName,
  onBackToAutomation,
}: {
  current: "runs" | "run" | "automation";
  onBackToAutomations: () => void;
  onBackToRuns?: () => void;
  automationName?: string;
  onBackToAutomation?: () => void;
}): React.JSX.Element {
  return (
    <nav aria-label="Automations breadcrumb" className="flex min-w-0 items-center text-sm">
      <Button
        type="button"
        variant="link"
        className="h-8 px-0 font-normal text-muted-foreground"
        onClick={onBackToAutomations}
      >
        Automations
      </Button>
      <ChevronRight className="mx-1 size-3.5 shrink-0 text-muted-foreground" />
      {current === "automation" ? (
        <span className="truncate font-medium" aria-current="page">
          {automationName}
        </span>
      ) : current === "run" ? (
        <>
          {automationName ? (
            <Button
              type="button"
              variant="link"
              className="h-8 max-w-[28ch] truncate px-0 font-normal text-muted-foreground"
              onClick={onBackToAutomation}
            >
              {automationName}
            </Button>
          ) : (
            <Button
              type="button"
              variant="link"
              className="h-8 px-0 font-normal text-muted-foreground"
              onClick={onBackToRuns}
            >
              Runs
            </Button>
          )}
          <ChevronRight className="mx-1 size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium" aria-current="page">
            Run details
          </span>
        </>
      ) : (
        <span className="truncate font-medium" aria-current="page">
          Runs
        </span>
      )}
    </nav>
  );
}
