// Port provenance: Lovecast Inc. MIT source at c97906287bb7a390b25e2025b600d9fb3c25d9c3.
// Original: src/preload/browser-window-close.test.ts (SHA256 845030ace67f72f009ddda1ff89365075c2506c4fd5588d629e233a06dcfc59d).

import { afterEach, describe, expect, it, vi } from 'vitest'

import { installBrowserWindowCloseGuard } from '../../../../../../apps/desktop/src/preload/browser-window-close-installation'

describe('browser window close preload', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('installs a non-replaceable window.close no-op in the page world', () => {
    const nativeClose = vi.fn()
    vi.stubGlobal('window', { close: nativeClose })

    installBrowserWindowCloseGuard()

    expect(window.close()).toBeUndefined()
    expect(window.close).not.toBe(nativeClose)
    expect(Reflect.set(window, 'close', nativeClose)).toBe(false)
  })
})
