// MIT Copyright (c) 2026 Lovecast Inc. Ported verbatim from
// src/renderer/src/components/terminal-pane/terminal-linkifier-click-priming.ts.
// xterm snapshots its current link on mousedown but otherwise resolves links
// only on mousemove, so output painted under a still pointer misses its first
// click. The capture-phase mousedown primer re-runs the hover resolution
// synchronously before xterm's own mousedown snapshot.
import type { IDisposable, Terminal } from "@xterm/xterm";
import { isTerminalOwnedLinkGesture } from "./terminal-link-activation";

const CAPTURE_LISTENER_OPTIONS = { capture: true } as const;

type LinkifierClickPrimer = {
  _activeLine?: number;
  _currentLink?: unknown;
  _handleMouseMove?: (event: MouseEvent) => void;
  _lastBufferCell?: unknown;
};

type TerminalCoreWithLinkifier = {
  _core?: {
    linkifier?: LinkifierClickPrimer;
  };
};

function primeTerminalLinkifier(terminal: Terminal, event: MouseEvent): void {
  try {
    const linkifier = (terminal as unknown as TerminalCoreWithLinkifier)._core
      ?.linkifier;
    if (!linkifier || typeof linkifier._handleMouseMove !== "function") {
      return;
    }
    if (!linkifier._currentLink) {
      if ("_lastBufferCell" in linkifier) {
        linkifier._lastBufferCell = undefined;
      }
      if ("_activeLine" in linkifier) {
        linkifier._activeLine = -1;
      }
    }
    linkifier._handleMouseMove(event);
  } catch {
    /* xterm internals unavailable — hover still primes later clicks */
  }
}

export function installTerminalLinkifierClickPriming(
  terminal: Terminal,
): IDisposable {
  const terminalElement = terminal.element;
  const handleMouseDown = (event: MouseEvent): void => {
    if (!isTerminalOwnedLinkGesture(event)) {
      return;
    }
    primeTerminalLinkifier(terminal, event);
  };

  terminalElement?.addEventListener(
    "mousedown",
    handleMouseDown,
    CAPTURE_LISTENER_OPTIONS,
  );
  return {
    dispose: () => {
      terminalElement?.removeEventListener(
        "mousedown",
        handleMouseDown,
        CAPTURE_LISTENER_OPTIONS,
      );
    },
  };
}
