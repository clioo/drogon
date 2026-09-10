// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/automations/AutomationSchedulePicker.tsx.
// Literal port of the cadence select + preset pickers + custom cron panel;
// weekday names are English (no i18n catalog in this repo).
import { cn } from "./automation-class-names";
import type { AutomationEditorDraft, AutomationSchedulePreset } from "./automation-editor-validation";
import { AutomationCustomCronPanel } from "./AutomationCustomCronPanel";
import { AutomationTimeField } from "./AutomationTimeField";
import { draftCron } from "./automation-editor-validation";
import { weekdayName } from "./automation-schedule-label";

const FIELD_CONTROL_CLASS = "border-input bg-input/30 shadow-xs dark:bg-input/30";
const AUTOMATION_WEEKDAY_VALUES = ["0", "1", "2", "3", "4", "5", "6"] as const;

export const AUTOMATION_SCHEDULE_PRESET_OPTIONS = [
  ["hourly", "Hourly"],
  ["daily", "Daily"],
  ["weekdays", "Weekdays"],
  ["weekly", "Weekly"],
  ["custom", "Custom cron"],
] as const satisfies readonly (readonly [AutomationSchedulePreset, string])[];

function buildCustomScheduleSeed(
  draft: AutomationEditorDraft,
  offsetMinutes?: number,
): string {
  const existing = draft.customSchedule.trim();
  if (existing) {
    return draft.customSchedule;
  }
  if (draft.preset === "custom") {
    return "";
  }
  // The preset is still the previous one here, so draftCron renders the
  // same wall time the preset stored: switching to custom seeds the
  // equivalent expression instead of shifting the schedule (zoned drafts
  // seed the in-zone wall time verbatim; legacy drafts keep the UTC
  // conversion inside draftCron).
  return offsetMinutes === undefined
    ? draftCron(draft)
    : draftCron(draft, offsetMinutes);
}

export function getSchedulePresetDraft(
  current: AutomationEditorDraft,
  preset: AutomationSchedulePreset,
  offsetMinutes?: number,
): Pick<AutomationEditorDraft, "preset" | "customSchedule" | "scheduleWarning"> {
  return {
    preset,
    customSchedule:
      preset === "custom"
        ? buildCustomScheduleSeed(current, offsetMinutes)
        : current.customSchedule,
    scheduleWarning: null,
  };
}

function Field({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

const selectClass = (extra?: string): string =>
  cn(
    "h-9 w-full min-w-0 rounded-md border px-3 py-1 text-sm outline-none",
    "bg-input/30 shadow-xs dark:bg-input/30",
    "focus-visible:ring-[3px] focus-visible:ring-ring/50",
    extra,
  );

export function AutomationSchedulePicker({
  draft,
  onDraftChange,
}: {
  draft: AutomationEditorDraft;
  onDraftChange: (updater: (current: AutomationEditorDraft) => AutomationEditorDraft) => void;
}): React.JSX.Element {
  const setTime = (time: string): void => {
    onDraftChange((current) => ({
      ...current,
      time,
      scheduleWarning: null,
    }));
  };

  return (
    <div className="grid gap-3">
      <select
        value={draft.preset}
        aria-label="Cadence"
        className={selectClass()}
        onChange={(event) =>
          onDraftChange((current) => ({
            ...current,
            ...getSchedulePresetDraft(current, event.target.value as AutomationSchedulePreset),
          }))
        }
      >
        {AUTOMATION_SCHEDULE_PRESET_OPTIONS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      {draft.preset === "custom" ? (
        <AutomationCustomCronPanel draft={draft} onDraftChange={onDraftChange} />
      ) : (
        <>
          {draft.preset === "weekly" ? (
            <Field label="Day">
              <select
                value={draft.dayOfWeek}
                aria-label="Day"
                className={selectClass()}
                onChange={(event) =>
                  onDraftChange((current) => ({
                    ...current,
                    dayOfWeek: event.target.value,
                    scheduleWarning: null,
                  }))
                }
              >
                {AUTOMATION_WEEKDAY_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {weekdayName(Number(value))}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {draft.preset === "hourly" ? (
            <Field label="Minute">
              <AutomationTimeField time={draft.time} mode="minute" onTimeChange={setTime} />
            </Field>
          ) : (
            <Field label="Time">
              <AutomationTimeField time={draft.time} mode="time" onTimeChange={setTime} />
            </Field>
          )}
        </>
      )}
    </div>
  );
}
