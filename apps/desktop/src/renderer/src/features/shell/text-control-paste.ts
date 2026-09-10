// MIT Copyright (c) 2026 Lovecast Inc. Ported from the Orca reference
// (read-only /Users/carlos/Documents/Drogon-orca):
//   src/renderer/src/lib/app-menu-paste.ts (request shape: owned terminal
//     event first, then focused text control, then native fallback),
//   src/renderer/src/lib/text-control-paste.ts (setRangeText insertion with
//     an `insertFromPaste` input event so React onChange fires; chunked
//     delivery for large payloads),
//   src/renderer/src/lib/text-control-paste-ownership.ts (closest
//     input/textarea target, xterm helper excluded),
//   src/renderer/src/lib/text-control-paste-model.ts (byte limits),
//   src/renderer/src/lib/primary-selection-capture.ts (text input types).
// Adapted: the shared clipboard-text/diag helpers live in coordinator-owned
// shared/ so byte length is measured locally with TextEncoder; clipboard
// reads go through the async Clipboard API (main pre-grants
// clipboard-read to the app window, same channel the terminal paste
// pipeline uses) instead of a main-side clipboard IPC; terminal and Monaco
// surfaces are never claimed here — they keep their own paste paths.
export type TextControlPasteTarget = HTMLInputElement | HTMLTextAreaElement;

export type TextControlAppMenuPasteResult =
  | { status: "pasted"; mode: "direct" | "chunked" }
  | { status: "ignored"; reason: "no-text-target" | "non-text-surface" }
  | {
      status: "rejected";
      reason:
        | "empty"
        | "too-large"
        | "target-unavailable"
        | "clipboard-unavailable";
    };

/** Source parity (text-control-paste-model.ts). */
export const TEXT_CONTROL_PASTE_DIRECT_MAX_BYTES = 64 * 1024;
export const TEXT_CONTROL_PASTE_CHUNK_MAX_BYTES = 16 * 1024;
export const TEXT_CONTROL_PASTE_MAX_BYTES = 16 * 1024 * 1024;

/** Source parity (primary-selection-capture.ts): input types that take text. */
const TEXT_INPUT_TYPES = new Set([
  "",
  "email",
  "password",
  "search",
  "tel",
  "text",
  "url",
]);

function isTextInputElement(element: Element): element is HTMLInputElement {
  return (
    element instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(element.type)
  );
}

function isTextControlElement(
  element: Element,
): element is HTMLInputElement | HTMLTextAreaElement {
  return isTextInputElement(element) || element instanceof HTMLTextAreaElement;
}

/**
 * Surfaces whose paste path lives elsewhere: xterm's hidden helper textarea
 * (terminal paste pipeline) and Monaco's input area (editor). Claiming them
 * here would bypass bracketed-paste protection or corrupt editor state.
 */
export function isNonTextPasteSurface(element: Element | null): boolean {
  if (!(element instanceof Element)) return false;
  return (
    element.closest(".xterm-helper-textarea, .xterm-screen") !== null ||
    element.closest(".monaco-editor") !== null
  );
}

/**
 * Source parity (findOwnedTextControlPasteTarget): the focused text control
 * the app-menu paste owns, or null when focus is on a terminal, the editor,
 * or no editable control at all.
 */
