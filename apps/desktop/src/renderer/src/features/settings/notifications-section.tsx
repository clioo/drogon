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
      description="When Drogon may interrupt you. Delivery itself is wired separately; this switch is the master control."
    >
      <SettingsSwitchRow
        label="Notify when an agent needs input"
        description="Off means working agents stay silent until you check on them."
        checked={notifyOnAgentNeedsInput}
        onChange={onNotifyChange}
      />
    </SettingsSection>
  );
}
