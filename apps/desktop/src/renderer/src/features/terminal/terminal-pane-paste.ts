// MIT Copyright (c) 2026 Lovecast Inc. Ported from
// src/renderer/src/components/terminal-pane/terminal-pane-paste-execution.ts
// and terminal-pane-paste-listeners.ts. Adapted to Drogon's contracts: one
// pane per tab (paneId is fixed, leaf/pty ids are the session id), the PTY
// writer is the `session.write` RPC, the runtime is always local, and the
// source's keybinding-table lookup is inlined to the platform paste chord.
// The policy itself (plan → execute → bracketed/chunked writes) is the
// source's, via terminal-paste-coordinator/executor.
import { pasteTerminalText } from './terminal-bracketed-paste'
import { pasteTerminalClipboard } from './terminal-clipboard-paste'
import {
  executeTerminalPastePlan,
  planTerminalPaste,
  type TerminalPasteSource,
  type TerminalPasteTextOptions,
} from './terminal-paste-coordinator'
import { formatTerminalPasteExecutionError } from './terminal-paste-errors'
import type { TerminalPasteTarget } from './terminal-paste-model'

export type TerminalPanePasteDeps = {
  /** Resolves the PTY write; false = the session cannot take input. */
  writePty: (data: string) => Promise<boolean>
  /** The session stayed live/connected for the whole plan. */
  isTargetCurrent: () => boolean
  sessionIdentity: { sessionId: string; incarnation: string }
  report: (message: string) => void
}

export type TerminalPanePaste = ReturnType<typeof createTerminalPanePaste>

const PANE_ID = 1;

function clipboardPlatform(): NodeJS.Platform {
  if (navigator.userAgent.includes('Mac')) return 'darwin';
  return navigator.userAgent.includes('Windows') ? 'win32' : 'linux';
}

/** Reads clipboard text, rejecting payloads beyond `maxBytes` (UTF-8). */
export async function readClipboardTextWithinMaxBytes(
  options: { maxBytes?: number } | undefined,
): Promise<string> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.clipboard ||
    typeof navigator.clipboard.readText !== 'function'
  ) {
    throw new Error('Clipboard is unavailable in this window.')
  }
  const text = await navigator.clipboard.readText()
  const maxBytes = options?.maxBytes
  if (!Number.isFinite(maxBytes) || (maxBytes ?? 0) <= 0) return text
  const encoded = new TextEncoder().encode(text)
  if (encoded.length > (maxBytes ?? 0)) {
    const tooLarge: { name: 'clipboard-text-too-large' } = {
      name: 'clipboard-text-too-large',
    }
    throw tooLarge
  }
  return text
}

/**
 * Ctrl+V as a terminal receives it: byte `0x16`. The harness's own
 * clipboard-image reader listens for this keystroke (Claude Code's hint:
 * "Image in clipboard · ctrl+v to paste"), so the pane hands the image to
 * the harness instead of dropping an image-only paste.
 */
export const IMAGE_PASTE_KEYSTROKE = '\u0016'

/**
 * Whether the clipboard holds an image, via the async Clipboard API's item
 * list. `readText()` cannot answer this -- an image-only clipboard reads as
 * an empty string -- so this is the only honest signal that a paste would
 * otherwise be dropped rather than empty. Returns false when the API is
 * unavailable or the read is denied.
 */
export async function readClipboardHasImage(): Promise<boolean> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.clipboard ||
    typeof navigator.clipboard.read !== 'function'
  ) {
    return false
  }
  const items = await navigator.clipboard.read()
  return items.some((item) =>
    item.types.some((type) => type.toLowerCase().startsWith('image/')),
  )
}

export function createTerminalPanePaste(deps: TerminalPanePasteDeps) {
  const target: TerminalPasteTarget = {
    kind: 'terminal',
    paneId: PANE_ID,
    leafId: deps.sessionIdentity.sessionId,
    ptyId: deps.sessionIdentity.sessionId,
    runtime: {
      platform: clipboardPlatform(),
      runtimeKey: `local:${clipboardPlatform()}`,
      kind: 'local',
    },
  }

  const executePanePasteText = async (
    source: TerminalPasteSource,
    text: string,
    options?: TerminalPasteTextOptions,
  ): Promise<void> => {
    const plan = planTerminalPaste({
      text,
      source,
      target,
      forceBracketedPaste: options?.forceBracketedPaste,
      forceBracketedPasteForMultiline: options?.forceBracketedPasteForMultiline,
      // The live DECA mode decides: when the PTY app enabled bracketed
      // paste, chunked writes bracket exactly like the source's pane does.
      terminalBracketedPasteMode: getTerminal().modes.bracketedPasteMode,
    })
    const execution = await executeTerminalPastePlan(plan, {
      pasteText: (pasteTextValue, pasteOptions) =>
        pasteTerminalText(getTerminal(), pasteTextValue, pasteOptions),
      writePty: (data) => deps.writePty(data),
      isTargetCurrent: () => deps.isTargetCurrent(),
      canContinue: () => deps.isTargetCurrent(),
    })
    if (execution.status !== 'pasted') {
      deps.report(formatTerminalPasteExecutionError(execution.reason))
    }
  }

  // Late-bound: TerminalPane owns the live xterm instance and binds it after
  // mount (the paste path never runs before that).
  let terminal: PasteTerminalLike | null = null
  const getTerminal = (): PasteTerminalLike => {
    if (terminal === null) throw new Error('paste target is not mounted')
    return terminal
  }
  const bindTerminal = (value: PasteTerminalLike): void => {
    terminal = value
  }

  const pasteFromClipboard = (
    source: TerminalPasteSource,
    readClipboardText: typeof readClipboardTextWithinMaxBytes = readClipboardTextWithinMaxBytes,
    readClipboardImage: () => Promise<boolean> = readClipboardHasImage,
  ): void => {
    void pasteTerminalClipboard({
      readClipboardText,
      readClipboardHasImage: readClipboardImage,
      pasteText: (text, options) => executePanePasteText(source, text, options),
      onImageClipboard: () => {
        // An image-only clipboard is the harness's to consume: deliver the
        // Ctrl+V keystroke its own clipboard-image reader listens on, exactly
        // like a normal terminal, instead of silently dropping the paste.
        void deps.writePty(IMAGE_PASTE_KEYSTROKE).then((accepted) => {
          if (!accepted) {
            deps.report(
              'Image paste failed: the session is not accepting input.',
            )
          }
        })
      },
      onTextPasteError: () =>
        deps.report(
          'Paste failed: clipboard text is too large for a safe terminal paste.',
        ),
    })
      .then((result) => {
        if (
          result.status === 'skipped' &&
          result.reason === 'image-unavailable'
        ) {
          // Honest failure: the clipboard held no text and this window cannot
          // inspect clipboard images, so the paste really did not reach the
          // harness. Never report success for a dropped image.
          deps.report(
            'Paste failed: the clipboard holds no text and this window cannot read clipboard images.',
          )
        }
      })
      .catch(() => deps.report('Paste failed.'))
  }

  return { bindTerminal, pasteFromClipboard, executePanePasteText }
}

