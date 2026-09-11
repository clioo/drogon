import { expect, test } from "vitest";
import { normalizeWorkspaceUIPreferences, DEFAULT_WORKSPACE_UI_PREFERENCES } from "./workspace-ui-preferences";
import { DEFAULT_WORKTREE_CARD_PROPERTIES, LEGACY_PORTS_ON_WORKTREE_CARD_PROPERTIES } from "../shared/worktree/card-properties";

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

test("profiles saved with the old default-on ports preset lose it exactly once", () => {
  const migrated = normalizeWorkspaceUIPreferences({
    worktreeCardProperties: [...LEGACY_PORTS_ON_WORKTREE_CARD_PROPERTIES],
  });
  expect(migrated.worktreeCardProperties).not.toContain("ports");
  expect(migrated.worktreeCardProperties).toEqual(DEFAULT_WORKTREE_CARD_PROPERTIES);
  expect(migrated._worktreeCardPortsDefaultedOff).toBe(true);
  // The stamp makes the removal one-shot: a later, deliberate opt-in via
  // `Show properties → Ports` survives every following hydration.
  const reEnabled = normalizeWorkspaceUIPreferences({
    ...migrated,
    worktreeCardProperties: [...migrated.worktreeCardProperties, "ports"],
  });
  expect(reEnabled.worktreeCardProperties).toContain("ports");
  expect(reEnabled._worktreeCardPortsDefaultedOff).toBe(true);
});

test("a user-customized profile still loses only the never-chosen ports default", () => {
  const customized = normalizeWorkspaceUIPreferences({
    worktreeCardProperties: LEGACY_PORTS_ON_WORKTREE_CARD_PROPERTIES.filter((id) => id !== "comment"),
    sortBy: "manual",
  });
  expect(customized.worktreeCardProperties).not.toContain("comment");
  expect(customized.worktreeCardProperties).not.toContain("ports");
  expect(customized.sortBy).toBe("manual");
});

test("profiles that never carried ports are untouched by the stamp migration", () => {
  const compact = normalizeWorkspaceUIPreferences({
    _worktreeCardPortsDefaultedOff: true,
    worktreeCardProperties: ["status", "unread"],
  });
  expect(compact.worktreeCardProperties).toEqual(["status", "unread"]);
  expect(compact._worktreeCardPortsDefaultedOff).toBe(true);
});
