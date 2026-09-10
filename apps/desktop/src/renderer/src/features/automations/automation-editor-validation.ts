// MIT Copyright (c) 2026 Lovecast Inc. Editor validation for the
// local-automation editor dialog. Cron validity reuses the existing
// automation-cron-preview helper (the daemon's croner stays authoritative);
// grace bounds mirror the shared automation-contract schema (0..10080).
import { previewCronFires, isValidTimezone, localTimezone } from "./automation-cron-preview";
import { localPresetToUtcCronParts, localToUtcOffsetMinutes } from "./automation-local-cron";
import { describeAutomationSchedule } from "./automation-schedule-label";

export type AutomationSchedulePreset =
  | "hourly"
  | "daily"
  | "weekdays"
  | "weekly"
  | "custom";

export type AutomationEditorDraft = {
  name: string;
  prompt: string;
  harness: string;
  workspaceId: string;
  preset: AutomationSchedulePreset;
  /** "HH:MM" 24h wall-clock value backing the preset pickers. */
  time: string;
  /** "0".."6" Sunday-first, backing the weekly picker. */
  dayOfWeek: string;
  /** IANA zone the wall time evaluates in; absent is the legacy UTC path. */
  timezone: string;
  customSchedule: string;
  enabled: boolean;
  graceMinutes: string;
  scheduleWarning: string | null;
};

export function blankAutomationDraft(workspaceId: string): AutomationEditorDraft {
  return {
    name: "",
    prompt: "",
    harness: "pi",
    workspaceId,
    preset: "daily",
    time: "09:00",
    dayOfWeek: "1",
    // New schedules are explicitly zoned in the host local zone, so the
    // wall time needs no local->UTC conversion on save (the legacy UTC
    // path only applies to rows stored without a zone).
    timezone: localTimezone(),
    customSchedule: "",
    enabled: true,
    graceMinutes: "15",
    scheduleWarning: null,
  };
}

/** Preset pickers build the stored 5-field cron from wall-clock parts. */
export function buildAutomationCronSchedule(args: {
  preset: Exclude<AutomationSchedulePreset, "custom">;
  hour: number;
  minute: number;
  dayOfWeek?: number;
}): string {
  const hour = Math.max(0, Math.min(23, Math.floor(args.hour)));
  const minute = Math.max(0, Math.min(59, Math.floor(args.minute)));
  if (args.preset === "hourly") {
    return `${minute} * * * *`;
  }
  if (args.preset === "weekdays") {
    return `${minute} ${hour} * * 1-5`;
  }
  if (args.preset === "weekly") {
    const day = Math.max(0, Math.min(6, Math.floor(args.dayOfWeek ?? 1)));
    return `${minute} ${hour} * * ${day}`;
  }
  return `${minute} ${hour} * * *`;
}

export function parseAutomationDraftTime(value: string): {
  hour: number;
  minute: number;
} {
  const [hour, minute] = value.split(":").map((part) => Number(part));
  return {
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 9,
    minute:
      Number.isInteger(minute) && minute >= 0 && minute <= 59 ? minute : 0,
  };
}

/**
 * Builds the stored cron for a draft. With an explicit zone the preset
 * wall time is stored verbatim in that zone — no local->UTC conversion,
 * so a zoned schedule is never double-converted. Drafts without a zone
 * keep the legacy behavior (local wall converted to the UTC the daemon
 * evaluates). `offsetMinutes` defaults to the live local offset; tests
 * pass explicit values. Custom cron stays verbatim in both paths.
 */
export function draftCron(
  draft: AutomationEditorDraft,
  offsetMinutes: number = localToUtcOffsetMinutes(),
): string {
  if (draft.preset === "custom") return draft.customSchedule.trim();
  const { hour, minute } = parseAutomationDraftTime(draft.time);
  if (draft.preset === "hourly") {
    // Minute-only crons need no conversion.
    return buildAutomationCronSchedule({ preset: "hourly", hour, minute });
  }
  if (draft.timezone.trim() !== "") {
    // Explicitly zoned (including explicit UTC): the wall time belongs to
    // the zone, so it is stored as-is.
    const day = Math.max(0, Math.min(6, Math.floor(Number(draft.dayOfWeek) || 0)));
    return buildAutomationCronSchedule({
      preset: draft.preset,
      hour,
      minute,
      dayOfWeek: day,
    });
  }
  const utc = localPresetToUtcCronParts(
    draft.preset,
    hour,
    minute,
    Number(draft.dayOfWeek),
    offsetMinutes,
  );
  return buildAutomationCronSchedule({
    preset: draft.preset,
    hour: utc.hour,
    minute: utc.minute,
    dayOfWeek: utc.dayOfWeek,
  });
}

export function isValidAutomationCron(cron: string): boolean {
  return (
    describeAutomationSchedule(cron).kind !== "invalid" &&
    previewCronFires(cron, Date.now()) !== null
  );
}

export type AutomationDraftErrors = {
  name?: string;
  prompt?: string;
  workspaceId?: string;
  harness?: string;
  schedule?: string;
  timezone?: string;
  graceMinutes?: string;
};

const HARNESSES = new Set(["claude", "pi", "opencode", "antigravity", "codex"]);

export function validateAutomationDraft(
  draft: AutomationEditorDraft,
): AutomationDraftErrors {
  const errors: AutomationDraftErrors = {};
  if (draft.name.trim() === "") {
    errors.name = "Give the automation a name.";
  } else if (draft.name.trim().length > 128) {
    errors.name = "Keep the name under 128 characters.";
  }
  if (draft.prompt.trim() === "") {
    errors.prompt = "Describe what the automation should do.";
  }
  if (draft.workspaceId.trim() === "") {
    errors.workspaceId = "Pick the workspace the automation runs in.";
  }
  if (!HARNESSES.has(draft.harness)) {
    errors.harness = "Pick a harness for the automation runs.";
  }
  const cron = draftCron(draft);
  if (cron === "") {
    errors.schedule = "Enter a five-field cron.";
  } else if (!isValidAutomationCron(cron)) {
    errors.schedule = "Enter a valid five-field cron before saving.";
  }
  if (draft.timezone.trim() !== "" && !isValidTimezone(draft.timezone.trim())) {
    errors.timezone = "Pick a valid timezone.";
  }
  const graceText = draft.graceMinutes.trim();
  if (graceText !== "") {
    const grace = Number(graceText);
    if (!Number.isFinite(grace) || grace < 0 || grace > 10_080) {
      errors.graceMinutes = "Grace must be within 0..=10080 minutes.";
    }
  }
  return errors;
}

export function parseGraceMinutes(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  return Number(trimmed);
}
