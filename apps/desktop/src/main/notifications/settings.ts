/* MIT Copyright (c) 2026 Lovecast Inc. */
// File-backed "notify when an agent needs input" toggle. Default on: a
// fresh install notifies, and only an explicit false silences it. Corrupt
// or foreign file content also falls back to on (fail-open toward the
// attention the journey needs, never toward silence). Synchronous JSON so
// the poll loop never awaits settings I/O.
import { readFileSync, writeFileSync } from "node:fs";

export const NOTIFICATIONS_SETTINGS_FILE = "notifications.json";

export class NotificationsSettings {
  /** Null means memory-only (tests); otherwise the JSON file path. */
  readonly #file: string | null;
  #enabled = true;

  constructor(file: string | null) {
    this.#file = file;
    if (file) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          (parsed as { enabled?: unknown }).enabled === false
        )
          this.#enabled = false;
      } catch {
        this.#enabled = true;
      }
    }
  }

  getEnabled(): boolean {
    return this.#enabled;
  }

  /** Persists (best effort) and returns the new value. */
  setEnabled(enabled: boolean): boolean {
    this.#enabled = enabled;
    if (this.#file) {
      try {
        writeFileSync(this.#file, JSON.stringify({ enabled }), "utf8");
      } catch {
        // In-memory state stays authoritative; the next launch re-reads.
      }
    }
    return this.#enabled;
  }
}
