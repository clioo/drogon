/* MIT Copyright (c) 2026 Lovecast Inc.
   Bulk worktree operations: the counted copy the menu and confirm show,
   the pin intent for a mixed selection, and the sequential delete runner
   that keeps going after a failure and reports exactly which workspace
   refused. */
import { describe, expect, test, vi } from "vitest";
import type { Worktree } from "../../../../shared/session-contract";
import {
  bulkDeleteMenuLabel,
  bulkPinIntent,
  deletableTargets,
  formatBulkDeleteResult,
  formatWorkspaceCount,
  getBulkDeleteDialogCopy,
  runBulkWorktreeDelete,
  type BulkWorktreeTarget,
} from "./worktree-bulk-actions";

function worktree(id: string, extra: Partial<Worktree> = {}): Worktree {
  return {
    id,
    projectId: "p1",
    workspaceId: `ws-${id}`,
    path: `/work/${id}`,
    branch: id,
    head: "abc",
    baseRef: null,
    createdAt: "",
    ...extra,
  };
}

function target(
  id: string,
  extra: Partial<BulkWorktreeTarget> = {},
): BulkWorktreeTarget {
  return {
    worktree: worktree(id),
    name: id,
    protectedFromDelete: false,
    ...extra,
  };
}

describe("counted copy", () => {
  test("pluralizes workspaces", () => {
    expect(formatWorkspaceCount(1)).toBe("1 workspace");
    expect(formatWorkspaceCount(3)).toBe("3 workspaces");
    expect(bulkDeleteMenuLabel(3)).toBe("Delete 3 workspaces");
  });
});

describe("bulkPinIntent", () => {
  test("pins when any selected workspace is unpinned", () => {
    const intent = bulkPinIntent([
      worktree("a", { isPinned: true }),
      worktree("b"),
    ]);
    expect(intent.pin).toBe(true);
    expect(intent.label).toBe("Pin 2 workspaces");
  });

  test("unpins only when every selected workspace is pinned", () => {
    const intent = bulkPinIntent([
      worktree("a", { isPinned: true }),
      worktree("b", { isPinned: true }),
    ]);
    expect(intent.pin).toBe(false);
    expect(intent.label).toBe("Unpin 2 workspaces");
  });
});

describe("delete protection", () => {
  test("protected targets are excluded and named in the confirm copy", () => {
    const targets = [
      target("a"),
      target("main", { protectedFromDelete: true }),
      target("b"),
    ];
    expect(deletableTargets(targets).map((item) => item.name)).toEqual([
      "a",
      "b",
    ]);
    const copy = getBulkDeleteDialogCopy(targets);
    expect(copy.title).toBe("Delete 2 workspaces");
    expect(copy.confirmLabel).toBe("Delete 2 workspaces");
    expect(copy.protectedHint).toBe(
      "1 workspace in this selection is a project's main checkout and will be kept.",
    );
  });

  test("no hint when nothing is protected", () => {
    expect(getBulkDeleteDialogCopy([target("a")]).protectedHint).toBeNull();
  });
});

describe("runBulkWorktreeDelete", () => {
  test("deletes every deletable target in rendered order, never in parallel", async () => {
    const seen: string[] = [];
    let inFlight = 0;
    const remove = vi.fn(async (item: Worktree) => {
      inFlight += 1;
      expect(inFlight).toBe(1);
      await Promise.resolve();
      seen.push(item.id);
      inFlight -= 1;
      return null;
    });
    const outcome = await runBulkWorktreeDelete({
      targets: [target("a"), target("b"), target("c")],
      force: false,
      remove,
    });
    expect(seen).toEqual(["a", "b", "c"]);
    expect(outcome.deletedIds).toEqual(["a", "b", "c"]);
    expect(outcome.failures).toEqual([]);
  });

  test("skips protected targets entirely", async () => {
    const remove = vi.fn(async () => null);
    const outcome = await runBulkWorktreeDelete({
      targets: [target("a"), target("main", { protectedFromDelete: true })],
      force: false,
      remove,
    });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(outcome.deletedIds).toEqual(["a"]);
  });

  test("passes the force flag through to every removal", async () => {
    const remove = vi.fn(async (_worktree: Worktree, _force: boolean) => null);
    await runBulkWorktreeDelete({
      targets: [target("a"), target("b")],
      force: true,
      remove,
    });
    expect(remove.mock.calls.every((call) => call[1] === true)).toBe(true);
  });

  test("keeps going after a failure and reports which workspace refused", async () => {
    const remove = vi.fn(async (item: Worktree) =>
      item.id === "b" ? "worktree is dirty" : null,
    );
    const outcome = await runBulkWorktreeDelete({
      targets: [target("a"), target("b"), target("c")],
      force: false,
      remove,
    });
    expect(remove).toHaveBeenCalledTimes(3);
    expect(outcome.deletedIds).toEqual(["a", "c"]);
    expect(outcome.failures).toEqual([
      { worktreeId: "b", name: "b", error: "worktree is dirty" },
    ]);
    expect(formatBulkDeleteResult(outcome)).toBe(
      "Deleted 2 workspaces, 1 failed",
    );
  });

  test("a thrown bridge error becomes a recorded failure, not a lost run", async () => {
    const remove = vi.fn(async (item: Worktree) => {
      if (item.id === "a") throw new Error("daemon disconnected");
      return null;
    });
    const outcome = await runBulkWorktreeDelete({
      targets: [target("a"), target("b")],
      force: false,
      remove,
    });
    expect(outcome.failures).toEqual([
      { worktreeId: "a", name: "a", error: "daemon disconnected" },
    ]);
    expect(outcome.deletedIds).toEqual(["b"]);
  });

  test("summary lines name the all-failed and all-succeeded cases", () => {
    expect(
      formatBulkDeleteResult({ deletedIds: ["a", "b"], failures: [] }),
    ).toBe("Deleted 2 workspaces");
    expect(
      formatBulkDeleteResult({
        deletedIds: [],
        failures: [{ worktreeId: "a", name: "a", error: "nope" }],
      }),
    ).toBe("Could not delete 1 workspace");
  });
});
