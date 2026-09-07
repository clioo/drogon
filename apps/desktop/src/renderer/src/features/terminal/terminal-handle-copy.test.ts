// MIT Copyright (c) 2026 Lovecast Inc. Drogon-new companion to the ported
// terminal-handle-copy.ts (the source's terminal.resolvePane RPC has no
// Drogon equivalent; the session id is copied directly).
import { describe, expect, it, vi } from "vitest";
import { copyTerminalHandleForPane } from "./terminal-handle-copy";

describe("copyTerminalHandleForPane", () => {
  it("writes the terminal id to the clipboard and returns it", async () => {
    const writeClipboardText = vi.fn<(text: string) => Promise<void>>();
    writeClipboardText.mockResolvedValue(undefined);

    await expect(
      copyTerminalHandleForPane({
        handle: "sess_abc123",
        writeClipboardText,
      }),
    ).resolves.toBe("sess_abc123");
    expect(writeClipboardText).toHaveBeenCalledWith("sess_abc123");
  });

  it("throws when no terminal id is available", async () => {
    const writeClipboardText = vi.fn<(text: string) => Promise<void>>();
    writeClipboardText.mockResolvedValue(undefined);

    await expect(
      copyTerminalHandleForPane({ handle: "", writeClipboardText }),
    ).rejects.toThrow("Terminal ID unavailable");
    expect(writeClipboardText).not.toHaveBeenCalled();
  });
});
