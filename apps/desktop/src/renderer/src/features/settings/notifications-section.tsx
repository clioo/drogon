// MIT Copyright (c) 2026 Lovecast Inc.
// Ported copy/layout from the Orca reference (read-only):
//   src/renderer/src/components/settings/NotificationsPane.tsx
//   src/renderer/src/components/settings/NotificationSettingToggle.tsx
//     (master, Agent Task Complete, Terminal Bell, and Suppress While
//      Focused rows in source order).
// Adapted: Drogon's flat SettingsStore and additive notifications IPC map
// replace Orca's GlobalSettings/zustand delivery bridge; sound and permission
// controls remain outside this MVP's native delivery contract.
import { useEffect } from "react";
import { Bot, Siren } from "lucide-react";
import { Separator } from "../../components/ui/separator";
import { SettingsSection, SettingsSwitchRow } from "./settings-rows";

function notificationBridge(): {
  setPreferences?: (updates: {
    enabled?: boolean;
    agentTaskComplete?: boolean;
    terminalBell?: boolean;
    suppressWhenFocused?: boolean;
  }) => Promise<unknown>;
} | null {
  try {
    return (
      window as unknown as {
        drogon?: {
          notifications?: {
            setPreferences?: (updates: {
              enabled?: boolean;
              agentTaskComplete?: boolean;
              terminalBell?: boolean;
              suppressWhenFocused?: boolean;
            }) => Promise<unknown>;
          };
        };
      }
    ).drogon?.notifications ?? null;
  } catch {
    return null;
  }
}

function mirrorToNotificationService(preferences: {
  enabled: boolean;
  agentTaskComplete: boolean;
  terminalBell: boolean;
  suppressWhenFocused: boolean;
}): void {
  void (
    notificationBridge()?.setPreferences?.(preferences) ?? Promise.resolve()
  ).catch(() => {
    // The renderer store remains the source of truth if main is restarting.
  });
}

function eventLabel(label: React.JSX.Element, text: string): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-2">
      {label}
      <span>{text}</span>
    </span>
  );
}

export function NotificationsSection({
  notifyOnAgentNeedsInput,
  onNotifyChange,
  notifyOnAgentTaskComplete = true,
  onAgentTaskCompleteChange = () => {},
  notifyOnTerminalBell = false,
  onTerminalBellChange = () => {},
  notifySuppressWhenFocused = true,
  onSuppressWhenFocusedChange = () => {},
}: {
  /** Existing master key; it maps to the fork's `enabled` setting. */
  notifyOnAgentNeedsInput: boolean;
  onNotifyChange: (next: boolean) => void;
  notifyOnAgentTaskComplete?: boolean;
  onAgentTaskCompleteChange?: (next: boolean) => void;
  notifyOnTerminalBell?: boolean;
  onTerminalBellChange?: (next: boolean) => void;
  notifySuppressWhenFocused?: boolean;
  onSuppressWhenFocusedChange?: (next: boolean) => void;
}): React.JSX.Element {
  useEffect(() => {
    mirrorToNotificationService({
      enabled: notifyOnAgentNeedsInput,
      agentTaskComplete: notifyOnAgentTaskComplete,
      terminalBell: notifyOnTerminalBell,
      suppressWhenFocused: notifySuppressWhenFocused,
    });
  }, [
    notifyOnAgentNeedsInput,
    notifyOnAgentTaskComplete,
    notifyOnTerminalBell,
    notifySuppressWhenFocused,
  ]);

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

      <Separator />

      <SettingsSwitchRow
        label={eventLabel(<Bot className="size-4" />, "Agent Task Complete")}
        description="A coding agent finishes and becomes idle."
        checked={notifyOnAgentTaskComplete}
        disabled={!notifyOnAgentNeedsInput}
        ariaLabel="Agent Task Complete"
        onChange={onAgentTaskCompleteChange}
      />

      <SettingsSwitchRow
        label={eventLabel(<Siren className="size-4" />, "Terminal Bell")}
        description="A background terminal emits a bell character."
        checked={notifyOnTerminalBell}
        disabled={!notifyOnAgentNeedsInput}
        ariaLabel="Terminal Bell"
        onChange={onTerminalBellChange}
      />

      <Separator />

      <SettingsSwitchRow
        label="Suppress While Focused"
        description="Skip notifications when the triggering worktree is already visible."
        checked={notifySuppressWhenFocused}
        disabled={!notifyOnAgentNeedsInput}
        onChange={onSuppressWhenFocusedChange}
      />
    </SettingsSection>
  );
}
