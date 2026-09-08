// MIT Copyright (c) 2026 Lovecast Inc. Ported from
// src/renderer/src/components/terminal-pane/terminal-link-action-request.ts.
// The pointer-gesture/activation imports resolve to the local ports; the
// request contract, close semantics and activation gate are verbatim.
import { isTerminalLinkActionActivation } from './terminal-link-activation'
import type { TerminalLinkPointerGesture } from './terminal-link-pointer-gesture'

export type TerminalLinkActionKind = 'url' | 'file' | 'workspace' | 'terminal' | 'task'

export type TerminalLinkAction = {
  external?: boolean
  label: string
  run: () => void | Promise<void>
}

export type TerminalLinkActionRequest = {
  paneId: number
  anchorX: number
  anchorY: number
  destination: string
  kind: TerminalLinkActionKind
  primary: TerminalLinkAction
  alternate?: TerminalLinkAction
  focusTerminal: () => void
}

export type TerminalLinkActionRequester = (request: TerminalLinkActionRequest) => void

export type TerminalLinkActionContext = {
  paneId: number
  pointerGesture: TerminalLinkPointerGesture
  claimPtyMouse: () => boolean
  request: TerminalLinkActionRequester
  focusTerminal: () => void
}

export function closeTerminalLinkActionRequest(
  current: TerminalLinkActionRequest | null,
  dismissed?: TerminalLinkActionRequest,
): TerminalLinkActionRequest | null {
  return dismissed && current !== dismissed ? current : null
}

type LinkActionDetails = Pick<
  TerminalLinkActionRequest,
  'destination' | 'kind' | 'primary' | 'alternate'
>

export function requestTerminalLinkAction(
  event: MouseEvent | undefined,
  context: TerminalLinkActionContext | null | undefined,
  details: LinkActionDetails,
): boolean {
  if (
    !event ||
    !context ||
    !isTerminalLinkActionActivation(event) ||
    !context.pointerGesture.canRequestAction(event)
  ) {
    return false
  }

  if (!context.claimPtyMouse()) {
    return false
  }
  event.preventDefault()
  context.request({
    ...details,
    paneId: context.paneId,
    anchorX: event.clientX,
    anchorY: event.clientY,
    focusTerminal: context.focusTerminal,
  })
  return true
}
