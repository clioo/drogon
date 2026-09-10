// MIT Copyright (c) 2026 Lovecast Inc.
// Real file-backed persistence, same shape as notifications/settings.ts's
// own tests: a real temp JSON file, no electron mocking (this module never
// imports electron itself -- only workspace-ui-preferences-bridge.ts does).
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  DEFAULT_WORKSPACE_UI_PREFERENCES,
  normalizeWorkspaceUIPreferences,
  WorkspaceUIPreferencesStore,
} from "./workspace-ui-preferences";

const dirs: string[] = [];
function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "drogon-ui-prefs-"));
  dirs.push(dir);
  return join(dir, "workspace-ui-preferences.json");
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("normalizeWorkspaceUIPreferences", () => {
  it("returns the exact defaults for a missing/garbage payload", () => {
    expect(normalizeWorkspaceUIPreferences(undefined)).toEqual(
      DEFAULT_WORKSPACE_UI_PREFERENCES,
    );
    expect(normalizeWorkspaceUIPreferences(null)).toEqual(DEFAULT_WORKSPACE_UI_PREFERENCES);
    expect(normalizeWorkspaceUIPreferences("garbage")).toEqual(
      DEFAULT_WORKSPACE_UI_PREFERENCES,
    );
    expect(normalizeWorkspaceUIPreferences([1, 2, 3])).toEqual(
      DEFAULT_WORKSPACE_UI_PREFERENCES,
    );
  });

  it("rejects an unknown groupBy/sortBy/projectOrderBy and falls back to the default", () => {
    const state = normalizeWorkspaceUIPreferences({
      groupBy: "not-a-real-mode",
      sortBy: "also-fake",
      projectOrderBy: "nonsense",
    });
    expect(state.groupBy).toBe("repo");
    expect(state.sortBy).toBe("recent");
    expect(state.projectOrderBy).toBe("manual");
  });

  it("accepts every real groupBy/sortBy/projectOrderBy value", () => {
    for (const groupBy of ["none", "workspace-status", "repo", "pr-status"] as const) {
      expect(normalizeWorkspaceUIPreferences({ groupBy }).groupBy).toBe(groupBy);
    }
    for (const sortBy of ["name", "smart", "recent", "repo", "manual"] as const) {
      expect(normalizeWorkspaceUIPreferences({ sortBy }).sortBy).toBe(sortBy);
    }
    for (const projectOrderBy of ["manual", "recent"] as const) {
      expect(normalizeWorkspaceUIPreferences({ projectOrderBy }).projectOrderBy).toBe(
        projectOrderBy,
      );
    }
    for (const cardLayout of ["comfortable", "compact"] as const) {
      expect(normalizeWorkspaceUIPreferences({ cardLayout }).cardLayout).toBe(cardLayout);
    }
  });

  it("rejects an unknown cardLayout and falls back to comfortable", () => {
    expect(
      normalizeWorkspaceUIPreferences({ cardLayout: "not-a-real-layout" }).cardLayout,
    ).toBe("comfortable");
  });

  it("preserves every real hide-* filter independently", () => {
    const state = normalizeWorkspaceUIPreferences({
      hideSleepingWorkspaces: true,
      hideDefaultBranchWorkspace: true,
      hideDetachedHeadWorkspaces: true,
      hideAutomationGeneratedWorkspaces: true,
      hideCliCreatedWorkspaces: true,
    });
    expect(state.hideSleepingWorkspaces).toBe(true);
    expect(state.hideDefaultBranchWorkspace).toBe(true);
    expect(state.hideDetachedHeadWorkspaces).toBe(true);
    expect(state.hideAutomationGeneratedWorkspaces).toBe(true);
    expect(state.hideCliCreatedWorkspaces).toBe(true);
  });

  it("drops an unrecognized worktreeCardProperties entry but keeps known ones", () => {
    const state = normalizeWorkspaceUIPreferences({
      worktreeCardProperties: ["branch", "not-a-real-property", "issue"],
    });
    expect(state.worktreeCardProperties).toEqual(["status", "unread", "branch", "issue"]);
  });

  it("clamps board opacity and column width to their real bounds", () => {
    expect(normalizeWorkspaceUIPreferences({ workspaceBoardOpacity: 5 }).workspaceBoardOpacity).toBe(
      1,
    );
    expect(normalizeWorkspaceUIPreferences({ workspaceBoardOpacity: 0 }).workspaceBoardOpacity).toBe(
      0.2,
    );
    expect(
      normalizeWorkspaceUIPreferences({ workspaceBoardColumnWidth: 10 }).workspaceBoardColumnWidth,
    ).toBe(220);
    expect(
      normalizeWorkspaceUIPreferences({ workspaceBoardColumnWidth: 9999 }).workspaceBoardColumnWidth,
    ).toBe(520);
  });

  it("stamps all four _workspaceStatuses* migration flags true after hydration", () => {
    const state = normalizeWorkspaceUIPreferences({});
    expect(state._workspaceStatusesDefaultOrderMigrated).toBe(true);
    expect(state._workspaceStatusesReorderedDefaultRepaired).toBe(true);
    expect(state._workspaceStatusesDefaultWorkflowMigrated).toBe(true);
    expect(state._workspaceStatusesDefaultVisualsMigrated).toBe(true);
  });

  it("migrates a legacy reverse-order default-status payload exactly once, gated on its own stamp", () => {
    const legacyReverseOrder = [
      { id: "completed", label: "Done", color: "conductor-done", icon: "conductor-done" },
      {
        id: "in-review",
        label: "In review",
        color: "conductor-review",
        icon: "conductor-review",
      },
      {
        id: "in-progress",
        label: "In progress",
        color: "conductor-progress",
        icon: "conductor-progress",
      },
      { id: "todo", label: "Todo", color: "neutral", icon: "circle" },
    ];
    const migrated = normalizeWorkspaceUIPreferences({
      workspaceStatuses: legacyReverseOrder,
      _workspaceStatusesDefaultWorkflowMigrated: false,
    });
    expect(migrated.workspaceStatuses!.map((s) => s.id)).toEqual([
      "todo",
      "in-progress",
      "in-review",
      "completed",
    ]);

    // Once BOTH the workflow-migration and reordered-repair stamps are
    // true, the same raw reverse-order shape is treated as a deliberate
    // user reorder and left alone.
    const alreadyMigrated = normalizeWorkspaceUIPreferences({
      workspaceStatuses: legacyReverseOrder,
      _workspaceStatusesDefaultWorkflowMigrated: true,
      _workspaceStatusesReorderedDefaultRepaired: true,
    });
    expect(alreadyMigrated.workspaceStatuses!.map((s) => s.id)).toEqual([
      "completed",
      "in-review",
      "in-progress",
      "todo",
    ]);
  });
});

