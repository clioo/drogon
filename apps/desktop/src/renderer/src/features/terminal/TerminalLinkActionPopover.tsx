// MIT Copyright (c) 2026 Lovecast Inc. Ported from
// src/renderer/src/components/terminal-pane/TerminalLinkActionPopover.tsx.
// Adapted: translate() calls are the source's English defaults (no i18n),
// the Terminal-link-settings button has no Drogon settings page and is
// omitted, and the header copy affordance extends to file links ("Copy
// path") where the source shows it for URLs only. Structure, classes,
// anchors, keyboard and ARIA are the source's.
import { useMemo, useRef } from 'react'
import { Check, Copy, ExternalLink, Globe } from 'lucide-react'
import { toast } from 'sonner'
import { ShortcutKeyCombo } from './ShortcutKeyCombo'
import { Button } from '../../components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '../../components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip'
import { useClipboardTextCopyFeedback } from './use-clipboard-text-copy-feedback'
import type { TerminalLinkAction, TerminalLinkActionRequest } from './terminal-link-action-request'

type TerminalLinkActionPopoverProps = {
  request: TerminalLinkActionRequest | null
  onClose: (dismissed?: TerminalLinkActionRequest) => void
}

function ActionRow({
  action,
  alternate,
  onRun,
}: {
  action: TerminalLinkAction
  alternate: boolean
  onRun: () => void
}): React.JSX.Element {
  const isMac = navigator.userAgent.includes('Mac')
  const keys = alternate
    ? [isMac ? '⇧' : 'Shift', isMac ? '⌘' : 'Ctrl', 'Click']
    : [isMac ? '⌘' : 'Ctrl', 'Click']

  return (
    <Button
      className="h-8 w-full justify-start gap-1.5 px-1.5 text-[13px] font-normal has-[>svg]:px-1.5"
      variant="ghost"
      onClick={onRun}
    >
      {action.external === true ? <ExternalLink className="size-3.5" /> : null}
      {action.external === false ? <Globe className="size-3.5" /> : null}
      <span className="min-w-0 flex-1 truncate text-left" title={action.label}>
        {action.label}
      </span>
      <ShortcutKeyCombo keys={keys} keyCapClassName="min-w-5 px-1 py-0 text-[11px]" />
    </Button>
  )
}

async function writeClipboardText(text: string): Promise<void> {
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function'
  ) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Unfocused windows are denied the async clipboard write; fall through
      // to the selection-copy path below.
    }
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  // Selection without focus: moving focus into the helper would dismiss a
  // surrounding Radix popover (FocusOutside) before the feedback lands.
  const range = document.createRange()
  range.selectNodeContents(area)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  try {
    if (!document.execCommand('copy')) {
      throw new Error('Clipboard copy was refused.')
    }
  } finally {
    selection?.removeAllRanges()
    area.remove()
  }
}

export function TerminalLinkActionPopover({
  request,
  onClose,
}: TerminalLinkActionPopoverProps): React.JSX.Element {
  const copyableDestination = request ? request.destination : ''
  const { copyText, status: copyStatus } = useClipboardTextCopyFeedback(
    copyableDestination,
    writeClipboardText,
  )
  const copyInFlightRef = useRef(false)
  const virtualRef = useMemo(
    () => ({
      current: {
        getBoundingClientRect: () => new DOMRect(request?.anchorX ?? 0, request?.anchorY ?? 0, 0, 0),
      },
    }),
    [request?.anchorX, request?.anchorY],
  )

  const runAction = (action: TerminalLinkAction): void => {
    onClose()
    request?.focusTerminal()
    void action.run()
  }

  const copyLabel =
    copyStatus === 'copied' ? 'Copied path' : 'Copy path'

  const copyDestination = async (): Promise<void> => {
    if (copyInFlightRef.current) {
      return
    }
    copyInFlightRef.current = true
    try {
      if (await copyText()) {
        toast.success('Copied path')
        return
      }
      toast.error('Failed to copy path')
    } finally {
      copyInFlightRef.current = false
    }
  }

  return (
    <Popover
      open={request !== null}
      onOpenChange={(open) => !open && onClose(request ?? undefined)}
    >
      <PopoverAnchor virtualRef={virtualRef} />
      {request ? (
        <PopoverContent
          align="start"
          side="top"
          sideOffset={6}
          collisionPadding={8}
          className="w-max min-w-52 max-w-[min(21rem,calc(100vw-1rem))] p-1"
          data-terminal-link-action-popover
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={() => request.focusTerminal()}
        >
          <div className="mb-0.5 flex items-center gap-1 overflow-hidden border-b border-border px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
            <span
              className="line-clamp-2 min-w-0 flex-1 break-all"
              data-terminal-link-destination
              title={request.destination}
            >
              {request.destination}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={copyLabel}
                  className="text-muted-foreground"
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => void copyDestination()}
                >
                  {copyStatus === 'copied' ? <Check /> : <Copy />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={4}>
                {copyLabel}
              </TooltipContent>
            </Tooltip>
          </div>
          <ActionRow
            action={request.primary}
            alternate={false}
            onRun={() => runAction(request.primary)}
          />
          {request.alternate ? (
            <ActionRow
              action={request.alternate}
              alternate
              onRun={() => runAction(request.alternate!)}
            />
          ) : null}
        </PopoverContent>
      ) : null}
    </Popover>
  )
}
