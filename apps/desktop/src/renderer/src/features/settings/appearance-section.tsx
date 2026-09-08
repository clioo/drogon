// MIT Copyright (c) 2026 Lovecast Inc.
// Ported structure from the Orca reference (read-only):
//   src/renderer/src/components/settings/AppearancePane.tsx
//     (Interface / Terminal accordion sections with per-section summaries)
//   src/renderer/src/components/settings/AppearanceInterfaceSection.tsx
//     (Theme segmented System/Dark/Light first row)
//   src/renderer/src/components/settings/TerminalAppearanceSection.tsx
//     (Terminal Typography subsection: Font Size + Font Family rows)
//   src/renderer/src/components/settings/TerminalAdvancedTypographyControls.tsx
//     (Font Weight / Bold Font Weight NumberFields, 100-900, defaults 500/700)
//   src/renderer/src/components/settings/EditorFontFamilySetting.tsx
//     (Editor Font Family row, empty follows the terminal font)
//   src/renderer/src/components/settings/FontAutocomplete.tsx
//     (font combobox; the component lives in font-autocomplete.tsx)
// Adapted: the MVP keeps this repo's real controls (theme, terminal font
// size, session details) grouped under Interface/Terminal subsection
// headers, plus the source's Terminal Rendering GPU-acceleration control
// (src/renderer/src/components/settings/TerminalRenderingSection.tsx copy);
// typography rows below are controlled when the caller passes values and
// otherwise read/write the persisted envelope directly (same pattern as the
// GPU reader/writer), so App.tsx needs no new prop thread.
import { useCallback, useRef, useState } from "react";
import { Input } from "../../components/ui/input";
import type { TerminalGpuAcceleration, Theme } from "../../settings-store";
import {
  readTerminalTypography,
  SETTINGS_DEFAULTS,
  writeTerminalTypography,
  type StorageLike,
} from "../../settings-store";
import {
  DEFAULT_TERMINAL_FONT_WEIGHT,
  DEFAULT_TERMINAL_FONT_WEIGHT_BOLD,
  getFallbackTerminalFonts,
  getTerminalTypographySearchEntries,
  isEditorFontFamily,
  isTerminalFontFamily,
  mergeFontSuggestions,
  normalizeTerminalFontWeight,
  normalizeTerminalFontWeightBold,
  requestSystemFontFamilies,
  TERMINAL_FONT_WEIGHT_MAX,
  TERMINAL_FONT_WEIGHT_MIN,
  TERMINAL_FONT_WEIGHT_STEP,
} from "./terminal-typography";
import { FontAutocomplete } from "./font-autocomplete";
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

