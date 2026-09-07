// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/automations/AutomationsPageTopBar.tsx.
// Adaptation: the owner-conflict notice and runs-dashboard breadcrumbs are
// out of MVP scope; the title header and the detail breadcrumb stay literal.
import { ChevronRight } from "lucide-react";

export function AutomationsPageTopBar({
  isDetailOpen,
  selectedAutomationName,
  showAutomationsList,
}: {
  isDetailOpen: boolean;
  selectedAutomationName?: string;
  showAutomationsList: () => void;
}): React.JSX.Element {
  return (
    <header
      className="flex shrink-0 flex-col gap-1 px-3 pb-3 md:px-5"
      style={{ paddingRight: "max(0.75rem, var(--window-controls-width, 0px))" }}
    >
      {isDetailOpen && selectedAutomationName ? (
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm">
          <button
            type="button"
            onClick={showAutomationsList}
            className="shrink-0 rounded-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            Automations
          </button>
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <h1 className="truncate text-base font-semibold leading-8">
            {selectedAutomationName}
          </h1>
        </nav>
      ) : (
        <h1 className="truncate text-base font-semibold leading-8">Automations</h1>
      )}
      <p className="text-sm text-muted-foreground">
        Local automations. Times are shown in your local time.
      </p>
    </header>
  );
}
