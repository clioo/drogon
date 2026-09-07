/**
 * Opens the existing command palette (journey J5 owner) in command mode
 * by dispatching the chord its host already listens for globally
 * (CmdOrCtrl+K). Both modifiers are set so the event matches on darwin
 * (meta) and elsewhere (ctrl); the host ignores it while unfocusable.
 */
export function openCommandPalette(): void {
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
}
