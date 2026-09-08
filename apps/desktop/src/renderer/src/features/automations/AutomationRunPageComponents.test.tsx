// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc. Render tests for the ported
// AutomationRunsTable and AutomationRunDetailsPage plus the run view-state
// ladder. renderToStaticMarkup covers DOM/copy/ARIA (the source's table
// tests are structure tests; its virtualization bound has no local port).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import type {
  AutomationRunDetail,
  AutomationRunListItem,
} from "../../../../shared/automation-contract";
import { AutomationRunsTable } from "./AutomationRunsTable";
import { AutomationRunDetailsPage } from "./AutomationRunDetailsPage";
import {
  buildAutomationRunsDashboardEntries,
  type AutomationRunsDashboardEntry,
} from "./automation-runs-dashboard-model";
import {
  canRerunAutomationRun,
  getAutomationRunViewState,
} from "./automation-run-view-state";
import { getAutomationRunContent } from "./automation-run-content";
import { getAutomationRunWorkspaceDisplay } from "./automation-run-workspace-display";
import type { Workspace } from "../../../../shared/session-contract";

function listItem(
  overrides: Partial<AutomationRunListItem> = {},
): AutomationRunListItem {
  return {
    id: "run-1",
    automationId: "auto-1",
    automationName: "Nightly sweep",
    title: "Nightly sweep — manual run",
    scheduledFor: 1_700_000_000_000,
    status: "completed",
    trigger: "manual",
    workspaceId: "ws-1",
    terminalSessionId: "ses-1",
    error: null,
    exitCode: 0,
    startedAt: 1_700_000_000_500,
    dispatchedAt: 1_700_000_000_400,
    createdAt: 1_700_000_000_300,
    ...overrides,
  };
}

function entry(overrides: Partial<AutomationRunListItem> = {}): AutomationRunsDashboardEntry {
  return buildAutomationRunsDashboardEntries([listItem(overrides)])[0];
}

afterEach(cleanup);

describe("AutomationRunsTable", () => {
  it("renders the source's five columns and one row per entry", () => {
    const screen = render(
      createElement(AutomationRunsTable, {
        entries: buildAutomationRunsDashboardEntries([
          listItem(),
          listItem({ id: "run-2", automationName: "Hourly check", status: "dispatch_failed" }),
        ]),
        loading: false,
        hasMore: false,
        onLoadMore: () => {},
        onOpenRun: () => {},
      }),
    );
    const header = screen.container.textContent ?? "";
    for (const column of ["Automation", "Triggered", "Trigger", "Host", "Status"]) {
      expect(header).toContain(column);
    }
    const rows = screen.container.querySelectorAll('[data-testid="automation-runs-row"]');
    expect(rows).toHaveLength(2);
    expect(header).toContain("Nightly sweep");
    expect(header).toContain("Hourly check");
    expect(header).toContain("Done");
    expect(header).toContain("Failed");
  });

  it("keeps the source's empty and loading copy", () => {
    const empty = render(
      createElement(AutomationRunsTable, {
        entries: [],
        loading: false,
        hasMore: false,
        onLoadMore: () => {},
        onOpenRun: () => {},
      }),
    );
    expect(empty.container.textContent).toContain("No runs yet");
    expect(empty.container.textContent).toContain(
      "Runs appear here after an automation is triggered.",
    );
    cleanup();
    const loading = render(
      createElement(AutomationRunsTable, {
        entries: [],
        loading: true,
        hasMore: false,
        onLoadMore: () => {},
        onOpenRun: () => {},
      }),
    );
    expect(loading.container.textContent).toContain("Loading runs…");
  });

  it("opens a run when its row is clicked", () => {
    let opened: string | null = null;
    const screen = render(
      createElement(AutomationRunsTable, {
        entries: buildAutomationRunsDashboardEntries([listItem()]),
        loading: false,
        hasMore: false,
        onLoadMore: () => {},
        onOpenRun: (openedEntry) => {
          opened = openedEntry.run.id;
        },
      }),
    );
    screen.container
      .querySelector('[data-testid="automation-runs-row"]')
      ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(opened).toBe("run-1");
  });
});

function detail(overrides: Partial<AutomationRunDetail> = {}): AutomationRunDetail {
  return {
    ...listItem(),
    title: "Nightly sweep — manual run",
    workspaceDisplayName: null,
    outputSnapshot: {
      format: "plain_text",
      content: "automation-fixture-output\n",
      capturedAt: 1_700_000_050_000,
      truncated: false,
    },
    sessionExists: true,
    ...overrides,
  };
}

const workspace: Workspace = {
  id: "ws-1",
  name: "alpha",
  path: "/tmp/alpha",
} as Workspace;

