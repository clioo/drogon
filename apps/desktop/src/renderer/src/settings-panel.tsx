// Appearance controls share App settings; native modal behavior owns focus containment.
import { useEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, RefObject } from "react";
import { Button } from "./components/ui/button";
import type { Theme } from "./settings-store";

export const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

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

export function handleThemeRadioChange(
  value: string,
  onThemeChange: (theme: Theme) => void,
): void {
  if (isTheme(value)) onThemeChange(value);
}

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

export const SETTINGS_PANEL_STYLES = `
  .settings-panel {
    position: fixed;
    top: 48px;
    right: 16px;
    left: auto;
    margin: 0;
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

  openerRef: RefObject<HTMLElement | null>;
};

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
