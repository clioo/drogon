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

export function getAutomationTemplates(): AutomationTemplate[] {
  return [
    {
      id: "morning-brief",
      category: "Report",
      label: "Morning brief",
      description: "Summarize overnight changes in this workspace every weekday morning.",
      name: "Morning brief",
      prompt: "Summarize the overnight changes in this workspace: git log, open diffs and failing checks. Keep it under 20 lines.",
      preset: "weekdays",
      time: "09:00",
    },
    {
      id: "hourly-sweep",
      category: "Maintenance",
      label: "Hourly sweep",
      description: "Check for failing checks or stale sessions once an hour.",
      name: "Hourly sweep",
      prompt: "Check this workspace for failing checks or stale sessions and report what needs attention.",
      preset: "hourly",
      time: "09:00",
    },
    {
      id: "weekly-review",
      category: "Report",
      label: "Weekly review",
      description: "Review the week's commits and open work every Monday morning.",
      name: "Weekly review",
      prompt: "Review this week's commits and open work in this workspace and draft priorities for next week.",
      preset: "weekly",
      time: "09:00",
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
