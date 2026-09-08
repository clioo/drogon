// MIT Copyright (c) 2026 Lovecast Inc.
// Ported structure from the Orca reference (read-only):
//   src/renderer/src/components/settings/AppearancePane.tsx
//     (Interface / Terminal accordion sections with per-section summaries)
//   src/renderer/src/components/settings/AppearanceInterfaceSection.tsx
//     (Theme segmented System/Dark/Light first row)
// Adapted: the MVP keeps this repo's real controls (theme, terminal font
// size, session details) grouped under Interface/Terminal subsection
// headers, plus the source's Terminal Rendering GPU-acceleration control
// (src/renderer/src/components/settings/TerminalRenderingSection.tsx copy);
// no font pickers, zoom or app-icon surface yet.
import { useState } from "react";
import { Input } from "../../components/ui/input";
import type { TerminalGpuAcceleration, Theme } from "../../settings-store";
import {
  readTerminalGpuAcceleration,
  writeTerminalGpuAcceleration,
} from "../../settings-store";
import {
  SettingsFieldError,
  SettingsRow,
  SettingsSection,
  SettingsSegmentedControl,
  SettingsSubsectionHeader,
  SettingsSwitchRow,
} from "./settings-rows";

export const THEME_SEGMENT_OPTIONS: readonly { value: Theme; label: string }[] =
  [
    { value: "system", label: "System" },
    { value: "dark", label: "Dark" },
    { value: "light", label: "Light" },
  ];

export const GPU_ACCELERATION_SEGMENT_OPTIONS: readonly {
  value: TerminalGpuAcceleration;
  label: string;
}[] = [
  { value: "auto", label: "Auto" },
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

/** Source copy (TerminalRenderingSection.tsx): the mode-specific row description. */
export function gpuAccelerationDescription(
  mode: TerminalGpuAcceleration,
): string {
  if (mode === "off") return "WebGL disabled; DOM renderer for max compatibility.";
  if (mode === "on") return "WebGL is always attempted for terminal panes.";
  return "Auto tries WebGL, with DOM fallback for unsupported or risky renderers.";
}

export function GpuAccelerationRow(): React.JSX.Element {
  // Self-contained persistence: the value lives in the settings envelope and
  // TerminalPane reads it at pane construction; local state only mirrors it
  // for the segmented control.
  const [mode, setMode] = useState<TerminalGpuAcceleration>(() =>
    typeof window === "undefined"
      ? "auto"
      : readTerminalGpuAcceleration(window.localStorage),
  );
  return (
    <SettingsRow
      label="GPU Acceleration"
      description={
        "Controls whether the terminal uses xterm.js WebGL rendering. Auto tries WebGL when the renderer is supported, with a conservative Linux fallback for software or unknown GPU renderers. " +
        gpuAccelerationDescription(mode)
      }
      control={
        <SettingsSegmentedControl<TerminalGpuAcceleration>
          value={mode}
          onChange={(next) => {
            setMode(next);
            if (typeof window !== "undefined") {
              writeTerminalGpuAcceleration(window.localStorage, next);
            }
          }}
          options={GPU_ACCELERATION_SEGMENT_OPTIONS}
          ariaLabel="GPU Acceleration"
        />
      }
    />
  );
}

export function AppearanceSection({
  theme,
  onThemeChange,
  terminalFontSize,
  onTerminalFontSizeChange,
  inspectorVisible,
  onInspectorChange,
}: {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  terminalFontSize: number;
  onTerminalFontSizeChange: (size: number) => void;
  inspectorVisible: boolean;
  onInspectorChange: (visible: boolean) => void;
}): React.JSX.Element {
  const [fontDraft, setFontDraft] = useState<string | null>(null);
  const [fontError, setFontError] = useState<string | null>(null);
  return (
    <SettingsSection
      id="appearance"
      title="Appearance"
      description="Theme and terminal text size. Changes apply immediately."
    >
      <div className="divide-y divide-border/40">
        <div className="space-y-2 pb-4">
          <SettingsSubsectionHeader
            title="Interface"
            description="How the app looks."
          />
          <SettingsRow
            label="Theme"
            description="System follows the OS color scheme."
            control={
              <SettingsSegmentedControl<Theme>
                value={theme}
                onChange={onThemeChange}
                options={THEME_SEGMENT_OPTIONS}
                ariaLabel="Theme"
              />
            }
          />
        </div>
        <div className="space-y-2 pt-4">
          <SettingsSubsectionHeader
            title="Terminal"
            description="How terminal sessions read."
          />
          <GpuAccelerationRow />
          <SettingsRow
            label="Terminal font size"
            description="9 to 32 pixels."
            control={
              <span className="settings-inline-control">
                <Input
                  type="number"
                  min={9}
                  max={32}
                  step={1}
                  aria-label="Terminal font size"
                  className="settings-number-input"
                  value={fontDraft ?? String(terminalFontSize)}
                  onChange={(event) => {
                    const raw = event.target.value;
                    setFontDraft(raw);
                    const parsed = Number(raw);
                    if (
                      raw.trim() === "" ||
                      !Number.isInteger(parsed) ||
                      parsed < 9 ||
                      parsed > 32
                    ) {
                      setFontError("Enter a whole number from 9 to 32.");
                      return;
                    }
                    setFontError(null);
                    onTerminalFontSizeChange(parsed);
                  }}
                  onBlur={() => setFontDraft(null)}
                />
                <span aria-hidden className="settings-unit">
                  px
                </span>
              </span>
            }
          />
          <SettingsFieldError message={fontError} />
          <SettingsSwitchRow
            label="Show session details"
            description="Side pane with the active session's command and state."
            checked={inspectorVisible}
            onChange={onInspectorChange}
          />
        </div>
      </div>
    </SettingsSection>
  );
}
