// Port provenance: Lovecast Inc. MIT source at c97906287bb7a390b25e2025b600d9fb3c25d9c3.
// Original: src/preload/renderer-restart-wiring.test.ts (SHA256 1f09c2e6e60a5449ae9d332d9b24b0c331e1f9c01409753d2368e1d357f482fe).

import { describe, expect, it, vi } from 'vitest'
import { ORCA_RENDERER_UNLOAD_PREVENTED_EVENT } from '../../../../../../apps/desktop/src/shared/renderer-shutdown-events'
import {
  ORCA_APP_RESTART_ABORTED_EVENT,
  ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT
} from '../../../../../../apps/desktop/src/shared/updater-renderer-events'
import {
  prepareAndInvokeUpdaterInstall,
  registerRendererRestartIpcRelays
} from '../../../../../../apps/desktop/src/preload/renderer-restart-wiring'

describe('renderer restart wiring', () => {
  it('relays updater status, aborted installs, and prevented unload events', () => {
    const eventTarget = new EventTarget()
    const unloadPrevented = vi.fn()
    const restartAborted = vi.fn()
    const handleStatus = vi.fn()
    const abort = vi.fn()
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const ipcRenderer = {
      on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
        listeners.set(channel, listener)
        return ipcRenderer
      })
    } as unknown as Parameters<typeof registerRendererRestartIpcRelays>[0]
    eventTarget.addEventListener(ORCA_RENDERER_UNLOAD_PREVENTED_EVENT, unloadPrevented)
    eventTarget.addEventListener(ORCA_APP_RESTART_ABORTED_EVENT, restartAborted)

    registerRendererRestartIpcRelays(ipcRenderer, eventTarget, { handleStatus, abort })
    listeners.get('updater:status')?.({}, { state: 'error', message: 'install failed' })
    // Why: main abandons an install without any status when its verdict outlived the cycle.
    listeners.get('updater:quitAndInstallAborted')?.({})
    listeners.get('window:unload-prevented')?.({})

    expect(ipcRenderer.on).toHaveBeenCalledTimes(3)
    expect(handleStatus).toHaveBeenCalledWith({ state: 'error', message: 'install failed' })
    expect(abort).toHaveBeenCalledTimes(1)
    expect(unloadPrevented).toHaveBeenCalledTimes(1)
    expect(restartAborted).toHaveBeenCalledTimes(1)
  })

  it('marks preparation before invoking main and aborts on IPC failure', async () => {
    const eventTarget = new EventTarget()
    const calls: string[] = []
    eventTarget.addEventListener(ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT, () => {
      calls.push('prepared')
    })
    const relay = {
      markPrepared: () => calls.push('marked'),
      abort: () => calls.push('aborted')
    }
    const invoke = vi.fn(async () => {
      calls.push('invoked')
      throw new Error('IPC failed')
    })

    await expect(
      prepareAndInvokeUpdaterInstall(eventTarget, relay, invoke, async () => {
        calls.push('checkpoint-flushed')
      })
    ).rejects.toThrow('IPC failed')

    expect(calls).toEqual(['prepared', 'checkpoint-flushed', 'marked', 'invoked', 'aborted'])
  })

  it('never installs the update when the shutdown checkpoint fails to persist', async () => {
    const eventTarget = new EventTarget()
    const invoke = vi.fn(() => Promise.resolve())
    const relay = { markPrepared: vi.fn(), abort: vi.fn() }

    await expect(
      prepareAndInvokeUpdaterInstall(eventTarget, relay, invoke, () =>
        Promise.reject(new Error('Failed to persist renderer state before unload.'))
      )
    ).rejects.toThrow('Failed to persist renderer state before unload.')

    expect(invoke).not.toHaveBeenCalled()
    expect(relay.markPrepared).not.toHaveBeenCalled()
  })
})
