// Scoped appearance checkpoint (ROOT-approved): theme + inspector visibility
// only. Presentational only — `uiSettings()` in App.tsx stays the single
// source of truth; this component drives it through props, never holds its
// own copy of the setting values. Keybinding editing is deferred to a later
// checkpoint.
//
// ROOT HELD the prior build (msg_82afd72eee69): aria-modal="true" on a plain
// absolutely-positioned div has no real focus trap or inert background, so
// keyboard focus could leave the dialog while it claimed to be modal. This
// version uses a native <dialog> opened with showModal(): the browser itself
// supplies focus-into-dialog on open, Tab/Shift+Tab trapping, an inert
// background and native Escape-to-close, so no custom JS trap is needed or
// implemented here.
import { useEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, RefObject } from "react";
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

export type DialogLike = {
  open: boolean;
  showModal: () => void;
  close: () => void;
  addEventListener: (type: "close", listener: () => void) => void;
  removeEventListener: (type: "close", listener: () => void) => void;
};

export type FocusableLike = { focus: () => void };

/**
 * Wires the native modal lifecycle for the settings dialog: opens it as a
 * real modal (the browser supplies focus-into-dialog, Tab/Shift+Tab trapping
 * and inert background) and calls `onClose` whenever the dialog's native
 * "close" event fires — which is the browser's single funnel for Escape,
 * outside-backdrop dismissal and the panel's own Close button (all of which
 * call the dialog's `.close()` method rather than reimplementing dismissal).
 * The returned cleanup closes a still-open dialog and restores focus to the
 * opener, matching the pre-existing openerRef contract.
 */
export function attachSettingsDialogLifecycle(
  dialog: DialogLike,
  opener: FocusableLike | null,
  onClose: () => void,
): () => void {
  const handleClose = () => onClose();
  dialog.addEventListener("close", handleClose);
  dialog.showModal();
  return () => {
    dialog.removeEventListener("close", handleClose);
    if (dialog.open) dialog.close();
    opener?.focus();
  };
}

/**
 * A native <dialog>'s ::backdrop is not part of the DOM, so an outside click
 * lands on the dialog element itself — but so does a click on the dialog's
 * own padding. The target check alone cannot tell backdrop from padding, so
 * this also requires the pointer to fall outside the dialog's content rect.
 * This is what the dialog's onClick wires to for truthful
 * outside-interaction dismissal (no synthetic overlay div).
 */
export function isSettingsBackdropClick(
  event: { target: unknown; clientX: number; clientY: number },
  dialog: {
    getBoundingClientRect: () => Pick<
      DOMRect,
      "left" | "right" | "top" | "bottom"
    >;
  } | null,
): boolean {
  if (!dialog || event.target !== dialog) return false;
  const rect = dialog.getBoundingClientRect();
  return (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  );
}

/**
 * Canonical 12/13/14px type scale and the source floating/popover layer tier
 * (z-index: 10, matching --shadow-floating usage elsewhere in main.css).
 * TODO(pending leader CSS handoff integration): move into main.css as a
 * regular class once the appearance-panel style-block relocation lands;
 * kept inline here for now since main.css is out of this dispatch's scope.
 */
export const SETTINGS_PANEL_STYLES = `
  .settings-panel {
    position: absolute;
    top: 48px;
    right: 16px;
    z-index: 10;
    width: min(260px, calc(100vw - 32px));
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
  .settings-panel::backdrop {
    background: transparent;
  }
  .settings-panel h2 {
    margin: 0;
    font-size: 14px;
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
    font-size: 12px;
    color: var(--muted-foreground);
  }
  .settings-panel label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .settings-panel .settings-panel-actions {
    display: flex;
    justify-content: flex-end;
  }
`;

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
 * Dismissible native modal dialog, not a route: mounted/unmounted directly by
 * App.tsx. showModal() moves focus in and traps Tab/Shift+Tab (browser-native,
 * see attachSettingsDialogLifecycle); closing (Escape, outside click, the
 * Close button, or unmount) returns focus to the opener via `openerRef`.
 */
export function SettingsPanel({
  theme,
  onThemeChange,
  inspectorVisible,
  onInspectorChange,
  onClose,
  openerRef,
}: SettingsPanelProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    return attachSettingsDialogLifecycle(dialog, openerRef.current, onClose);
    // Runs once per mount: the panel is mounted/unmounted directly by
    // App.tsx rather than toggled via a prop, so a re-open always means a
    // fresh mount with the current onClose/openerRef.
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-label="Settings"
      className="settings-panel"
      onClick={(event: ReactMouseEvent<HTMLDialogElement>) => {
        if (isSettingsBackdropClick(event, dialogRef.current)) onClose();
      }}
    >
      <style>{SETTINGS_PANEL_STYLES}</style>
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
        <Button
          size="sm"
          variant="outline"
          onClick={() => dialogRef.current?.close()}
        >
          Close
        </Button>
      </div>
    </dialog>
  );
}
