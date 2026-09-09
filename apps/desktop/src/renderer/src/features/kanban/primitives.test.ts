// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
   Tests for the kanban slice primitives with no direct source test file at
   pinned source c9790628: host-qualified identity, status catalog and
   normalization, and the drag-data channel. The source covers these through
   its sidebar suites; these cases pin the same contracts on the Drogon port.
   Host identity cases mirror the source's host-qualified-identity guarantees
   (printable separator, empty-host bucket, exact id recovery). */
import { describe, expect, it } from "vitest";
import {
  composeWorktreeHostIdentity,
  getExecutionHostIdFromWorktreeHostIdentity,
  getWorktreeHostIdentity,
  getWorktreeIdFromHostIdentity,
  isWorktreeHostIdentity,
} from "./host-identity";
import {
  DEFAULT_WORKSPACE_STATUSES,
  cloneDefaultWorkspaceStatuses,
  clampWorkspaceBoardColumnWidth,
  clampWorkspaceBoardOpacity,
  getDefaultWorkspaceStatusId,
  getWorkspaceStatus,
  getWorkspaceStatusFromGroupKey,
  getWorkspaceStatusGroupKey,
  getWorkspaceStatusVisualMeta,
  isWorkspaceStatusId,
  makeWorkspaceStatusId,
  normalizeWorkspaceStatuses,
  WORKSPACE_BOARD_COLUMN_WIDTH_DEFAULT,
  WORKSPACE_BOARD_COLUMN_WIDTH_MAX,
  WORKSPACE_BOARD_COLUMN_WIDTH_MIN,
} from "./workspace-status";
import {
  hasWorkspaceDragData,
  readWorkspaceDragData,
  readWorkspaceDragDataIds,
  writeWorkspaceDragData,
  WORKSPACE_STATUS_DRAG_IDS_TYPE,
  WORKSPACE_STATUS_DRAG_PAYLOAD_MAX_BYTES,
  WORKSPACE_STATUS_DRAG_TYPE,
} from "./drag-data";
import { isWorktreePaletteQueryTooLarge } from "./worktree-palette-query-bounds";

describe("host identity", () => {
  it("composes a printable host-qualified identity", () => {
    expect(getWorktreeHostIdentity({ id: "a::/tmp/x", hostId: "local" })).toBe(
      "local|a::/tmp/x",
    );
    expect(composeWorktreeHostIdentity(undefined, "a::/tmp/x")).toBe(
      "|a::/tmp/x",
    );
  });

  it("recovers the host and id exactly, and keeps unqualified rows in their own bucket", () => {
    expect(
      getExecutionHostIdFromWorktreeHostIdentity("ssh:box|a::/tmp/x"),
    ).toBe("ssh:box");
    expect(
      getExecutionHostIdFromWorktreeHostIdentity("|a::/tmp/x"),
    ).toBeUndefined();
    expect(getWorktreeIdFromHostIdentity("ssh:box|a::/tmp/x")).toBe(
      "a::/tmp/x",
    );
    expect(isWorktreeHostIdentity("|a::/tmp/x")).toBe(true);
    expect(isWorktreeHostIdentity("legacy|id")).toBe(true);
  });

  it("keeps same-id rows on different hosts distinct", () => {
    const local = getWorktreeHostIdentity({ id: "shared", hostId: "local" });
    const remote = getWorktreeHostIdentity({ id: "shared", hostId: "ssh:box" });
    expect(local).not.toBe(remote);
  });
});

