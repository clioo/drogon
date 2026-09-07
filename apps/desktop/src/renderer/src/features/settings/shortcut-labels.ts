// Read-only shortcut reference for the Shortcuts section: titles for the
// palette registry plus the window-level actions App registers, rendered
// with platform-correct labels (⌘ on macOS, Ctrl elsewhere).
import { PALETTE_SHORTCUTS } from "../../shortcuts";

export type ShortcutGroup = "Settings" | "Terminals" | "Commands" | "Tabs";

export type ShortcutListEntry = {
  id: string;
  title: string;
  chord: string;
  group: ShortcutGroup;
};

function paletteTitle(id: string): { title: string; group: ShortcutGroup } {
  if (id === "palette.openCommands")
    return { title: "Open command palette", group: "Commands" };
  if (id === "palette.openQuickOpen")
    return { title: "Quick open workspace or session", group: "Commands" };
  const tabSelect = /^tabs\.select([1-9])$/.exec(id);
  if (tabSelect)
    return { title: `Select tab ${tabSelect[1]}`, group: "Tabs" };
  if (id === "tabs.prev") return { title: "Previous tab", group: "Tabs" };
  if (id === "tabs.next") return { title: "Next tab", group: "Tabs" };
  return { title: id, group: "Commands" };
}

const WINDOW_SHORTCUTS: ShortcutListEntry[] = [
  {
    id: "settings.open",
    title: "Open Settings",
    chord: "CmdOrCtrl+,",
    group: "Settings",
  },
  {
    id: "workspace.newTerminal",
    title: "New terminal",
    chord: "CmdOrCtrl+Shift+N",
    group: "Terminals",
  },
];

/** Every shortcut the Shortcuts section lists, window actions first. */
export function buildShortcutList(): ShortcutListEntry[] {
  return [
    ...WINDOW_SHORTCUTS,
    ...PALETTE_SHORTCUTS.map((def) => ({
      id: def.id,
      chord: def.chord,
      ...paletteTitle(def.id),
    })),
  ];
}

export type ShortcutPlatform = "darwin" | "other";

export function resolveShortcutPlatform(userAgent: string): ShortcutPlatform {
  return userAgent.includes("Mac") ? "darwin" : "other";
}

/**
 * Splits a registry chord ("CmdOrCtrl+Shift+N") into display labels:
 * symbols on macOS (⌘⇧⌥, no separator), words elsewhere (Ctrl+Shift+N).
 */
export function formatChordForPlatform(
  chord: string,
  platform: ShortcutPlatform,
): string[] {
  const parts = chord.split("+").map((part) => part.trim());
  const labels: string[] = [];
  for (const part of parts) {
    const token = part.toLowerCase();
    if (token === "cmdorctrl") labels.push(platform === "darwin" ? "⌘" : "Ctrl");
    else if (token === "shift") labels.push(platform === "darwin" ? "⇧" : "Shift");
    else if (token === "alt") labels.push(platform === "darwin" ? "⌥" : "Alt");
    else if (part !== "") labels.push(displayKey(part));
  }
  return labels;
}

/** Single-char keys render uppercased; named keys keep a capitalised form. */
export function displayKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed === "") return key;
  if (trimmed.length === 1) return trimmed.toUpperCase();
  return trimmed[0].toUpperCase() + trimmed.slice(1).toLowerCase();
}

/** Case-insensitive substring match over title, id and raw chord. */
export function filterShortcuts(
  entries: ShortcutListEntry[],
  query: string,
): ShortcutListEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return entries;
  return entries.filter(
    (entry) =>
      entry.title.toLowerCase().includes(needle) ||
      entry.id.toLowerCase().includes(needle) ||
      entry.chord.toLowerCase().includes(needle),
  );
}
