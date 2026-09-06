// Persisted-renderer contract port — Lovecast Inc. MIT source
// c97906287bb7a390b25e2025b600d9fb3c25d9c3,
// src/renderer/src/lib/updater-beforeunload.ts
// (SHA256 79b67eb76e596dd79d1373205ffc2333c312cd45614e69cf60f110a98a4c8886).
// Faithful implementation port: every declaration and behavior of the pinned
// module is preserved.

import {
  ORCA_APP_RESTART_ABORTED_EVENT,
  ORCA_APP_RESTART_STARTED_EVENT,
  ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT,
  ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT
} from '../../../shared/updater-renderer-events'
import { ORCA_RENDERER_SHUTDOWN_CHECKPOINT_ABORTED_EVENT } from '../../../shared/renderer-shutdown-events'

let intentionalAppRestartInProgress = false

export function isUpdaterQuitAndInstallInProgress(): boolean {
  return isIntentionalAppRestartInProgress()
}

export function isIntentionalAppRestartInProgress(): boolean {
  return intentionalAppRestartInProgress
}

export function registerUpdaterBeforeUnloadBypass(): () => void {
  const markInProgress = (): void => {
    intentionalAppRestartInProgress = true
  }
  const clearInProgress = (): void => {
    intentionalAppRestartInProgress = false
  }

  window.addEventListener(ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT, markInProgress)
  window.addEventListener(ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT, clearInProgress)
  window.addEventListener(ORCA_APP_RESTART_STARTED_EVENT, markInProgress)
  window.addEventListener(ORCA_APP_RESTART_ABORTED_EVENT, clearInProgress)
  window.addEventListener(ORCA_RENDERER_SHUTDOWN_CHECKPOINT_ABORTED_EVENT, clearInProgress)

  return () => {
    window.removeEventListener(ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT, markInProgress)
    window.removeEventListener(ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT, clearInProgress)
    window.removeEventListener(ORCA_APP_RESTART_STARTED_EVENT, markInProgress)
    window.removeEventListener(ORCA_APP_RESTART_ABORTED_EVENT, clearInProgress)
    window.removeEventListener(ORCA_RENDERER_SHUTDOWN_CHECKPOINT_ABORTED_EVENT, clearInProgress)
    // Why: hot reloads can re-register this listener inside the same renderer.
    // Reset the module flag on cleanup so a failed earlier restart attempt
    // cannot silently suppress future unsaved-change prompts.
    intentionalAppRestartInProgress = false
  }
}
