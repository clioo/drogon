// MIT Copyright (c) 2026 Lovecast Inc.
// Ported copy/layout from the Orca reference (read-only):
//   src/renderer/src/components/settings/NotificationsPane.tsx
//     (pane title "Notifications", description "Native desktop
//      notifications for agent activity and terminal events.", master
//      "Enable Notifications" row with "Native system notifications for
//      background events.")
// Adapted: only the master switch is wired — it drives the existing
// notifyOnAgentNeedsInput preference (the only notification event Drogon
// emits: the main needs_input poller) and mirrors to the main
// notifications service like before. The fork's per-event rows (Agent Task
// Complete, Terminal Bell), sound combobox, Suppress While Focused, test
// button and macOS delivery alert are omitted: per-event and sound choices
// cannot reach the main delivery process over the fixed boolean
// notifications IPC (shared/notifications-contract.ts, preload owned), and
// there is no bell-event source, sound-playback subsystem or permission
// probe in the MVP — a switch for any of them would be dead.
import { useEffect } from "react";
import { SettingsSection, SettingsSwitchRow } from "./settings-rows";

// The persisted preference lives in the renderer SettingsStore; the desktop
// notification service keeps its own switch, so every change (and the mount
// value) is mirrored to main. Failures are swallowed: the store stays the
// source of truth and the service falls back to its default.
function mirrorToNotificationService(enabled: boolean): void {
  const bridge = (window as { drogon?: { notifications?: { setEnabled?: (v: boolean) => Promise<unknown> } } }).drogon?.notifications;
  void bridge?.setEnabled?.(enabled)?.catch(() => {});
}

export function NotificationsSection({
  notifyOnAgentNeedsInput,
  onNotifyChange,
}: {
  notifyOnAgentNeedsInput: boolean;
  onNotifyChange: (next: boolean) => void;
}): React.JSX.Element {
  useEffect(() => {
    mirrorToNotificationService(notifyOnAgentNeedsInput);
  }, [notifyOnAgentNeedsInput]);
  return (
    <SettingsSection
      id="notifications"
      title="Notifications"
      description="Native desktop notifications for agent activity and terminal events."
    >
      <SettingsSwitchRow
        label="Enable Notifications"
        description="Native system notifications for background events."
        checked={notifyOnAgentNeedsInput}
        onChange={onNotifyChange}
      />
    </SettingsSection>
  );
}
