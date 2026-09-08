// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/renderer/src/components/settings/TerminalInteractionSection.tsx
// (scroll-speed cards and the right-click/Focus/Copy/OSC 52 rows).
// Adapted: the MVP settings envelope and live-change callback are Drogon's
// renderer contracts; native Radix Slider is represented by an equivalent
// accessible range input because this build has no Slider primitive.

import { RotateCcw } from "lucide-react";
import { Button } from "../../components/ui/button";
import { SettingsSubsectionHeader, SettingsSwitchRow } from "./settings-rows";
import { matchesTerminalSetting } from "./terminal-setting-search";
import {
  DEFAULT_TERMINAL_FAST_SCROLL_SENSITIVITY,
  DEFAULT_TERMINAL_SCROLL_SENSITIVITY,
  DEFAULT_TERMINAL_TUI_SCROLL_SENSITIVITY,
  normalizeTerminalFastScrollSensitivity,
  normalizeTerminalScrollSensitivity,
  normalizeTerminalTuiScrollSensitivity,
  type TerminalSettings,
} from "../terminal/terminal-settings";

type ScrollSpeedSliderProps = {
  id: string;
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
};

function formatScrollSpeedValue(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function ScrollSpeedSlider({
  id,
  label,
  description,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: ScrollSpeedSliderProps): React.JSX.Element {
  return (
    <div className="rounded-md border border-border/60 bg-background/50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <label htmlFor={id} className="text-xs font-medium">
            {label}
          </label>
          <p className="text-[11px] leading-4 text-muted-foreground">
            {description}
          </p>
        </div>
        <span className="shrink-0 rounded-md border border-border/50 bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-foreground">
          {formatScrollSpeedValue(value)}
          {suffix}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-3 block h-4 w-full cursor-pointer accent-primary"
      />
      <div className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>{formatScrollSpeedValue(min)}</span>
        <span>{formatScrollSpeedValue(max)}</span>
      </div>
    </div>
  );
}

export function TerminalInteractionSection({
  settings,
  onChange,
  searchQuery = "",
}: {
  settings: TerminalSettings;
  onChange: (updates: Partial<TerminalSettings>) => void;
  searchQuery?: string;
}): React.JSX.Element | null {
  const showScrollSpeed = matchesTerminalSetting(
    searchQuery,
    "Scroll Speed",
    "Tune normal terminal scrollback, fast modifier scrolling, and full-screen TUI wheel speed.",
    [
      "terminal",
      "scroll",
      "scrolling",
      "speed",
      "sensitivity",
      "multiplier",
      "normal",
      "fast",
      "wheel",
      "mouse",
      "trackpad",
      "tui",
      "opencode",
      "fast scroll",
    ],
  );
  const showRightClick = matchesTerminalSetting(
    searchQuery,
    "Right-click to paste",
    "Right-click pastes the clipboard into the terminal.",
    [
      "terminal",
      "right click",
      "right-click",
      "paste",
      "context menu",
    ],
  );
  const showFocus = matchesTerminalSetting(
    searchQuery,
    "Focus Follows Mouse",
    "Hovering a terminal pane activates it without needing to click.",
    [
      "focus",
      "follows",
      "mouse",
      "hover",
      "pane",
      "ghostty",
      "active",
      "focus-follows-mouse",
    ],
  );
  const showCopy = matchesTerminalSetting(
    searchQuery,
    "Copy on Select",
    "Automatically copy terminal selections to the clipboard.",
    [
      "clipboard",
      "copy",
      "select",
      "selection",
      "auto",
      "copy-on-select",
      "automatic",
      "x11",
      "linux",
      "gnome",
      "paste",
    ],
  );
  const showOsc52 = matchesTerminalSetting(
    searchQuery,
    "Allow TUI Clipboard Writes (OSC 52)",
    "Let programs in the terminal copy to your system clipboard.",
    [
      "osc 52",
      "osc52",
      "clipboard",
      "zellij",
      "tmux",
      "neovim",
      "nvim",
      "fzf",
      "grok",
      "ssh",
      "remote",
      "copy",
      "paste",
    ],
  );
  const hasVisibleSetting =
    showScrollSpeed || showRightClick || showFocus || showCopy || showOsc52;
  if (!hasVisibleSetting) return null;

  const isMac =
    typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
  const rightClickPasteSwitchDescription = isMac
    ? "Right-click pastes the clipboard. Control-click opens the context menu."
    : "Right-click pastes the clipboard. Ctrl+right-click opens the context menu.";

  return (
    <section
      className="space-y-3"
      data-settings-subsection="terminal-interaction"
    >
      <SettingsSubsectionHeader
        title="Terminal Interaction"
        description="Mouse and clipboard behavior for terminal panes."
      />
      <div className="divide-y divide-border/40">
        {showScrollSpeed ? (
          <div className="space-y-3 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-0.5">
                <span className="text-sm font-medium">Scroll Speed</span>
                <p className="max-w-xl text-xs text-muted-foreground">
                  Adjust how wheel input feels in scrollback and in mouse-aware
                  terminal apps.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() =>
                  onChange({
                    terminalScrollSensitivity:
                      DEFAULT_TERMINAL_SCROLL_SENSITIVITY,
                    terminalFastScrollSensitivity:
                      DEFAULT_TERMINAL_FAST_SCROLL_SENSITIVITY,
                    terminalTuiScrollSensitivity:
                      DEFAULT_TERMINAL_TUI_SCROLL_SENSITIVITY,
                  })
                }
              >
                <RotateCcw className="size-3.5" />
                Reset
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <ScrollSpeedSlider
                id="terminal-scroll-sensitivity"
                label="Normal"
                description="Scrollback wheel multiplier."
                value={normalizeTerminalScrollSensitivity(
                  settings.terminalScrollSensitivity,
                )}
                min={0.5}
                max={3}
                step={0.05}
                suffix="x"
                onChange={(value) =>
                  onChange({
                    terminalScrollSensitivity:
                      normalizeTerminalScrollSensitivity(value),
                  })
                }
              />
              <ScrollSpeedSlider
                id="terminal-fast-scroll-sensitivity"
                label="Fast"
                description="Extra multiplier while scrolling with a modifier key."
                value={normalizeTerminalFastScrollSensitivity(
                  settings.terminalFastScrollSensitivity,
                )}
                min={1}
                max={10}
                step={0.5}
                suffix="x"
                onChange={(value) =>
                  onChange({
                    terminalFastScrollSensitivity:
                      normalizeTerminalFastScrollSensitivity(value),
                  })
                }
              />
              <ScrollSpeedSlider
                id="terminal-tui-scroll-sensitivity"
                label="TUI"
                description="Discrete wheel reports for full-screen terminal apps."
                value={normalizeTerminalTuiScrollSensitivity(
                  settings.terminalTuiScrollSensitivity,
                )}
                min={1}
                max={10}
                step={1}
                suffix="x"
                onChange={(value) =>
                  onChange({
                    terminalTuiScrollSensitivity:
                      normalizeTerminalTuiScrollSensitivity(value),
                  })
                }
              />
            </div>
          </div>
        ) : null}

        {showRightClick ? (
          <SettingsSwitchRow
            label="Right-click to paste"
            description={rightClickPasteSwitchDescription}
            checked={settings.terminalRightClickToPaste}
            onChange={(next) => onChange({ terminalRightClickToPaste: next })}
            ariaLabel="Right-click to paste"
          />
        ) : null}
        {showFocus ? (
          <SettingsSwitchRow
            label="Focus Follows Mouse"
            description="Hovering a terminal pane activates it without needing to click."
            checked={settings.terminalFocusFollowsMouse}
            onChange={(next) => onChange({ terminalFocusFollowsMouse: next })}
            ariaLabel="Focus Follows Mouse"
          />
        ) : null}
        {showCopy ? (
          <SettingsSwitchRow
            label="Copy on Select"
            description="Automatically copy terminal selections to the clipboard."
            checked={settings.terminalClipboardOnSelect}
            onChange={(next) => onChange({ terminalClipboardOnSelect: next })}
            ariaLabel="Copy on Select"
          />
        ) : null}
        {showOsc52 ? (
          <SettingsSwitchRow
            label="Allow TUI Clipboard Writes (OSC 52)"
            description="Let programs in the terminal (Zellij, tmux, Neovim, fzf, Grok, SSH) copy to your system clipboard."
            checked={settings.terminalAllowOsc52Clipboard}
            onChange={(next) => onChange({ terminalAllowOsc52Clipboard: next })}
            ariaLabel="Allow TUI Clipboard Writes (OSC 52)"
          />
        ) : null}
      </div>
    </section>
  );
}
