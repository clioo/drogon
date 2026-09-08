/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/main/ipc/native-notification-delivery.ts and
   src/main/ipc/notification-options.ts (adapter: sound/permission UI stays
   outside this MVP; BF2's session-state push feeds Agent Task Complete and
   xterm BEL reaches main over the additive IPC channel; click focuses the
   session tab via ui:focus-session). */
import { nativeNotificationsSuppressed } from "./background-suppression";
import { BrowserWindow, Notification, ipcMain } from "electron";
import path from "node:path";
import {
  notificationBellSchema,
  notificationPreferencesPatchSchema,
  notificationsIpcChannels,
  type FocusSessionEvent,
  type SessionStateChangedEvent,
} from "../../shared/notifications-contract";
import { callNative, dataDirectory } from "../native-client";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATIONS_SETTINGS_FILE,
  NotificationsSettings,
} from "./settings";
import {
  diffAgentStates,
  formatAgentTaskComplete,
  formatNeedsInput,
  isAgentTaskCompleteTransition,
  type WatchedSession,
} from "./watcher";

export const NEEDS_INPUT_POLL_INTERVAL_MS = 2_000;

export type NeedsInputWatcherDeps = {
  getWindow: () => BrowserWindow | null;
  listSessions: () => Promise<{
    sessions: WatchedSession[];
    workspaceNames: Map<string, string>;
  }>;
  isEnabled: () => boolean;
  /** Fork suppressWhenFocused: do not interrupt an already focused app. */
  suppressWhenFocused?: () => boolean;
  show: (title: string, body: string, onClick: () => void) => void;
  pollIntervalMs?: number;
  log?: (message: string) => void;
};

function asWatchedSessions(value: unknown): WatchedSession[] {
  if (typeof value !== "object" || value === null) return [];
  const sessions = (value as { sessions?: unknown }).sessions;
  if (!Array.isArray(sessions)) return [];
  const out: WatchedSession[] = [];
  for (const item of sessions) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.workspaceId !== "string") continue;
    if (typeof row.command !== "string") continue;
    out.push({
      id: row.id,
      workspaceId: row.workspaceId,
      command: row.command,
      harnessId:
        typeof row.harnessId === "string" || row.harnessId === null
          ? row.harnessId
          : undefined,
      agentState: typeof row.agentState === "string" ? row.agentState : undefined,
      agentStateAt: typeof row.agentStateAt === "string" ? row.agentStateAt : null,
    });
  }
  return out;
}

/**
 * Workspace display names for the notification title (the fork's
 * `formatNotificationWorktreeContext` adapted: the registered workspace name
 * when known, else the last path segment, so a renamed workspace still reads
 * as the user named it).
 */
function asWorkspaceNames(value: unknown): Map<string, string> {
  const names = new Map<string, string>();
  if (typeof value !== "object" || value === null) return names;
  const workspaces = (value as { workspaces?: unknown }).workspaces;
  if (!Array.isArray(workspaces)) return names;
  for (const item of workspaces) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string") continue;
    if (typeof row.name === "string" && row.name) {
      names.set(row.id, row.name);
      continue;
    }
    if (typeof row.path === "string") {
      const base = row.path.split(/[\\/]/).filter(Boolean).at(-1);
      if (base) names.set(row.id, base);
    }
  }
  return names;
}

async function listSessionsAndPaths(): Promise<{
  sessions: WatchedSession[];
  workspaceNames: Map<string, string>;
}> {
  const [sessionsResult, workspacesResult] = await Promise.all([
    callNative("session.list", {}),
    callNative("workspace.list", {}),
  ]);
  return {
    sessions: sessionsResult.ok
      ? asWatchedSessions(sessionsResult.result)
      : [],
    workspaceNames: workspacesResult.ok
      ? asWorkspaceNames(workspacesResult.result)
      : new Map(),
  };
}

/** Polls `session.list`, notifies once per entry into `needs_input`, and
 * forwards every transition to the renderer for the live badge. */
