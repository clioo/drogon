// Scoped appearance checkpoint (ROOT-approved): theme + inspector visibility
// only. Presentational only — `uiSettings()` in App.tsx stays the single
// source of truth; this component drives it through props, never holds its
// own copy of the setting values. Keybinding editing is deferred to a later
// checkpoint.
import { useEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import { Button } from "./components/ui/button";
import type { Theme } from "./settings-store";

export const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** Pure aria/props mapping: which theme radio is checked, in catalog order. */
export function buildThemeOptionsState(
  theme: Theme,
): { value: Theme; label: string; checked: boolean }[] {
  return THEME_OPTIONS.map((option) => ({
    ...option,
    checked: option.value === theme,
  }));
}

function isTheme(value: string): value is Theme {
  return value === "system" || value === "light" || value === "dark";
}

/** What a theme radio's onChange wires to; ignores any foreign value. */
export function handleThemeRadioChange(
  value: string,
  onThemeChange: (theme: Theme) => void,
): void {
  if (isTheme(value)) onThemeChange(value);
}

/** What the inspector checkbox's onChange wires to. */
export function handleInspectorCheckboxChange(
  checked: boolean,
  onInspectorChange: (visible: boolean) => void,
): void {
  onInspectorChange(checked);
}

/** What the dialog's onKeyDown wires to: Escape closes, everything else is inert. */
export function handleSettingsKeyDown(
  event: { key: string; preventDefault: () => void },
  onClose: () => void,
): void {
  if (event.key !== "Escape") return;
  event.preventDefault();
  onClose();
}

export type SettingsPanelProps = {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  inspectorVisible: boolean;
  onInspectorChange: (visible: boolean) => void;
  onClose: () => void;
  /** The control that opened the panel; focus returns there on close. */
  openerRef: RefObject<HTMLElement | null>;
};

/**
 * Dismissible dialog, not a route: mounted/unmounted directly by App.tsx.
 * Opening moves focus into the dialog (mount effect); closing (unmount)
 * returns focus to the opener via `openerRef`.
 */
export function SettingsPanel({
  theme,
  onThemeChange,
  inspectorVisible,
  onInspectorChange,
  onClose,
  openerRef,
}: SettingsPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
    return () => {
      openerRef.current?.focus();
    };
  }, [openerRef]);

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      className="settings-panel"
      onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) =>
        handleSettingsKeyDown(event, onClose)
      }
    >
      <style>{`
        .settings-panel {
          position: absolute;
          top: 48px;
          right: 16px;
          z-index: 20;
          width: 260px;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          border-radius: var(--radius-md);
          border: 1px solid var(--border);
          background: var(--popover);
          color: var(--popover-foreground);
          box-shadow: var(--shadow-floating);
        }
        .settings-panel h2 {
          margin: 0;
          font-size: 0.9rem;
          font-weight: 600;
        }
        .settings-panel fieldset {
          margin: 0;
          padding: 0;
          border: none;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .settings-panel legend {
          padding: 0 0 4px;
          font-size: 0.8rem;
          color: var(--muted-foreground);
        }
        .settings-panel label {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.85rem;
        }
        .settings-panel .settings-panel-actions {
          display: flex;
          justify-content: flex-end;
        }
      `}</style>
      <h2>Settings</h2>
      <fieldset>
        <legend>Theme</legend>
        {buildThemeOptionsState(theme).map((option) => (
          <label key={option.value}>
            <input
              type="radio"
              name="settings-theme"
              value={option.value}
              checked={option.checked}
              onChange={(event) =>
                handleThemeRadioChange(event.target.value, onThemeChange)
              }
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      <label>
        <input
          type="checkbox"
          checked={inspectorVisible}
          onChange={(event) =>
            handleInspectorCheckboxChange(
              event.target.checked,
              onInspectorChange,
            )
          }
        />
        Show session details
      </label>
      <div className="settings-panel-actions">
        <Button size="sm" variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
