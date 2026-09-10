import { expect, test } from "vitest";
import { normalizeWorkspaceUIPreferences, DEFAULT_WORKSPACE_UI_PREFERENCES } from "./workspace-ui-preferences";
import { DEFAULT_WORKTREE_CARD_PROPERTIES } from "../shared/worktree/card-properties";

test("new profiles use source property and compact-activity defaults", () => {
  expect(DEFAULT_WORKSPACE_UI_PREFERENCES.worktreeCardProperties).toEqual(DEFAULT_WORKTREE_CARD_PROPERTIES);
  expect(DEFAULT_WORKSPACE_UI_PREFERENCES.agentActivityDisplayMode).toBe("compact");
});
test("limited old menu profiles retain unchecked Branch and previously visible notes/agents", () => {
  const upgraded = normalizeWorkspaceUIPreferences({ cardLayout: "comfortable", worktreeCardProperties: ["pr"] });
  expect(upgraded.worktreeCardProperties).not.toContain("branch");
  expect(upgraded.worktreeCardProperties).toContain("pr");
  expect(upgraded.worktreeCardProperties).toContain("comment");
  expect(upgraded.worktreeCardProperties).toContain("inline-agents");
  expect(upgraded.agentActivityDisplayMode).toBe("full");
  const unchecked = { ...upgraded, worktreeCardProperties: upgraded.worktreeCardProperties.filter((id) => id !== "comment") };
  expect(normalizeWorkspaceUIPreferences(unchecked).worktreeCardProperties).not.toContain("comment");
});
