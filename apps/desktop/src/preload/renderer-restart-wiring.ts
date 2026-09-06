// Source provenance: Lovecast Inc. MIT source c97906287bb7a390b25e2025b600d9fb3c25d9c3,
// src/preload/renderer-restart-wiring.ts (SHA256 dc1d269077b4e863076ff7271a5a57738bc8a490f078cbf8ff3b07f5d09636b1).

import type { IpcRenderer } from "electron";
import { ORCA_RENDERER_UNLOAD_PREVENTED_EVENT } from "../shared/renderer-shutdown-events";
import {
  prepareRendererForAppRestart,
  type UpdaterQuitAbortRelay,
} from "../shared/renderer-restart-preparation";
import type { UpdateStatus } from "../shared/update-status-types";
import {
  ORCA_APP_RESTART_ABORTED_EVENT,
  ORCA_APP_RESTART_STARTED_EVENT,
  ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT,
  ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT,
} from "../shared/updater-renderer-events";

export function registerRendererRestartIpcRelays(
  ipcRenderer: Pick<IpcRenderer, "on">,
  eventTarget: EventTarget,
  relay: Pick<UpdaterQuitAbortRelay, "handleStatus" | "abort">,
): void {
  ipcRenderer.on("updater:status", (_event, status: UpdateStatus) => {
    relay.handleStatus(status);
  });
  // Main abandons some installs without an error status, and only this tells
  // the renderer that the quit/install attempt ended.
  ipcRenderer.on("updater:quitAndInstallAborted", () => {
    relay.abort();
  });
  ipcRenderer.on("window:unload-prevented", () => {
    eventTarget.dispatchEvent(
      new Event(ORCA_RENDERER_UNLOAD_PREVENTED_EVENT),
    );
    eventTarget.dispatchEvent(new Event(ORCA_APP_RESTART_ABORTED_EVENT));
  });
}

export async function prepareAndInvokeUpdaterInstall(
  eventTarget: EventTarget,
  relay: Pick<UpdaterQuitAbortRelay, "markPrepared" | "abort">,
  invoke: () => Promise<void>,
  awaitCheckpoint: () => Promise<void>,
): Promise<void> {
  await prepareRendererForAppRestart(eventTarget, {
    startedEventName: ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT,
    abortedEventName: ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT,
    awaitCheckpoint,
  });
  relay.markPrepared();
  try {
    await invoke();
  } catch (error) {
    relay.abort();
    throw error;
  }
}

export async function prepareAndInvokeAppRestart(
  eventTarget: EventTarget,
  invoke: () => Promise<unknown>,
  awaitCheckpoint: () => Promise<void>,
): Promise<void> {
  await prepareRendererForAppRestart(eventTarget, {
    startedEventName: ORCA_APP_RESTART_STARTED_EVENT,
    abortedEventName: ORCA_APP_RESTART_ABORTED_EVENT,
    awaitCheckpoint,
  });
  try {
    await invoke();
  } catch (error) {
    eventTarget.dispatchEvent(new Event(ORCA_APP_RESTART_ABORTED_EVENT));
    throw error;
  }
}
