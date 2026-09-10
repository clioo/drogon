// MIT Copyright (c) 2026 Lovecast Inc. Tests for editor validation,
// run-history projection and detail tab navigation.
import { describe, expect, it } from "vitest";
import type { AutomationRunView } from "../../../../shared/automation-contract";
import {
  blankAutomationDraft,
  buildAutomationCronSchedule,
  draftCron,
  validateAutomationDraft,
} from "./automation-editor-validation";
import { getSchedulePresetDraft } from "./AutomationSchedulePicker";
import {
  formatAutomationRunCountLabel,
  getAutomationHistoryStatusLabel,
  getAutomationHistoryStatusVariant,
  projectAutomationRunHistory,
} from "./automation-run-history-projection";
import { getAutomationDetailNextTab } from "./automation-detail-tab-navigation";
import { formatAutomationDateTimeWithRelative } from "./automation-page-parts";

function run(overrides: Partial<AutomationRunView>): AutomationRunView {
  return {
    id: "r1",
    automationId: "a1",
    status: "completed",
    trigger: "scheduled",
    scheduledFor: 1_000,
    workspaceId: "w1",
    terminalSessionId: null,
    error: null,
    exitCode: 0,
    startedAt: null,
    dispatchedAt: null,
    createdAt: 1_000,
    ...overrides,
  };
}

describe("validateAutomationDraft", () => {
  it("accepts a complete daily draft", () => {
    const draft = {
      ...blankAutomationDraft("w1"),
      name: "nightly",
      prompt: "sweep",
    };
    expect(validateAutomationDraft(draft)).toEqual({});
    // Explicitly zoned: the wall time stores verbatim in the zone, with
    // no local->UTC conversion at any offset.
    expect(draftCron(draft, 0)).toBe("0 9 * * *");
    expect(draftCron(draft, 360)).toBe("0 9 * * *");
    expect(draftCron({ ...draft, preset: "custom", customSchedule: "*/5 * * * *" }, 360)).toBe(
      "*/5 * * * *",
    );
  });

  it("keeps the legacy local->UTC conversion for drafts without a zone", () => {
    const legacy = { ...blankAutomationDraft("w1"), timezone: "" };
    // Explicit zero offset: local 9 AM stores unchanged.
    expect(draftCron(legacy, 0)).toBe("0 9 * * *");
    // 9 AM at UTC-6 stores as 15:00 UTC.
    expect(draftCron(legacy, 360)).toBe("0 15 * * *");
  });

  it("rejects an unknown timezone without touching the schedule", () => {
    const errors = validateAutomationDraft({
      ...blankAutomationDraft("w1"),
      name: "x",
      prompt: "y",
      timezone: "Mars/Olympus",
    });
    expect(errors.timezone).toContain("valid timezone");
    expect(errors.schedule).toBeUndefined();
  });

  it("flags blank name, prompt and workspace", () => {
    const errors = validateAutomationDraft(blankAutomationDraft(""));
    expect(errors.name).toContain("name");
    expect(errors.prompt).toContain("Describe");
    expect(errors.workspaceId).toContain("workspace");
    expect(errors.schedule).toBeUndefined();
  });

  it("rejects invalid custom crons and out-of-range grace", () => {
    const errors = validateAutomationDraft({
      ...blankAutomationDraft("w1"),
      name: "x",
      prompt: "y",
      preset: "custom",
      customSchedule: "bogus",
      graceMinutes: "99999",
    });
    expect(errors.schedule).toContain("valid five-field cron");
    expect(errors.graceMinutes).toContain("0..=10080");
  });

  it("seeds custom cron with the equivalent converted expression", () => {
    const draft = {
      ...blankAutomationDraft("w1"),
      preset: "daily" as const,
      time: "09:00",
    };
    // Zoned drafts seed the in-zone wall time verbatim.
    expect(getSchedulePresetDraft(draft, "custom", 360).customSchedule).toBe(
      "0 9 * * *",
    );
    // Legacy drafts without a zone keep the UTC conversion.
    expect(
      getSchedulePresetDraft({ ...draft, timezone: "" }, "custom", 360).customSchedule,
    ).toBe("0 15 * * *");
    // An existing custom expression is never overwritten by the seed.
    expect(
      getSchedulePresetDraft({ ...draft, customSchedule: "* * * * *" }, "custom", 360)
        .customSchedule,
    ).toBe("* * * * *");
  });

  it("builds preset crons for every cadence", () => {
    expect(
      buildAutomationCronSchedule({ preset: "hourly", hour: 9, minute: 5 }),
    ).toBe("5 * * * *");
    expect(
      buildAutomationCronSchedule({ preset: "weekdays", hour: 9, minute: 0 }),
    ).toBe("0 9 * * 1-5");
    expect(
      buildAutomationCronSchedule({
        preset: "weekly",
        hour: 14,
        minute: 30,
        dayOfWeek: 2,
      }),
    ).toBe("30 14 * * 2");
    expect(
      buildAutomationCronSchedule({ preset: "daily", hour: 9, minute: 0 }),
    ).toBe("0 9 * * *");
  });
});

describe("projectAutomationRunHistory", () => {
  it("labels statuses and details like the reference vocabulary", () => {
    expect(getAutomationHistoryStatusLabel("dispatch_failed")).toBe("Failed");
    expect(getAutomationHistoryStatusLabel("completed")).toBe("Done");
    expect(getAutomationHistoryStatusVariant("dispatch_failed")).toBe(
      "destructive",
    );
    expect(getAutomationHistoryStatusVariant("completed")).toBe("secondary");
    expect(getAutomationHistoryStatusVariant("skipped_missed")).toBe("outline");
  });

  it("projects scheduled labels and error details", () => {
    const now = 5_000;
    const [failed, ok] = projectAutomationRunHistory(
      [
        run({ id: "r1", status: "dispatch_failed", error: "boom" }),
        run({ id: "r2", status: "completed", error: null, exitCode: 0 }),
      ],
      now,
    );
    expect(failed?.scheduledLabel).toBe(
      formatAutomationDateTimeWithRelative(1_000, now),
    );
    expect(failed?.detailLabel).toBe("boom");
    expect(ok?.detailLabel).toBe("exit=0");
    expect(
      formatAutomationRunCountLabel([
        run({}),
        run({ id: "r2", status: "dispatch_failed" }),
      ]),
    ).toBe("2 runs · 1 completed");
  });
});

describe("getAutomationDetailNextTab", () => {
  it("moves between overview and runs with the arrow keys", () => {
    expect(
      getAutomationDetailNextTab({ currentTab: "overview", key: "ArrowRight" }),
    ).toBe("runs");
    expect(
      getAutomationDetailNextTab({ currentTab: "runs", key: "ArrowLeft" }),
    ).toBe("overview");
    expect(
      getAutomationDetailNextTab({ currentTab: "runs", key: "ArrowRight" }),
    ).toBeNull();
    expect(
      getAutomationDetailNextTab({
        currentTab: "overview",
        key: "ArrowRight",
        canAccessRuns: false,
      }),
    ).toBeNull();
  });
});
