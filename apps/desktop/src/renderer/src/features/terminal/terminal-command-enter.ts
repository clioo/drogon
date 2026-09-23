// MIT Copyright (c) 2026 Lovecast Inc.
// Terminal-local Command+Enter submit shim: xterm 6 emits a plain CR for
// Meta+Enter on macOS but leaves the DOM event unclaimed. Claiming the whole
// key transaction keeps one gesture as one PTY byte and prevents a later
// keypress/window shortcut path from re-interpreting the same Return.

export function createTerminalCommandEnterHandler(
  isMac: boolean,
  sendInput: (data: string) => void,
) {
  let claimedCode: string | null = null;
  return (event: KeyboardEvent): boolean => {
    const code = event.code || "Enter";
    if (
      (event.type === "keyup" || event.type === "keypress") &&
      event.key === "Enter" &&
      code === claimedCode
    ) {
      if (event.type === "keyup") claimedCode = null;
      event.preventDefault();
      event.stopPropagation();
      return true;
    }

    if (
      !isMac ||
      event.type !== "keydown" ||
      event.key !== "Enter" ||
      !event.metaKey ||
      event.shiftKey ||
      event.ctrlKey ||
      event.altKey ||
      event.isComposing ||
      event.keyCode === 229
    ) {
      return false;
    }

    claimedCode = code;
    event.preventDefault();
    event.stopPropagation();
    sendInput("\r");
    return true;
  };
}
