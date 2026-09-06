// Source provenance: Lovecast Inc. MIT source c97906287bb7a390b25e2025b600d9fb3c25d9c3,
// src/shared/renderer-restart-preparation.ts (SHA256 ccbe3af4bd913cd6699f03693f05f364ce7253ae8b3f27d62b39ba8844be5b24).

import {
  ORCA_EDITOR_PREPARE_HOT_EXIT_EVENT,
  type EditorPrepareHotExitDetail,
} from "./editor-save-events";
import {
  consumeShutdownCheckpointFailureReason,
  ORCA_RENDERER_SHUTDOWN_CHECKPOINT_ABORTED_EVENT,
  ORCA_RENDERER_SHUTDOWN_CHECKPOINT_FAILED_EVENT,
} from "./renderer-shutdown-events";
import type { UpdateStatus } from "./update-status-types";

export type AppRestartPrepOptions = {
  startedEventName: string;
  abortedEventName: string;
  /** Joins the durable write of the state the checkpoint staged; rejects if it failed. */
  awaitCheckpoint: () => Promise<void>;
};

function requestEditorHotExitBackup(eventTarget: EventTarget): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let claimed = false;
    eventTarget.dispatchEvent(
      new CustomEvent<EditorPrepareHotExitDetail>(
        ORCA_EDITOR_PREPARE_HOT_EXIT_EVENT,
        {
          detail: {
            claim: () => {
              claimed = true;
            },
            resolve,
            reject: (message) => {
              reject(new Error(message));
            },
          },
        },
      ),
    );

    // Restart can begin before the editor autosave controller mounts. With no
    // claimant there are no renderer-owned dirty buffers to back up.
    if (!claimed) {
      resolve();
    }
  });
}

export async function prepareRendererForAppRestart(
  eventTarget: EventTarget,
  {
    startedEventName,
    abortedEventName,
    awaitCheckpoint,
  }: AppRestartPrepOptions,
): Promise<void> {
  eventTarget.dispatchEvent(new Event(startedEventName));
  let checkpointFailed = false;

  try {
    await requestEditorHotExitBackup(eventTarget);
    const markCheckpointFailed = (): void => {
      checkpointFailed = true;
    };
    eventTarget.addEventListener(
      ORCA_RENDERER_SHUTDOWN_CHECKPOINT_FAILED_EVENT,
      markCheckpointFailed,
    );
    try {
      // The aggregate unload verdict also includes unrelated listeners.
      eventTarget.dispatchEvent(new Event("beforeunload", { cancelable: true }));
    } finally {
      eventTarget.removeEventListener(
        ORCA_RENDERER_SHUTDOWN_CHECKPOINT_FAILED_EVENT,
        markCheckpointFailed,
      );
    }
    if (checkpointFailed) {
      // The guard publishes the swallowed persist error out of band so the
      // update-error surface can name the actual failure.
      const reason = consumeShutdownCheckpointFailureReason();
      throw new Error(
        reason
          ? `Renderer shutdown checkpoint was not completed: ${reason}`
          : "Renderer shutdown checkpoint was not completed.",
      );
    }
    // The checkpoint only stages synchronously. Navigating before the durable
    // write lands can lose the session snapshot to a crash or power loss.
    await awaitCheckpoint();
  } catch (error) {
    // A checkpoint failure ends this restart without abandoning the
    // retry-then-degrade budget that the next user attempt must consume.
    eventTarget.dispatchEvent(
      new Event(
        checkpointFailed
          ? ORCA_RENDERER_SHUTDOWN_CHECKPOINT_ABORTED_EVENT
          : abortedEventName,
      ),
    );
    throw error;
  }
}

export type UpdaterQuitAbortRelay = {
  markPrepared: () => void;
  abort: () => void;
  handleStatus: (status: UpdateStatus) => void;
};

export function createUpdaterQuitAbortRelay(
  eventTarget: EventTarget,
  abortedEventName: string,
): UpdaterQuitAbortRelay {
  let prepared = false;
  const abort = (): void => {
    if (!prepared) {
      return;
    }
    prepared = false;
    eventTarget.dispatchEvent(new Event(abortedEventName));
  };

  return {
    markPrepared(): void {
      prepared = true;
    },
    abort,
    handleStatus(status): void {
      // quitAndInstall IPC resolves after scheduling; a later updater error is
      // the authoritative signal that the app will remain open.
      if (status.state === "error") {
        abort();
      }
    },
  };
}
