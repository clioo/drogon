// MIT Copyright (c) 2026 Lovecast Inc.
// Per-action keybinding overrides (journey J10): the renderer Shortcuts
// section lets the user rebind chords, and the registry dispatches the
// effective (default-overridden) table.
//
// Ported from the Orca reference (read-only):
//   src/shared/keybindings/types.ts (KeybindingOverrides)
//   src/shared/keybindings/effective.ts (override branch of
//     getEffectiveKeybindingsForAction, digit-index canonicalization to the
//     …+1 representative)
//   src/shared/keybindings/input.ts (keybindingFromInput core: modifier-only
//     input is not a chord, the platform primary modifier canonicalizes to
//     Mod; the layout-independent `code` path and modifier double-tap are
//     omitted — this repo has no code→token table and no double-tap
//     detector, and capture reuses event.key exactly like the dispatcher's
//     match path, so a captured chord always fires)
//   src/shared/keybindings/formatting.ts (conflict reporting limited to
//     customized actions: the default table is conflict-free by
//     construction, so only overrides can introduce a conflict)
// Adapted: overrides persist in a dedicated renderer localStorage envelope
// (the fork keeps a keybindings file in main; this repo's settings persist
// in the renderer, so a sibling envelope is the honest data layer), keyed
// per action id string. Reads are cached by raw envelope text so the
// per-keydown match path stays cheap.
import {
  DEFINITIONS_BY_ID,
  bindingsForPlatform,
  isDigitIndexDefinition,
  type KeybindingDefinition,
  type KeybindingPlatform,
} from "./definitions";
import {
  isSafeBareKey,
  normalizeChord,
  normalizeKeyToken,
  parseKeybinding,
  canonicalizeParsedKeybinding,
} from "./parser";

/** Stored per-action chords; absent key = the table default. */
export type KeybindingOverrides = Record<string, string[]>;

export const KEYBINDING_OVERRIDES_STORAGE_KEY = "drogon:keybinding-overrides";

const ENVELOPE_VERSION = 1;

/** Minimal storage surface so tests can inject a fake (mirrors SettingsStore). */
export type KeybindingOverrideStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

function defaultStorage(): KeybindingOverrideStorage | null {
  try {
    if (typeof globalThis.localStorage === "undefined") return null;
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/** True when the stored representative may fire for any digit 1-9. */
function canonicalizeDigitBinding(binding: string): string | null {
  const parsed = parseKeybinding(binding);
  if (!parsed || parsed.doubleTapModifier) return null;
  if (/^[1-9]$/.test(parsed.key)) {
    return canonicalizeParsedKeybinding({ ...parsed, key: "1" });
  }
  return canonicalizeParsedKeybinding(parsed);
}

/**
 * Normalizes one raw override list: every entry must be a well-formed
 * chord (digit-index rows canonicalize to the …+1 representative),
 * duplicates collapse. Non-array input is rejected (the key is dropped).
 */
export function normalizeOverrideList(
  definition: KeybindingDefinition,
  value: unknown,
): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  const digit = isDigitIndexDefinition(definition);
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const normalized = digit
      ? canonicalizeDigitBinding(entry)
      : normalizeChord(entry);
    if (normalized && !out.includes(normalized)) out.push(normalized);
  }
  return out;
}

/**
 * Parses the persisted envelope { version: 1, overrides: {...} }.
 * Malformed envelopes yield no overrides; unknown action ids and invalid
 * lists are dropped individually (same philosophy as parsePersistedSettings).
 */
export function parseOverridesEnvelope(
  raw: string | null | undefined,
): KeybindingOverrides {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return {};
    const overrides = (parsed as { overrides?: unknown }).overrides;
    if (typeof overrides !== "object" || overrides === null || Array.isArray(overrides))
      return {};
    const out: KeybindingOverrides = {};
    for (const [actionId, value] of Object.entries(
      overrides as Record<string, unknown>,
    )) {
      const definition = DEFINITIONS_BY_ID.get(actionId);
      if (!definition) continue;
      const normalized = normalizeOverrideList(definition, value);
      if (normalized) out[actionId] = normalized;
    }
    return out;
  } catch {
    return {};
  }
}

let cachedRaw: string | null | undefined;
let cachedParsed: KeybindingOverrides = {};

