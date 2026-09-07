// MIT Copyright (c) 2026 Lovecast Inc. Ported from
// src/renderer/src/components/terminal-pane/terminal-handle-copy.ts.
// Adapted: the source resolves the pane's `term_*` handle through the runtime
// RPC (`terminal.resolvePane`); Drogon sessions already carry their stable id,
// so the helper copies the id it is given. Used by the context menu's
// "Copy Terminal ID" item.

export async function copyTerminalHandleForPane(input: {
  handle: string;
  writeClipboardText: (text: string) => Promise<void>;
}): Promise<string> {
  if (!input.handle) {
    throw new Error("Terminal ID unavailable");
  }
  await input.writeClipboardText(input.handle);
  return input.handle;
}
