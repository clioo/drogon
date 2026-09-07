import { useState } from "react";
import { Input } from "../../components/ui/input";
import type { Theme } from "../../settings-store";
import {
  SettingsFieldError,
  SettingsRow,
  SettingsSection,
  SettingsSegmentedControl,
  SettingsSwitchRow,
} from "./settings-rows";

export const THEME_SEGMENT_OPTIONS: readonly { value: Theme; label: string }[] =
  [
    { value: "system", label: "System" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ];

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
    </SettingsSection>
  );
}
