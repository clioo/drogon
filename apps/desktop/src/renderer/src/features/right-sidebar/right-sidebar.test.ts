/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/right-sidebar/right-sidebar-route.test.ts and
   right-sidebar-width.test.ts (adapter: this repo's tab set and storage
   keys; behavior contracts unchanged). */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  normalizeRightSidebarTab,
  resolveRightSidebarEffectiveTab,
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
  it("orders Explorer, Mentu, Source Control, Ports and labels with the chord", () => {
    const items = buildRightSidebarActivityItems({
      explorerShortcut: "⌘⇧E",
      sourceControlShortcut: "⌘⇧G",
      portsShortcut: "⌘⇧I",
    });
    assert.deepEqual(
      items.map((item) => item.id),
      ["explorer", "mentu", "source-control", "ports", "session"],
    );
    assert.equal(
      activityItemAriaLabel(items[0]),
      "Explorer (⌘⇧E)",
    );
    // The fork's mentu entry carries no toggle chord.
    assert.equal(items[1].title, "Mentu");
    assert.equal(activityItemAriaLabel(items[1]), "Mentu");
    // R13-B: the source's ports item (Plug icon, ⌘⇧I chord) sits between
    // Source Control and the session-details entry.
    assert.equal(items[3].title, "Ports");
    assert.equal(activityItemAriaLabel(items[3]), "Ports (⌘⇧I)");
    assert.equal(activityItemAriaLabel(items[4]), "Session details");
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
    const items = buildRightSidebarActivityItems({
      explorerShortcut: "",
      sourceControlShortcut: "",
      portsShortcut: "",
    });
    assert.deepEqual(
      getVisibleRightSidebarActivityItems(items, {
        gitAvailable: false,
        mentuAvailable: true,
      }).map((item) => item.id),
      ["explorer", "mentu", "ports", "session"],
    );
    assert.equal(
      getVisibleRightSidebarActivityItems(items, {
        gitAvailable: true,
        mentuAvailable: true,
      }).length,
      5,
    );
  });
  it("projects the mentu entry with and without the mentu.v1 capability", () => {
    const items = buildRightSidebarActivityItems({
      explorerShortcut: "",
      sourceControlShortcut: "",
      portsShortcut: "",
    });
    assert.deepEqual(
      getVisibleRightSidebarActivityItems(items, {
        gitAvailable: true,
        mentuAvailable: true,
      }).map((item) => item.id),
      ["explorer", "mentu", "source-control", "ports", "session"],
    );
    assert.deepEqual(
      getVisibleRightSidebarActivityItems(items, {
        gitAvailable: true,
        mentuAvailable: false,
      }).map((item) => item.id),
      ["explorer", "source-control", "ports", "session"],
    );
  });
});
