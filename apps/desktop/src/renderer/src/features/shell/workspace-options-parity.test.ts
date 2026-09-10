// @vitest-environment node
/* Reference-parity tables and the filter badge over WorkspaceOptionsState:
   order, copy and descriptions match the reference menu while the
   persisted ids stay exactly the same. */
import { describe, expect, test } from "vitest";
import {
  CARD_PROPERTY_OPTIONS,
  countWorkspaceOptionsActiveFilters,
  DEFAULT_WORKSPACE_OPTIONS_STATE,
  getWorkspaceOptionsFilterLabel,
  hasWorkspaceOptionsActiveFilters,
  WORKSPACE_CARD_LAYOUT_OPTIONS,
  WORKSPACE_GROUP_BY_OPTIONS,
  WORKSPACE_PROJECT_ORDER_OPTIONS,
  WORKSPACE_SHOW_PROPERTIES_DISPLAY_ORDER,
  WORKSPACE_SHOW_PROPERTY_LABEL_OVERRIDES,
  WORKSPACE_SORT_OPTIONS,
} from "./workspace-options-state";

describe("workspace options reference parity (additive view)", () => {
  test("group-by order and copy follow the reference", () => {
    expect(WORKSPACE_GROUP_BY_OPTIONS.map(({ id }) => id)).toEqual([
      "none",
      "workspace-status",
      "pr-status",
      "repo",
    ]);
    expect(Object.fromEntries(WORKSPACE_GROUP_BY_OPTIONS.map(({ id, label }) => [id, label]))).toEqual({
      none: "None",
      "workspace-status": "Status",
      "pr-status": "PR",
      repo: "Project",
    });
  });

  test("sort order, copy and descriptions follow the reference", () => {
    expect(WORKSPACE_SORT_OPTIONS.map(({ id }) => id)).toEqual([
      "name",
      "smart",
      "recent",
      "repo",
      "manual",
    ]);
    const byId = Object.fromEntries(WORKSPACE_SORT_OPTIONS.map((option) => [option.id, option]));
    expect(byId.smart.label).toBe("Agent Activity");
    expect(byId.smart.description).toContain("need attention");
    expect(byId.manual.label).toBe("Manual");
    expect(byId.manual.description).toContain("Drag workspaces");
    expect(byId.recent.label).toBe("Recent");
    expect(byId.repo.label).toBe("Project");
  });

  test("project order and card layout copy follow the reference", () => {
    expect(WORKSPACE_PROJECT_ORDER_OPTIONS.map(({ id }) => id)).toEqual(["manual", "recent"]);
    expect(WORKSPACE_PROJECT_ORDER_OPTIONS[0]).toMatchObject({ label: "Manual" });
    expect(WORKSPACE_PROJECT_ORDER_OPTIONS[1]).toMatchObject({ label: "Recent" });
    expect(Object.fromEntries(WORKSPACE_CARD_LAYOUT_OPTIONS.map(({ id, label }) => [id, label]))).toEqual({
      comfortable: "Detailed",
      compact: "Compact",
    });
  });

  test("show-properties display order covers every known property exactly once", () => {
    const ids = CARD_PROPERTY_OPTIONS.map(({ id }) => id);
    expect([...WORKSPACE_SHOW_PROPERTIES_DISPLAY_ORDER].sort()).toEqual([...ids].sort());
    expect(new Set(WORKSPACE_SHOW_PROPERTIES_DISPLAY_ORDER).size).toBe(ids.length);
    // Issues first, identity last — the reference arrangement.
    expect(WORKSPACE_SHOW_PROPERTIES_DISPLAY_ORDER.slice(0, 3)).toEqual([
      "issue",
      "linear-issue",
      "jira-issue",
    ]);
    expect(WORKSPACE_SHOW_PROPERTY_LABEL_OVERRIDES.pr).toBe("PR/MR link");
  });

  test("filter badge counts the hide switches only", () => {
    expect(countWorkspaceOptionsActiveFilters(DEFAULT_WORKSPACE_OPTIONS_STATE)).toBe(0);
    expect(hasWorkspaceOptionsActiveFilters(DEFAULT_WORKSPACE_OPTIONS_STATE)).toBe(false);
    const state = {
      ...DEFAULT_WORKSPACE_OPTIONS_STATE,
      hide: { ...DEFAULT_WORKSPACE_OPTIONS_STATE.hide, sleeping: true, cliCreated: true },
    };
    expect(countWorkspaceOptionsActiveFilters(state)).toBe(2);
    expect(hasWorkspaceOptionsActiveFilters(state)).toBe(true);
    expect(getWorkspaceOptionsFilterLabel(1)).toBe("1 filter");
    expect(getWorkspaceOptionsFilterLabel(2)).toBe("2 filters");
  });
});
