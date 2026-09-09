/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/main/ipc/native-notification-delivery.ts and
   src/main/ipc/notification-options.ts (adapter: worktree/pane-key
   navigation collapses to focusing the session tab; sound selection and
   permission probes stay outside this MVP). */
// Native notification contract for journey J1: the main process posts one OS
// notification per admitted event transition (agent completion or terminal
// BEL; needs_input remains the reconciliation path); clicking it focuses the
// session tab.
import { z } from "zod";

export const notificationsIpcChannels = {
  /** Legacy master switch channels retained for additive compatibility. */
  getEnabled: "drogon:notificationsEnabled",
  setEnabled: "drogon:notificationsSetEnabled",
  /** Full fork-shaped preference map. */
  getPreferences: "drogon:notificationsPreferences",
  setPreferences: "drogon:notificationsSetPreferences",
  /** Renderer -> main: an xterm BEL from a terminal session. */
  bell: "drogon:notificationsBell",
  /** Main -> renderer: the clicked notification's session. */
  focusSession: "ui:focus-session",
  /** Main -> renderer: a session entered or left `needs_input` (live badge). */
  stateChanged: "ui:session-state-changed",
} as const;

export const notificationPreferencesSchema = z.object({
  enabled: z.boolean(),
  agentTaskComplete: z.boolean(),
  terminalBell: z.boolean(),
  suppressWhenFocused: z.boolean(),
});
export type NotificationPreferences = z.infer<
  typeof notificationPreferencesSchema
>;

export const notificationPreferencesPatchSchema =
  notificationPreferencesSchema.partial();

export const notificationBellSchema = z.object({
  sessionId: z.string().min(1).max(128),
  workspaceId: z.string().min(1).max(128),
});
export type NotificationBellEvent = z.infer<typeof notificationBellSchema>;

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
  agentPromptPreview: z.string().max(2048).nullable().optional(),
  cacheIdleAt: z.string().nullable().optional(),
});
export type SessionStateChangedEvent = z.infer<
  typeof sessionStateChangedSchema
>;

export interface NotificationsBridge {
  /** Legacy master switch, persisted by main; default on. */
  getEnabled(): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<boolean>;
  /** Fork-shaped event preferences; `enabled` remains the master switch. */
  getPreferences(): Promise<NotificationPreferences>;
  setPreferences(
    updates: Partial<NotificationPreferences>,
  ): Promise<NotificationPreferences>;
  /** Sends a BEL event to the main-process native notification service. */
  notifyBell(event: NotificationBellEvent): Promise<boolean>;
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
