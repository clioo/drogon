/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/right-sidebar/right-sidebar-route.test.ts and
   right-sidebar-width.test.ts (adapter: this repo's tab set and storage
   keys; behavior contracts unchanged). */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  DEFAULT_RIGHT_SIDEBAR_TAB,
  normalizeRightSidebarTab,
  resolveInitialRightSidebarTab,
  resolveRightSidebarEffectiveTab,
  RIGHT_SIDEBAR_TAB_STORAGE_KEY,
} from "./right-sidebar-route";
import {
  clampRightSidebarPanelWidth,
  computeMaxRightSidebarPanelWidth,
  loadRightSidebarOpen,
  loadRightSidebarWidth,
  nextRightSidebarWidth,
  RIGHT_SIDEBAR_DEFAULT_WIDTH,
  RIGHT_SIDEBAR_MIN_WIDTH,
} from "./right-sidebar-width";
import {
  activityItemAriaLabel,
  buildRightSidebarActivityItems,
  getVisibleRightSidebarActivityItems,
} from "./activity-bar-items";
import { formatSidebarChord } from "./shortcut-label";

describe("normalizeRightSidebarTab", () => {
  it("keeps the MVP tabs", () => {
    assert.equal(normalizeRightSidebarTab("explorer"), "explorer");
    assert.equal(normalizeRightSidebarTab("mentu"), "mentu");
    assert.equal(normalizeRightSidebarTab("source-control"), "source-control");
    assert.equal(normalizeRightSidebarTab("ports"), "ports");
    assert.equal(normalizeRightSidebarTab("session"), "session");
  });
  it("resets unknown and legacy tabs to Explorer", () => {
    assert.equal(normalizeRightSidebarTab("search"), "explorer");
    assert.equal(normalizeRightSidebarTab("checks"), "explorer");
    assert.equal(normalizeRightSidebarTab(undefined), "explorer");
    assert.equal(normalizeRightSidebarTab("plugin:other/panel"), "explorer");
  });
});

describe("resolveInitialRightSidebarTab", () => {
  function storageWith(value: string | null) {
    const store = new Map<string, string>();
    if (value !== null) store.set(RIGHT_SIDEBAR_TAB_STORAGE_KEY, value);
    return {
      getItem: (key: string) => store.get(key) ?? null,
    };
  }
  it("defaults to the Explorer panel when nothing was stored", () => {
    assert.equal(DEFAULT_RIGHT_SIDEBAR_TAB, "explorer");
    assert.equal(
      resolveInitialRightSidebarTab(storageWith(null)),
      "explorer",
    );
  });
  it("keeps a stored tab and resets unknown values to Explorer", () => {
    assert.equal(
      resolveInitialRightSidebarTab(storageWith("source-control")),
      "source-control",
    );
    assert.equal(
      resolveInitialRightSidebarTab(storageWith("checks")),
      "explorer",
    );
  });
});

describe("resolveRightSidebarEffectiveTab", () => {
  it("keeps a visible stored tab", () => {
    assert.equal(
      resolveRightSidebarEffectiveTab("source-control", [
        "explorer",
        "source-control",
        "session",
      ]),
      "source-control",
    );
  });
  it("falls back without overwriting when the stored tab is hidden", () => {
    assert.equal(
      resolveRightSidebarEffectiveTab("source-control", [
        "explorer",
        "session",
      ]),
      "explorer",
    );
  });
});

describe("right-sidebar-width", () => {
  it("clamps below the minimum and above the window-derived maximum", () => {
    assert.equal(clampRightSidebarPanelWidth(10, 1440), RIGHT_SIDEBAR_MIN_WIDTH);
    assert.equal(
      clampRightSidebarPanelWidth(1200, 1440),
      1440 - 320,
    );
    assert.equal(
      computeMaxRightSidebarPanelWidth(undefined),
      2000,
    );
  });
  it("loads defaults and round-trips persisted values", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    assert.equal(loadRightSidebarWidth(storage), RIGHT_SIDEBAR_DEFAULT_WIDTH);
    assert.equal(loadRightSidebarOpen(storage), null);
  });
  it("widens when the left-edge handle drags left", () => {
    assert.equal(
      nextRightSidebarWidth(280, 1000, 960, 1440),
      320,
    );
    assert.equal(
      nextRightSidebarWidth(280, 1000, 1040, 1440),
      240,
    );
  });
});

