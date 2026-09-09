// MIT Copyright (c) 2026 Lovecast Inc.
// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  clampWorkspaceBoardColumnWidth,
  clampWorkspaceBoardOpacity,
  cloneDefaultWorkspaceStatuses,
  DEFAULT_WORKSPACE_STATUS_ID,
  getDefaultWorkspaceStatusId,
  getWorkspaceStatus,
  getWorkspaceStatusFromGroupKey,
  getWorkspaceStatusGroupKey,
  isWorkspaceStatusId,
  makeWorkspaceStatusId,
  normalizeWorkspaceStatuses,
  WORKSPACE_BOARD_COLUMN_WIDTH_MAX,
  WORKSPACE_BOARD_COLUMN_WIDTH_MIN,
} from "./workspace-statuses";
import { DEFAULT_WORKSPACE_STATUSES } from "./workspace-status-defaults";

describe("cloneDefaultWorkspaceStatuses", () => {
  it("matches the exact task-specified default set", () => {
    expect(cloneDefaultWorkspaceStatuses()).toEqual([
      { id: "todo", label: "Todo", color: "neutral", icon: "circle" },
      {
        id: "in-progress",
        label: "In progress",
        color: "conductor-progress",
        icon: "conductor-progress",
      },
      {
        id: "in-review",
        label: "In review",
        color: "conductor-review",
        icon: "conductor-review",
      },
      { id: "completed", label: "Done", color: "conductor-done", icon: "conductor-done" },
    ]);
  });

  it("returns a fresh array each call (no shared mutable reference)", () => {
    const first = cloneDefaultWorkspaceStatuses();
    first[0]!.label = "Mutated";
    expect(cloneDefaultWorkspaceStatuses()[0]!.label).toBe("Todo");
    expect(DEFAULT_WORKSPACE_STATUSES[0]!.label).toBe("Todo");
  });
});

describe("normalizeWorkspaceStatuses", () => {
  it("falls back to the defaults for garbage input", () => {
    expect(normalizeWorkspaceStatuses(undefined)).toEqual(cloneDefaultWorkspaceStatuses());
    expect(normalizeWorkspaceStatuses("nope")).toEqual(cloneDefaultWorkspaceStatuses());
    expect(normalizeWorkspaceStatuses([])).toEqual(cloneDefaultWorkspaceStatuses());
  });

  it("sanitizes a custom status: trims/slugs id, trims/truncates label, validates color/icon", () => {
    const [status] = normalizeWorkspaceStatuses([
      { id: "  My Custom Status!! ", label: "  Blocked   on   review  ", color: "bogus", icon: "bogus" },
    ]);
    expect(status!.id).toBe("my-custom-status");
    expect(status!.label).toBe("Blocked on review");
    // Unknown color/icon falls back to a real known one (never the raw garbage).
    expect(status!.color).not.toBe("bogus");
    expect(status!.icon).not.toBe("bogus");
  });

  it("deduplicates colliding ids by minting a new one", () => {
    const statuses = normalizeWorkspaceStatuses([
      { id: "dup", label: "First" },
      { id: "dup", label: "Second" },
    ]);
    const ids = statuses.map((s) => s.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("makeWorkspaceStatusId", () => {
  it("slugs the label and disambiguates against existing ids", () => {
    const existing = cloneDefaultWorkspaceStatuses();
    existing.push({ id: "blocked", label: "Blocked" });
    expect(makeWorkspaceStatusId("Blocked", existing)).toBe("blocked-2");
    expect(makeWorkspaceStatusId("Brand new", existing)).toBe("brand-new");
  });
});

describe("clampWorkspaceBoardOpacity / clampWorkspaceBoardColumnWidth", () => {
  it("clamps to [0.2, 1] and [220, 520] respectively, defaulting on garbage", () => {
    expect(clampWorkspaceBoardOpacity(0)).toBe(0.2);
    expect(clampWorkspaceBoardOpacity(5)).toBe(1);
    expect(clampWorkspaceBoardOpacity(0.55)).toBe(0.55);
    expect(clampWorkspaceBoardOpacity("nope")).toBe(1);

    expect(clampWorkspaceBoardColumnWidth(1)).toBe(WORKSPACE_BOARD_COLUMN_WIDTH_MIN);
    expect(clampWorkspaceBoardColumnWidth(99999)).toBe(WORKSPACE_BOARD_COLUMN_WIDTH_MAX);
    expect(clampWorkspaceBoardColumnWidth("nope")).toBe(308);
  });
});

describe("getWorkspaceStatus / isWorkspaceStatusId / getDefaultWorkspaceStatusId", () => {
  it("falls back to the default status id when the worktree's status is unknown or absent", () => {
    const statuses = cloneDefaultWorkspaceStatuses();
    expect(getWorkspaceStatus({ workspaceStatus: null }, statuses)).toBe(
      DEFAULT_WORKSPACE_STATUS_ID,
    );
    expect(getWorkspaceStatus({ workspaceStatus: "not-a-real-status" }, statuses)).toBe(
      DEFAULT_WORKSPACE_STATUS_ID,
    );
    expect(getWorkspaceStatus({ workspaceStatus: "in-review" }, statuses)).toBe("in-review");
  });

  it("falls back to the first status when the canonical default id was removed", () => {
    const withoutDefault = cloneDefaultWorkspaceStatuses().filter(
      (s) => s.id !== DEFAULT_WORKSPACE_STATUS_ID,
    );
    expect(getDefaultWorkspaceStatusId(withoutDefault)).toBe(withoutDefault[0]!.id);
  });

  it("isWorkspaceStatusId only accepts a status actually in the list", () => {
    const statuses = cloneDefaultWorkspaceStatuses();
    expect(isWorkspaceStatusId("todo", statuses)).toBe(true);
    expect(isWorkspaceStatusId("ghost", statuses)).toBe(false);
  });
});

describe("getWorkspaceStatusGroupKey / getWorkspaceStatusFromGroupKey", () => {
  it("round trips through the group key encoding", () => {
    const statuses = cloneDefaultWorkspaceStatuses();
    for (const status of statuses) {
      const key = getWorkspaceStatusGroupKey(status.id);
      expect(getWorkspaceStatusFromGroupKey(key, statuses)).toBe(status.id);
    }
  });

  it("rejects a group key for a non-workspace-status prefix or an unknown status", () => {
    const statuses = cloneDefaultWorkspaceStatuses();
    expect(getWorkspaceStatusFromGroupKey("repo:some-project", statuses)).toBeNull();
    expect(
      getWorkspaceStatusFromGroupKey("workspace-status:not-a-real-status", statuses),
    ).toBeNull();
  });
});
