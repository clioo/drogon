// MIT Copyright (c) 2026 Lovecast Inc. Ported from
// src/renderer/src/components/terminal-pane/terminal-clipboard-paste.ts.
// Adapted: Drogon has no clipboard-image-to-temp-file primitive, so an
// image-only clipboard is handed to the harness's OWN clipboard reader
// instead (see `onImageClipboard`): the reference saves the image to a temp
// file and pastes its path, which needs a main-process primitive this build
// does not have. Text size is enforced by the caller's `readClipboardText`
// measuring against `maxBytes`; the text path's status contract, error
// routing and paste options are the source's.
import { TERMINAL_PASTE_MAX_BYTES, type TerminalPasteTextOptions } from './terminal-paste-coordinator'

type ReadClipboardTextOptions = {
  maxBytes?: number
}

export type TerminalClipboardTextTooLargeError = {
  name: 'clipboard-text-too-large'
}

export function isClipboardTextTooLargeError(
  error: unknown,
): error is TerminalClipboardTextTooLargeError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'clipboard-text-too-large'
  )
}

type PasteTerminalClipboardDeps = {
  readClipboardText: (options?: ReadClipboardTextOptions) => Promise<string>
  /**
   * Whether the clipboard currently holds an image. Consulted only when
   * `readClipboardText` came back empty, because that is exactly the case
   * the browser clipboard API cannot distinguish from an empty clipboard
   * (reading text off an image-only clipboard yields ""). Absent means this
   * window cannot inspect clipboard images at all, which the caller must
   * report honestly instead of pretending the paste happened.
   */
  readClipboardHasImage?: () => Promise<boolean>
  /**
   * Deliver an image-only clipboard to the session. The harness's own
   * clipboard-image reader is what actually consumes the pixels, and it
   * listens on a Ctrl+V keystroke in a normal terminal -- so the pane hands
   * it that keystroke rather than dropping the paste.
   */
  onImageClipboard?: () => void | Promise<void>
  pasteText: (
    text: string,
    options?: TerminalPasteTextOptions,
  ) => boolean | void | Promise<boolean | void>
  forceBracketedMultilineTextPaste?: boolean
  onTextPasteError?: (error: unknown) => void
}

export type TerminalClipboardPasteResult =
  | { status: 'pasted'; kind: 'text' | 'image-keystroke' }
  | {
      status: 'skipped'
      reason:
        | 'empty'
        | 'image-unavailable'
        | 'text-paste-failed'
        | 'text-paste-rejected'
        | 'text-too-large'
    }

export async function pasteTerminalClipboard({
  readClipboardText,
  readClipboardHasImage,
  onImageClipboard,
  pasteText,
  forceBracketedMultilineTextPaste = false,
  onTextPasteError,
}: PasteTerminalClipboardDeps): Promise<TerminalClipboardPasteResult> {
  let text = ''
  try {
    text = await readClipboardText({ maxBytes: TERMINAL_PASTE_MAX_BYTES })
  } catch (error) {
    if (isClipboardTextTooLargeError(error)) {
      onTextPasteError?.(error)
      return { status: 'skipped', reason: 'text-too-large' }
    }
    // Browser clipboard text reads can FAIL for image-only clipboards (the
    // source's own note). Do not abort the paste here: fall through to the
    // image branch, which is the only way a screenshot reaches the harness.
  }
  if (text) {
    try {
      const textOptions = forceBracketedMultilineTextPaste
        ? { forceBracketedPasteForMultiline: true }
        : undefined
      const result = await (textOptions ? pasteText(text, textOptions) : pasteText(text))
      if (result === false) {
        return { status: 'skipped', reason: 'text-paste-rejected' }
      }
      return { status: 'pasted', kind: 'text' }
    } catch (error) {
      onTextPasteError?.(error)
      return { status: 'skipped', reason: 'text-paste-failed' }
    }
  }
  // No text. A screenshot on the clipboard reads as empty text, so ask the
  // browser whether an image is actually there before giving up.
  if (!readClipboardHasImage) {
    return { status: 'skipped', reason: 'image-unavailable' }
  }
  let hasImage = false
  try {
    hasImage = await readClipboardHasImage()
  } catch {
    return { status: 'skipped', reason: 'image-unavailable' }
  }
  if (!hasImage || !onImageClipboard) {
    return { status: 'skipped', reason: 'empty' }
  }
  await onImageClipboard()
  return { status: 'pasted', kind: 'image-keystroke' }
}
