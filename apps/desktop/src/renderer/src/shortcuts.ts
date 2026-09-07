/**
 * Keyboard shortcut registry core.
 *
 * This is the platform-aware primitive that the full 88-action static
 * catalog (docs/migration/parity-settings-keybindings.{md,json}) will be
 * migrated onto incrementally. Extension point: each catalog row
 * (id/title/group/scope/darwin-linux-win32 chords/flags/conflictGroup)
 * becomes one `register()` call driven by a table built from that JSON,
 * rather than hand-written per-binding effects in App.tsx. Fields not yet
 * consumed here (title/group/scope/allowInTerminal/allowBareKeybindings/
 * allowShiftOnlyKeybindings/conflictGroup) are deliberately out of scope
 * for this pass; only id/chord/handler are modeled.
 */

export type PlatformId = string;

export interface ShortcutEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export interface ShortcutAction {
  id: string;
  chord: string;
  handler: () => void;
}

export interface ParsedChord {
  cmdOrCtrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

/** darwin uses Cmd (metaKey); every other platform uses Ctrl (ctrlKey). */
export function resolveModifier(platform: PlatformId): "meta" | "ctrl" {
  return platform === "darwin" ? "meta" : "ctrl";
}

const MODIFIER_TOKENS = new Set(["cmdorctrl", "shift", "alt"]);

export function parseChord(chord: string): ParsedChord {
  const parts = chord.split("+").map((part) => part.trim());
  const parsed: ParsedChord = {
    cmdOrCtrl: false,
    shift: false,
    alt: false,
    key: "",
  };
  for (const part of parts) {
    const token = part.toLowerCase();
    if (token === "cmdorctrl") {
      parsed.cmdOrCtrl = true;
    } else if (token === "shift") {
      parsed.shift = true;
    } else if (token === "alt") {
      parsed.alt = true;
    } else if (!MODIFIER_TOKENS.has(token)) {
      parsed.key = token;
    }
  }
  return parsed;
}

/**
 * A chord's unspecified modifiers are unconstrained (not required-false),
 * matching the legacy inline handler that checked mod+shift+key but never
 * inspected altKey.
 */
export function matchesChord(
  parsed: ParsedChord,
  event: ShortcutEventLike,
  platform: PlatformId,
): boolean {
  if (event.key.toLowerCase() !== parsed.key) return false;
  if (parsed.cmdOrCtrl) {
    const modifier = resolveModifier(platform);
    const pressed = modifier === "meta" ? event.metaKey : event.ctrlKey;
    if (!pressed) return false;
  }
  if (parsed.shift && !event.shiftKey) return false;
  if (parsed.alt && !event.altKey) return false;
  return true;
}

export interface ShortcutRegistry {
  /** Returns false without registering when `id` is already taken. */
  register(action: ShortcutAction): boolean;
  unregister(id: string): void;
  /** Returns the first registered action whose chord matches, or null. */
  matchKeyEvent(
    event: ShortcutEventLike,
    platform: PlatformId,
  ): ShortcutAction | null;
}

export function createShortcutRegistry(): ShortcutRegistry {
  const actions = new Map<string, ShortcutAction & { parsed: ParsedChord }>();

  return {
    register(action) {
      if (actions.has(action.id)) return false;
      actions.set(action.id, { ...action, parsed: parseChord(action.chord) });
      return true;
    },
    unregister(id) {
      actions.delete(id);
    },
    matchKeyEvent(event, platform) {
      for (const action of actions.values()) {
        if (matchesChord(action.parsed, event, platform)) {
          return { id: action.id, chord: action.chord, handler: action.handler };
        }
      }
      return null;
    },
  };
}

/**
 * Palette/tab shortcut vocabulary. Ids follow the Orca source registry
 * (src/shared/keybindings/definitions-core-1.ts: `worktree.palette` on
 * Mod+J, `worktree.quickOpen` on Mod+P; `terminal.clear` on Mod+K is
 * terminal-scoped and registered by App, never here). Handlers attach at
 * mount (the palette host owns them) via `register()` — registration here
 * is only the id+chord table, never the behavior.
 */
export interface PaletteShortcutDef {
  id: string;
  chord: string;
}

function tabSelectDef(index: number): PaletteShortcutDef {
  return { id: `tabs.select${index}`, chord: `CmdOrCtrl+${index}` };
}

export const PALETTE_SHORTCUTS: readonly PaletteShortcutDef[] = [
  { id: "worktree.palette", chord: "CmdOrCtrl+J" },
  { id: "worktree.quickOpen", chord: "CmdOrCtrl+P" },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(tabSelectDef),
  { id: "tabs.prev", chord: "CmdOrCtrl+Shift+[" },
  { id: "tabs.next", chord: "CmdOrCtrl+Shift+]" },
];

/** Wraps a handler so it is skipped while `isDisabled()` is true (e.g. busy/loading guards). */
export function guardHandler(
  handler: () => void,
  isDisabled: () => boolean,
): () => void {
  return () => {
    if (isDisabled()) return;
    handler();
  };
}
