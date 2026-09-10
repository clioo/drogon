/* MIT Copyright (c) 2026 Lovecast Inc.
 * Source: terminal-shortcut-policy.ts's Shift+Enter branch and the direct
 * modified-Enter release guard in terminal-keyboard-runtime.ts. No global
 * shortcuts or protocol advertisements: only this xterm's input is claimed. */
export function createTerminalShiftEnterHandler(getKittyFlags: () => number, sendInput: (data: string) => void) {
  let claimedCode: string | null = null;
  return (event: KeyboardEvent): boolean => {
    const code = event.code || "Enter";
    if ((event.type === "keyup" || event.type === "keypress") && event.key === "Enter" && code === claimedCode) {
      if (event.type === "keyup") claimedCode = null;
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    if (event.type !== "keydown" || event.key !== "Enter" || !event.shiftKey
      || event.metaKey || event.ctrlKey || event.altKey || event.isComposing || event.keyCode === 229) return false;
    claimedCode = code;
    event.preventDefault();
    event.stopPropagation();
    // Never infer protocol support from the UI platform or the harness name.
    sendInput(getKittyFlags() > 0 ? "\x1b[13;2u" : "\x1b\r");
    return true;
  };
}
