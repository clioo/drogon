import { describe, expect, test } from "vitest";
import type { Workspace } from "../../shared/session-contract";
import {
  loadSavedSelection,
  resolveRestoredSelection,
  resolveWorkspaceSelection,
  saveSavedSelection,
} from "./workspace-selection";

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage;
}

const workspace = (id: string, hostId = "h1"): Workspace => ({
  id,
  path: `/tmp/${id}`,
  name: id,
  kind: "folder",
  hostId,
});

describe("resolveWorkspaceSelection", () => {
  test("clicking the already-selected workspace is a no-op", () => {
    const resolution = resolveWorkspaceSelection("w1", "w1");
    expect(resolution.changed).toBe(false);
  });
  test("clicking a different workspace resolves a change to that target", () => {
    const resolution = resolveWorkspaceSelection("w1", "w2");
    expect(resolution).toEqual({ changed: true, selected: "w2" });
  });
});

describe("saved workspace selection round trip", () => {
  test("a saved selection is restored exactly, scoped by host", () => {
    const storage = fakeStorage();
    saveSavedSelection({ workspaceId: "w2", hostId: "h1" }, storage);
    expect(loadSavedSelection(storage)).toEqual({
      workspaceId: "w2",
      hostId: "h1",
    });
  });
  test("no saved selection yields an explicit absent signal, not a thrown error", () => {
    const storage = fakeStorage();
    expect(loadSavedSelection(storage)).toBeNull();
  });
  test("tampered storage is treated as absent, never trusted", () => {
    const storage = fakeStorage();
    storage.setItem("drogon:selected-workspace", '{"not":"valid"}');
    expect(loadSavedSelection(storage)).toBeNull();
    storage.setItem("drogon:selected-workspace", "not json at all");
    expect(loadSavedSelection(storage)).toBeNull();
  });
  test("a storage write failure (private mode/quota) is swallowed, not thrown", () => {
    const throwingStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    } as unknown as Storage;
    expect(() =>
      saveSavedSelection({ workspaceId: "w1", hostId: "h1" }, throwingStorage),
    ).not.toThrow();
  });
});

describe("resolveRestoredSelection", () => {
  test("restore prefers the saved workspace over the first-workspace default", () => {
    const workspaces = [workspace("w1"), workspace("w2")];
    const restored = resolveRestoredSelection(workspaces, {
      workspaceId: "w2",
      hostId: "h1",
    });
    expect(restored).toBe("w2");
  });
  test("a missing saved selection falls back to the first workspace", () => {
    const workspaces = [workspace("w1"), workspace("w2")];
    expect(resolveRestoredSelection(workspaces, null)).toBe("w1");
  });
  test("a saved selection whose workspace is no longer available falls back to the first workspace", () => {
    const workspaces = [workspace("w1"), workspace("w2")];
    const restored = resolveRestoredSelection(workspaces, {
      workspaceId: "gone",
      hostId: "h1",
    });
    expect(restored).toBe("w1");
  });
  test("a saved selection for a different host is not trusted, even with a matching id", () => {
    const workspaces = [workspace("w1", "h1"), workspace("w2", "h2")];
    const restored = resolveRestoredSelection(workspaces, {
      workspaceId: "w2",
      hostId: "h1",
    });
    expect(restored).toBe("w1");
  });
  test("no workspaces at all restores an explicit empty selection", () => {
    expect(resolveRestoredSelection([], { workspaceId: "w1", hostId: "h1" })).toBe(
      "",
    );
  });
});