/** Reads the persisted overrides ({} when storage is unavailable). */
export function readPersistedKeybindingOverrides(
  storage?: KeybindingOverrideStorage | null,
): KeybindingOverrides {
  if (storage !== undefined) {
    if (!storage) return {};
    return parseOverridesEnvelope(storage.getItem(KEYBINDING_OVERRIDES_STORAGE_KEY));
  }
  const backing = defaultStorage();
  if (!backing) return {};
  let raw: string | null = null;
  try {
    raw = backing.getItem(KEYBINDING_OVERRIDES_STORAGE_KEY);
  } catch {
    return {};
  }
  if (raw === cachedRaw) return cachedParsed;
  cachedRaw = raw;
  cachedParsed = parseOverridesEnvelope(raw);
  return cachedParsed;
}

/**
 * Writes the overrides envelope. Returns false when storage throws
 * (quota); the caller surfaces the fork's "Failed to save shortcut." copy.
 */
export function writePersistedKeybindingOverrides(
  overrides: KeybindingOverrides,
  storage?: KeybindingOverrideStorage | null,
): boolean {
  const backing = storage !== undefined ? storage : defaultStorage();
  if (!backing) return true;
  try {
    backing.setItem(
      KEYBINDING_OVERRIDES_STORAGE_KEY,
      JSON.stringify({ version: ENVELOPE_VERSION, overrides }),
    );
    if (storage === undefined) {
      cachedRaw = backing.getItem(KEYBINDING_OVERRIDES_STORAGE_KEY);
      cachedParsed = overrides;
    }
    return true;
  } catch {
    return false;
  }
}

/** Effective chords for one definition: the override wins when present. */
export function getEffectiveBindings(
  definition: KeybindingDefinition,
  platform: KeybindingPlatform,
  overrides?: KeybindingOverrides | null,
): string[] {
  const override = overrides?.[definition.id];
  if (Array.isArray(override)) return [...override];
  return [...bindingsForPlatform(definition, platform)];
}

const MODIFIER_ONLY_KEYS = new Set([
  "Control",
  "Shift",
  "Alt",
  "Meta",
  "AltGraph",
  "CapsLock",
  "NumLock",
  "ScrollLock",
  "Symbol",
  "SymbolLock",
  "Fn",
  "FnLock",
  "Hyper",
  "Super",
  "OS",
]);

export type KeybindingCaptureResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

/** Lone modifier presses never complete a chord; the recorder waits silently. */
export function isModifierOnlyKey(key: string): boolean {
  return MODIFIER_ONLY_KEYS.has(key);
}

/**
 * Converts a captured keydown into the canonical stored chord ("Mod+Shift+B").
 * Modifier-only presses are not chords (fork copy); chords without any
 * modifier must be safe bare keys or they would fire while typing.
 */
export function keybindingFromKeyEvent(
  input: {
    key: string;
    altKey?: boolean;
    metaKey?: boolean;
    ctrlKey?: boolean;
    shiftKey?: boolean;
  },
  platform: KeybindingPlatform,
): KeybindingCaptureResult {
  if (MODIFIER_ONLY_KEYS.has(input.key)) {
    return { ok: false, error: "Press a key, not only a modifier." };
  }
  const key = normalizeKeyToken(input.key);
  if (!key) return { ok: false, error: "Unable to parse shortcut." };
  const isMac = platform === "darwin";
  const parts: string[] = [];
  if (isMac ? input.metaKey : input.ctrlKey) parts.push("Mod");
  if (isMac && input.ctrlKey) parts.push("Ctrl");
  if (!isMac && input.metaKey) parts.push("Cmd");
  if (input.altKey) parts.push("Alt");
  if (input.shiftKey) parts.push("Shift");
  parts.push(key);
  const chord = normalizeChord(parts.join("+"));
  if (!chord) return { ok: false, error: "Unable to parse shortcut." };
  const parsed = parseKeybinding(chord);
  if (
    parsed &&
    !parsed.mod &&
    !parsed.meta &&
    !parsed.control &&
    !parsed.alt &&
    !isSafeBareKey(parsed)
  ) {
    return {
      ok: false,
      error: "Add a modifier: bare keys would fire while typing.",
    };
  }
  return { ok: true, value: chord };
}
