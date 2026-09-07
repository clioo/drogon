// MIT Copyright (c) 2026 Lovecast Inc. Render tests for the ported
// automations page components: list rows, detail pane with history, editor
// dialog, delete confirm and empty state. renderToString covers DOM/copy/ARIA
// (effects never run); behavior is covered by the projection unit tests.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { AutomationSummary } from "../../../../shared/automation-contract";
import { AutomationsListPanel } from "./AutomationsListPanel";
import { AutomationsDetailPane } from "./AutomationsDetailPane";
import { AutomationEditorDialog } from "./AutomationEditorDialog";
import { AutomationDeleteDialog } from "./AutomationDeleteDialogs";
import { AutomationListEmptyStateView } from "./AutomationListEmptyView";
import { blankAutomationDraft } from "./automation-editor-validation";
import { EMPTY_AUTOMATION_LIST_FILTER } from "./automation-list-projection";
import { projectAutomationRows } from "./automation-list-projection";

function summary(overrides: Partial<AutomationSummary>): AutomationSummary {
  return {
    id: "a1",
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

const noop = (): void => {};

describe("AutomationsListPanel render", () => {
  it("renders rows with local schedule labels and status cells", () => {
    const rows = projectAutomationRows(
      [summary({}), summary({ id: "a2", name: "paused", enabled: false })],
      workspaceNameFor,
    );
    const html = renderToString(
      createElement(AutomationsListPanel, {
        loading: false,
        error: null,
        totalCount: 2,
        rows,
        searchActive: false,
        listSearchQuery: "",
        isListSearchQueryTooLarge: false,
        onListSearchQueryChange: noop,
        listFilter: EMPTY_AUTOMATION_LIST_FILTER,
        onListFilterChange: noop,
        selectedId: "a1",
        relativeNow: 1_000,
        runningId: null,
        isRefreshing: false,
        onSelect: noop,
        onRunNow: noop,
        onEdit: noop,
        onToggle: noop,
        onDelete: noop,
        onRefresh: noop,
        openCreateDialog: noop,
      }),
    );
    expect(html).toContain("nightly");
    expect(html).toContain("Daily at");
    expect(html).toContain("Enabled");
    expect(html).toContain("Paused");
    expect(html).toContain('data-automation-row-id="a1"');
    expect(html).toContain('data-current="true"');
    expect(html).toContain("Name");
    expect(html).toContain("Next run");
  });

  it("renders the empty state with templates when nothing exists", () => {
    const html = renderToString(
      createElement(AutomationsListPanel, {
        loading: false,
        error: null,
        totalCount: 0,
        rows: [],
        searchActive: false,
        listSearchQuery: "",
        isListSearchQueryTooLarge: false,
        onListSearchQueryChange: noop,
        listFilter: EMPTY_AUTOMATION_LIST_FILTER,
        onListFilterChange: noop,
        selectedId: null,
        relativeNow: 1_000,
        runningId: null,
        isRefreshing: false,
        onSelect: noop,
        onRunNow: noop,
        onEdit: noop,
        onToggle: noop,
        onDelete: noop,
        onRefresh: noop,
        openCreateDialog: noop,
      }),
    );
    expect(html).toContain("No automations yet.");
    expect(html).toContain("Start from a template");
  });

  it("renders the empty view for loading and error states", () => {
    const loading = renderToString(
      createElement(AutomationListEmptyStateView, {
        loading: true,
        error: null,
        totalCount: 0,
        visibleCount: 0,
        searchActive: false,
        filterActive: false,
      }),
    );
    expect(loading).toContain("Loading automations…");
    const failed = renderToString(
      createElement(AutomationListEmptyStateView, {
        loading: false,
        error: "down",
        totalCount: 0,
        visibleCount: 0,
        searchActive: false,
        filterActive: false,
      }),
    );
    expect(failed).toContain("Automations could not be loaded.");
  });
});

describe("AutomationsDetailPane render", () => {
  it("renders the detail with schedule label, actions and run history", () => {
    const automation = summary({});
    const html = renderToString(
      createElement(AutomationsDetailPane, {
        selected: automation,
        workspaceName: "alpha",
        runs: [
          {
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
          },
        ],
        runsLoading: false,
        runsError: null,
        activePaneTab: "runs",
        relativeNow: 5_000,
        running: false,
        onActivePaneTabChange: noop,
        onRunNow: noop,
        onEdit: noop,
        onToggle: noop,
        onDelete: noop,
        onBackToList: noop,
      }),
    );
    expect(html).toContain("Run history");
    expect(html).toContain("1 run · 1 completed");
    expect(html).toContain("Done");
    expect(html).toContain('aria-label="All automations"');
  });

  it("renders the overview with the prompt disclosure", () => {
    const html = renderToString(
      createElement(AutomationsDetailPane, {
        selected: summary({}),
        workspaceName: "alpha",
        runs: [],
        runsLoading: false,
        runsError: null,
        activePaneTab: "overview",
        relativeNow: 5_000,
        running: false,
        onActivePaneTabChange: noop,
        onRunNow: noop,
        onEdit: noop,
        onToggle: noop,
        onDelete: noop,
        onBackToList: noop,
      }),
    );
    expect(html).toContain("sweep the repo");
    expect(html).toContain("Run Now");
    expect(html).toContain("Daily at");
  });
});

describe("AutomationEditorDialog render", () => {
  it("renders header, prompt section, settings and footer", () => {
    const html = renderToString(
      createElement(AutomationEditorDialog, {
        open: true,
        isEditing: false,
        isSaving: false,
        draft: { ...blankAutomationDraft("w1"), name: "n", prompt: "p" },
        workspaces: [{ id: "w1", name: "alpha", path: "/tmp", kind: "folder", hostId: "local" }],
        errors: {},
        onDraftChange: noop,
        onApplyTemplate: noop,
        onOpenChange: noop,
        onSave: noop,
      }),
    );
    expect(html).toContain("Create automation");
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Use template");
    expect(html).toContain("Cadence");
    expect(html).toContain("Create automation</button>");
  });

  it("renders nothing when closed", () => {
    expect(
      renderToString(
        createElement(AutomationEditorDialog, {
          open: false,
          isEditing: false,
          isSaving: false,
          draft: blankAutomationDraft("w1"),
          workspaces: [],
          errors: {},
          onDraftChange: noop,
          onApplyTemplate: noop,
          onOpenChange: noop,
          onSave: noop,
        }),
      ),
    ).toBe("");
  });
});

describe("AutomationDeleteDialog render", () => {
  it("confirms with the automation name and run-history copy", () => {
    const html = renderToString(
      createElement(AutomationDeleteDialog, {
        deleteTarget: summary({}),
        onOpenChange: noop,
        onConfirm: noop,
      }),
    );
    expect(html).toContain("Delete Automation");
    expect(html).toContain("nightly");
    expect(html).toContain("and its run history.");
    expect(html).toContain("Don");
  });
});
