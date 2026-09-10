// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/automations/automation-schedule-label.ts and
// src/shared/automation-schedules.ts (classify + format helpers). Adaptation:
// English-only copy (no i18n catalog) and plain cron input (this repo stores
// `cron`, not `rrule`); classification and local-time rendering are literal.
import {
  localToUtcOffsetMinutes,
  utcCronPartsToLocal,
} from "./automation-local-cron";
export type AutomationScheduleDescriptor =
  | { kind: "hourly"; minute: number }
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekdays"; hour: number; minute: number }
  | { kind: "weekly"; hour: number; minute: number; dayOfWeek: number }
  | { kind: "custom" }
  | { kind: "invalid" };

const EN_DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const MONTH_NAMES: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

const DAY_NAMES: Record<string, number> = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};

function parseValue(
  token: string,
  names: Record<string, number> | null,
  min: number,
  max: number,
): number | null {
  const upper = token.toUpperCase();
  const named = names?.[upper];
  const value = named ?? Number(upper);
  if (!Number.isInteger(value) || upper === "") return null;
  const normalized = names === DAY_NAMES && value === 7 ? 0 : value;
  if (normalized < min || normalized > max) return null;
  return normalized;
}

function parseField(
  raw: string,
  names: Record<string, number> | null,
  min: number,
  max: number,
): { values: Set<number>; restricted: boolean } | null {
  const text = raw.trim();
  if (text === "") return null;
  const values = new Set<number>();
  const restricted = text !== "*";
  for (const part of text.split(",")) {
    const [range, stepText] = part.split("/");
    if (range === undefined || range === "") return null;
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) return null;
    let from: number;
    let to: number;
    if (range === "*") {
      from = min;
      to = max;
    } else if (range.includes("-")) {
      const [lo, hi] = range.split("-");
      if (lo === undefined || hi === undefined) return null;
      const low = parseValue(lo, names, min, max);
      const high = parseValue(hi, names, min, max);
      if (low === null || high === null || low > high) return null;
      from = low;
      to = high;
    } else {
      const single = parseValue(range, names, min, max);
      if (single === null) return null;
      from = single;
      to = single;
    }
    for (let value = from; value <= to; value += step) values.add(value);
  }
  if (values.size === 0) return null;
  return { values, restricted };
}

type ParsedCron = {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
};

function parseCron(cron: string): ParsedCron | null {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minute, hour, dom, month, dow] = fields as [
    string, string, string, string, string,
  ];
  const minutes = parseField(minute, null, 0, 59);
  const hours = parseField(hour, null, 0, 23);
  const daysOfMonth = parseField(dom, null, 1, 31);
  const months = parseField(month, MONTH_NAMES, 1, 12);
  const daysOfWeek = parseField(dow, DAY_NAMES, 0, 7);
  if (!minutes || !hours || !daysOfMonth || !months || !daysOfWeek) {
    return null;
  }
  return {
    minutes: minutes.values,
    hours: hours.values,
    daysOfMonth: daysOfMonth.values,
    months: months.values,
    daysOfWeek: daysOfWeek.values,
    domRestricted: daysOfMonth.restricted,
    dowRestricted: daysOfWeek.restricted,
  };
}

function singleValue(values: Set<number>): number | null {
  if (values.size !== 1) return null;
  return values.values().next().value as number;
}

function containsRange(values: Set<number>, min: number, max: number): boolean {
  if (values.size !== max - min + 1) return false;
  for (let value = min; value <= max; value += 1) {
    if (!values.has(value)) return false;
  }
  return true;
}

function containsExactly(values: Set<number>, expected: readonly number[]): boolean {
  if (values.size !== expected.length) return false;
  return expected.every((value) => values.has(value));
}

/**
 * Clock-time portion of a schedule label. Numeric shape follows the OS
 * region by convention: the wall-clock hour/minute render in the user's
 * local time exactly as the reference does (setHours + Intl, no timeZone).
 */
