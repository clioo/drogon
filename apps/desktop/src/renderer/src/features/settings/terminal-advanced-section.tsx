// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/renderer/src/components/settings/TerminalAdvancedSection.tsx
//   src/renderer/src/components/settings/TerminalMacKeyboardSection.tsx
// (scrollback, word separators and macOS Option/JIS controls).
// Adapted: Drogon has no Windows PowerShell or setup-script settings seam, so
// those source-only rows stay out rather than becoming dead switches.

import { useEffect, useState } from "react";
import { Input } from "../../components/ui/input";
import {
  DESKTOP_TERMINAL_SCROLLBACK_ROW_PRESETS,
  DESKTOP_TERMINAL_SCROLLBACK_ROWS_MAX,
  DESKTOP_TERMINAL_SCROLLBACK_ROWS_MIN,
  normalizeDesktopTerminalScrollbackRows,
} from "../terminal/terminal-scrollback-policy";
import {
  SettingsRow,
  SettingsSegmentedControl,
  SettingsSubsectionHeader,
  SettingsSwitchRow,
} from "./settings-rows";
import { matchesTerminalSetting } from "./terminal-setting-search";
import {
  useTerminalMacOptionDetection,
  type TerminalMacOptionDetection,
  type TerminalSettings,
} from "../terminal/terminal-settings";

const WORD_SEPARATOR_PLACEHOLDER = " ()[]{},'\"`";

const SCROLLBACK_PRESETS_ROWS = DESKTOP_TERMINAL_SCROLLBACK_ROW_PRESETS;

function formatScrollbackRowsLabel(rows: number): string {
  return rows % 1_000 === 0 ? `${rows / 1_000}k` : String(rows);
}

function optionDetectionLabel(detected: TerminalMacOptionDetection): string {
  if (detected === "us") {
    return "US English — Option sends Alt/Esc sequences";
  }
  if (detected === "non-us") {
    return "non-US layout — Option composes characters like @, €, [, ]";
  }
  return "unknown layout — Option composes characters (safe default)";
}