describe("WorkspaceUIPreferencesStore", () => {
  it("starts at the exact defaults with no file present", () => {
    const store = new WorkspaceUIPreferencesStore(tempFile());
    expect(store.get()).toEqual(DEFAULT_WORKSPACE_UI_PREFERENCES);
  });

  it("persists a partial set field-by-field and survives a reopen", () => {
    const file = tempFile();
    const store = new WorkspaceUIPreferencesStore(file);
    const after = store.set({ groupBy: "workspace-status", hideCliCreatedWorkspaces: true });
    expect(after.groupBy).toBe("workspace-status");
    expect(after.hideCliCreatedWorkspaces).toBe(true);
    // Untouched fields keep their prior values, not reset to defaults.
    expect(after.sortBy).toBe(DEFAULT_WORKSPACE_UI_PREFERENCES.sortBy);

    const raw = JSON.parse(readFileSync(file, "utf8"));
    expect(raw.groupBy).toBe("workspace-status");

    const reopened = new WorkspaceUIPreferencesStore(file);
    expect(reopened.get().groupBy).toBe("workspace-status");
    expect(reopened.get().hideCliCreatedWorkspaces).toBe(true);
  });

  it("degrades to defaults on a corrupt file instead of throwing", () => {
    const file = tempFile();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "{not json", "utf8");
    const store = new WorkspaceUIPreferencesStore(file);
    expect(store.get()).toEqual(DEFAULT_WORKSPACE_UI_PREFERENCES);
  });

  it("stays in-memory-only (never throws) when constructed with a null path", () => {
    const store = new WorkspaceUIPreferencesStore(null);
    expect(store.get()).toEqual(DEFAULT_WORKSPACE_UI_PREFERENCES);
    expect(store.set({ sortBy: "smart" }).sortBy).toBe("smart");
  });
});
