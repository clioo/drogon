// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/automations/automation-page-parts.ts
// (formatAutomationDateTime, formatAutomationRelativeTime,
// formatAutomationDateTimeWithRelative). Literal port.
export function formatAutomationDateTime(
  value: number | null | undefined,
): string {
  if (!value) {
    return "Never";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

export function formatAutomationRelativeTime(
  value: number | null | undefined,
  now = Date.now(),
): string | null {
  if (!value) {
    return null;
  }
  const diffMs = value - now;
  const absMs = Math.abs(diffMs);
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  const format = (amount: number, unit: string): string => `${amount}${unit}`;
  let text: string;
  if (absMs < minuteMs) {
    text = "now";
  } else if (absMs < hourMs) {
    text = format(Math.round(absMs / minuteMs), "m");
  } else if (absMs < dayMs) {
    text = format(Math.round(absMs / hourMs), "h");
  } else {
    text = format(Math.round(absMs / dayMs), "d");
  }
  if (text === "now") {
    return text;
  }
  return diffMs >= 0 ? `in ${text}` : `${text} ago`;
}

export function formatAutomationDateTimeWithRelative(
  value: number | null | undefined,
  now = Date.now(),
): string {
  const absolute = formatAutomationDateTime(value);
  const relative = formatAutomationRelativeTime(value, now);
  return relative ? `${absolute} (${relative})` : absolute;
}
