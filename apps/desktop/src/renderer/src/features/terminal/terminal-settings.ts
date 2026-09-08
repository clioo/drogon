// MIT Copyright (c) 2026 Lovecast Inc.
// Terminal settings bridge for the fork-parity Interaction and Advanced
// controls. The persisted envelope stays owned by the renderer settings store;
// this module adds the live event and xterm option projection needed by
// already-mounted TerminalPane instances.

import { useCallback, useEffect, useState } from "react";
import {
  parsePersistedSettings,
  parseUnknownSettingsKeys,
  SETTINGS_DEFAULTS,
  settingsStorageKey,
  type SettingsSubset,
  type StorageLike,
} from "../../settings-store";
import {
  DESKTOP_TERMINAL_SCROLLBACK_ROWS_DEFAULT,
  normalizeDesktopTerminalScrollbackRows,
} from "./terminal-scrollback-policy";

export type TerminalSettings = Pick<
  SettingsSubset,
  | "terminalScrollSensitivity"
  | "terminalFastScrollSensitivity"
  | "terminalTuiScrollSensitivity"
  | "terminalRightClickToPaste"
  | "terminalFocusFollowsMouse"
  | "terminalClipboardOnSelect"
  | "terminalAllowOsc52Clipboard"
  | "terminalScrollbackRows"
  | "terminalWordSeparator"
  | "terminalMacOptionAsAlt"
  | "terminalJISYenToBackslash"
>;

export const TERMINAL_SETTINGS_CHANGED_EVENT =
  "drogon:terminal-settings-changed";

export const DEFAULT_TERMINAL_SCROLL_SENSITIVITY = 1.15;
export const DEFAULT_TERMINAL_FAST_SCROLL_SENSITIVITY = 5;
export const DEFAULT_TERMINAL_TUI_SCROLL_SENSITIVITY = 1;

export function normalizeTerminalScrollSensitivity(value: number): number {
  return Number.isFinite(value)
    ? Math.min(10, Math.max(0.1, value))
    : DEFAULT_TERMINAL_SCROLL_SENSITIVITY;
}

export function normalizeTerminalFastScrollSensitivity(value: number): number {
  return Number.isFinite(value)
    ? Math.min(20, Math.max(1, value))
    : DEFAULT_TERMINAL_FAST_SCROLL_SENSITIVITY;
}

export function normalizeTerminalTuiScrollSensitivity(value: number): number {
  return Number.isFinite(value)
    ? Math.round(Math.min(10, Math.max(1, value)))
    : DEFAULT_TERMINAL_TUI_SCROLL_SENSITIVITY;
}

export type TerminalSettingsChangedDetail = {
  settings: TerminalSettings;
};

export function terminalSettingsDefaults(): TerminalSettings {
  return {
    terminalScrollSensitivity: SETTINGS_DEFAULTS.terminalScrollSensitivity,
    terminalFastScrollSensitivity:
      SETTINGS_DEFAULTS.terminalFastScrollSensitivity,
    terminalTuiScrollSensitivity:
      SETTINGS_DEFAULTS.terminalTuiScrollSensitivity,
    terminalRightClickToPaste: SETTINGS_DEFAULTS.terminalRightClickToPaste,
    terminalFocusFollowsMouse: SETTINGS_DEFAULTS.terminalFocusFollowsMouse,
    terminalClipboardOnSelect: SETTINGS_DEFAULTS.terminalClipboardOnSelect,
    terminalAllowOsc52Clipboard: SETTINGS_DEFAULTS.terminalAllowOsc52Clipboard,
    terminalScrollbackRows: SETTINGS_DEFAULTS.terminalScrollbackRows,
    terminalWordSeparator: SETTINGS_DEFAULTS.terminalWordSeparator,
    terminalMacOptionAsAlt: SETTINGS_DEFAULTS.terminalMacOptionAsAlt,
    terminalJISYenToBackslash: SETTINGS_DEFAULTS.terminalJISYenToBackslash,
  };
}