describe("workspace statuses", () => {
  it("ships the source's default columns exactly", () => {
    expect(DEFAULT_WORKSPACE_STATUSES).toEqual([
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
      {
        id: "completed",
        label: "Done",
        color: "conductor-done",
        icon: "conductor-done",
      },
    ]);
    // The default lane of an unassigned card is the source's DEFAULT status.
    expect(getDefaultWorkspaceStatusId(DEFAULT_WORKSPACE_STATUSES)).toBe(
      "in-progress",
    );
    expect(cloneDefaultWorkspaceStatuses()).not.toBe(
      DEFAULT_WORKSPACE_STATUSES,
    );
  });

  it("normalizes persisted payloads with the source's fallbacks", () => {
    expect(normalizeWorkspaceStatuses(null)).toEqual(
      cloneDefaultWorkspaceStatuses(),
    );
    expect(normalizeWorkspaceStatuses([])).toEqual(
      cloneDefaultWorkspaceStatuses(),
    );
    expect(normalizeWorkspaceStatuses("junk")).toEqual(
      cloneDefaultWorkspaceStatuses(),
    );

    const normalized = normalizeWorkspaceStatuses([
      {
        id: "Custom ID!",
        label: "  In   progress ",
        color: "nope",
        icon: "flag",
      },
      { id: "custom-id", label: "Second" },
      { label: "" },
    ]);
    expect(normalized[0]).toMatchObject({
      id: "custom-id",
      label: "In progress",
      icon: "flag",
    });
    // Duplicate ids get the source's -2 suffix (from the label slug).
    expect(normalized[1]?.id).toBe("second");
    // Unknown ids carry no default visual, so colors cycle the source palette
    // by position: entry 1 -> "blue".
    expect(normalized[1]?.color).toBe("blue");
    expect(normalized[0]?.color).toBe("neutral");
    // A blank label falls back to "Status N" and its color to the cycling palette.
    expect(normalized[2]?.label).toBe("Status 3");
    expect(normalized[2]?.color).toBe("sky");
  });

  it("mints unique status ids", () => {
    const existing = cloneDefaultWorkspaceStatuses();
    expect(makeWorkspaceStatusId("Blocked", existing)).toBe("blocked");
    expect(makeWorkspaceStatusId("Todo", existing)).toBe("todo-2");
  });

  it("clamps column width and board opacity to the source bounds", () => {
    expect(clampWorkspaceBoardColumnWidth(10)).toBe(
      WORKSPACE_BOARD_COLUMN_WIDTH_MIN,
    );
    expect(clampWorkspaceBoardColumnWidth(99999)).toBe(
      WORKSPACE_BOARD_COLUMN_WIDTH_MAX,
    );
    expect(clampWorkspaceBoardColumnWidth("NaN")).toBe(
      WORKSPACE_BOARD_COLUMN_WIDTH_DEFAULT,
    );
    expect(clampWorkspaceBoardColumnWidth(307.4)).toBe(307);
    expect(clampWorkspaceBoardOpacity(5)).toBe(1);
    expect(clampWorkspaceBoardOpacity(0.1)).toBe(0.2);
    expect(clampWorkspaceBoardOpacity(undefined)).toBe(1);
  });

  it("round-trips group keys and resolves statuses", () => {
    const custom = [
      { id: "in progress", label: "In progress" },
      { id: "todo", label: "Todo" },
    ];
    const key = getWorkspaceStatusGroupKey("in progress");
    expect(getWorkspaceStatusFromGroupKey(key, custom)).toBe("in progress");
    // Only known status ids decode; unknown or malformed keys stay null.
    expect(
      getWorkspaceStatusFromGroupKey(key, DEFAULT_WORKSPACE_STATUSES),
    ).toBeNull();
    expect(getWorkspaceStatusFromGroupKey("other:x", custom)).toBeNull();
    expect(
      getWorkspaceStatusFromGroupKey("workspace-status:%zz", custom),
    ).toBeNull();
    expect(isWorkspaceStatusId("todo", DEFAULT_WORKSPACE_STATUSES)).toBe(true);
    expect(
      getWorkspaceStatus(
        { workspaceStatus: "nope" },
        DEFAULT_WORKSPACE_STATUSES,
      ),
    ).toBe("in-progress");
    expect(
      getWorkspaceStatus({ workspaceStatus: null }, DEFAULT_WORKSPACE_STATUSES),
    ).toBe("in-progress");
  });

  it("maps the default visuals onto the conductor palette", () => {
    const meta = getWorkspaceStatusVisualMeta("in-progress");
    expect(meta.tone).toBe("text-[#d4a300]");
    expect(meta.laneTint).toBe("bg-[#d4a300]/[0.04]");
    const doneMeta = getWorkspaceStatusVisualMeta(
      DEFAULT_WORKSPACE_STATUSES[3],
    );
    expect(doneMeta.tone).toBe("text-[#c7a594]");
  });
});

