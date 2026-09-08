// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/automations/AutomationListEmptyView.tsx and
// AutomationTemplateEmptyState.tsx. Adaptation: templates create local
// automations (name/prompt/preset seeds); the card DOM stays literal.
import { Plus } from "lucide-react";
import { Button } from "../../components/ui/button";
import { cn } from "./automation-class-names";
import {
  resolveAutomationListEmptyState,
  type AutomationListEmptyStateKind,
} from "./automation-list-projection";
import type { AutomationSchedulePreset } from "./automation-editor-validation";

export type AutomationTemplate = {
  id: string;
  category: string;
  label: string;
  description: string;
  name: string;
  prompt: string;
  preset: AutomationSchedulePreset;
  time: string;
};

// Source catalog (automation-templates.ts, English defaults): the dayOfWeek,
// agentId and missedRunGraceMinutes seeds have no counterpart in this
// repo's template shape, so only the schedule preset + wall-clock time that
// the local editor backs are carried over.
export function getAutomationTemplates(): AutomationTemplate[] {
  return [
    {
      id: "repo-health-weekday",
      category: "Repo health",
      label: "Weekday repo audit",
      description: "Check dependencies, failing tests, and risky open changes each weekday.",
      name: "Weekday repo audit",
      prompt: "Review the repository health. Check dependency updates, failing tests, lint/typecheck status, and risky open changes. Summarize findings and suggest the next action.",
      preset: "weekdays",
      time: "09:00",
    },
    {
      id: "release-prep-weekly",
      category: "Release prep",
      label: "Release readiness",
      description: "Prepare a weekly release risk summary from the current project state.",
      name: "Release readiness review",
      prompt: "Prepare a release readiness summary. Look for blockers, unmerged risky changes, missing validation, and documentation gaps. End with a concise release/no-release recommendation.",
      preset: "weekly",
      time: "14:00",
    },
    {
      id: "recurring-review-daily",
      category: "Recurring review",
      label: "Daily change review",
      description: "Scan recent work and call out correctness, UX, and test coverage risks.",
      name: "Daily change review",
      prompt: "Review recent changes in this workspace. Focus on correctness risks, UX regressions, missing tests, and follow-up tasks. Keep the report short and actionable.",
      preset: "daily",
      time: "16:30",
    },
    {
      id: "maintenance-hourly",
      category: "Maintenance",
      label: "Hourly queue check",
      description: "Look for stuck work, stale generated files, and failed local validation.",
      name: "Hourly maintenance check",
      prompt: "Check for stuck work, stale generated files, failing validation, and anything that needs human attention. Report only actionable issues.",
      preset: "hourly",
      time: "00:15",
    },
  ];
}

export function AutomationListEmptyView({
  emptyState,
  className,
}: {
  emptyState: { kind: AutomationListEmptyStateKind; title: string; detail: string | null };
  className?: string;
}): React.JSX.Element | null {
  if (emptyState.kind === "rows") {
    return null;
  }

  return (
    <div
      data-empty-state={emptyState.kind}
      className={cn(
        "flex flex-col items-center gap-1.5 px-6 py-10 text-center text-muted-foreground",
        className,
      )}
    >
      <p className="text-sm text-foreground">{emptyState.title}</p>
      {emptyState.detail ? <p className="text-xs">{emptyState.detail}</p> : null}
    </div>
  );
}

export type AutomationListEmptyViewProps = {
  loading: boolean;
  error: string | null;
  totalCount: number;
  visibleCount: number;
  searchActive: boolean;
  filterActive: boolean;
  className?: string;
};

export function AutomationListEmptyStateView(
  props: AutomationListEmptyViewProps,
): React.JSX.Element | null {
  const { loading, error, totalCount, visibleCount, searchActive, filterActive, className } =
    props;
  const state = resolveAutomationListEmptyState({
    loading,
    error,
    totalCount,
    visibleCount,
    searchActive,
    filterActive,
  });
  return <AutomationListEmptyView emptyState={state} className={className} />;
}

export function AutomationTemplateEmptyState({
  onOpenCreate,
}: {
  onOpenCreate: (template?: AutomationTemplate) => void;
}): React.JSX.Element {
  return (
    <div className="mx-auto grid max-w-2xl gap-2 p-4">
      <div className="px-1 pb-1 text-sm font-medium">Start from a template</div>
      {getAutomationTemplates().map((template) => (
        <button
          key={template.id}
          type="button"
          onClick={() => onOpenCreate(template)}
          className="rounded-md border border-border/70 bg-background px-3 py-2 text-left shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <div className="text-[11px] font-medium uppercase text-muted-foreground">
            {template.category}
          </div>
          <div className="mt-1 text-sm font-medium">{template.label}</div>
          <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {template.description}
          </div>
        </button>
      ))}
      <Button
        type="button"
        variant="outline"
        className="mt-1 w-full justify-start"
        onClick={() => onOpenCreate()}
      >
        <Plus className="size-4" />
        Add new
      </Button>
    </div>
  );
}
