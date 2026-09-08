/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/main/ipc/native-notification-delivery.ts (adapter: Orca's HTTP hook
   server and sound selection collapse to polling session.list — this repo
   has no daemon push channel, so the renderer polls as it does now and
   main polls alongside it for transitions; click focuses the session tab
   via ui:focus-session). */
import { nativeNotificationsSuppressed } from "./background-suppression";
import { BrowserWindow, Notification, ipcMain } from "electron";
import path from "node:path";
import {
  notificationsIpcChannels,
  type FocusSessionEvent,
  type SessionStateChangedEvent,
} from "../../shared/notifications-contract";
import { callNative, dataDirectory } from "../native-client";
import { NOTIFICATIONS_SETTINGS_FILE, NotificationsSettings } from "./settings";
import {
  diffAgentStates,
  formatNeedsInput,
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
        if (!transition.entered || !deps.isEnabled()) continue;
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
  if (nativeNotificationsSuppressed(process.env)) return;
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

let settings: NotificationsSettings | null = null;
let stopWatcher: (() => void) | null = null;

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
}

// Same posture as the usage bridge: only our own window's main frame.
function isAppMainFrame(event: Electron.IpcMainInvokeEvent): boolean {
  return BrowserWindow.getAllWindows().some(
    (candidate) =>
      event.sender === candidate.webContents &&
      event.senderFrame === candidate.webContents.mainFrame,
  );
}

/** Registers the toggle IPC and starts the transition poller. Main entry
 * owns the import; this line only loads the module. */
export function registerNotificationsIpc(
  getWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle(notificationsIpcChannels.getEnabled, (event) => {
    if (!isAppMainFrame(event)) return true;
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
  stopWatcher?.();
  stopWatcher = createNeedsInputWatcher({
    getWindow,
    listSessions: listSessionsAndPaths,
    isEnabled: () => getSettings().getEnabled(),
    show: showElectronNotification,
  }).stop;
}