describe("AutomationRunDetailsPage", () => {
  it("renders title, breadcrumbs, status badge and the output snapshot", () => {
    const screen = render(
      createElement(AutomationRunDetailsPage, {
        automation: { id: "auto-1", name: "Nightly sweep" } as never,
        run: detail(),
        relativeNow: 1_700_000_010_000,
        workspaceDisplay: getAutomationRunWorkspaceDisplay({
          run: detail(),
          workspace,
        }),
        viewState: getAutomationRunViewState({ run: detail(), sessionExists: true }),
        canRerun: false,
        isRerunPending: false,
        onRerun: () => {},
        onOpenWorkspace: () => {},
        onBack: () => {},
      }),
    );
    const text = screen.container.textContent ?? "";
    expect(text).toContain("Nightly sweep");
    expect(text).toContain("Drogon");
    expect(text).toContain("alpha");
    expect(text).toContain("Done");
    expect(text).toContain("automation-fixture-output");
    // Source action affordances: Open session enabled, no Rerun on success.
    const buttons = [...screen.container.querySelectorAll("button")];
    const openSession = buttons.find((button) => button.textContent === "Open session");
    expect(openSession).toBeDefined();
    expect(openSession?.disabled).toBe(false);
    expect(buttons.find((button) => button.textContent === "Rerun")).toBeUndefined();
    // The back affordance and its label.
    expect(
      screen.container.querySelector('[aria-label="Back to runs"]'),
    ).not.toBeNull();
  });

  it("falls back to the run error when no snapshot exists", () => {
    const run = detail({
      outputSnapshot: null,
      sessionExists: false,
      error: "harness start failed",
    });
    expect(getAutomationRunContent(run)).toBe("harness start failed");
    const screen = render(
      createElement(AutomationRunDetailsPage, {
        automation: { id: "auto-1", name: "Nightly sweep" } as never,
        run,
        relativeNow: 1,
        workspaceDisplay: getAutomationRunWorkspaceDisplay({ run, workspace: null }),
        viewState: getAutomationRunViewState({ run, sessionExists: false }),
        canRerun: true,
        isRerunPending: false,
        onRerun: () => {},
        onOpenWorkspace: () => {},
        onBack: () => {},
      }),
    );
    expect(screen.container.textContent).toContain("harness start failed");
    // Rerun appears for a failed run of a known automation.
    expect(screen.container.textContent).toContain("Rerun");
    // Disabled view action with the metadata ladder copy.
    expect(screen.container.textContent).toContain("Workspace no longer available");
  });
});

describe("automation run view state", () => {
  it("ladders session → snapshot → metadata like the source", () => {
    const withSession = getAutomationRunViewState({ run: detail(), sessionExists: true });
    expect(withSession).toEqual({
      availability: "session",
      actionLabel: "Open session",
      statusLabel: "Run is open",
      canOpen: true,
    });

    const snapshotRun = detail({ sessionExists: false });
    const withSnapshot = getAutomationRunViewState({
      run: snapshotRun,
      sessionExists: false,
    });
    expect(withSnapshot).toEqual({
      availability: "snapshot",
      actionLabel: "Snapshot saved",
      statusLabel: "Showing saved run snapshot.",
      canOpen: false,
    });

    const bareRun = detail({ outputSnapshot: null, sessionExists: false });
    const metadata = getAutomationRunViewState({ run: bareRun, sessionExists: false });
    expect(metadata.availability).toBe("metadata");
    expect(metadata.canOpen).toBe(false);
    expect(metadata.statusLabel).toBe("Workspace no longer available");

    const namedRun = detail({
      outputSnapshot: null,
      sessionExists: false,
      workspaceDisplayName: "old-ws",
    });
    expect(getAutomationRunViewState({ run: namedRun, sessionExists: false }).statusLabel).toBe(
      "old-ws no longer available",
    );

    const noWorkspaceRun = detail({
      outputSnapshot: null,
      sessionExists: false,
      workspaceId: null,
    });
    expect(getAutomationRunViewState({ run: noWorkspaceRun, sessionExists: false }).statusLabel).toBe(
      "No workspace launched",
    );
  });

  it("permits rerun only for failed and refused runs of the same automation", () => {
    expect(
      canRerunAutomationRun({ automationId: "auto-1", run: detail({ status: "dispatch_failed" }) }),
    ).toBe(true);
    expect(
      canRerunAutomationRun({
        automationId: "auto-1",
        run: detail({ status: "skipped_unavailable" }),
      }),
    ).toBe(true);
    expect(canRerunAutomationRun({ automationId: "auto-1", run: detail() })).toBe(false);
    expect(
      canRerunAutomationRun({ automationId: "auto-2", run: detail({ status: "dispatch_failed" }) }),
    ).toBe(false);
    expect(
      canRerunAutomationRun({ automationId: null, run: detail({ status: "dispatch_failed" }) }),
    ).toBe(false);
  });
});

describe("automation run workspace display", () => {
  it("mirrors the source's launched/deleted/not-launched labels", () => {
    const run = detail();
    expect(getAutomationRunWorkspaceDisplay({ run, workspace })).toEqual({
      rowLabel: "alpha",
      detailLabel: "alpha",
      muted: false,
      title: "alpha",
    });
    const deleted = getAutomationRunWorkspaceDisplay({
      run: detail({ workspaceDisplayName: "old-ws" }),
      workspace: null,
    });
    expect(deleted.detailLabel).toBe("old-ws (no longer available)");
    expect(deleted.muted).toBe(true);
    const notLaunched = getAutomationRunWorkspaceDisplay({
      run: detail({ workspaceId: null }),
      workspace: null,
    });
    expect(notLaunched.rowLabel).toBe("Not launched");
  });
});