describe("drag data channel", () => {
  function makeDataTransfer(): DataTransfer {
    const store = new Map<string, string>();
    const transferTypes: string[] = [];
    return {
      effectAllowed: "uninitialized",
      dropEffect: "none",
      files: [],
      items: [],
      types: transferTypes,
      setData(type: string, value: string) {
        store.set(type, value);
        (transferTypes as string[]).length = 0;
        for (const key of store.keys()) (transferTypes as string[]).push(key);
      },
      getData(type: string) {
        return store.get(type) ?? "";
      },
      clearData() {
        store.clear();
      },
      setDragImage() {},
    } as unknown as DataTransfer;
  }

  it("writes and reads back single and batch payloads", () => {
    const transfer = makeDataTransfer();
    writeWorkspaceDragData(transfer, "a::/tmp/x");
    expect(readWorkspaceDragData(transfer)).toBe("a::/tmp/x");
    expect(readWorkspaceDragDataIds(transfer)).toEqual(["a::/tmp/x"]);

    const batch = makeDataTransfer();
    writeWorkspaceDragData(batch, ["a", "b", "c"]);
    expect(readWorkspaceDragDataIds(batch)).toEqual(["a", "b", "c"]);
    // Legacy single-id payload stays for older drop targets.
    expect(batch.getData(WORKSPACE_STATUS_DRAG_TYPE)).toBe("a");
    expect(batch.getData("text/plain")).toBe("a");
  });

  it("ignores empty writes and non-board payloads", () => {
    const transfer = makeDataTransfer();
    writeWorkspaceDragData(transfer, []);
    expect(readWorkspaceDragDataIds(transfer)).toEqual([]);
    expect(hasWorkspaceDragData(transfer)).toBe(false);

    const plain = makeDataTransfer();
    plain.setData("text/plain", "surfaced-id");
    expect(hasWorkspaceDragData(plain)).toBe(true);
    expect(readWorkspaceDragData(plain)).toBe("surfaced-id");
  });

  it("rejects over-bound payloads instead of reading them", () => {
    const transfer = makeDataTransfer();
    const huge = "x".repeat(WORKSPACE_STATUS_DRAG_PAYLOAD_MAX_BYTES * 2);
    transfer.setData(WORKSPACE_STATUS_DRAG_IDS_TYPE, JSON.stringify([huge]));
    expect(readWorkspaceDragDataIds(transfer)).toEqual([]);
  });

  it("caps batch ids at the source's 512 count", () => {
    const transfer = makeDataTransfer();
    const ids = Array.from({ length: 600 }, (_, index) => `id-${index}`);
    transfer.setData(WORKSPACE_STATUS_DRAG_IDS_TYPE, JSON.stringify(ids));
    (transfer.types as string[]).push(WORKSPACE_STATUS_DRAG_IDS_TYPE);
    expect(readWorkspaceDragDataIds(transfer)).toEqual([]);
  });
});

describe("query bounds", () => {
  it("rejects queries above the 2 KiB UTF-8 bound", () => {
    expect(isWorktreePaletteQueryTooLarge("a".repeat(2048))).toBe(false);
    expect(isWorktreePaletteQueryTooLarge("a".repeat(2049))).toBe(true);
    // Multi-byte content over the byte bound with few code units.
    expect(isWorktreePaletteQueryTooLarge("🔍".repeat(700))).toBe(true);
  });
});
