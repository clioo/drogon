// MIT Copyright (c) 2026 Lovecast Inc. Tests for the automation list
// projection (search, status/last-run filters, name sort, empty states).
import { describe, expect, it } from "vitest";
import type { AutomationSummary } from "../../../../shared/automation-contract";
import {
  EMPTY_AUTOMATION_LIST_FILTER,
  getAutomationSummaryLastRunSnapshot,
  projectAutomationList,
  resolveAutomationListEmptyState,
} from "./automation-list-projection";

function summary(overrides: Partial<AutomationSummary>): AutomationSummary {
  return {
    id: "a",
    name: "nightly",
    cron: "0 9 * * *",
    workspaceId: "w1",
    harness: "pi",
    prompt: "sweep the repo",
    enabled: true,
    nextRunAt: 2_000,
    lastRunAt: null,
    lastRun: null,
    ...overrides,
  };
}

const workspaceNameFor = (id: string | null): string =>
  id === "w1" ? "alpha" : "Missing workspace";

describe("projectAutomationList", () => {
  it("sorts by name and keeps the total count", () => {
    const projection = projectAutomationList(
      [
        summary({ id: "b", name: "zebra" }),
        summary({ id: "a", name: "apple" }),
      ],
      workspaceNameFor,
      "",
      EMPTY_AUTOMATION_LIST_FILTER,
    );
    expect(projection.rows.map((row) => row.automation.id)).toEqual([
      "a",
      "b",
    ]);
    expect(projection.totalCount).toBe(2);
    expect(projection.searchActive).toBe(false);
  });

  it("searches name, cron, harness, workspace and prompt", () => {
    const automations = [
      summary({ id: "a", name: "nightly", cron: "0 9 * * *" }),
      summary({
        id: "b",
        name: "other",
        cron: "5 * * * *",
        harness: "claude",
        workspaceId: null,
        prompt: "unrelated",
      }),
    ];
    expect(
      projectAutomationList(automations, workspaceNameFor, "alpha", EMPTY_AUTOMATION_LIST_FILTER)
        .rows.map((row) => row.automation.id),
    ).toEqual(["a"]);
    expect(
      projectAutomationList(automations, workspaceNameFor, "claude", EMPTY_AUTOMATION_LIST_FILTER)
        .rows.map((row) => row.automation.id),
    ).toEqual(["b"]);
    expect(
      projectAutomationList(automations, workspaceNameFor, "0 9", EMPTY_AUTOMATION_LIST_FILTER)
        .rows.map((row) => row.automation.id),
    ).toEqual(["a"]);
  });

  it("filters by status and last-run tone", () => {
    const automations = [
      summary({ id: "a", enabled: true }),
      summary({
        id: "b",
        enabled: false,
        lastRun: {
          id: "r1",
          status: "dispatch_failed",
          trigger: "scheduled",
          scheduledFor: 1_000,
          error: "boom",
          exitCode: 1,
        },
      }),
      summary({
        id: "c",
        enabled: true,
        lastRun: {
          id: "r2",
          status: "completed",
          trigger: "manual",
          scheduledFor: 1_000,
          error: null,
          exitCode: 0,
        },
      }),
    ];
    expect(
      projectAutomationList(automations, workspaceNameFor, "", {
        status: "paused",
        lastRun: "all",
      }).rows.map((row) => row.automation.id),
    ).toEqual(["b"]);
    expect(
      projectAutomationList(automations, workspaceNameFor, "", {
        status: "all",
        lastRun: "failed",
      }).rows.map((row) => row.automation.id),
    ).toEqual(["b"]);
    expect(
      projectAutomationList(automations, workspaceNameFor, "", {
        status: "all",
        lastRun: "succeeded",
      }).rows.map((row) => row.automation.id),
    ).toEqual(["c"]);
    expect(
      projectAutomationList(automations, workspaceNameFor, "", {
        status: "all",
        lastRun: "never",
      }).rows.map((row) => row.automation.id),
    ).toEqual(["a"]);
  });
});

describe("getAutomationSummaryLastRunSnapshot", () => {
  it("reports never when no run exists", () => {
    expect(getAutomationSummaryLastRunSnapshot(summary({}))).toEqual({
      at: null,
      tone: "never",
      statusLabel: "",
    });
  });

  it("maps failed and completed statuses", () => {
    const failed = getAutomationSummaryLastRunSnapshot(
      summary({
        lastRun: {
          id: "r",
          status: "dispatch_failed",
          trigger: "scheduled",
          scheduledFor: 42,
          error: null,
          exitCode: 1,
        },
      }),
    );
    expect(failed).toEqual({ at: 42, tone: "failed", statusLabel: "Failed" });
  });
});

describe("resolveAutomationListEmptyState", () => {
  it("prefers rows, then loading, then error, then search/filter, then empty", () => {
    expect(
      resolveAutomationListEmptyState({
        loading: false,
        error: null,
        totalCount: 2,
        visibleCount: 1,
        searchActive: false,
        filterActive: false,
      }).kind,
    ).toBe("rows");
    expect(
      resolveAutomationListEmptyState({
        loading: true,
        error: null,
        totalCount: 0,
        visibleCount: 0,
        searchActive: false,
        filterActive: false,
      }).kind,
    ).toBe("loading");
    expect(
      resolveAutomationListEmptyState({
        loading: false,
        error: "down",
        totalCount: 0,
        visibleCount: 0,
        searchActive: false,
        filterActive: false,
      }).kind,
    ).toBe("error");
    expect(
      resolveAutomationListEmptyState({
        loading: false,
        error: null,
        totalCount: 3,
        visibleCount: 0,
        searchActive: true,
        filterActive: false,
      }).kind,
    ).toBe("search-no-match");
    expect(
      resolveAutomationListEmptyState({
        loading: false,
        error: null,
        totalCount: 3,
        visibleCount: 0,
        searchActive: false,
        filterActive: true,
      }).kind,
    ).toBe("filter-no-match");
    expect(
      resolveAutomationListEmptyState({
        loading: false,
        error: null,
        totalCount: 0,
        visibleCount: 0,
        searchActive: false,
        filterActive: false,
      }).kind,
    ).toBe("empty");
  });
});
