// MIT Copyright (c) 2026 Lovecast Inc. Editor validation for the
// local-automation editor dialog. Cron validity reuses the existing
// automation-cron-preview helper (the daemon's croner stays authoritative);
// grace bounds mirror the shared automation-contract schema (0..10080).
import { previewCronFires } from "./automation-cron-preview";
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
    customSchedule: "",
    enabled: true,
    graceMinutes: "15",
    scheduleWarning: null,
  };
}

/** Preset pickers build the stored 5-field cron (local wall-clock time). */
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

export function draftCron(draft: AutomationEditorDraft): string {
  if (draft.preset === "custom") return draft.customSchedule.trim();
  const { hour, minute } = parseAutomationDraftTime(draft.time);
  return buildAutomationCronSchedule({
    preset: draft.preset,
    hour,
    minute,
    dayOfWeek: Number(draft.dayOfWeek),
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
  graceMinutes?: string;
};

const HARNESSES = new Set(["claude", "pi", "opencode", "antigravity"]);

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
