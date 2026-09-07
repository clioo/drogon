// Thin wrapper around the J10 settings surface (features/settings): the
// native modal shell lives here so existing callers keep working, every
// section lives in the surface.
import { useEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, RefObject } from "react";
import type { Harness } from "../../shared/session-contract";
import { Button } from "./components/ui/button";
import {
  SettingsSurface,
  type SettingsSurfaceProps,
} from "./features/settings/SettingsSurface";
import type { SettingsSectionId } from "./features/settings/settings-sections";
import type { HarnessAgentDefault, Theme } from "./settings-store";

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

const noop = (): void => {};

export type SettingsPanelProps = {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  inspectorVisible: boolean;
  onInspectorChange: (visible: boolean) => void;
  onClose: () => void;
  openerRef: RefObject<HTMLElement | null>;
} & Partial<
  Pick<
    SettingsSurfaceProps,
    | "terminalFontSize"
    | "onTerminalFontSizeChange"
    | "harnesses"
    | "defaultHarnessId"
    | "onDefaultHarnessChange"
    | "harnessDefaults"
    | "onHarnessDefaultChange"
    | "notifyOnAgentNeedsInput"
    | "onNotifyChange"
    | "workspacePath"
    | "initialSection"
  >
>;

export function SettingsPanel({
  theme,
  onThemeChange,
  inspectorVisible,
  onInspectorChange,
  onClose,
  openerRef,
  terminalFontSize = 13,
  onTerminalFontSizeChange = noop,
  harnesses = [],
  defaultHarnessId = "",
  onDefaultHarnessChange = noop,
  harnessDefaults = {},
  onHarnessDefaultChange = noop,
  notifyOnAgentNeedsInput = true,
  onNotifyChange = noop,
  workspacePath = null,
  initialSection,
}: SettingsPanelProps & { initialSection?: SettingsSectionId }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // The native-notification toggle is owned by main (default on); this row
  // only mirrors it, so App's settings store stays untouched.
  const [notifyOnNeedsInput, setNotifyOnNeedsInput] = useState(true);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    return attachSettingsDialogLifecycle(dialog, openerRef.current, onClose);
    // Runs once per mount: the panel is mounted/unmounted directly by
    // App.tsx rather than toggled via a prop, so a re-open always means a
    // fresh mount with the current onClose/openerRef.
  }, []);

  useEffect(() => {
    let cancelled = false;
    void window.drogon.notifications
      ?.getEnabled()
      .then((enabled) => {
        if (!cancelled) setNotifyOnNeedsInput(enabled);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-label="Settings"
      className="settings-surface-dialog"
      onClick={(event: ReactMouseEvent<HTMLDialogElement>) => {
        if (isSettingsBackdropClick(event, dialogRef.current)) onClose();
      }}
    >
      <div className="settings-surface-head">
        <h2>Settings</h2>
        <Button
          size="sm"
          variant="outline"
          onClick={() => dialogRef.current?.close()}
        >
          Close
        </Button>
      </div>
      <SettingsSurface
        theme={theme}
        onThemeChange={onThemeChange}
        terminalFontSize={terminalFontSize}
        onTerminalFontSizeChange={onTerminalFontSizeChange}
        inspectorVisible={inspectorVisible}
        onInspectorChange={onInspectorChange}
        harnesses={harnesses}
        defaultHarnessId={defaultHarnessId}
        onDefaultHarnessChange={onDefaultHarnessChange}
        harnessDefaults={harnessDefaults}
        onHarnessDefaultChange={onHarnessDefaultChange}
        notifyOnAgentNeedsInput={notifyOnAgentNeedsInput}
        onNotifyChange={onNotifyChange}
        workspacePath={workspacePath}
        initialSection={initialSection}
      />
    </dialog>
  );
}
