// MIT Copyright (c) 2026 Lovecast Inc. Ported from
// src/renderer/src/components/terminal-pane/terminal-clipboard-paste.ts.
// Adapted: Drogon has no clipboard-image-to-temp-file primitive, so the
// image branch is out of scope and text size is enforced by the caller's
// `readClipboardText` measuring against `maxBytes`; the text path's status
// contract, error routing and paste options are the source's.
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
  pasteText: (
    text: string,
    options?: TerminalPasteTextOptions,
  ) => boolean | void | Promise<boolean | void>
  forceBracketedMultilineTextPaste?: boolean
  onTextPasteError?: (error: unknown) => void
}

export type TerminalClipboardPasteResult =
  | { status: 'pasted'; kind: 'text' }
  | {
      status: 'skipped'
      reason:
        | 'empty'
        | 'text-paste-failed'
        | 'text-paste-rejected'
        | 'text-too-large'
    }

export async function pasteTerminalClipboard({
  readClipboardText,
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
    throw error
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
  return { status: 'skipped', reason: 'empty' }
}