function pickTerminalSettings(
  source: Partial<SettingsSubset> | null | undefined,
): TerminalSettings {
  const defaults = terminalSettingsDefaults();
  return {
    terminalScrollSensitivity:
      source?.terminalScrollSensitivity ?? defaults.terminalScrollSensitivity,
    terminalFastScrollSensitivity:
      source?.terminalFastScrollSensitivity ??
      defaults.terminalFastScrollSensitivity,
    terminalTuiScrollSensitivity:
      source?.terminalTuiScrollSensitivity ??
      defaults.terminalTuiScrollSensitivity,
    terminalRightClickToPaste:
      source?.terminalRightClickToPaste ?? defaults.terminalRightClickToPaste,
    terminalFocusFollowsMouse:
      source?.terminalFocusFollowsMouse ?? defaults.terminalFocusFollowsMouse,
    terminalClipboardOnSelect:
      source?.terminalClipboardOnSelect ?? defaults.terminalClipboardOnSelect,
    terminalAllowOsc52Clipboard:
      source?.terminalAllowOsc52Clipboard ??
      defaults.terminalAllowOsc52Clipboard,
    terminalScrollbackRows:
      source?.terminalScrollbackRows ??
      DESKTOP_TERMINAL_SCROLLBACK_ROWS_DEFAULT,
    terminalWordSeparator:
      source?.terminalWordSeparator ?? defaults.terminalWordSeparator,
    terminalMacOptionAsAlt:
      source?.terminalMacOptionAsAlt ?? defaults.terminalMacOptionAsAlt,
    terminalJISYenToBackslash:
      source?.terminalJISYenToBackslash ?? defaults.terminalJISYenToBackslash,
  };
}

/** Reads terminal settings without ever making storage failures fatal. */
export function readTerminalSettings(
  storage?: Pick<StorageLike, "getItem">,
): TerminalSettings {
  const fallback = terminalSettingsDefaults();
  try {
    const source =
      storage ??
      (typeof window !== "undefined" ? window.localStorage : undefined);
    if (!source) return fallback;
    return pickTerminalSettings(
      parsePersistedSettings(source.getItem(settingsStorageKey("ui"))),
    );
  } catch {
    return fallback;
  }
}

function emitTerminalSettingsChanged(settings: TerminalSettings): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<TerminalSettingsChangedDetail>(
      TERMINAL_SETTINGS_CHANGED_EVENT,
      { detail: { settings } },
    ),
  );
}

/**
 * Writes only the terminal subset while carrying unrelated known and unknown
 * settings forward. A synchronous event keeps existing panes live even though
 * App's legacy settings mirror does not own these newly ported keys.
 */
export function writeTerminalSettings(
  storage: StorageLike,
  updates: Partial<TerminalSettings>,
  fallback?: Partial<TerminalSettings>,
): TerminalSettings {
  let next: TerminalSettings;
  try {
    const key = settingsStorageKey("ui");
    const raw = storage.getItem(key);
    const candidate = {
      ...parseUnknownSettingsKeys(raw),
      ...parsePersistedSettings(raw),
      ...updates,
    };
    // Reuse the settings-store validators and normalizers, rather than
    // allowing a malformed direct caller to put an option outside xterm's
    // supported bounds into the envelope.
    const normalized = parsePersistedSettings(
      JSON.stringify({ settings: candidate }),
    );
    const settings = {
      ...parseUnknownSettingsKeys(raw),
      ...normalized,
    };
    storage.setItem(key, JSON.stringify({ settings }));
    next = pickTerminalSettings(normalized);
  } catch {
    // Storage is best-effort. Keep the caller's current view when a storage
    // object exists but throws during the read-modify-write.
    next = pickTerminalSettings({ ...fallback, ...updates });
  }
  emitTerminalSettingsChanged(next);
  return next;
}

