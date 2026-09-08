// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/shared/keybindings/parser.ts
// Adapted: the modifier alias `CmdOrCtrl` (this repo's legacy chord spelling)
// parses to `Mod`; double-tap bindings parse but never match (Drogon has no
// modifier double-tap detector). Otherwise verbatim: token tables,
// canonicalization order (Mod, Cmd, Ctrl, Alt, Shift, key), safe-bare rules.

export type ModifierToken = "Mod" | "Cmd" | "Ctrl" | "Alt" | "Shift";

export interface ParsedKeybinding {
  mod: boolean;
  meta: boolean;
  control: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
  doubleTapModifier?: ModifierToken;
}

export interface KeybindingInput {
  key?: string;
  code?: string;
  altKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  doubleTapModifier?: ModifierToken;
}

const SIMPLE_KEY_TOKENS = new Map<string, string>(
  Object.entries({
    "[": "BracketLeft",
    "]": "BracketRight",
    "{": "BracketLeft",
    "}": "BracketRight",
    "-": "Minus",
    _: "Underscore",
    "=": "Equal",
    "+": "Plus",
    ",": "Comma",
    ".": "Period",
    "/": "Slash",
    "\\": "Backslash",
    ";": "Semicolon",
    "'": "Quote",
    "`": "Backquote",
    RETURN: "Enter",
    ESC: "Escape",
    SPACEBAR: "Space",
    PGUP: "PageUp",
    PGDN: "PageDown",
    PLUS: "Plus",
    MINUS: "Minus",
    EQUAL: "Equal",
    UNDERSCORE: "Underscore",
    ARROWLEFT: "ArrowLeft",
    LEFT: "ArrowLeft",
    ARROWRIGHT: "ArrowRight",
    RIGHT: "ArrowRight",
    ARROWUP: "ArrowUp",
    UP: "ArrowUp",
    ARROWDOWN: "ArrowDown",
    DOWN: "ArrowDown",
    PAGEUP: "PageUp",
    PAGEDOWN: "PageDown",
    BACKSPACE: "Backspace",
    DELETE: "Delete",
    DEL: "Delete",
    INSERT: "Insert",
    INS: "Insert",
    ENTER: "Enter",
    TAB: "Tab",
    ESCAPE: "Escape",
    SPACE: "Space",
    BRACKETLEFT: "BracketLeft",
    BRACKETRIGHT: "BracketRight",
    NUMPADADD: "NumpadAdd",
    NUMPADSUBTRACT: "NumpadSubtract",
    ADD: "NumpadAdd",
    SUBTRACT: "NumpadSubtract",
    COMMA: "Comma",
    PERIOD: "Period",
    SLASH: "Slash",
    BACKSLASH: "Backslash",
    SEMICOLON: "Semicolon",
    QUOTE: "Quote",
    BACKQUOTE: "Backquote",
  }),
);

function isFunctionKeyToken(key: string): boolean {
  return /^F([1-9]|1[0-9]|2[0-4])$/.test(key);
}

export function normalizeKeyToken(token: string): string | null {
  if (token === " ") return "Space";
  const trimmed = token.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (upper.length === 1 && upper >= "A" && upper <= "Z") return upper;
  if (upper.length === 1 && upper >= "0" && upper <= "9") return upper;
  if (isFunctionKeyToken(upper)) return upper;
  return SIMPLE_KEY_TOKENS.get(upper) ?? null;
}

export function parseModifierToken(rawPart: string): ModifierToken | null {
  const part = rawPart.toLowerCase();
  if (
    part === "mod" ||
    part === "cmdorctrl" ||
    part === "commandorcontrol"
  ) {
    return "Mod";
  }
  if (
    part === "cmd" ||
    part === "command" ||
    part === "meta" ||
    rawPart === "⌘"
  ) {
    return "Cmd";
  }
  if (
    part === "ctrl" ||
    part === "control" ||
    rawPart === "⌃"
  ) {
    return "Ctrl";
  }
  if (
    part === "alt" ||
    part === "option" ||
    part === "opt" ||
    rawPart === "⌥"
  ) {
    return "Alt";
  }
  if (part === "shift" || rawPart === "⇧") return "Shift";
  return null;
}

