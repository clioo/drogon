import { describe, expect, test } from "vitest";
import { getDeleteWorktreeDialogCopy } from "./delete-worktree-dialog-copy";
import {
  formatDirtyChangeLabel,
  getDeleteWorktreeDirtyChangeCount,
} from "./delete-worktree-dirty-change-counts";

describe("delete worktree dialog copy", () => {
  test("git worktrees delete from git and disk", () => {
    const copy = getDeleteWorktreeDialogCopy({
      displayName: "feature",
      isFolderWorkspaceDelete: false,
    });
    expect(copy.targetLabel).toBe("feature");
    expect(copy.descriptionSuffix).toBe(
      "from git and delete its workspace folder.",
    );
    expect(copy.mainWorktreeBlocker).toBe(
      "Git does not allow removing the main worktree.",
    );
  });

  test("folder deletes keep the folder on disk", () => {
    const copy = getDeleteWorktreeDialogCopy({
      displayName: "my-folder",
      isFolderWorkspaceDelete: true,
    });
    expect(copy.descriptionSuffix).toBe(
      "from Drogon. The project folder on disk will not be deleted.",
    );
    expect(copy.mainWorktreeBlocker).toBe(
      "Remove the folder project instead of deleting this workspace.",
    );
  });
});

describe("delete worktree dirty change counts", () => {
  test("live git status counts surface as the hint", () => {
    expect(
      getDeleteWorktreeDirtyChangeCount({
        isFolderWorkspaceDelete: false,
        entryCount: 3,
      }),
    ).toBe(3);
    expect(
      getDeleteWorktreeDirtyChangeCount({
        isFolderWorkspaceDelete: false,
        entryCount: 0,
      }),
    ).toBeUndefined();
    expect(
      getDeleteWorktreeDirtyChangeCount({
        isFolderWorkspaceDelete: false,
        entryCount: null,
      }),
    ).toBeUndefined();
  });

  test("folder deletes never carry a dirty hint", () => {
    expect(
      getDeleteWorktreeDirtyChangeCount({
        isFolderWorkspaceDelete: true,
        entryCount: 5,
      }),
    ).toBeUndefined();
  });

  test("a proven-dirty refusal warns without inventing a count", () => {
    expect(
      getDeleteWorktreeDirtyChangeCount({
        isFolderWorkspaceDelete: false,
        entryCount: 0,
        provenDirty: true,
      }),
    ).toBe(0);
  });

  test("hint text pluralizes like the source", () => {
    expect(formatDirtyChangeLabel(1)).toBe(
      "1 uncommitted or untracked change",
    );
    expect(formatDirtyChangeLabel(4)).toBe(
      "4 uncommitted or untracked changes",
    );
    expect(formatDirtyChangeLabel(0)).toBe(
      "Uncommitted or untracked changes",
    );
  });
});