export function createNeedsInputWatcher(deps: NeedsInputWatcherDeps): {
  tick: () => Promise<void>;
  stop: () => void;
} {
  const log = deps.log ?? ((message: string) => console.log(message));
  let states = new Map<string, string>();
  // #272: false until the first poll has seeded the baseline, so the boot
  // snapshot never floods the renderer with first-sighting events.
  let primed = false;
  let inFlight = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function tick(): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    try {
      const { sessions, workspaceNames } = await deps.listSessions();
      const previousStates = states;
      const { next, transitions } = diffAgentStates(states, sessions, {
        emitFirstSightings: primed,
      });
      states = next;
      primed = true;
      for (const transition of transitions) {
        const window = deps.getWindow();
        const agentState =
          next.get(transition.session.id) ?? "unknown";
        if (window && !window.isDestroyed()) {
          const stateEvent: SessionStateChangedEvent = {
            sessionId: transition.session.id,
            workspaceId: transition.session.workspaceId,
            agentState,
            agentStateAt:
              sessions.find((item) => item.id === transition.session.id)
                ?.agentStateAt ?? null,
          };
          window.webContents.send(
            notificationsIpcChannels.stateChanged,
            stateEvent,
          );
        }
        // The push stream owns working → needs_input completion banners. The
        // polling fallback still forwards the state to the renderer, but must
        // not double-deliver that same event when it catches up a few ms later.
        if (
          !transition.entered ||
          previousStates.get(transition.session.id) === "working" ||
          !deps.isEnabled() ||
          (deps.suppressWhenFocused?.() ?? false)
        )
          continue;
        const { title, body } = formatNeedsInput(
          transition.session,
          workspaceNames.get(transition.session.workspaceId) ?? null,
        );
        const focus: FocusSessionEvent = {
          sessionId: transition.session.id,
          workspaceId: transition.session.workspaceId,
        };
        deps.show(title, body, () => {
          const target = deps.getWindow();
          if (!target || target.isDestroyed()) return;
          if (target.isMinimized()) target.restore();
          target.show();
          target.focus();
          target.webContents.send(
            notificationsIpcChannels.focusSession,
            focus,
          );
        });
        log(`[drogon] needs_input notification shown: ${title} — ${body}`);
      }
    } catch {
      // A failed poll keeps the previous states: the next tick diffs
      // against them, so no transition is lost or double-reported.
    } finally {
      inFlight = false;
    }
  }

  timer = setInterval(
    () => void tick(),
    deps.pollIntervalMs ?? NEEDS_INPUT_POLL_INTERVAL_MS,
  );
  // An interval alone must never keep the app alive past its windows.
  timer.unref?.();
  return {
    tick,
    stop: () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}

// Electron `Notification` handles must be retained while visible, or GC
// collects the click handler mid-flight (Orca's delivery module does the
// same). Entries leave on click or close.
const liveNotifications = new Set<Notification>();

function showElectronNotification(
  title: string,
  body: string,
  onClick: () => void,
): void {
  // Test instances (background window) keep the delivery log line but never
  // put a native banner on the user's screen.
  if (nativeNotificationsSuppressed(process.env)) {
    console.log(`[background] suppressed native notification: ${title} — ${body}`);
    return;
  }
  const notification = new Notification({
    title,
    body,
    ...(process.platform === "darwin" ? { sound: "default" as const } : {}),
  });
  liveNotifications.add(notification);
  notification.on("click", () => {
    liveNotifications.delete(notification);
    onClick();
  });
  notification.on("close", () => liveNotifications.delete(notification));
  notification.show();
}

export type AgentTaskCompletionEvent = SessionStateChangedEvent & {
  /** Optional enrichment used by direct/unit-test consumers. */
  command?: string;
  harnessId?: string | null;
};

export type AgentTaskCompletionObserverDeps = {
  getWindow: () => BrowserWindow | null;
  isEnabled: () => boolean;
  suppressWhenFocused?: () => boolean;
  resolveContext?: (
    event: AgentTaskCompletionEvent,
  ) => Promise<{ session: WatchedSession; workspaceName: string | null }>;
  show: (title: string, body: string, onClick: () => void) => void;
  log?: (message: string) => void;
};

/**
 * Consumes the same BF2 session-state stream used by the renderer. A first
 * sighting is only a baseline; the fork's completion rule is specifically a
 * working → idle/needs_input transition. Keeping this observer separate from
 * the 2 s needs_input reconciliation means the native event is instant while
 * the old poll remains a recovery path for badges.
 */
