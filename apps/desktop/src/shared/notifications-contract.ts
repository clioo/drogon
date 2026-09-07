/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/main/ipc/native-notification-delivery.ts (adapter: Orca's
   worktree/pane-key navigation and sound selection collapse to focusing the
   session tab; no zustand, no permission probe — Electron shows the OS
   prompt on first use). */
// Native notification contract for journey J1: when an agent session waits
// for the user (`needs_input`), the main process posts one OS notification
// per state transition; clicking it focuses the session tab.
import { z } from "zod";

export const notificationsIpcChannels = {
  getEnabled: "drogon:notificationsEnabled",
  setEnabled: "drogon:notificationsSetEnabled",
  /** Main -> renderer: the clicked notification's session. */
  focusSession: "ui:focus-session",
  /** Main -> renderer: a session entered or left `needs_input` (live badge). */
  stateChanged: "ui:session-state-changed",
} as const;

export const focusSessionSchema = z.object({
  sessionId: z.string().min(1).max(128),
  workspaceId: z.string().min(1).max(128),
});
export type FocusSessionEvent = z.infer<typeof focusSessionSchema>;

export const sessionStateChangedSchema = z.object({
  sessionId: z.string().min(1).max(128),
  workspaceId: z.string().min(1).max(128),
  agentState: z.string().min(1).max(32),
  agentStateAt: z.string().nullable(),
});
export type SessionStateChangedEvent = z.infer<
  typeof sessionStateChangedSchema
>;

export interface NotificationsBridge {
  /** Settings toggle, persisted by main; default on. */
  getEnabled(): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<boolean>;
  onFocusSession(listener: (event: FocusSessionEvent) => void): () => void;
  onStateChanged(
    listener: (event: SessionStateChangedEvent) => void,
  ): () => void;
}

// Optional like the granted `git`/`browser` namespaces (supplied at
// runtime by preload via Object.assign, never constructed in the bridge
// literal), so older preloads without it keep typechecking.
declare module "./session-contract" {
  interface DesktopBridge {
    notifications?: NotificationsBridge;
  }
}