export function findTextControlPasteTarget(
  activeElement: Element | null,
): HTMLInputElement | HTMLTextAreaElement | null {
  if (!(activeElement instanceof Element)) return null;
  if (isNonTextPasteSurface(activeElement)) return null;
  const textControl = activeElement.closest("input, textarea");
  if (!textControl || !isTextControlElement(textControl)) return null;
  if (textControl.disabled || textControl.readOnly) return null;
  return textControl;
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function dispatchTextControlInputEvent(
  target: HTMLInputElement | HTMLTextAreaElement,
  data: string | null,
): void {
  const event =
    typeof InputEvent === "function"
      ? new InputEvent("input", {
          bubbles: true,
          cancelable: false,
          data,
          inputType: "insertFromPaste",
        })
      : new Event("input", { bubbles: true, cancelable: false });
  target.dispatchEvent(event);
}

function isPasteTargetAvailable(target: TextControlPasteTarget): boolean {
  return (
    target.isConnected &&
    !target.disabled &&
    !target.readOnly &&
    target.ownerDocument.activeElement === target
  );
}

function selectionRange(target: TextControlPasteTarget): {
  start: number;
  end: number;
} {
  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? start;
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Source parity (pasteTextIntoTextControl, direct + chunked modes): insert
 * clipboard text at the caret, replacing the selection, and notify React via
 * a bubbling `input` event. Large payloads are written in 16 KiB slices so
 * the renderer can yield between DOM mutations.
 */
export async function pasteTextIntoTextControl(
  target: TextControlPasteTarget,
  text: string,
): Promise<
  | { status: "pasted"; mode: "direct" | "chunked" }
  | { status: "rejected"; reason: "empty" | "too-large" | "target-unavailable" }
> {
  const byteLength = utf8ByteLength(text);
  if (byteLength === 0) return { status: "rejected", reason: "empty" };
  if (byteLength > TEXT_CONTROL_PASTE_MAX_BYTES)
    return { status: "rejected", reason: "too-large" };
  if (!isPasteTargetAvailable(target))
    return { status: "rejected", reason: "target-unavailable" };

  try {
    target.focus();

    if (byteLength <= TEXT_CONTROL_PASTE_DIRECT_MAX_BYTES) {
      const { start, end } = selectionRange(target);
      target.setRangeText(text, start, end, "end");
      dispatchTextControlInputEvent(target, text);
      return { status: "pasted", mode: "direct" };
    }

    const { start, end } = selectionRange(target);
    if (start !== end) target.setRangeText("", start, end, "end");

    // Why chunked writes keep literal content: only the delivery cadence
    // changes so the renderer can yield between DOM mutations (source).
    // Slices follow UTF-8 boundaries by accumulating per-code-point byte
    // lengths in one linear pass.
    let index = 0;
    while (index < text.length) {
      if (!isPasteTargetAvailable(target)) {
        if (target.isConnected) dispatchTextControlInputEvent(target, null);
        return { status: "rejected", reason: "target-unavailable" };
      }
      let next = index;
      let chunkBytes = 0;
      while (next < text.length) {
        const codePoint = text.codePointAt(next) ?? 0;
        const codePointBytes =
          codePoint > 0xffff ? 4 : codePoint > 0x7ff ? 3 : codePoint > 0x7f ? 2 : 1;
        if (chunkBytes + codePointBytes > TEXT_CONTROL_PASTE_CHUNK_MAX_BYTES && next > index)
          break;
        chunkBytes += codePointBytes;
        next += codePoint > 0xffff ? 2 : 1;
      }
      const chunk = text.slice(index, next);
      const caret = target.selectionStart ?? target.value.length;
      target.setRangeText(chunk, caret, caret, "end");
      index = next;
      if (index < text.length) await yieldToEventLoop();
    }
    dispatchTextControlInputEvent(target, null);
    return { status: "pasted", mode: "chunked" };
  } catch {
    return { status: "rejected", reason: "target-unavailable" };
  }
}

export type TextControlPasteDeps = {
  readClipboardText?: () => Promise<string>;
  getActiveElement?: () => Element | null;
};

/**
 * App-menu / context-menu paste for dialog and form inputs (Add Project et
 * al). The Edit > Paste accelerator consumes the key event in main, and
 * document.execCommand("paste") is denied in Chromium, so the clipboard is
 * read explicitly and inserted into the focused text control. Terminal and
 * editor surfaces are reported as non-text so their own pipelines (and the
 * legacy fallback) keep working untouched.
 */
export async function handleTextControlAppMenuPaste(
  deps: TextControlPasteDeps = {},
): Promise<TextControlAppMenuPasteResult> {
  const activeElement =
    deps.getActiveElement?.() ??
    (typeof document === "undefined" ? null : document.activeElement);
  if (isNonTextPasteSurface(activeElement))
    return { status: "ignored", reason: "non-text-surface" };
  const target = findTextControlPasteTarget(activeElement);
  if (!target) return { status: "ignored", reason: "no-text-target" };

  let text: string;
  try {
    text =
      (await deps.readClipboardText?.()) ??
      (await navigator.clipboard.readText());
  } catch {
    return { status: "rejected", reason: "clipboard-unavailable" };
  }
  return pasteTextIntoTextControl(target, text);
}
