// @vitest-environment jsdom
// Regression coverage for the image half of the terminal paste path (P2):
// "en las sesiones de claude code y seguramente en otras tampoco no puedo
// pegar imágenes".
//
// Reading clipboard TEXT off an image-only clipboard yields an empty string,
// so the old pipeline treated a screenshot exactly like an empty clipboard
// and dropped it without a word. The harness's own clipboard-image reader is
// what consumes the pixels, and it listens on the Ctrl+V keystroke (Claude
// Code: "Image in clipboard · ctrl+v to paste"), so the paste must hand that
// keystroke to the session.
import { describe, expect, it, vi } from "vitest";

import {
  pasteTerminalClipboard,
  isClipboardTextTooLargeError,
} from "./terminal-clipboard-paste";
import {
  IMAGE_PASTE_KEYSTROKE,
  createTerminalPanePaste,
  registerTerminalPanePasteListeners,
} from "./terminal-pane-paste";

describe("pasteTerminalClipboard image branch", () => {
  it("pastes text when the clipboard has text, never touching the image path", async () => {
    const readClipboardHasImage = vi.fn(async () => true);
    const onImageClipboard = vi.fn();
    const pasteText = vi.fn(async () => undefined);
    const result = await pasteTerminalClipboard({
      readClipboardText: async () => "hello",
      readClipboardHasImage,
      onImageClipboard,
      pasteText,
    });
    expect(result).toEqual({ status: "pasted", kind: "text" });
    expect(pasteText).toHaveBeenCalledWith("hello");
    expect(readClipboardHasImage).not.toHaveBeenCalled();
    expect(onImageClipboard).not.toHaveBeenCalled();
  });

  it("hands an image-only clipboard to the harness instead of dropping it", async () => {
    const onImageClipboard = vi.fn();
    const result = await pasteTerminalClipboard({
      readClipboardText: async () => "",
      readClipboardHasImage: async () => true,
      onImageClipboard,
      pasteText: vi.fn(),
    });
    expect(result).toEqual({ status: "pasted", kind: "image-keystroke" });
    expect(onImageClipboard).toHaveBeenCalledTimes(1);
  });

  it("reports image-unavailable when this window cannot read clipboard images", async () => {
    const onImageClipboard = vi.fn();
    const result = await pasteTerminalClipboard({
      readClipboardText: async () => "",
      onImageClipboard,
      pasteText: vi.fn(),
    });
    expect(result).toEqual({ status: "skipped", reason: "image-unavailable" });
    expect(onImageClipboard).not.toHaveBeenCalled();
  });

  it("stays 'empty' for a genuinely empty clipboard", async () => {
    const result = await pasteTerminalClipboard({
      readClipboardText: async () => "",
      readClipboardHasImage: async () => false,
      onImageClipboard: vi.fn(),
      pasteText: vi.fn(),
    });
    expect(result).toEqual({ status: "skipped", reason: "empty" });
  });

  it("never invents an image when the clipboard read throws", async () => {
    const result = await pasteTerminalClipboard({
      readClipboardText: async () => "",
      readClipboardHasImage: async () => {
        throw new Error("denied");
      },
      onImageClipboard: vi.fn(),
      pasteText: vi.fn(),
    });
    expect(result).toEqual({ status: "skipped", reason: "image-unavailable" });
  });

  it("falls through to the image branch when reading TEXT off an image clipboard fails", async () => {
    // Chromium rejects `readText()` for an image-only clipboard; aborting on
    // that rejection is exactly how a screenshot got dropped silently.
    const onImageClipboard = vi.fn();
    const result = await pasteTerminalClipboard({
      readClipboardText: async () => {
        throw new Error("Clipboard read failed");
      },
      readClipboardHasImage: async () => true,
      onImageClipboard,
      pasteText: vi.fn(),
    });
    expect(result).toEqual({ status: "pasted", kind: "image-keystroke" });
    expect(onImageClipboard).toHaveBeenCalledTimes(1);
  });

  it("still enforces the text-size guard first", async () => {
    const onTextPasteError = vi.fn();
    const tooLarge = { name: "clipboard-text-too-large" as const };
    const result = await pasteTerminalClipboard({
      readClipboardText: async () => {
        throw tooLarge;
      },
      readClipboardHasImage: async () => true,
      onImageClipboard: vi.fn(),
      pasteText: vi.fn(),
      onTextPasteError,
    });
    expect(result).toEqual({ status: "skipped", reason: "text-too-large" });
    expect(onTextPasteError).toHaveBeenCalledWith(tooLarge);
    expect(isClipboardTextTooLargeError(tooLarge)).toBe(true);
  });
});