/** Structural subset of the xterm Terminal the paste path touches. */
export type PasteTerminalLike = Parameters<typeof pasteTerminalText>[0]

/**
 * Registers the source's paste-event policy listeners on the terminal
 * container: the keyboard paste chord, the DOM paste event and the native
 * Edit > Paste menu command are captured, the native xterm paste is
 * suppressed, and the payload goes through the plan/execute pipeline.
 *
 * The menu path matters on macOS: the app menu registers
 * `CmdOrCtrl+V`, so Electron consumes the key in main and forwards
 * `ui:appMenuPaste` to the renderer instead of delivering a DOM paste event.
 * Without a subscriber here the standard paste chord did nothing in a
 * terminal at all -- text included -- and an image-only clipboard was
 * silently dropped. Only the pane that actually owns focus acts, so a split
 * layout or a hidden tab never pastes twice. Returns the cleanup.
 */
export function registerTerminalPanePasteListeners({
  container,
  paste,
  isMac,
  subscribeAppMenuPaste,
}: {
  container: HTMLElement
  paste: TerminalPanePaste
  isMac: boolean
  /** `window.drogon.appMenu.onPaste`, injected so the pure listener wiring
   *  stays testable without a preload bridge. */
  subscribeAppMenuPaste?: (listener: () => void) => () => void
}): () => void {
  let suppressNextNativePaste = false
  let pasteSuppressionTimerId: number | null = null
  const suppressNativePasteOnce = (): void => {
    suppressNextNativePaste = true
    if (pasteSuppressionTimerId !== null) window.clearTimeout(pasteSuppressionTimerId)
    pasteSuppressionTimerId = window.setTimeout(() => {
      pasteSuppressionTimerId = null
      suppressNextNativePaste = false
    }, 0)
  }
  const shouldSuppressNativePaste = (event: KeyboardEvent): boolean => {
    const key = event.key.toLowerCase()
    return (
      (isMac && key === 'v' && event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) ||
      (!isMac && key === 'v' && event.ctrlKey && !event.metaKey && !event.altKey) ||
      (!isMac && event.key === 'Insert' && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey)
    )
  }
  const onKeyPaste = (event: KeyboardEvent): void => {
    if (event.target instanceof Element && event.target.closest('[data-terminal-search-root]')) {
      return
    }
    if (!shouldSuppressNativePaste(event)) return
    event.preventDefault()
    event.stopPropagation()
    suppressNativePasteOnce()
    paste.pasteFromClipboard('keyboard')
  }
  const onPaste = (event: ClipboardEvent): void => {
    if (event.target instanceof Element && event.target.closest('[data-terminal-search-root]')) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (suppressNextNativePaste) {
      suppressNextNativePaste = false
      if (pasteSuppressionTimerId !== null) {
        window.clearTimeout(pasteSuppressionTimerId)
        pasteSuppressionTimerId = null
      }
      return
    }
    paste.pasteFromClipboard('paste-event')
  }
  container.addEventListener('keydown', onKeyPaste, { capture: true })
  container.addEventListener('paste', onPaste, { capture: true })
  const offAppMenuPaste = subscribeAppMenuPaste?.(() => {
    const active = document.activeElement
    if (!(active instanceof Element) || !container.contains(active)) return
    if (active.closest('[data-terminal-search-root]')) return
    paste.pasteFromClipboard('app-menu')
  })
  return () => {
    if (pasteSuppressionTimerId !== null) window.clearTimeout(pasteSuppressionTimerId)
    container.removeEventListener('keydown', onKeyPaste, { capture: true })
    container.removeEventListener('paste', onPaste, { capture: true })
    offAppMenuPaste?.()
  }
}
