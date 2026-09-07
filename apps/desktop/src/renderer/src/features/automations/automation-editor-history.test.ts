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
    expect(draftCron(draft)).toBe("0 9 * * *");
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