export function createAgentTaskCompletionObserver(
  deps: AgentTaskCompletionObserverDeps,
): { observe: (event: AgentTaskCompletionEvent) => void; reset: () => void } {
  const states = new Map<string, string>();
  const log = deps.log ?? ((message: string) => console.log(message));
  const resolveContext =
    deps.resolveContext ??
    (async (event: AgentTaskCompletionEvent) => ({
      session: {
        id: event.sessionId,
        workspaceId: event.workspaceId,
        command: event.command ?? "",
        harnessId: event.harnessId,
        agentState: event.agentState,
        agentStateAt: event.agentStateAt,
      },
      workspaceName: null,
    }));

  const observe = (event: AgentTaskCompletionEvent): void => {
    const previous = states.get(event.sessionId);
    states.set(event.sessionId, event.agentState);
    if (!isAgentTaskCompleteTransition(previous, event.agentState)) return;
    if (!deps.isEnabled() || (deps.suppressWhenFocused?.() ?? false)) return;
    void resolveContext(event)
      .then(({ session, workspaceName }) => {
        // Settings/focus can change while session.list resolves.
        if (!deps.isEnabled() || (deps.suppressWhenFocused?.() ?? false)) return;
        const { title, body } = formatAgentTaskComplete(
          { ...session, agentState: event.agentState },
          workspaceName,
        );
        const focus: FocusSessionEvent = {
          sessionId: event.sessionId,
          workspaceId: event.workspaceId,
        };
        deps.show(title, body, () => {
          const target = deps.getWindow();
          if (!target || target.isDestroyed()) return;
          if (target.isMinimized()) target.restore();
          target.show();
          target.focus();
          target.webContents.send(
            notificationsIpcChannels.focusSession,
            focus,
          );
        });
        log(`[drogon] agent_task_complete notification shown: ${title} — ${body}`);
      })
      .catch(() => {
        // A missing session during daemon reconnect cannot prove completion
        // false; the state transition remains consumed and the next one can
        // notify normally.
      });
  };

  return {
    observe,
    reset: () => states.clear(),
  };
}

let settings: NotificationsSettings | null = null;
let stopWatcher: (() => void) | null = null;
let agentTaskCompletionObserver: ReturnType<
  typeof createAgentTaskCompletionObserver
> | null = null;

function focusedWindow(getWindow: () => BrowserWindow | null): boolean {
  const target = getWindow();
  if (!target || target.isDestroyed()) return false;
  return typeof target.isFocused === "function" && target.isFocused();
}

function focusSession(
  getWindow: () => BrowserWindow | null,
  focus: FocusSessionEvent,
): void {
  const target = getWindow();
  if (!target || target.isDestroyed()) return;
  if (target.isMinimized()) target.restore();
  target.show();
  target.focus();
  target.webContents.send(notificationsIpcChannels.focusSession, focus);
}

function getSettings(): NotificationsSettings {
  if (!settings) {
    let file: string | null = null;
    try {
      file = path.join(dataDirectory(), NOTIFICATIONS_SETTINGS_FILE);
    } catch {
      file = null;
    }
    settings = new NotificationsSettings(file);
  }
  return settings;
}

/** Test seam: swap the singleton settings and stop the poller. */
export function setNotificationsSettingsForTests(
  next: NotificationsSettings | null,
): void {
  settings = next;
}

export function stopNotificationsWatcherForTests(): void {
  stopWatcher?.();
  stopWatcher = null;
  agentTaskCompletionObserver?.reset();
  agentTaskCompletionObserver = null;
}

/** BF2 session-state consumer; main/session-state-bridge calls this for every
 * deduped push event. Kept as a function seam so the bridge has no import of
 * Electron delivery details beyond this additive consumer. */
export function observeAgentStateForNotification(
  event: AgentTaskCompletionEvent,
): void {
  agentTaskCompletionObserver?.observe(event);
}

// Same posture as the usage bridge: only our own window's main frame.
function isAppMainFrame(event: Electron.IpcMainInvokeEvent): boolean {
  return BrowserWindow.getAllWindows().some(
    (candidate) =>
      event.sender === candidate.webContents &&
      event.senderFrame === candidate.webContents.mainFrame,
  );
}

export type TerminalBellNotificationDeps = {
  getPreferences: () => ReturnType<NotificationsSettings["getPreferences"]>;
  isFocused: () => boolean;
  resolveWorkspaceName: (
    workspaceId: string,
  ) => Promise<string | null>;
  show: (title: string, body: string, onClick: () => void) => void;
  onClick: (event: { sessionId: string; workspaceId: string }) => void;
};

