// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/shared/keybindings/definitions-core-1.ts
//   src/shared/keybindings/definitions-core-2.ts
//   src/shared/keybindings/definitions-core-3.ts
//   src/shared/keybindings/definitions-core-4.ts
//   src/shared/keybindings/definitions.ts (group order, digit-index rows)
//   src/shared/keybindings/types.ts (scope/platform/binding types)
// Adapted: MVP-relevant ids only (J5 palette/quick-open/tabs, J10 settings,
// workspace/sidebar/terminal/zoom/browser-tab surfaces). Chords, ids, titles,
// groups and scopes are verbatim from the source; each row carries a Drogon
// status so ids without a feature yet stay registered as disabled, never
// removed. Stored chords use the source `Mod` token; the parser also accepts
// the legacy Drogon `CmdOrCtrl` spelling.

export type KeybindingScope =
  | "global"
  | "tabs"
  | "terminal"
  | "browser"
  | "editor"
  | "fileExplorer"
  | "settings";

export type KeybindingPlatform = "darwin" | "linux" | "win32";

export interface PlatformBindings {
  readonly darwin: readonly string[];
  readonly linux: readonly string[];
  readonly win32: readonly string[];
}

/** One binding applies to every desktop platform. */
export function platformBindings(
  bindings: readonly string[],
): PlatformBindings {
  return { darwin: bindings, linux: bindings, win32: bindings };
}

export type KeybindingStatus =
  | { kind: "implemented" }
  | { kind: "menu"; note: string }
  | { kind: "disabled"; reason: string };

export interface KeybindingDefinition {
  readonly id: string;
  readonly title: string;
  readonly group: string;
  readonly scope: KeybindingScope;
  readonly defaultBindings: PlatformBindings;
  readonly allowInTerminal?: boolean;
  /** Digit-index rows store a representative chord; any of 1-9 fires it. */
  readonly digitIndex?: boolean;
  readonly status: KeybindingStatus;
}

function same(bindings: readonly string[]): PlatformBindings {
  return platformBindings(bindings);
}

const IMPLEMENTED: KeybindingStatus = { kind: "implemented" };

/**
 * MVP keybinding table in source definition order (core-1, then core-2/3/4).
 * Group first-appearance order matches the source catalog: Global, Tabs,
 * Tab Navigation, Settings, Terminal Panes.
 */
