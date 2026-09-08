// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/automations/automation-runs-dashboard-model.test.ts.
// Adaptation: local automations only — the source's local/ssh/runtime host
// cases collapse to the single local host; sorting, filtering, search and
// the outcome windows stay literal.
import { describe, expect, it } from "vitest";
import type { AutomationRunListItem } from "../../../../shared/automation-contract";
import {
  AUTOMATION_RUNS_LOCAL_HOST_KEY,
  buildAutomationRunsDashboardEntries,
  countAutomationRunOutcomes,
  filterAutomationRunsDashboardEntries,
  getAutomationRunsHostKey,
  getAutomationRunsScope,
} from "./automation-runs-dashboard-model";

function run(
  id: string,
  automationId: string,
  automationName: string,
  scheduledFor: number,
  status: string,
  title = `Run ${id}`,
): AutomationRunListItem {
  return {
    id,
    automationId,
    automationName,
    title,
    scheduledFor,
    status,
    trigger: "scheduled",
    workspaceId: null,
    terminalSessionId: null,
    error: null,
    exitCode: null,
    startedAt: null,
    dispatchedAt: null,
    createdAt: scheduledFor,
  };
}

describe("automation runs dashboard model", () => {
  it("builds one chronologically sorted list across automations", () => {
    const entries = buildAutomationRunsDashboardEntries([
      run("a", "auto-1", "Nightly", 10, "completed"),
      run("b", "auto-2", "Hourly", 30, "dispatch_failed"),
      run("c", "auto-1", "Nightly", 20, "completed"),
    ]);

    expect(entries.map((entry) => entry.run.id)).toEqual(["b", "c", "a"]);
    expect(entries.map((entry) => entry.key)).toEqual([
      "auto-2:b",
      "auto-1:c",
      "auto-1:a",
    ]);
    expect(getAutomationRunsScope()).toBe("local");
    expect(getAutomationRunsHostKey()).toBe(AUTOMATION_RUNS_LOCAL_HOST_KEY);
    // Search text covers automation name, run title and the host label.
    expect(entries[0].searchText).toContain("hourly");
    expect(entries[0].searchText).toContain("run b");
    expect(entries[0].searchText).toContain("local");
  });

  it("filters by status and query without splitting the dashboard by host", () => {
    const entries = buildAutomationRunsDashboardEntries([
      run("ok", "auto-1", "Nightly", 10, "completed"),
      run("bad", "auto-2", "Hourly", 20, "dispatch_failed"),
      run("skip", "auto-2", "Hourly", 30, "skipped_missed"),
      run("live", "auto-3", "Weekly", 40, "dispatched"),
    ]);

    const only = (status: Parameters<typeof filterAutomationRunsDashboardEntries>[0]["status"]) =>
      filterAutomationRunsDashboardEntries({
        entries,
        status,
        query: "",
        hostKeys: [],
      }).map((entry) => entry.run.id);

    expect(only("all")).toEqual(["live", "skip", "bad", "ok"]);
    expect(only("successful")).toEqual(["ok"]);
    expect(only("failed")).toEqual(["bad"]);
    expect(only("skipped")).toEqual(["skip"]);
    expect(only("active")).toEqual(["live"]);

    expect(
      filterAutomationRunsDashboardEntries({
        entries,
        status: "all",
        query: "nightly",
        hostKeys: [],
      }).map((entry) => entry.run.id),
    ).toEqual(["ok"]);
    expect(
      filterAutomationRunsDashboardEntries({
        entries,
        status: "all",
        query: "  RUN BAD \t",
        hostKeys: [],
      }).map((entry) => entry.run.id),
    ).toEqual(["bad"]);
    // Host filtering is a no-op with the single local host selected…
    expect(
      filterAutomationRunsDashboardEntries({
        entries,
        status: "all",
        query: "",
        hostKeys: [AUTOMATION_RUNS_LOCAL_HOST_KEY],
      }),
    ).toEqual(entries);
    // …and an unknown host key selects nothing.
    expect(
      filterAutomationRunsDashboardEntries({
        entries,
        status: "all",
        query: "",
        hostKeys: ["desktop:elsewhere"],
      }),
    ).toEqual([]);
  });

  it("keeps future-dated runs out of the outcome windows", () => {
    const entries = buildAutomationRunsDashboardEntries([
      run("ahead", "auto-1", "Nightly", 40, "completed"),
      run("ahead-failed", "auto-2", "Hourly", 40, "dispatch_failed"),
    ]);

    expect(countAutomationRunOutcomes(entries, 30)).toEqual({
      successful24h: 0,
      failed24h: 0,
      successful7d: 0,
      failed7d: 0,
    });

    // Runs inside the 24h and 7d windows count once each; a run older
    // than the week never counts.
    const now = 1_700_000_000_000;
    const hour = 3_600_000;
    const day = 24 * hour;
    const windows = buildAutomationRunsDashboardEntries([
      run("day", "auto-1", "Nightly", now - hour, "completed"),
      run("week", "auto-2", "Hourly", now - 6 * day, "dispatch_failed"),
      run("ancient", "auto-2", "Hourly", now - 30 * day, "dispatch_failed"),
    ]);
    expect(countAutomationRunOutcomes(windows, now)).toEqual({
      successful24h: 1,
      failed24h: 0,
      successful7d: 1,
      failed7d: 1,
    });
  });
});
