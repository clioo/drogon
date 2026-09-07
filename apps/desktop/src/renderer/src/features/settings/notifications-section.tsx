import { SettingsSection, SettingsSwitchRow } from "./settings-rows";

export function NotificationsSection({
  notifyOnAgentNeedsInput,
  onNotifyChange,
}: {
  notifyOnAgentNeedsInput: boolean;
  onNotifyChange: (next: boolean) => void;
}): React.JSX.Element {
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
