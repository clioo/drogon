// MIT Copyright (c) 2026 Lovecast Inc. Ported trigger semantics from
// src/renderer/src/components/terminal-pane/pty-connection/pane-pty-visibility-bind.ts
// (onBell) and src/main/ipc/notification-options.ts (bell copy).
// Adapted: Orca delivers BEL through the main-process notification service
// (unread markers, per-source settings, OS notification with cooldown).
// Drogon forwards the debounced xterm signal over the additive notifications
// IPC channel; main owns native delivery, preference gating and click focus.
import type { IDisposable } from "@xterm/xterm";
import {
  parsePersistedSettings,
  settingsStorageKey,
} from "../../settings-store";

/** Reads the master and Terminal Bell event switch from the persisted
 * envelope, so the source needs no App-level prop thread. The fork defaults
 * the bell row off while keeping its master on. */
export function readBellNotificationsEnabled(storage: {
  getItem(key: string): string | null;
}): boolean {
  try {
    const parsed = parsePersistedSettings(
      storage.getItem(settingsStorageKey("ui")),
    );
    return (
      (parsed.notifyOnAgentNeedsInput ?? true) &&
      (parsed.notifyOnTerminalBell ?? false)
    );
  } catch {
    return false;
  }
}

export function readBellSuppressWhenFocused(storage: {
  getItem(key: string): string | null;
}): boolean {
  try {
    return (
      parsePersistedSettings(storage.getItem(settingsStorageKey("ui")))
        .notifySuppressWhenFocused ?? true
    );
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
  /** Optional per-event override; omitted keeps the fork's default. */
  suppressWhenFocused?: () => boolean;
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
    if ((sink.suppressWhenFocused?.() ?? true) && sink.terminalFocused()) return;
    const at = now();
    if (at - lastNotifiedAt < cooldownMs) return;
    lastNotifiedAt = at;
    const { title, body } = terminalBellToast(sink.labels());
    sink.notify(title, body);
  });
}
