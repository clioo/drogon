// MIT Copyright (c) 2026 Lovecast Inc. Adapted from
// src/renderer/src/components/terminal-pane/terminal-option-shortcut-policy.ts.
// Drogon's xterm host has no kitty keyboard protocol yet, so this focused
// policy covers the ordinary ASCII Option-as-Alt path and leaves IME/dead-key
// input to the browser and xterm.

export type TerminalMacOptionAsAlt = "true" | "false" | "left" | "right";
export type TerminalOptionKeyLocation = 0 | 1 | 2 | 3;

export type TerminalOptionKeyEvent = {
  type: string;
  key: string;
  code?: string;
  location?: number;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
  keyCode?: number;
};

export function updateTerminalOptionKeyLocation(
  location: TerminalOptionKeyLocation,
  event: Pick<TerminalOptionKeyEvent, "type" | "key" | "location">,
): TerminalOptionKeyLocation {
  if (event.key !== "Alt") return location;
  const side = event.location === 1 ? 1 : event.location === 2 ? 2 : null;
  if (side === null) return 0;
  if (event.type === "keydown") {
    return (location | side) as TerminalOptionKeyLocation;
  }
  if (event.type === "keyup") {
    return (location & ~side) as TerminalOptionKeyLocation;
  }
  return location;
}

function baseCharacterForCode(code: string | undefined): string | undefined {
  if (!code) return undefined;
  if (/^Key[A-Z]$/.test(code)) return code.slice(-1).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(-1);
  return {
    Backquote: "`",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
  }[code];
}

function isConfiguredOptionSide(
  mode: TerminalMacOptionAsAlt,
  location: TerminalOptionKeyLocation,
): boolean {
  if (mode === "true") return true;
  if (mode === "left") return (location & 1) !== 0;
  if (mode === "right") return (location & 2) !== 0;
  return false;
}

/** Returns the manual escape sequence for a configured Option side, if any. */
export function resolveTerminalMacOptionKeyAction(
  event: TerminalOptionKeyEvent,
  mode: TerminalMacOptionAsAlt,
  location: TerminalOptionKeyLocation,
): { type: "sendInput"; data: string } | null {
  if (
    mode === "true" ||
    mode === "false" ||
    !event.altKey ||
    event.metaKey ||
    event.ctrlKey ||
    event.isComposing ||
    event.key === "Dead" ||
    event.type !== "keydown"
  ) {
    return null;
  }
  const configuredSide = isConfiguredOptionSide(mode, location);
  if (!configuredSide) {
    // Preserve the source's readline navigation fallback on the composing
    // side of a one-sided Option configuration.
    const composingSide =
      (mode === "left" && (location & 2) !== 0) ||
      (mode === "right" && (location & 1) !== 0);
    if (!composingSide || event.shiftKey) return null;
    const navigationCharacter =
      event.code === "KeyB"
        ? "b"
        : event.code === "KeyF"
          ? "f"
          : event.code === "KeyD"
            ? "d"
            : null;
    return navigationCharacter
      ? { type: "sendInput", data: `\x1b${navigationCharacter}` }
      : null;
  }
  const base = baseCharacterForCode(event.code);
  if (!base) return null;
  return {
    type: "sendInput",
    data: `\x1b${event.shiftKey ? base.toUpperCase() : base}`,
  };
}