describe("TerminalPane image paste delivery", () => {
  function pane(writePty: (data: string) => Promise<boolean>) {
    const report = vi.fn();
    const paste = createTerminalPanePaste({
      writePty,
      isTargetCurrent: () => true,
      sessionIdentity: { sessionId: "s1", incarnation: "i1" },
      report,
    });
    // A minimal xterm stand-in: the text path never runs in these cases.
    paste.bindTerminal({
      modes: { bracketedPasteMode: false },
      options: { ignoreBracketedPasteMode: false },
      input: vi.fn(),
      paste: vi.fn(),
    });
    return { paste, report };
  }

  it("writes the Ctrl+V byte to the PTY for an image-only clipboard", async () => {
    const writes: string[] = [];
    const { paste, report } = pane(async (data) => {
      writes.push(data);
      return true;
    });
    paste.pasteFromClipboard(
      "keyboard",
      async () => "",
      async () => true,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writes).toEqual([IMAGE_PASTE_KEYSTROKE]);
    expect(IMAGE_PASTE_KEYSTROKE).toBe("\u0016");
    expect(report).not.toHaveBeenCalled();
  });

  it("reports honestly when the session refuses the keystroke", async () => {
    const { paste, report } = pane(async () => false);
    paste.pasteFromClipboard(
      "keyboard",
      async () => "",
      async () => true,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(report).toHaveBeenCalledWith(
      expect.stringContaining("not accepting input"),
    );
  });

  it("reports image-unavailable when the window cannot inspect clipboard images", async () => {
    const { paste, report } = pane(async () => true);
    paste.pasteFromClipboard(
      "keyboard",
      async () => "",
      async () => {
        throw new Error("denied");
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(report).toHaveBeenCalledWith(
      expect.stringContaining("cannot read clipboard images"),
    );
  });
});

describe("native Edit > Paste reaches the focused terminal", () => {
  function mount(onImageClipboard: () => void) {
    const container = document.createElement("div");
    document.body.append(container);
    const listeners: Array<() => void> = [];
    const paste = {
      pasteFromClipboard: vi.fn(),
    } as unknown as ReturnType<typeof createTerminalPanePaste>;
    const dispose = registerTerminalPanePasteListeners({
      container,
      paste,
      isMac: true,
      subscribeAppMenuPaste: (listener) => {
        listeners.push(listener);
        return () => {
          const index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
        };
      },
    });
    void onImageClipboard;
    return { container, listeners, paste, dispose };
  }

  it("routes the app-menu Paste command to the terminal's own pipeline", () => {
    // macOS consumes Cmd+V in the Electron menu and forwards
    // `ui:appMenuPaste`; the terminal must claim it or the standard paste
    // chord does nothing here (the owner's "no puedo pegar imágenes").
    const { container, listeners, paste, dispose } = mount(() => {});
    const textarea = document.createElement("textarea");
    textarea.className = "xterm-helper-textarea";
    container.append(textarea);
    textarea.focus();
    listeners[0]();
    expect(paste.pasteFromClipboard).toHaveBeenCalledWith("app-menu");
    dispose();
    expect(listeners).toHaveLength(0);
  });

  it("leaves an app-menu paste alone when another pane owns focus", () => {
    const { container, listeners, paste, dispose } = mount(() => {});
    const outside = document.createElement("textarea");
    document.body.append(outside);
    outside.focus();
    listeners[0]();
    expect(paste.pasteFromClipboard).not.toHaveBeenCalled();
    void container;
    dispose();
  });
});