export function useTerminalSettings(): {
  settings: TerminalSettings;
  updateSettings: (updates: Partial<TerminalSettings>) => void;
} {
  const [settings, setSettings] = useState<TerminalSettings>(() =>
    readTerminalSettings(),
  );

  useEffect(() => {
    const onSettingsChanged = (event: Event) => {
      const detail = (event as CustomEvent<TerminalSettingsChangedDetail>)
        .detail;
      setSettings(detail?.settings ?? readTerminalSettings());
    };
    window.addEventListener(TERMINAL_SETTINGS_CHANGED_EVENT, onSettingsChanged);
    return () =>
      window.removeEventListener(
        TERMINAL_SETTINGS_CHANGED_EVENT,
        onSettingsChanged,
      );
  }, []);

  const updateSettings = useCallback(
    (updates: Partial<TerminalSettings>) => {
      if (typeof window === "undefined") return;
      let storage: StorageLike | null = null;
      try {
        storage = window.localStorage;
      } catch {
        // Private browsing/storage-denied windows still get the in-memory event.
      }
      const next = storage
        ? writeTerminalSettings(storage, updates, settings)
        : pickTerminalSettings({ ...settings, ...updates });
      if (!storage) emitTerminalSettingsChanged(next);
      setSettings(next);
    },
    [settings],
  );

  return { settings, updateSettings };
}

export type TerminalOptionTarget = {
  options: {
    scrollSensitivity?: number;
    fastScrollSensitivity?: number;
    scrollback?: number;
    wordSeparator?: string;
    macOptionIsMeta?: boolean;
  };
};

export type TerminalMacOptionDetection = "us" | "non-us" | "unknown";

const US_OPTION_LAYOUT_FINGERPRINT: Readonly<Record<string, string>> = {
  KeyQ: "q",
  KeyW: "w",
  KeyA: "a",
  KeyZ: "z",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  BracketLeft: "[",
  BracketRight: "]",
};

/** Source-compatible layout probe: incomplete maps are treated conservatively. */
export function classifyTerminalKeyboardLayout(layoutMap: {
  get: (code: string) => string | undefined;
  size: number;
}): TerminalMacOptionDetection {
  if (layoutMap.size === 0) return "unknown";
  for (const [code, expected] of Object.entries(US_OPTION_LAYOUT_FINGERPRINT)) {
    const actual = layoutMap.get(code);
    if (actual === undefined) return "unknown";
    if (actual !== expected) return "non-us";
  }
  return "us";
}

export function useTerminalMacOptionDetection(
  enabled: boolean,
): TerminalMacOptionDetection {
  const [detected, setDetected] =
    useState<TerminalMacOptionDetection>("unknown");
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined") return;
    const keyboard = (
      navigator as Navigator & {
        keyboard?: {
          getLayoutMap?: () => Promise<{
            get: (code: string) => string | undefined;
            size: number;
          }>;
        };
      }
    ).keyboard;
    if (!keyboard?.getLayoutMap) return;
    let cancelled = false;
    void keyboard
      .getLayoutMap()
      .then((map) => {
        if (!cancelled) setDetected(classifyTerminalKeyboardLayout(map));
      })
      .catch(() => {
        // Browser layout probing is optional; the conservative unknown mode
        // keeps Option composing characters when the API is unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return detected;
}

/** Matches the source's safe fallback: only a confirmed US layout enables Alt. */
export function resolveTerminalMacOptionAsMeta(
  value: TerminalSettings["terminalMacOptionAsAlt"],
  detected: TerminalMacOptionDetection = "unknown",
): boolean {
  if (value === "true") return true;
  return value === "auto" && detected === "us";
}

/** Applies the mutable xterm options shared by new and existing terminals. */
export function applyTerminalSettings(
  terminal: TerminalOptionTarget,
  settings: TerminalSettings,
  options: {
    isMac: boolean;
    detectedMacOption?: TerminalMacOptionDetection;
  },
): void {
  terminal.options.scrollSensitivity = normalizeTerminalScrollSensitivity(
    settings.terminalScrollSensitivity,
  );
  terminal.options.fastScrollSensitivity =
    normalizeTerminalFastScrollSensitivity(
      settings.terminalFastScrollSensitivity,
    );
  terminal.options.scrollback = normalizeDesktopTerminalScrollbackRows(
    settings.terminalScrollbackRows,
  );
  terminal.options.wordSeparator = settings.terminalWordSeparator || undefined;
  terminal.options.macOptionIsMeta = options.isMac
    ? resolveTerminalMacOptionAsMeta(
        settings.terminalMacOptionAsAlt,
        options.detectedMacOption,
      )
    : false;
}