describe("activity-bar-items", () => {
  // Fork item order (use-right-sidebar-activity-items.ts), minus the
  // panels Drogon does not serve yet (vault, workspaces, pr-checks,
  // checks) and with no Session details item (the fork has none).
  const fullState = {
    isFolder: false,
    isFolderWorkspace: false,
    isSshRepo: false,
    hasActiveWorktree: true,
    gitAvailable: true,
    mentuAvailable: true,
  };
  function builtItems() {
    return buildRightSidebarActivityItems({
      explorerShortcut: "⌘⇧E",
      sourceControlShortcut: "⌘⇧G",
      portsShortcut: "⌘⇧I",
    });
  }
  it("orders Explorer, Mentu, Source Control, Ports and labels with the chord", () => {
    const items = builtItems();
    assert.deepEqual(
      items.map((item) => item.id),
      ["explorer", "mentu", "source-control", "ports"],
    );
    assert.equal(
      activityItemAriaLabel(items[0]),
      "Explorer (⌘⇧E)",
    );
    // The fork's mentu entry carries no toggle chord.
    assert.equal(items[1].title, "Mentu");
    assert.equal(activityItemAriaLabel(items[1]), "Mentu");
    // R13-B: the source's ports item (Plug icon, ⌘⇧I chord) sits after
    // Source Control, in the source's relative order.
    assert.equal(items[3].title, "Ports");
    assert.equal(activityItemAriaLabel(items[3]), "Ports (⌘⇧I)");
  });
  it("formats chords per platform", () => {
    assert.equal(
      formatSidebarChord("CmdOrCtrl+Shift+E", "darwin"),
      "⌘⇧E",
    );
    assert.equal(
      formatSidebarChord("CmdOrCtrl+Shift+E", "other"),
      "Ctrl+Shift+E",
    );
    assert.equal(formatSidebarChord("CmdOrCtrl+L", "darwin"), "⌘L");
  });
  it("hides the git-only entry while git.v1 is withheld", () => {
    const items = builtItems();
    assert.deepEqual(
      getVisibleRightSidebarActivityItems(items, {
        ...fullState,
        gitAvailable: false,
      }).map((item) => item.id),
      ["explorer", "mentu", "ports"],
    );
    assert.deepEqual(
      getVisibleRightSidebarActivityItems(items, fullState).map(
        (item) => item.id,
      ),
      ["explorer", "mentu", "source-control", "ports"],
    );
  });
  it("hides Source Control on a folder workspace even while git.v1 is advertised", () => {
    const items = builtItems();
    assert.deepEqual(
      getVisibleRightSidebarActivityItems(items, {
        ...fullState,
        isFolder: true,
        isFolderWorkspace: true,
      }).map((item) => item.id),
      ["explorer", "mentu", "ports"],
    );
  });
  it("hides the workspace-only entries without a selected workspace", () => {
    const items = builtItems();
    assert.deepEqual(
      getVisibleRightSidebarActivityItems(items, {
        ...fullState,
        hasActiveWorktree: false,
      }).map((item) => item.id),
      ["explorer", "source-control"],
    );
  });
  it("projects the mentu entry with and without the mentu.v1 capability", () => {
    const items = builtItems();
    assert.deepEqual(
      getVisibleRightSidebarActivityItems(items, fullState).map(
        (item) => item.id,
      ),
      ["explorer", "mentu", "source-control", "ports"],
    );
    assert.deepEqual(
      getVisibleRightSidebarActivityItems(items, {
        ...fullState,
        mentuAvailable: false,
      }).map((item) => item.id),
      ["explorer", "source-control", "ports"],
    );
  });
  it("keeps the folderOnly/sshOnly filter branches for the unported items", () => {
    const items = [
      ...builtItems(),
      {
        id: "source-control" as const,
        icon: builtItems()[0].icon,
        title: "Attached worktrees",
        shortcut: "",
        folderOnly: true,
      },
      {
        id: "ports" as const,
        icon: builtItems()[0].icon,
        title: "Ssh",
        shortcut: "",
        sshOnly: true,
      },
    ];
    // Folder workspace without SSH: folderOnly shows, sshOnly hides.
    assert.deepEqual(
      getVisibleRightSidebarActivityItems(items, {
        ...fullState,
        isFolder: true,
        isFolderWorkspace: true,
      }).map((item) => item.title),
      ["Explorer", "Mentu", "Ports", "Attached worktrees"],
    );
    // Git workspace with SSH: folderOnly hides, sshOnly shows.
    assert.deepEqual(
      getVisibleRightSidebarActivityItems(items, {
        ...fullState,
        isSshRepo: true,
      }).map((item) => item.title),
      ["Explorer", "Mentu", "Source Control", "Ports", "Ssh"],
    );
  });
});
