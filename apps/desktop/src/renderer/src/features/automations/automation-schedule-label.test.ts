// MIT Copyright (c) 2026 Lovecast Inc. Tests for the local-time schedule
// labels (ported from Orca's automation-schedule-label.ts behavior).
import { describe, expect, it } from "vitest";
import {
  describeAutomationSchedule,
  formatAutomationScheduleTime,
  formatUiAutomationSchedule,
  formatUiAutomationScheduleDescriptor,
} from "./automation-schedule-label";

function localTime(hour: number, minute: number): string {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

describe("describeAutomationSchedule", () => {
  it("classifies hourly, daily, weekdays and weekly crons", () => {
    expect(describeAutomationSchedule("5 * * * *")).toEqual({
      kind: "hourly",
      minute: 5,
    });
    expect(describeAutomationSchedule("0 9 * * *")).toEqual({
      kind: "daily",
      hour: 9,
      minute: 0,
    });
    expect(describeAutomationSchedule("0 9 * * 1-5")).toEqual({
      kind: "weekdays",
      hour: 9,
      minute: 0,
    });
    expect(describeAutomationSchedule("30 14 * * 2")).toEqual({
      kind: "weekly",
      hour: 14,
      minute: 30,
      dayOfWeek: 2,
    });
  });

  it("marks custom and invalid expressions", () => {
    expect(describeAutomationSchedule("0 9 * * 1,3")).toEqual({
      kind: "custom",
    });
    expect(describeAutomationSchedule("bogus")).toEqual({ kind: "invalid" });
    expect(describeAutomationSchedule("61 * * * *")).toEqual({
      kind: "invalid",
    });
  });
});

describe("formatUiAutomationSchedule", () => {
  it("renders hourly labels without a timezone-dependent clock", () => {
    expect(formatUiAutomationSchedule("5 * * * *")).toBe("Hourly at :05");
  });

  it("renders daily labels in the user's local time", () => {
    expect(formatUiAutomationSchedule("0 9 * * *")).toBe(
      `Daily at ${localTime(9, 0)}`,
    );
    expect(formatUiAutomationSchedule("0 9 * * 1-5")).toBe(
      `Weekdays at ${localTime(9, 0)}`,
    );
  });

  it("renders weekly labels with the English day name", () => {
    expect(formatUiAutomationSchedule("30 14 * * 2")).toBe(
      `Tuesdays at ${localTime(14, 30)}`,
    );
  });

  it("renders custom and invalid fallbacks", () => {
    expect(formatUiAutomationSchedule("0 9 * * 1,3")).toBe("Custom schedule");
    expect(formatUiAutomationSchedule("bogus")).toBe("Invalid schedule");
  });

  it("formats the clock portion with the OS locale, like the reference", () => {
    expect(formatAutomationScheduleTime(9, 5)).toBe(localTime(9, 5));
    expect(
      formatUiAutomationScheduleDescriptor({ kind: "hourly", minute: 7 }),
    ).toBe("Hourly at :07");
  });
});