export function formatAutomationScheduleTime(hour: number, minute: number): string {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

const UI_WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Locale-free schedule shape for a plain 5-field cron expression. */
export function describeAutomationSchedule(
  scheduleExpression: string,
): AutomationScheduleDescriptor {
  const rule = parseCron(scheduleExpression);
  if (rule === null) return { kind: "invalid" };
  const minute = singleValue(rule.minutes);
  const hour = singleValue(rule.hours);
  const unrestrictedCalendar =
    !rule.domRestricted && containsRange(rule.months, 1, 12);
  if (
    minute !== null &&
    containsRange(rule.hours, 0, 23) &&
    unrestrictedCalendar &&
    !rule.dowRestricted
  ) {
    return { kind: "hourly", minute };
  }
  if (minute !== null && hour !== null && unrestrictedCalendar) {
    if (!rule.dowRestricted) return { kind: "daily", hour, minute };
    if (containsExactly(rule.daysOfWeek, [1, 2, 3, 4, 5])) {
      return { kind: "weekdays", hour, minute };
    }
    const dayOfWeek = singleValue(rule.daysOfWeek);
    if (dayOfWeek !== null) return { kind: "weekly", hour, minute, dayOfWeek };
  }
  return { kind: "custom" };
}

/**
 * Localized (here: English) schedule label for UI surfaces. With no
 * zone (or "UTC") the descriptor carries UTC cron parts and they render
 * as the local wall clock, like the reference. With an explicit IANA zone
 * the cron parts already are that zone's wall time, so they render
 * verbatim with the zone named — never double-converted. `offsetMinutes`
 * defaults to the live local offset; tests pass explicit values.
 */
export function formatUiAutomationScheduleDescriptor(
  descriptor: AutomationScheduleDescriptor,
  offsetMinutes: number = localToUtcOffsetMinutes(),
  timezone?: string | null,
): string {
  if (descriptor.kind === "invalid") return "Invalid schedule";
  if (descriptor.kind === "custom")
    return timezone && timezone !== "UTC" ? `Custom schedule (${timezone})` : "Custom schedule";
  if (descriptor.kind === "hourly") {
    const base = `Hourly at :${String(descriptor.minute).padStart(2, "0")}`;
    return timezone && timezone !== "UTC" ? `${base} (${timezone})` : base;
  }
  if (timezone && timezone !== "UTC") {
    const time = formatAutomationScheduleTime(descriptor.hour, descriptor.minute);
    const zoned = (label: string): string => `${label} (${timezone})`;
    if (descriptor.kind === "daily") return zoned(`Daily at ${time}`);
    if (descriptor.kind === "weekdays") return zoned(`Weekdays at ${time}`);
    return zoned(`${EN_DAY_NAMES[descriptor.dayOfWeek]}s at ${time}`);
  }
  const dayOfWeek =
    descriptor.kind === "weekly" ? descriptor.dayOfWeek : null;
  const local = utcCronPartsToLocal(
    descriptor.hour,
    descriptor.minute,
    dayOfWeek,
    offsetMinutes,
  );
  const time = formatAutomationScheduleTime(local.hour, local.minute);
  if (descriptor.kind === "daily") return `Daily at ${time}`;
  if (descriptor.kind === "weekdays") return `Weekdays at ${time}`;
  return `${EN_DAY_NAMES[local.dayOfWeek ?? descriptor.dayOfWeek]}s at ${time}`;
}

/** Convenience wrapper for callers that hold the raw cron expression. */
export function formatUiAutomationSchedule(
  scheduleExpression: string,
  offsetMinutes: number = localToUtcOffsetMinutes(),
  timezone?: string | null,
): string {
  return formatUiAutomationScheduleDescriptor(
    describeAutomationSchedule(scheduleExpression),
    offsetMinutes,
    timezone,
  );
}

export function weekdayName(dayOfWeek: number): string {
  return UI_WEEKDAY_NAMES[dayOfWeek] ?? "";
}
