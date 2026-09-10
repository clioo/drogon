/** Match the reference terminal's exclusive ownership of Backtab. Drogon
 * keeps xterm's screenReaderMode enabled, which otherwise lets this key's
 * browser focus traversal escape after xterm has emitted ESC [ Z.
 * Call only from xterm's custom handler, then continue its normal encoder. */
export function preventTerminalBacktabNavigation(event: KeyboardEvent): boolean {
  if (event.type !== "keydown" || event.key !== "Tab" || !event.shiftKey
    || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.keyCode === 229) return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}