export function TerminalAdvancedSection({
  settings,
  onChange,
  searchQuery = "",
}: {
  settings: TerminalSettings;
  onChange: (updates: Partial<TerminalSettings>) => void;
  searchQuery?: string;
}): React.JSX.Element | null {
  const isMac =
    typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
  const detectedLayout = useTerminalMacOptionDetection(isMac);
  const scrollbackRows = normalizeDesktopTerminalScrollbackRows(
    settings.terminalScrollbackRows,
  );
  const isPreset = SCROLLBACK_PRESETS_ROWS.includes(
    scrollbackRows as (typeof SCROLLBACK_PRESETS_ROWS)[number],
  );
  const [scrollbackMode, setScrollbackMode] = useState<"preset" | "custom">(
    () => (isPreset ? "preset" : "custom"),
  );
  const [scrollbackRowsDraft, setScrollbackRowsDraft] = useState(
    String(scrollbackRows),
  );

  useEffect(() => {
    setScrollbackRowsDraft(String(scrollbackRows));
    setScrollbackMode(isPreset ? "preset" : "custom");
  }, [scrollbackRows, isPreset]);

  const showScrollback = matchesTerminalSetting(
    searchQuery,
    "Scrollback Rows",
    "Retained desktop terminal rows for new and open panes.",
    ["terminal", "scrollback", "rows", "buffer", "memory"],
  );
  const showWordSeparators = matchesTerminalSetting(
    searchQuery,
    "Word Separators",
    "Characters treated as word boundaries for double-click selection.",
    ["word", "separator", "boundary", "double-click", "selection"],
  );
  const showOptionAsAlt =
    isMac &&
    matchesTerminalSetting(
      searchQuery,
      "Option as Alt",
      "Controls whether the macOS Option key sends Alt/Esc sequences or composes characters.",
      [
        "terminal",
        "option",
        "alt",
        "key",
        "meta",
        "compose",
        "mac",
        "macos",
        "keyboard",
        "german",
        "international",
        "readline",
        "ghostty",
        "layout",
      ],
    );
  const showJisYen =
    isMac &&
    matchesTerminalSetting(
      searchQuery,
      "JIS Yen (¥) to Backslash (\\)",
      "Controls whether pressing the JIS Yen (¥) key sends a backslash (\\) instead.",
      [
        "terminal",
        "yen",
        "backslash",
        "japanese",
        "keyboard",
        "mac",
        "macos",
        "jis",
        "intl",
      ],
    );
  if (
    !showScrollback &&
    !showWordSeparators &&
    !showOptionAsAlt &&
    !showJisYen
  ) {
    return null;
  }
  const scrollbackToggleValue =
    scrollbackMode === "custom"
      ? "custom"
      : isPreset
        ? `${scrollbackRows}`
        : "custom";
  const commitScrollbackRowsDraft = (): void => {
    const trimmed = scrollbackRowsDraft.trim();
    const value = Number(trimmed);
    if (trimmed === "" || !Number.isFinite(value)) {
      setScrollbackRowsDraft(String(scrollbackRows));
      return;
    }
    const next = normalizeDesktopTerminalScrollbackRows(value);
    onChange({ terminalScrollbackRows: next });
    setScrollbackRowsDraft(String(next));
  };

  return (
    <section className="space-y-3" data-settings-subsection="terminal-advanced">
      <SettingsSubsectionHeader
        title="Advanced"
        description="Scrollback, word boundaries, and platform-specific terminal behaviors."
      />
      <div className="divide-y divide-border/40">
        {showScrollback ? (
          <SettingsRow
            alignTop={scrollbackMode === "custom"}
            label="Scrollback Rows"
            description="Retained desktop terminal rows for new and open panes."
            control={
              <div className="flex flex-col items-end gap-2">
                <SettingsSegmentedControl
                  ariaLabel="Scrollback Rows"
                  value={scrollbackToggleValue}
                  onChange={(value) => {
                    if (value === "custom") {
                      setScrollbackMode("custom");
                      return;
                    }
                    setScrollbackMode("preset");
                    onChange({
                      terminalScrollbackRows:
                        normalizeDesktopTerminalScrollbackRows(Number(value)),
                    });
                  }}
                  options={[
                    ...SCROLLBACK_PRESETS_ROWS.map((preset) => ({
                      value: `${preset}`,
                      label: formatScrollbackRowsLabel(preset),
                      ariaLabel: `${preset} rows`,
                    })),
                    { value: "custom", label: "Custom", ariaLabel: "Custom" },
                  ]}
                />
                {scrollbackMode === "custom" ? (
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={DESKTOP_TERMINAL_SCROLLBACK_ROWS_MIN}
                      max={DESKTOP_TERMINAL_SCROLLBACK_ROWS_MAX}
                      step={100}
                      aria-label="Custom scrollback rows"
                      value={scrollbackRowsDraft}
                      onChange={(event) =>
                        setScrollbackRowsDraft(event.target.value)
                      }
                      onBlur={commitScrollbackRowsDraft}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") commitScrollbackRowsDraft();
                      }}
                      className="number-input-clean w-24 tabular-nums"
                    />
                    <span className="text-xs text-muted-foreground">rows</span>
                  </div>
                ) : null}
              </div>
            }
          />
        ) : null}

        {showWordSeparators ? (
          <SettingsRow
            label="Word Separators"
            description="Characters treated as word boundaries for double-click selection."
            control={
              <Input
                value={settings.terminalWordSeparator}
                onChange={(event) =>
                  onChange({ terminalWordSeparator: event.target.value })
                }
                placeholder={WORD_SEPARATOR_PLACEHOLDER}
                aria-label="Word Separators"
                className="w-56 font-mono text-xs"
              />
            }
          />
        ) : null}

        {isMac && (showOptionAsAlt || showJisYen) ? (
          <>
            {showOptionAsAlt ? (
              <SettingsRow
                alignTop
                label="Option as Alt"
                description={
                  settings.terminalMacOptionAsAlt === "auto"
                    ? `Auto — detected: ${optionDetectionLabel(detectedLayout)}.`
                    : settings.terminalMacOptionAsAlt === "false"
                      ? "Option composes special characters for your keyboard layout."
                      : settings.terminalMacOptionAsAlt === "true"
                        ? "Both Option keys send Alt/Esc sequences."
                        : `The ${settings.terminalMacOptionAsAlt} Option key sends Alt/Esc; the other composes special characters.`
                }
                control={
                  <SettingsSegmentedControl
                    ariaLabel="Option as Alt"
                    value={settings.terminalMacOptionAsAlt}
                    onChange={(value) =>
                      onChange({ terminalMacOptionAsAlt: value })
                    }
                    options={[
                      { value: "auto", label: "Auto" },
                      { value: "true", label: "Both" },
                      { value: "left", label: "Left" },
                      { value: "right", label: "Right" },
                      { value: "false", label: "Off" },
                    ]}
                  />
                }
              />
            ) : null}
            {showJisYen ? (
              <SettingsSwitchRow
                label="JIS Yen (¥) to Backslash (\\)"
                description="Pressing the JIS Yen (¥) key sends a backslash (\\) instead."
                checked={settings.terminalJISYenToBackslash}
                onChange={(next) =>
                  onChange({ terminalJISYenToBackslash: next })
                }
                ariaLabel="JIS Yen (¥) to Backslash (\\)"
              />
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