export function emptyParsedKeybinding(): ParsedKeybinding {
  return {
    mod: false,
    meta: false,
    control: false,
    alt: false,
    shift: false,
    key: "",
  };
}

function parseDoubleTapKeybinding(
  rawParts: string[],
): ParsedKeybinding | null {
  const modifiers: ModifierToken[] = [];
  let sawDoubleTap = false;
  for (const rawPart of rawParts) {
    if (rawPart.toLowerCase() === "doubletap") {
      if (sawDoubleTap) return null;
      sawDoubleTap = true;
      continue;
    }
    const modifier = parseModifierToken(rawPart);
    if (!modifier) return null;
    modifiers.push(modifier);
  }
  if (modifiers.length === 0) return null;
  const parsed = emptyParsedKeybinding();
  for (const modifier of modifiers) applyModifierToken(parsed, modifier);
  if (parsed.mod && (parsed.meta || parsed.control)) {
    parsed.doubleTapModifier = "Mod";
    return parsed;
  }
  if (modifiers.length > 1) return null;
  parsed.doubleTapModifier = modifiers[0];
  return parsed;
}

export function applyModifierToken(
  parsed: ParsedKeybinding,
  modifier: ModifierToken,
): void {
  if (modifier === "Mod") parsed.mod = true;
  else if (modifier === "Cmd") parsed.meta = true;
  else if (modifier === "Ctrl") parsed.control = true;
  else if (modifier === "Alt") parsed.alt = true;
  else parsed.shift = true;
}

export function parseKeybinding(binding: string): ParsedKeybinding | null {
  const rawParts = binding
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (rawParts.length === 0) return null;
  if (rawParts.some((part) => part.toLowerCase() === "doubletap")) {
    return parseDoubleTapKeybinding(rawParts);
  }
  const parsed = emptyParsedKeybinding();
  for (const rawPart of rawParts) {
    const modifier = parseModifierToken(rawPart);
    if (modifier) {
      applyModifierToken(parsed, modifier);
      continue;
    }
    if (parsed.key) return null;
    const key = normalizeKeyToken(rawPart);
    if (!key) return null;
    parsed.key = key;
  }
  return parsed.key ? parsed : null;
}

export function canonicalizeParsedKeybinding(
  parsed: ParsedKeybinding,
): string {
  if (parsed.doubleTapModifier) {
    return `DoubleTap+${parsed.doubleTapModifier}`;
  }
  const parts: string[] = [];
  if (parsed.mod) parts.push("Mod");
  if (parsed.meta) parts.push("Cmd");
  if (parsed.control) parts.push("Ctrl");
  if (parsed.alt) parts.push("Alt");
  if (parsed.shift) parts.push("Shift");
  parts.push(parsed.key);
  return parts.join("+");
}

/** Canonical storage form, or null when the chord is not well-formed. */
export function normalizeChord(binding: string): string | null {
  const parsed = parseKeybinding(binding);
  if (!parsed) return null;
  if (parsed.mod && (parsed.meta || parsed.control)) return null;
  return canonicalizeParsedKeybinding(parsed);
}

export function isSafeBareKey(parsed: ParsedKeybinding): boolean {
  if (parsed.mod || parsed.meta || parsed.control || parsed.alt) return false;
  if (parsed.shift) return isFunctionKeyToken(parsed.key);
  return (
    isFunctionKeyToken(parsed.key) ||
    [
      "Backspace",
      "Delete",
      "Enter",
      "Escape",
      "Tab",
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "PageUp",
      "PageDown",
    ].includes(parsed.key)
  );
}