export const KEYBINDING_DEFINITIONS: readonly KeybindingDefinition[] = [
  {
    id: "worktree.quickOpen",
    title: "Go to File",
    group: "Global",
    scope: "global",
    defaultBindings: same(["Mod+P"]),
    status: IMPLEMENTED,
  },
  {
    id: "app.settings",
    title: "Open Settings",
    group: "Global",
    scope: "global",
    defaultBindings: same(["Mod+Comma"]),
    status: IMPLEMENTED,
  },
  {
    id: "app.forceReload",
    title: "Force Reload",
    group: "Global",
    scope: "global",
    defaultBindings: same(["Mod+Shift+R"]),
    status: {
      kind: "menu",
      note: "Native view-menu role owns this chord; no renderer handler.",
    },
  },
  {
    id: "worktree.palette",
    title: "Switch worktree",
    group: "Global",
    scope: "global",
    defaultBindings: {
      darwin: ["Mod+J"],
      linux: ["Mod+Shift+J"],
      win32: ["Mod+Shift+J"],
    },
    status: IMPLEMENTED,
  },
  {
    id: "worktree.navigateUp",
    title: "Previous worktree",
    group: "Global",
    scope: "global",
    defaultBindings: same(["Mod+Shift+ArrowUp"]),
    status: IMPLEMENTED,
  },
  {
    id: "worktree.navigateDown",
    title: "Next worktree",
    group: "Global",
    scope: "global",
    defaultBindings: same(["Mod+Shift+ArrowDown"]),
    status: IMPLEMENTED,
  },
  {
    id: "workspace.create",
    title: "Create worktree",
    group: "Global",
    scope: "global",
    defaultBindings: same(["Mod+N", "Mod+Shift+N"]),
    status: IMPLEMENTED,
  },
  {
    id: "workspace.selectByIndex",
    title: "Select Workspace 1–9",
    group: "Global",
    scope: "global",
    defaultBindings: same(["Mod+1"]),
    digitIndex: true,
    status: IMPLEMENTED,
  },
  {
    id: "sidebar.left.toggle",
    title: "Toggle Sidebar",
    group: "Global",
    scope: "global",
    defaultBindings: same(["Mod+B"]),
    status: IMPLEMENTED,
  },
  {
    id: "sidebar.right.toggle",
    title: "Toggle Right Sidebar",
    group: "Global",
    scope: "global",
    defaultBindings: same(["Mod+L"]),
    status: IMPLEMENTED,
  },
  {
    id: "sidebar.explorer.toggle",
    title: "Show Explorer",
    group: "Global",
    scope: "global",
    defaultBindings: same(["Mod+Shift+E"]),
    status: IMPLEMENTED,
  },
  {
    id: "sidebar.sourceControl.toggle",
    title: "Show Source Control",
    group: "Global",
    scope: "global",
    defaultBindings: same(["Mod+Shift+G"]),
    status: IMPLEMENTED,
  },
  {
    id: "zoom.in",
    title: "Zoom In",
    group: "Global",
    scope: "global",
    defaultBindings: same(["Mod+Equal", "Mod+Shift+Plus", "Mod+NumpadAdd"]),
    status: {
      kind: "menu",
      note: "Native view-menu role owns these chords; no renderer handler.",
    },
  },
  {
    id: "zoom.out",
    title: "Zoom Out",
    group: "Global",
    scope: "global",
    defaultBindings: same(["Mod+Minus", "Mod+NumpadSubtract"]),
    status: {
      kind: "menu",
      note: "Native view-menu role owns these chords; no renderer handler.",
    },
  },
  {
    id: "zoom.reset",
    title: "Reset Size",
    group: "Global",
    scope: "global",
    defaultBindings: same(["Mod+0"]),
    status: {
      kind: "menu",
      note: "Native view-menu role owns this chord; no renderer handler.",
    },
  },
  {
    id: "worktree.history.back",
    title: "Worktree History Back",
    group: "Global",
    scope: "global",
    defaultBindings: same(["Mod+Alt+ArrowLeft"]),
    allowInTerminal: true,
    status: IMPLEMENTED,
  },
  {
    id: "worktree.history.forward",
    title: "Worktree History Forward",
    group: "Global",
    scope: "global",
    defaultBindings: same(["Mod+Alt+ArrowRight"]),
    allowInTerminal: true,
    status: IMPLEMENTED,
  },
  {
    id: "tab.newTerminal",
    title: "New terminal tab",
    group: "Tabs",
    scope: "tabs",
    defaultBindings: same(["Mod+T"]),
    status: IMPLEMENTED,
  },
  {
    id: "tab.newBrowser",
    title: "New browser tab",
    group: "Tabs",
    scope: "tabs",
    defaultBindings: same(["Mod+Shift+B"]),
    status: IMPLEMENTED,
  },
  {
    // Fork definitions-core-2.ts `tab.newMarkdown` verbatim (title, group,
    // scope, Mod+Shift+M on every platform); wired to the create menu's
    // New Markdown row (#197).
    id: "tab.newMarkdown",
    title: "New markdown tab",
    group: "Tabs",
    scope: "tabs",
    defaultBindings: same(["Mod+Shift+M"]),
    status: IMPLEMENTED,
  },
  {
    id: "tab.close",
    title: "Close active tab",
    group: "Tabs",
    scope: "tabs",
    defaultBindings: same(["Mod+W"]),
    status: {
      kind: "disabled",
      reason:
        "The native window Close item owns CmdOrCtrl+W; needs main-process before-input-event interception first.",
    },
  },
  {
    id: "tab.reopenClosed",
    title: "Reopen closed tab",
    group: "Tabs",
    scope: "tabs",
    defaultBindings: same(["Mod+Shift+T"]),
    status: {
      kind: "disabled",
      reason:
        "Closed tabs are stopped and dismissed; Drogon keeps no closed-tab journal to reopen from.",
    },
  },
  {
    id: "tab.nextSameType",
    title: "Next tab (same type)",
    group: "Tab Navigation",
    scope: "tabs",
    defaultBindings: same(["Mod+Alt+BracketRight"]),
    status: IMPLEMENTED,
  },
  {
    id: "tab.previousSameType",
    title: "Previous tab (same type)",
    group: "Tab Navigation",
    scope: "tabs",
    defaultBindings: same(["Mod+Alt+BracketLeft"]),
    status: IMPLEMENTED,
  },
  {
    id: "tab.nextAllTypes",
    title: "Next tab (all types)",
    group: "Tab Navigation",
    scope: "tabs",
    defaultBindings: same(["Mod+Shift+BracketRight"]),
    status: IMPLEMENTED,
  },
  {
    id: "tab.previousAllTypes",
    title: "Previous tab (all types)",
    group: "Tab Navigation",
    scope: "tabs",
    defaultBindings: same(["Mod+Shift+BracketLeft"]),
    status: IMPLEMENTED,
  },
  {
    id: "tab.selectByIndex",
    title: "Select Tab 1–9",
    group: "Tab Navigation",
    scope: "tabs",
    defaultBindings: {
      darwin: ["Ctrl+1"],
      linux: ["Alt+1"],
      win32: ["Alt+1"],
    },
    digitIndex: true,
    status: IMPLEMENTED,
  },
  {
    id: "settings.search",
    title: "Search Settings",
    group: "Settings",
    scope: "settings",
    defaultBindings: same(["Mod+F"]),
    status: IMPLEMENTED,
  },
  {
    id: "terminal.clear",
    title: "Clear active pane",
    group: "Terminal Panes",
    scope: "terminal",
    defaultBindings: same(["Mod+K"]),
    status: IMPLEMENTED,
  },
  {
    id: "terminal.splitRight",
    title: "Split terminal right",
    group: "Terminal Panes",
    scope: "terminal",
    defaultBindings: {
      darwin: ["Mod+D"],
      linux: ["Mod+Shift+D"],
      win32: ["Mod+Shift+D"],
    },
    // R16-N enables the fork's chord now that the two-pane split model
    // exists (terminal-split.ts). Split Down stays disabled with #129.
    status: IMPLEMENTED,
  },
  {
    id: "terminal.splitDown",
    title: "Split terminal down",
    group: "Terminal Panes",
    scope: "terminal",
    defaultBindings: {
      darwin: ["Mod+Shift+D"],
      linux: ["Alt+Shift+D"],
      win32: ["Alt+Shift+D"],
    },
    status: {
      kind: "disabled",
      reason: "Single terminal pane; Drogon has no split model yet.",
    },
  },
];

