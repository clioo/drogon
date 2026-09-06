// Source provenance: Lovecast Inc. MIT source c97906287bb7a390b25e2025b600d9fb3c25d9c3,
// src/preload/browser-window-close-installation.ts (SHA256 fdd0ce5f4416d1d9d8e517ae33b7bc6b429479e851ec70c9f87c66c8f2b53720).

export function installBrowserWindowCloseGuard(): void {
  const ignoreWindowClose = (): void => {};
  try {
    Object.defineProperty(window, "close", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: ignoreWindowClose,
    });
  } catch {
    try {
      window.close = ignoreWindowClose;
    } catch {
      // The source contract deliberately makes this a best-effort guard.
    }
  }
}
