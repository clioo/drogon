// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/right-sidebar/source-control/listing/section-header.tsx.
// Adapter: literal copy strings (no i18n in this repo); the conflict suffix
// is kept and stays hidden while the MVP contract reports no conflicts.
import React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "./panel-class-names";

export function SectionHeader({
  label,
  count,
  countTitle,
  conflictCount = 0,
  isCollapsed,
  onToggle,
  actions,
}: {
  label: string;
  count: number;
  /** Spells out what the count measures — e.g. files changed against a compare base. */
  countTitle?: string;
  conflictCount?: number;
  isCollapsed: boolean;
  onToggle: () => void;
  actions?: React.ReactNode;
}): React.JSX.Element {
  // Why: shared rounded container so the hover background spans the whole row instead of clipping around the label.
  return (
    <div className="pl-1 pr-3 pt-3 pb-1">
      <div className="group/section flex items-center rounded-md pr-1 hover:bg-accent hover:text-accent-foreground">
        <button
          type="button"
          className="flex flex-1 items-center gap-1 px-0.5 py-0.5 text-left text-xs font-semibold uppercase tracking-wider text-foreground/70 group-hover/section:text-accent-foreground"
          onClick={onToggle}
        >
          <ChevronDown
            className={cn("size-3.5 shrink-0 transition-transform", isCollapsed && "-rotate-90")}
          />
          <span>{label}</span>
          {/* Why: no aria-label here — inside the toggle button it would rewrite the
              button's accessible name; the explanation stays a hover-only title. */}
          <span className="text-[11px] font-medium tabular-nums" title={countTitle}>
            {count}
          </span>
          {conflictCount > 0 && (
            <span className="text-[11px] font-medium text-destructive/80">
              · {conflictCount} conflict{conflictCount === 1 ? "" : "s"}
            </span>
          )}
        </button>
        <div className="shrink-0 flex items-center">{actions}</div>
      </div>
    </div>
  );
}
