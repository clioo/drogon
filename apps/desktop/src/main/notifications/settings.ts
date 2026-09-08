/* MIT Copyright (c) 2026 Lovecast Inc. */
// File-backed "notify when an agent needs input" toggle. Default on: a
// fresh install notifies, and only an explicit false silences it. Corrupt
// or foreign file content also falls back to on (fail-open toward the
// attention the journey needs, never toward silence). Synchronous JSON so
// the poll loop never awaits settings I/O.
import { readFileSync, writeFileSync } from "node:fs";

export const NOTIFICATIONS_SETTINGS_FILE = "notifications.json";

/** The fork's notification preference map. `enabled` remains the master
 * switch; the event keys are additive so older `{ enabled }` files retain
 * their behavior while new installs get the fork defaults. */
export type NotificationPreferences = {
  enabled: boolean;
  agentTaskComplete: boolean;
  terminalBell: boolean;
  suppressWhenFocused: boolean;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enabled: true,
  agentTaskComplete: true,
  terminalBell: false,
  suppressWhenFocused: true,
};

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export class NotificationsSettings {
  /** Null means memory-only (tests); otherwise the JSON file path. */
  readonly #file: string | null;
  #preferences: NotificationPreferences = { ...DEFAULT_NOTIFICATION_PREFERENCES };

  constructor(file: string | null) {
    this.#file = file;
    if (file) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
        if (typeof parsed !== "object" || parsed === null) return;
        const candidate = parsed as Record<string, unknown>;
        for (const key of Object.keys(DEFAULT_NOTIFICATION_PREFERENCES) as Array<
          keyof NotificationPreferences
        >) {
          if (isBoolean(candidate[key])) this.#preferences[key] = candidate[key];
        }
      } catch {
        this.#preferences = { ...DEFAULT_NOTIFICATION_PREFERENCES };
      }
    }
  }

  getPreferences(): NotificationPreferences {
    return { ...this.#preferences };
  }

  getEnabled(): boolean {
    return this.#preferences.enabled;
  }

  getEventEnabled(event: "agentTaskComplete" | "terminalBell"): boolean {
    return this.#preferences[event];
  }

  /** Persists (best effort) and returns the new master value. */
  setEnabled(enabled: boolean): boolean {
    this.#preferences.enabled = enabled;
    this.#persist();
    return this.#preferences.enabled;
  }

  /** Updates the event map, preserving omitted keys for additive IPC calls. */
  setPreferences(
    updates: Partial<NotificationPreferences>,
  ): NotificationPreferences {
    for (const key of Object.keys(DEFAULT_NOTIFICATION_PREFERENCES) as Array<
      keyof NotificationPreferences
    >) {
      if (isBoolean(updates[key])) this.#preferences[key] = updates[key] as boolean;
    }
    this.#persist();
    return this.getPreferences();
  }

  #persist(): void {
    if (!this.#file) return;
    try {
      writeFileSync(this.#file, JSON.stringify(this.#preferences), "utf8");
    } catch {
      // In-memory state stays authoritative; the next launch re-reads.
    }
  }
}