export function GpuAccelerationRow({
  mode,
  onChange,
}: {
  mode: TerminalGpuAcceleration;
  onChange: (mode: TerminalGpuAcceleration) => void;
}): React.JSX.Element {
  // Controlled like the font-size row: App owns the single settings store
  // writer, so a GPU edit can never be reverted by a later settings flush.
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
          onChange={onChange}
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
  terminalGpuAcceleration,
  onTerminalGpuAccelerationChange,
  inspectorVisible,
  onInspectorChange,
  terminalFontFamily: terminalFontFamilyProp,
  onTerminalFontFamilyChange,
  terminalFontWeight: terminalFontWeightProp,
  onTerminalFontWeightChange,
  terminalFontWeightBold: terminalFontWeightBoldProp,
  onTerminalFontWeightBoldChange,
  editorFontFamily: editorFontFamilyProp,
  onEditorFontFamilyChange,
  statusBarVisible,
  onStatusBarVisibleChange,
  tasksButtonVisible,
  onTasksButtonVisibleChange,
  automationsButtonVisible,
  onAutomationsButtonVisibleChange,
  titlebarAppNameVisible,
  onTitlebarAppNameVisibleChange,
}: {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  terminalFontSize: number;
  onTerminalFontSizeChange: (size: number) => void;
  terminalGpuAcceleration: TerminalGpuAcceleration;
  onTerminalGpuAccelerationChange: (mode: TerminalGpuAcceleration) => void;
  inspectorVisible: boolean;
  onInspectorChange: (visible: boolean) => void;
  /** Source typography knobs. Optional: when omitted the rows read/write
   *  the persisted envelope directly (GPU-reader pattern), so App.tsx
   *  needs no new prop thread. */
  terminalFontFamily?: string;
  onTerminalFontFamilyChange?: (family: string) => void;
  terminalFontWeight?: number;
  onTerminalFontWeightChange?: (weight: number) => void;
  terminalFontWeightBold?: number;
  onTerminalFontWeightBoldChange?: (weight: number) => void;
  editorFontFamily?: string;
  onEditorFontFamilyChange?: (family: string) => void;
  /** R14-B appearance flags: same toggles the native View > Appearance
      submenu checkbox-marks (source default-on settings + status bar). */
  statusBarVisible: boolean;
  onStatusBarVisibleChange: (visible: boolean) => void;
  tasksButtonVisible: boolean;
  onTasksButtonVisibleChange: (visible: boolean) => void;
  automationsButtonVisible: boolean;
  onAutomationsButtonVisibleChange: (visible: boolean) => void;
  titlebarAppNameVisible: boolean;
  onTitlebarAppNameVisibleChange: (visible: boolean) => void;
}): React.JSX.Element {
  const [fontDraft, setFontDraft] = useState<string | null>(null);
  const [fontError, setFontError] = useState<string | null>(null);
  const [familyError, setFamilyError] = useState<string | null>(null);
  const [editorFontError, setEditorFontError] = useState<string | null>(null);

  // Store-backed fallback for the optional typography props (read once like
  // the GPU reader; writes go through the envelope writer below).
  const storageRef = useRef<StorageLike | null>(null);
  if (storageRef.current === null && typeof window !== "undefined") {
    try {
      storageRef.current = window.localStorage;
    } catch {
      storageRef.current = null;
    }
  }
  const [storeTypography] = useState(() =>
    storageRef.current
      ? readTerminalTypography(storageRef.current)
      : {
          terminalFontFamily: SETTINGS_DEFAULTS.terminalFontFamily,
          terminalFontWeight: SETTINGS_DEFAULTS.terminalFontWeight,
          terminalFontWeightBold: SETTINGS_DEFAULTS.terminalFontWeightBold,
          editorFontFamily: SETTINGS_DEFAULTS.editorFontFamily,
        },
  );
  const [localFamily, setLocalFamily] = useState(storeTypography.terminalFontFamily);
  const [localWeight, setLocalWeight] = useState(storeTypography.terminalFontWeight);
  const [localBoldWeight, setLocalBoldWeight] = useState(
    storeTypography.terminalFontWeightBold,
  );
  const [localEditorFont, setLocalEditorFont] = useState(
    storeTypography.editorFontFamily,
  );
  const writeTypography = useCallback(
    (updates: {
      terminalFontFamily?: string;
      terminalFontWeight?: number;
      terminalFontWeightBold?: number;
      editorFontFamily?: string;
    }) => {
      if (storageRef.current) writeTerminalTypography(storageRef.current, updates);
      if (updates.terminalFontFamily !== undefined)
        setLocalFamily(updates.terminalFontFamily);
      if (updates.terminalFontWeight !== undefined)
        setLocalWeight(updates.terminalFontWeight);
      if (updates.terminalFontWeightBold !== undefined)
        setLocalBoldWeight(updates.terminalFontWeightBold);
      if (updates.editorFontFamily !== undefined)
        setLocalEditorFont(updates.editorFontFamily);
    },
    [],
  );

  const terminalFontFamily = terminalFontFamilyProp ?? localFamily;
  const terminalFontWeight = terminalFontWeightProp ?? localWeight;
  const terminalFontWeightBold = terminalFontWeightBoldProp ?? localBoldWeight;
  const editorFontFamily = editorFontFamilyProp ?? localEditorFont;

  const changeTerminalFontFamily = (next: string) => {
    if (!isTerminalFontFamily(next)) {
      setFamilyError("Font names must be under 256 characters with no line breaks.");
      return;
    }
    setFamilyError(null);
    if (onTerminalFontFamilyChange) onTerminalFontFamilyChange(next);
    else writeTypography({ terminalFontFamily: next });
  };
  const changeTerminalFontWeight = (next: number) => {
    const normalized = normalizeTerminalFontWeight(next);
    if (onTerminalFontWeightChange) onTerminalFontWeightChange(normalized);
    else writeTypography({ terminalFontWeight: normalized });
  };
  const changeTerminalFontWeightBold = (next: number) => {
    const normalized = normalizeTerminalFontWeightBold(next);
    if (onTerminalFontWeightBoldChange) onTerminalFontWeightBoldChange(normalized);
    else writeTypography({ terminalFontWeightBold: normalized });
  };
  const changeEditorFontFamily = (next: string) => {
    if (!isEditorFontFamily(next)) {
      setEditorFontError("Font names must be under 256 characters with no line breaks.");
      return;
    }
    setEditorFontError(null);
    if (onEditorFontFamilyChange) onEditorFontFamilyChange(next);
    else writeTypography({ editorFontFamily: next });
  };

  // Font suggestions: curated fallback list first, merged with the
  // system-enumerated families on first open (latched like the source's
  // requestFontSuggestions, so a font-less host never reissues the call).
  const [fontSuggestions, setFontSuggestions] = useState<string[]>(() =>
    mergeFontSuggestions([], getFallbackTerminalFonts()),
  );
  const fontsLoadedRef = useRef(false);
  const requestFontSuggestions = useCallback(() => {
    if (fontsLoadedRef.current) return;
    void requestSystemFontFamilies().then((fonts) => {
      fontsLoadedRef.current = true;
      if (fonts.length > 0)
        setFontSuggestions((prev) => mergeFontSuggestions(fonts, prev));
    });
  }, []);

  const typographyEntries = getTerminalTypographySearchEntries();
  return (
    <SettingsSection
      id="appearance"
      title="Appearance"
      description="Theme and terminal typography. Changes apply immediately."
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
          <SettingsSwitchRow
            label="Show Status Bar"
            description="Bottom bar with usage meters, awake, memory, ports and terminals."
            checked={statusBarVisible}
            onChange={onStatusBarVisibleChange}
          />
          <SettingsSwitchRow
            label="Show Tasks Button"
            description="Show the Tasks button at the top of the left sidebar."
            checked={tasksButtonVisible}
            onChange={onTasksButtonVisibleChange}
          />
          <SettingsSwitchRow
            label="Show Automations Button"
            description="Show the Automations button at the top of the left sidebar."
            checked={automationsButtonVisible}
            onChange={onAutomationsButtonVisibleChange}
          />
          <SettingsSwitchRow
            label="Show Titlebar App Name"
            description="Show the app name in the titlebar."
            checked={titlebarAppNameVisible}
            onChange={onTitlebarAppNameVisibleChange}
          />
        </div>
        <div className="space-y-2 pt-4">
          <SettingsSubsectionHeader
            title="Terminal"
            description="How terminal sessions read."
          />
          <GpuAccelerationRow
            mode={terminalGpuAcceleration}
            onChange={onTerminalGpuAccelerationChange}
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
          <SettingsRow
            label="Font Family"
            description={typographyEntries[1]?.description}
            control={
              <FontAutocomplete
                value={terminalFontFamily}
                suggestions={fontSuggestions}
                onRequestSuggestions={requestFontSuggestions}
                onChange={changeTerminalFontFamily}
              />
            }
          />
          <SettingsFieldError message={familyError} />
          <TypographyNumberRow
            label="Font Weight"
            defaultValue={DEFAULT_TERMINAL_FONT_WEIGHT}
            value={terminalFontWeight}
            onChange={changeTerminalFontWeight}
          />
          <TypographyNumberRow
            label="Bold Font Weight"
            description="Adjust independently from Font Weight. Some fonts map several values to one face, so lower Font Weight or choose another font if bold looks unchanged."
            defaultValue={DEFAULT_TERMINAL_FONT_WEIGHT_BOLD}
            value={terminalFontWeightBold}
            onChange={changeTerminalFontWeightBold}
          />
          <SettingsRow
            label="Editor Font Family"
            description={typographyEntries[4]?.description}
            control={
              <FontAutocomplete
                value={editorFontFamily}
                suggestions={fontSuggestions}
                onRequestSuggestions={requestFontSuggestions}
                placeholder="Same as terminal font"
                onChange={changeEditorFontFamily}
              />
            }
          />
          <SettingsFieldError message={editorFontError} />
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

/**
 * Source NumberField (TerminalAdvancedTypographyControls.tsx): draft text
 * with commit-on-blur/Enter, clamped to min/max, rounded to integers, with
 * the "· Default: N" hint and the "100-900" range suffix.
 */
function TypographyNumberRow({
  label,
  description,
  defaultValue,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  defaultValue: number;
  value: number;
  onChange: (value: number) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(
    Number.isFinite(value) ? String(value) : "",
  );
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setDraft(Number.isFinite(value) ? String(value) : "");
  }
  const commit = (): void => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      setDraft(Number.isFinite(value) ? String(value) : "");
      return;
    }
    const next = Number(trimmed);
    if (Number.isFinite(next)) {
      const clamped = Math.min(
        TERMINAL_FONT_WEIGHT_MAX,
        Math.max(TERMINAL_FONT_WEIGHT_MIN, Math.round(next)),
      );
      onChange(clamped);
      setDraft(String(clamped));
    } else {
      setDraft(Number.isFinite(value) ? String(value) : "");
    }
  };
  return (
    <SettingsRow
      label={label}
      description={
        <>
          {description}
          <span className="ml-1 text-muted-foreground/70">
            · Default: {defaultValue}
          </span>
        </>
      }
      control={
        <span className="settings-inline-control">
          <Input
            type="number"
            min={TERMINAL_FONT_WEIGHT_MIN}
            max={TERMINAL_FONT_WEIGHT_MAX}
            step={TERMINAL_FONT_WEIGHT_STEP}
            aria-label={label}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
            }}
            className="settings-number-input tabular-nums number-input-clean"
          />
          <span aria-hidden className="settings-unit">
            100-900
          </span>
        </span>
      }
    />
  );
}