export const DEFINITIONS_BY_ID = new Map<string, KeybindingDefinition>(
  KEYBINDING_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export function getKeybindingDefinition(id: string): KeybindingDefinition | null {
  return DEFINITIONS_BY_ID.get(id) ?? null;
}

/** Source group order: first appearance across the definition table. */
export function keybindingGroupOrder(): string[] {
  const order: string[] = [];
  for (const definition of KEYBINDING_DEFINITIONS) {
    if (!order.includes(definition.group)) order.push(definition.group);
  }
  return order;
}

export function bindingsForPlatform(
  definition: KeybindingDefinition,
  platform: KeybindingPlatform,
): readonly string[] {
  return definition.defaultBindings[platform];
}

/**
 * Drogon UI code distinguishes only darwin vs other. This MVP subset has no
 * linux/win32 divergence (covered by a test), so other maps to linux.
 */
export function resolveKeybindingPlatform(
  uiPlatform: "darwin" | "other",
): KeybindingPlatform {
  return uiPlatform === "darwin" ? "darwin" : "linux";
}

/** NodeJS.Platform → the table's platform key (source getKeybindingPlatform). */
export function getKeybindingPlatform(
  platform: typeof process.platform,
): KeybindingPlatform {
  if (platform === "darwin") return "darwin";
  if (platform === "win32") return "win32";
  return "linux";
}

export function isDigitIndexDefinition(
  definition: KeybindingDefinition,
): boolean {
  return definition.digitIndex === true;
}
