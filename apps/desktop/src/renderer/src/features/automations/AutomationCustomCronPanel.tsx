// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/automations/AutomationCustomCronPanel.tsx.
// Literal port (English copy, cron field chips, validity status).
import { CheckCircle2, CircleAlert } from "lucide-react";
import { Input } from "../../components/ui/input";
import { cn } from "./automation-class-names";
import {
  describeAutomationSchedule,
  formatUiAutomationScheduleDescriptor,
} from "./automation-schedule-label";
import { isValidAutomationCron, type AutomationEditorDraft } from "./automation-editor-validation";

const FIELD_CONTROL_CLASS = "border-input bg-input/30 shadow-xs dark:bg-input/30";

// Why: chip identity is the cron field position, not the copy.
const AUTOMATION_CRON_FIELD_IDS = ["minute", "hour", "day", "month", "weekday"] as const;

const AUTOMATION_CRON_FIELD_LABELS = ["Minute", "Hour", "Day", "Month", "Weekday"] as const;

export function getCronScheduleStatusLabel(schedule: string): {
  kind: "empty" | "invalid" | "valid";
  label: string;
} {
  const trimmed = schedule.trim();
  if (!trimmed) {
    return { kind: "empty", label: "Enter a five-field cron." };
  }
  if (!isValidAutomationCron(trimmed)) {
    return { kind: "invalid", label: "Enter a valid five-field cron before saving." };
  }
  // Why: branch on the parsed kind, not on rendered copy.
  const descriptor = describeAutomationSchedule(trimmed);
  if (descriptor.kind === "custom") {
    return { kind: "valid", label: "Valid custom cron" };
  }
  return { kind: "valid", label: formatUiAutomationScheduleDescriptor(descriptor) };
}

export function getCronFieldValues(schedule: string): readonly string[] {
  const parts = schedule.trim().split(/\s+/);
  return AUTOMATION_CRON_FIELD_IDS.map((_, index) => parts[index] ?? "...");
}

export function AutomationCustomCronPanel({
  draft,
  onDraftChange,
}: {
  draft: AutomationEditorDraft;
  onDraftChange: (updater: (current: AutomationEditorDraft) => AutomationEditorDraft) => void;
}): React.JSX.Element {
  const customScheduleStatus = getCronScheduleStatusLabel(draft.customSchedule);
  const customScheduleInvalid = customScheduleStatus.kind === "invalid";
  const cronFieldValues = getCronFieldValues(draft.customSchedule);

  return (
    <div className="grid gap-3">
      <div className="min-w-0 space-y-1.5">
        <div className="text-xs text-muted-foreground">Cron expression</div>
        <div>
          <Input
            value={draft.customSchedule}
            placeholder="0 9 * * 1-5"
            spellCheck={false}
            className={cn("font-mono", FIELD_CONTROL_CLASS)}
            aria-invalid={customScheduleInvalid}
            aria-describedby="automation-cron-status"
            onChange={(event) =>
              onDraftChange((current) => ({
                ...current,
                customSchedule: event.target.value,
                scheduleWarning: null,
              }))
            }
          />
          <div className="mt-2 grid grid-cols-5 gap-1.5">
            {AUTOMATION_CRON_FIELD_IDS.map((fieldId, index) => (
              <div
                key={fieldId}
                className="min-w-0 rounded-md border border-border/70 bg-muted/25 px-1.5 py-1 text-center"
              >
                <div
                  className="truncate text-[10px] font-medium text-muted-foreground"
                  title={AUTOMATION_CRON_FIELD_LABELS[index]}
                >
                  {AUTOMATION_CRON_FIELD_LABELS[index]}
                </div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-foreground">
                  {cronFieldValues[index]}
                </div>
              </div>
            ))}
          </div>
          <div
            id="automation-cron-status"
            className={cn(
              "mt-2 flex min-h-8 items-center gap-2 rounded-md border px-2 py-1.5 text-xs",
              customScheduleStatus.kind === "invalid"
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-border/70 bg-muted/30 text-muted-foreground",
            )}
          >
            {customScheduleStatus.kind === "invalid" ? (
              <CircleAlert className="size-3.5 shrink-0" />
            ) : (
              <CheckCircle2 className="size-3.5 shrink-0" />
            )}
            <span className="min-w-0 truncate">{customScheduleStatus.label}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