/** Pure bell-event admission used by the IPC handler and unit tests. */
export function createTerminalBellNotificationHandler(
  deps: TerminalBellNotificationDeps,
): (input: unknown) => Promise<boolean> {
  return async (input: unknown): Promise<boolean> => {
    const parsed = notificationBellSchema.safeParse(input);
    if (!parsed.success) return false;
    const preferences = deps.getPreferences();
    if (!preferences.enabled || !preferences.terminalBell) return false;
    if (preferences.suppressWhenFocused && deps.isFocused()) return false;
    const focus = parsed.data;
    const workspaceName = (await deps.resolveWorkspaceName(focus.workspaceId)) ??
      "workspace";
    deps.show(
      `Bell in ${workspaceName}`,
      "Attention requested",
      () => deps.onClick(focus),
    );
    return true;
  };
}

/** Registers the toggle/event IPC and starts the transition poller. Main
 * entry owns the import; this line only loads the module. */
export function registerNotificationsIpc(
  getWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle(notificationsIpcChannels.getEnabled, (event) => {
    if (!isAppMainFrame(event)) return DEFAULT_NOTIFICATION_PREFERENCES.enabled;
    return getSettings().getEnabled();
  });
  ipcMain.handle(
    notificationsIpcChannels.setEnabled,
    (event, input: unknown) => {
      if (!isAppMainFrame(event)) return getSettings().getEnabled();
      if (typeof input !== "boolean") return getSettings().getEnabled();
      return getSettings().setEnabled(input);
    },
  );
  ipcMain.handle(notificationsIpcChannels.getPreferences, (event) => {
    if (!isAppMainFrame(event)) return { ...DEFAULT_NOTIFICATION_PREFERENCES };
    return getSettings().getPreferences();
  });
  ipcMain.handle(
    notificationsIpcChannels.setPreferences,
    (event, input: unknown) => {
      if (!isAppMainFrame(event)) return getSettings().getPreferences();
      const parsed = notificationPreferencesPatchSchema.safeParse(input);
      if (!parsed.success) return getSettings().getPreferences();
      return getSettings().setPreferences(parsed.data);
    },
  );
  const handleBell = createTerminalBellNotificationHandler({
    getPreferences: () => getSettings().getPreferences(),
    isFocused: () => focusedWindow(getWindow),
    resolveWorkspaceName: async (workspaceId) => {
      const { workspaceNames } = await listSessionsAndPaths();
      return workspaceNames.get(workspaceId) ?? null;
    },
    show: showElectronNotification,
    onClick: (focus) => focusSession(getWindow, focus),
  });
  ipcMain.handle(notificationsIpcChannels.bell, (event, input: unknown) => {
    if (!isAppMainFrame(event)) return false;
    return handleBell(input).catch(() => false);
  });
  stopWatcher?.();
  agentTaskCompletionObserver?.reset();
  agentTaskCompletionObserver = createAgentTaskCompletionObserver({
    getWindow,
    isEnabled: () => {
      const preferences = getSettings().getPreferences();
      return preferences.enabled && preferences.agentTaskComplete;
    },
    suppressWhenFocused: () => {
      const preferences = getSettings().getPreferences();
      return preferences.suppressWhenFocused && focusedWindow(getWindow);
    },
    resolveContext: async (event) => {
      const { sessions, workspaceNames } = await listSessionsAndPaths();
      const found = sessions.find((session) => session.id === event.sessionId);
      return {
        session:
          found ?? {
            id: event.sessionId,
            workspaceId: event.workspaceId,
            command: event.command ?? "",
            harnessId: event.harnessId,
            agentState: event.agentState,
            agentStateAt: event.agentStateAt,
          },
        workspaceName: workspaceNames.get(event.workspaceId) ?? null,
      };
    },
    show: showElectronNotification,
  });
  stopWatcher = createNeedsInputWatcher({
    getWindow,
    listSessions: listSessionsAndPaths,
    isEnabled: () => {
      const preferences = getSettings().getPreferences();
      return preferences.enabled && preferences.agentTaskComplete;
    },
    suppressWhenFocused: () => {
      const preferences = getSettings().getPreferences();
      return preferences.suppressWhenFocused && focusedWindow(getWindow);
    },
    show: showElectronNotification,
  }).stop;
}
