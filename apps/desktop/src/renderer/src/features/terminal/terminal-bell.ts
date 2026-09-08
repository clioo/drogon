// MIT Copyright (c) 2026 Lovecast Inc. Ported trigger semantics from
// src/renderer/src/components/terminal-pane/pty-connection/pane-pty-visibility-bind.ts
// (onBell) and src/main/ipc/notification-options.ts (bell copy).
// Adapted: Orca delivers BEL through the main-process notification service
// (unread markers, per-source settings, OS notification with cooldown).
// Drogon exposes no renderer-callable native notify primitive, so the
// debounced signal surfaces as a toast with the fork's copy while the
// terminal is unfocused — the same trigger, an in-app channel. The master
// notifications switch gates it like the fork's `enabled` gate.
import type { IDisposable } from "@xterm/xterm";
import {
  parsePersistedSettings,
  settingsStorageKey,
} from "../../settings-store";

/**
 * Reads the master notifications switch straight from the persisted envelope
 * (default on, matching SETTINGS_DEFAULTS), so the bell source needs no
 * App-level prop thread — same pattern as the GPU/typography readers.
 */
export function readBellNotificationsEnabled(storage: {
  getItem(key: string): string | null;
}): boolean {
  try {
    const parsed = parsePersistedSettings(
      storage.getItem(settingsStorageKey("ui")),
    );
    return parsed.notifyOnAgentNeedsInput ?? true;
  } catch {
    return true;
  }
}

/** Fork copy: `Bell in ${worktreeLabel}` / `${repoLabel} · Attention requested`. */
export function terminalBellToast(input: {
  worktreeLabel?: string | null;
  repoLabel?: string | null;
}): { title: string; body: string } {
  return {
    title: `Bell in ${input.worktreeLabel || "workspace"}`,
    body: input.repoLabel
      ? `${input.repoLabel} · Attention requested`
      : "Attention requested",
  };
}

export type TerminalBellSink = {
  /** Master notifications switch (fork `enabled` gate). */
  notificationsEnabled(): boolean;
  /** Focused terminal needs no attention signal (fork suppressWhenFocused). */
  terminalFocused(): boolean;
  /** Labels for the fork copy, resolved at fire time. */
  labels(): { worktreeLabel?: string | null; repoLabel?: string | null };
  notify(title: string, body: string): void;
};

/**
 * Subscribes to xterm BEL and forwards a debounced attention signal.
 * Trailing-edge cooldown per session: a burst of bells (agent CLIs often
 * ring BEL with their completion output) surfaces once, like the fork's
 * notification cooldown dedupe.
 */
export function installTerminalBell(
  terminal: { onBell(listener: () => void): IDisposable },
  sink: TerminalBellSink,
  options?: { cooldownMs?: number; now?: () => number },
): IDisposable {
  const cooldownMs = options?.cooldownMs ?? 30_000;
  const now = options?.now ?? (() => Date.now());
  let lastNotifiedAt = Number.NEGATIVE_INFINITY;
  return terminal.onBell(() => {
    if (!sink.notificationsEnabled()) return;
    if (sink.terminalFocused()) return;
    const at = now();
    if (at - lastNotifiedAt < cooldownMs) return;
    lastNotifiedAt = at;
    const { title, body } = terminalBellToast(sink.labels());
    sink.notify(title, body);
  });
}
