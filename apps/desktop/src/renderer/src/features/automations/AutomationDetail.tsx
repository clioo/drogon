// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/automations/AutomationDetail.tsx. Adaptation:
// the metrics show this repo's AutomationSummary fields (local schedule
// label, next run, host, run location = workspace, harness, last run);
// precheck/session/usage/cost/grace rows have no MVP list-projection source
// and are omitted. Header, toolbar actions and prompt disclosure stay literal.
import { Pause, Pencil, Play, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { cn } from "./automation-class-names";
import type { AutomationSummary } from "../../../../shared/automation-contract";
import { formatUiAutomationSchedule } from "./automation-schedule-label";
import { formatAutomationDateTimeWithRelative } from "./automation-page-parts";
import { AutomationPromptDisclosure } from "./AutomationPromptDisclosure";

function DetailMetric({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}): React.JSX.Element {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-sm font-medium" title={title}>
        {value}
      </div>
    </div>
  );
}

function ToolbarIconButton({
  label,
  children,
  onClick,
  className,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  className?: string;
}): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn("size-8 [&_svg]:size-4", className)}
    >
      {children}
    </Button>
  );
}

export function AutomationDetail({
  automation,
  workspaceName,
  now,
  running,
  onRunNow,
  onEdit,
  onToggle,
  onDelete,
}: {
  automation: AutomationSummary | null;
  workspaceName: string;
  now: number;
  running: boolean;
  onRunNow: (automation: AutomationSummary) => void;
  onEdit: (automation: AutomationSummary) => void;
  onToggle: (automation: AutomationSummary) => void;
  onDelete: (automation: AutomationSummary) => void;
}): React.JSX.Element {
  if (!automation) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Create an automation to start scheduling agent work.
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex items-start justify-between gap-4 border-b border-border/50 pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-semibold">{automation.name}</h2>
            <span
              className={cn(
                "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
                automation.enabled
                  ? "border-transparent bg-secondary text-secondary-foreground"
                  : "text-muted-foreground",
              )}
            >
              {automation.enabled ? "Enabled" : "Paused"}
            </span>
          </div>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {workspaceName} / {automation.harness}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onRunNow(automation)}
            disabled={running}
          >
            <Play className="size-4" />
            Run Now
          </Button>
          <ToolbarIconButton label="Edit automation" onClick={() => onEdit(automation)}>
            <Pencil className="size-4" />
          </ToolbarIconButton>
          <ToolbarIconButton
            label={automation.enabled ? "Pause automation" : "Resume automation"}
            onClick={() => onToggle(automation)}
          >
            {automation.enabled ? <Pause className="size-4" /> : <Play className="size-4" />}
          </ToolbarIconButton>
          <ToolbarIconButton
            label="Delete automation"
            onClick={() => onDelete(automation)}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </ToolbarIconButton>
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-5 rounded-md border border-border/50 bg-muted/30 px-4 py-3 shadow-sm">
        <DetailMetric
          label="Schedule"
          value={formatUiAutomationSchedule(automation.cron)}
          title={automation.cron}
        />
        <DetailMetric
          label="Next run"
          value={
            automation.enabled
              ? formatAutomationDateTimeWithRelative(automation.nextRunAt, now)
              : "Paused"
          }
        />
        <DetailMetric label="Host" value="Local" />
        <DetailMetric label="Run location" value={workspaceName} />
        <DetailMetric label="Harness" value={automation.harness} />
        <DetailMetric
          label="Last run"
          value={formatAutomationDateTimeWithRelative(automation.lastRunAt, now)}
        />
      </div>

      <AutomationPromptDisclosure
        key={`${automation.id}:${automation.prompt}`}
        prompt={automation.prompt}
      />
    </div>
  );
}
