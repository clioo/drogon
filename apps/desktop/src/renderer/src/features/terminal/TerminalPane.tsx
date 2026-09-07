// MIT Copyright (c) 2026 Lovecast Inc. Moved from
// apps/desktop/src/renderer/src/TerminalPane.tsx and extended with the
// terminal-parity ports: src/renderer/src/assets/terminal.css,
// terminal-appearance.ts, useTerminalFontZoom.ts (chords handled in the
// container keydown below), TerminalSearch.tsx, terminal-handle-links.ts /
// terminal-web-link-click.ts / terminal-file-link-actions.ts (adapted),
// TerminalContextMenu.tsx, terminal-selection-copy.ts, terminal-handle-copy.ts,
// osc52-clipboard.ts, TerminalProcessExitOverlay.tsx and
// terminal-renderer-policy.ts.
import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import type { ILinkProvider, ILink } from "@xterm/xterm";
import { TerminalInputQueue } from "./terminal-input-queue";
import {
  applyTerminalAppearance,
  composeActiveTerminalTheme,
  readEffectiveSchemeFromRoot,
  terminalThemeForScheme,
} from "./terminal-appearance";
import {
  isTerminalSearchChord,
  matchFontZoomChord,
  nextFontZoomSize,
} from "./terminal-font-zoom";
import { resolvePaneRendererPolicy } from "./terminal-renderer-policy";
import TerminalSearch, { type TerminalSearchState } from "./TerminalSearch";
import TerminalContextMenu, {
  type TerminalContextMenuPoint,
} from "./TerminalContextMenu";
import {
  TerminalProcessExitOverlay,
} from "./TerminalProcessExitOverlay";
import {
  projectTerminalProcessExit,
  type TerminalProcessExit,
} from "./terminal-process-exit";
import {
  extractTerminalFileLinks,
  handleTerminalFileLink,
  TERMINAL_FILE_OPEN_EVENT,
  type TerminalFileOpenDetail,
} from "./terminal-file-link";
import {
  handleTerminalWebLinkClick,
} from "./terminal-web-link-click";
import {
  isTerminalLinkDirectActivation,
  terminalLinkModifierHint,
} from "./terminal-link-activation";
import { copyTerminalSelection } from "./terminal-selection-copy";
import { copyTerminalHandleForPane } from "./terminal-handle-copy";
import { createOsc52OscHandler } from "./osc52-clipboard";
import {
  createBrowserAuthoritySource,
  windowBrowserBridge,
} from "../browser/browser-bridge";
import { requestWindowOpenDecision } from "../browser/browser-nav-state";
import type { Session } from "../../../../shared/session-contract";

/**
 * Dispatched by the App-level `terminal.clear` chord (Cmd+K, source id from
 * definitions-core-3.ts). App only dispatches while focus is inside the
 * active session panel, so this listener clears unconditionally.
 */
export const TERMINAL_CLEAR_EVENT = "drogon:terminal-clear";

/**
 * Dispatched by the exit overlay's Restart button. App wires it to the same
 * path as "New terminal" for the requesting workspace; TerminalPane cannot
 * touch App-owned tab state (import-path-only grant on App.tsx).
 */
export const TERMINAL_RESTART_EVENT = "drogon:terminal-restart";

export type TerminalRestartDetail = {
  sessionId: string;
  workspaceId: string;
};

/**
 * Dispatched by the context menu's Close Pane item after stopping the PTY.
 * App wires it to tab dismissal; the stop() call below is the real effect
 * until then (the session flips to exited and the overlay takes over).
 */
export const TERMINAL_CLOSE_EVENT = "drogon:terminal-close";

export type TerminalCloseDetail = {
  sessionId: string;
  workspaceId: string;
};

async function writeClipboardText(text: string): Promise<void> {
  if (
    typeof navigator === "undefined" ||
    !navigator.clipboard ||
    typeof navigator.clipboard.writeText !== "function"
  ) {
    throw new Error("Clipboard is unavailable in this window.");
  }
  await navigator.clipboard.writeText(text);
}

export function TerminalPane({
  session,
  fontSize,
  onError,
  onSession,
}: {
  session: Session;
  /** Terminal font size in px, mirrored from the settings store by App. */
  fontSize: number;
  onError(message: string): void;
  onSession(value: Session): void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onError, onSession });
  callbacks.current = { onError, onSession };
  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [zoomOverride, setZoomOverride] = useState<number | null>(null);
  const zoomOverrideRef = useRef<number | null>(null);
  zoomOverrideRef.current = zoomOverride;
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchAddon, setSearchAddon] = useState<SearchAddon | null>(null);
  const searchStateRef = useRef<TerminalSearchState>({
    query: "",
    caseSensitive: false,
    regex: false,
  });
  const [menu, setMenu] = useState<TerminalContextMenuPoint | null>(null);
  const [processExit, setProcessExit] = useState<TerminalProcessExit | null>(
    () => projectTerminalProcessExit(session),
  );
  const dismissedExitKey = useRef<string | null>(null);
  const [linkTooltip, setLinkTooltip] = useState<string | null>(null);
  const live = useRef<{
    terminal: Terminal;
    fit: FitAddon;
    search: SearchAddon;
    input: TerminalInputQueue;
    focus: () => void;
  } | null>(null);

  const showExit = (exit: TerminalProcessExit | null) => {
    if (!exit) {
      setProcessExit(null);
      return;
    }
    const key = `${sessionRef.current.id}:${sessionRef.current.incarnation}`;
    if (dismissedExitKey.current === key) return;
    setProcessExit(exit);
  };

  useEffect(() => {
    const onClear = () => live.current?.terminal.clear();
    window.addEventListener(TERMINAL_CLEAR_EVENT, onClear);
    return () => window.removeEventListener(TERMINAL_CLEAR_EVENT, onClear);
  }, []);

  // Applies a later settings change without remounting the session: the
  // creation effect below stays keyed on session identity only. A zoom
  // override wins over the settings size until ⌘0 resets it.
  useEffect(() => {
    const current = live.current;
    if (!current) return;
    current.terminal.options.fontSize = zoomOverride ?? fontSize;
    if (
      surface.current &&
      surface.current.clientWidth !== 0 &&
      surface.current.clientHeight !== 0
    )
      current.fit.fit();
  }, [fontSize, zoomOverride]);

  useEffect(() => {
    const mount = surface.current!;
    const css = getComputedStyle(mount);
    const initialScheme = readEffectiveSchemeFromRoot(
      typeof document !== "undefined" ? document.documentElement : null,
    );
    const terminal = new Terminal({
      fontFamily:
        css.getPropertyValue("--font-mono").trim() ||
        '"SF Mono", SFMono-Regular, ui-monospace, "Cascadia Code", Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: zoomOverrideRef.current ?? fontSizeRef.current,
      cursorBlink: true,
      cursorStyle: "block",
      scrollback: 5000,
      // Required for the SearchAddon match-decoration colors (proposed API).
      allowProposedApi: true,
      screenReaderMode: true,
      theme:
        composeActiveTerminalTheme(
          terminalThemeForScheme(initialScheme),
          {},
        ) ?? undefined,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    const search = new SearchAddon();
    terminal.loadAddon(search);
    setSearchAddon(search);
    let disposed = false;
    // True once the initial history catch-up has been painted; gates OSC 52
    // writes so a stale sequence in scrollback cannot overwrite the clipboard.
    const caughtUp = { current: false };
    const report = (message: string) => {
      if (!disposed) callbacks.current.onError(message);
    };
    // WebGL with canvas fallback per the renderer policy: the policy gates
    // the attempt; a failed load/activation keeps the canvas renderer.
    if (resolvePaneRendererPolicy({}).gpuEnabled) {
      void import("@xterm/addon-webgl")
        .then(({ WebglAddon }) => {
          try {
            terminal.loadAddon(new WebglAddon());
          } catch {
            // Canvas fallback: the terminal stays usable without WebGL.
          }
        })
        .catch(() => {
          // Canvas fallback: missing WebGL support keeps DOM rendering.
        });
    }
    const osc52Handler = createOsc52OscHandler({
      // OSC 52 clipboard defaults on (source gate); queries stay blocked.
      getSettingEnabled: () => true,
      // True while the initial history catch-up is being painted, so a
      // stale `\e]52;…` in scrollback cannot overwrite a newer clipboard.
      getReplaying: () => !caughtUp.current,
      writeClipboardText,
      showBlockedWriteToast: () => {},
      showWriteFailedToast: () =>
        void report("Terminal clipboard write failed."),
    });
    terminal.parser.registerOscHandler(52, (data) => osc52Handler(data));
    const openHttpUrl = async (
      url: string,
    ): Promise<{ ok: true } | { ok: false; message: string }> => {
      const source = createBrowserAuthoritySource({
        bridge: windowBrowserBridge(),
        workspaceId: () => sessionRef.current.workspaceId,
      });
      return new Promise((resolve) => {
        void requestWindowOpenDecision({
          tabId: "",
          url,
          source,
          onDecision: (decision) => {
            if (decision.outcome === "allow") {
              resolve({ ok: true });
              return;
            }
            if (decision.outcome === "open-in-system") {
              // No host system-open primitive exists yet (main/preload
              // follow-up); the event carries the contract.
              window.dispatchEvent(
                new CustomEvent("drogon:open-external-url", {
                  detail: { url },
                }),
              );
              resolve({ ok: true });
              return;
            }
            resolve({ ok: false, message: decision.reason });
          },
          onError: (message) => resolve({ ok: false, message }),
        });
      });
    };
    terminal.loadAddon(
      new WebLinksAddon((event, url) =>
        handleTerminalWebLinkClick(url, event, {
          openUrl: openHttpUrl,
          clearSelection: () => terminal.clearSelection(),
          report,
        }),
      ),
    );
    const fileLinkProvider: ILinkProvider = {
      provideLinks: (bufferLineNumber, callback) => {
        const line = terminal.buffer.active.getLine(bufferLineNumber);
        const text = line?.translateToString(true) ?? "";
        if (!text.includes("/")) {
          callback(undefined);
          return;
        }
        const links: ILink[] = [];
        for (const parsed of extractTerminalFileLinks(text)) {
          links.push({
            // Why 1-based inclusive: xterm's link hit-test uses 1-based
            // inclusive coordinates; parsed links are zero-based half-open.
            range: {
              start: { x: parsed.startIndex + 1, y: bufferLineNumber },
              end: { x: parsed.endIndex, y: bufferLineNumber },
            },
            text: parsed.path,
            activate: (_event, linkText) => {
              const mouse = _event as MouseEvent | undefined;
              if (!isTerminalLinkDirectActivation(mouse)) return;
              mouse?.preventDefault?.();
              handleTerminalFileLink(
                parsed.path,
                parsed.line,
                parsed.column,
                mouse,
                { workspaceId: sessionRef.current.workspaceId },
              );
              terminal.clearSelection();
              setLinkTooltip(null);
            },
            hover: (_event, linkText) => {
              setLinkTooltip(
                `${linkText ?? parsed.path} (${terminalLinkModifierHint()})`,
              );
            },
            leave: () => setLinkTooltip(null),
          });
        }
        callback(links.length > 0 ? links : undefined);
      },
    };
    const fileLinkDisposable = terminal.registerLinkProvider(fileLinkProvider);
    terminal.open(mount);
    const inputIdentity = {
      sessionId: session.id,
      incarnation: session.incarnation,
    };
    const queue = new TerminalInputQueue(
      (text) => window.drogon.write({ ...inputIdentity, text }),
      () => !disposed && canWrite,
      report,
    );
    live.current = {
      terminal,
      fit,
      search,
      input: queue,
      focus: () => terminal.focus(),
    };
    const media = matchMedia("(prefers-color-scheme: dark)");
    const updateTheme = () => {
      applyTerminalAppearance(
        terminal,
        readEffectiveSchemeFromRoot(document.documentElement),
      );
    };
    media.addEventListener("change", updateTheme);
    // Explicit theme choice beats the OS media (App toggles `.dark`).
    const rootObserver = new MutationObserver(updateTheme);
    rootObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    let cursor = 0;
    let timeout: ReturnType<typeof setTimeout>;
    let canWrite = session.verdict === "live";
    let lastObserved = session;
    // Loss of contact is never proof of exit: a read failure or transport
    // error must not leave a stale "live" badge showing. Once exited is
    // positively observed, that stays authoritative — a later transport
    // hiccup does not un-exit a session that already reported its real end.
    const projectUnverifiable = () => {
      if (lastObserved.verdict === "exited") return;
      lastObserved = { ...lastObserved, verdict: "unverifiable" };
      callbacks.current.onSession(lastObserved);
    };
    const subscription = terminal.onData((text) => {
      void queue.enqueue(text);
    });
    const fitTerminal = () => {
      if (disposed || mount.clientWidth === 0 || mount.clientHeight === 0)
        return;
      fit.fit();
    };
    const resize = terminal.onResize(({ cols, rows }) => {
      if (canWrite && !disposed)
        void window.drogon
          .resize({ ...inputIdentity, cols, rows })
          .then((result) => {
            if (!result.ok) report(result.error.message);
          })
          .catch(() => report("Terminal resize could not be confirmed."));
    });
    const observer = new ResizeObserver(fitTerminal);
    observer.observe(mount);
    fitTerminal();
    if (document.activeElement?.getAttribute("role") !== "tab")
      terminal.focus();
    async function read() {
      if (disposed) return;
      try {
        const response = await window.drogon.read({
          ...inputIdentity,
          cursor,
        });
        if (disposed) return;
        if (!response.ok) {
          canWrite = false;
          projectUnverifiable();
          report(response.error.message);
          return;
        }
        const value = response.result;
        if (value.truncated)
          terminal.write("\r\n[Earlier output is no longer retained]\r\n");
        const bytes = Uint8Array.from(atob(value.dataBase64), (char) =>
          char.charCodeAt(0),
        );
        await new Promise<void>((resolve) => terminal.write(bytes, resolve));
        if (disposed) return;
        cursor = value.nextCursor;
        canWrite = value.session.verdict === "live";
        lastObserved = value.session;
        callbacks.current.onSession(value.session);
        if (bytes.length < 65536) caughtUp.current = true;
        const exit = projectTerminalProcessExit(value.session);
        if (exit) showExit(exit);
        if (value.session.verdict === "exited" && bytes.length === 0) return;
        timeout = setTimeout(read, bytes.length === 65536 ? 0 : 120);
      } catch {
        canWrite = false;
        projectUnverifiable();
        report(
          "Terminal connection lost. Refresh to reconnect; process state is unverified.",
        );
      }
    }
    void read();
    return () => {
      disposed = true;
      live.current = null;
      setSearchAddon(null);
      clearTimeout(timeout);
      media.removeEventListener("change", updateTheme);
      rootObserver.disconnect();
      observer.disconnect();
      fileLinkDisposable.dispose();
      subscription.dispose();
      resize.dispose();
      terminal.dispose();
    };
    // Keyed on session identity only; font size rides the effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, session.incarnation]);

  const isMac =
    typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");

  const onContainerKeyDown = (event: React.KeyboardEvent) => {
    const zoom = matchFontZoomChord(event, isMac);
    if (zoom) {
      event.preventDefault();
      event.stopPropagation();
      const base = fontSizeRef.current;
      const current = zoomOverrideRef.current ?? base;
      const next = nextFontZoomSize({ current, base, direction: zoom });
      setZoomOverride(next.override);
      return;
    }
    if (isTerminalSearchChord(event, isMac)) {
      event.preventDefault();
      event.stopPropagation();
      setSearchOpen(true);
    }
  };

  const onContainerContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY });
  };

  const current = live.current;
  const copySelection = () => {
    setMenu(null);
    if (!current) return;
    void copyTerminalSelection({ terminal: current.terminal, writeClipboardText })
      .then((copied) => {
        if (!copied) callbacks.current.onError("Nothing is selected.");
      })
      .catch(() => {
        callbacks.current.onError("Copy failed: clipboard unavailable.");
      });
  };
  const selectAll = () => {
    setMenu(null);
    current?.terminal.selectAll();
    current?.focus();
  };
  const pasteClipboard = () => {
    setMenu(null);
    if (!current) return;
    const queue = current.input;
    const focus = current.focus;
    if (
      typeof navigator === "undefined" ||
      !navigator.clipboard ||
      typeof navigator.clipboard.readText !== "function"
    ) {
      callbacks.current.onError("Paste failed: clipboard unavailable.");
      return;
    }
    void navigator.clipboard
      .readText()
      .then((text) => {
        if (text) void queue.enqueue(text);
        focus();
      })
      .catch(() => {
        callbacks.current.onError("Paste failed: clipboard unavailable.");
      });
  };
  const copyTerminalId = () => {
    setMenu(null);
    void copyTerminalHandleForPane({
      handle: sessionRef.current.id,
      writeClipboardText,
    }).catch(() => {
      callbacks.current.onError("Copy failed: clipboard unavailable.");
    });
  };
  const clearScreen = () => {
    setMenu(null);
    current?.terminal.clear();
    current?.focus();
  };
  const closePane = () => {
    setMenu(null);
    const detail: TerminalCloseDetail = {
      sessionId: sessionRef.current.id,
      workspaceId: sessionRef.current.workspaceId,
    };
    window.dispatchEvent(new CustomEvent(TERMINAL_CLOSE_EVENT, { detail }));
    const identity = {
      sessionId: detail.sessionId,
      incarnation: sessionRef.current.incarnation,
    };
    void window.drogon
      .stop(identity)
      .then((result) => {
        if (!result.ok) callbacks.current.onError(result.error.message);
        else callbacks.current.onSession(result.result);
      })
      .catch(() => {
        callbacks.current.onError("The terminal process could not be stopped.");
      });
  };

  const restartExits = () => {
    const detail: TerminalRestartDetail = {
      sessionId: sessionRef.current.id,
      workspaceId: sessionRef.current.workspaceId,
    };
    dismissedExitKey.current = `${detail.sessionId}:${sessionRef.current.incarnation}`;
    setProcessExit(null);
    window.dispatchEvent(new CustomEvent(TERMINAL_RESTART_EVENT, { detail }));
  };
  const dismissExit = () => {
    dismissedExitKey.current = `${sessionRef.current.id}:${sessionRef.current.incarnation}`;
    setProcessExit(null);
    current?.focus();
  };

  return (
    <div
      ref={container}
      className="terminal-surface"
      style={{ position: "relative" }}
      aria-label="Session terminal"
      onKeyDown={onContainerKeyDown}
      onContextMenu={onContainerContextMenu}
    >
      <div ref={surface} style={{ width: "100%", height: "100%" }} />
      {linkTooltip ? (
        <div className="pane-link-tooltip" role="status">
          {linkTooltip}
        </div>
      ) : null}
      <TerminalSearch
        isOpen={searchOpen}
        onClose={() => {
          setSearchOpen(false);
          current?.focus();
        }}
        searchAddon={searchAddon}
        searchStateRef={searchStateRef}
      />
      {processExit ? (
        <TerminalProcessExitOverlay
          processExit={processExit}
          onRestart={restartExits}
          onClose={dismissExit}
        />
      ) : null}
      <TerminalContextMenu
        open={menu !== null}
        menuPoint={menu ?? { x: 0, y: 0 }}
        onOpenChange={(open) => {
          if (!open) {
            setMenu(null);
            current?.focus();
          }
        }}
        onCopy={copySelection}
        onSelectAll={selectAll}
        onPaste={pasteClipboard}
        onCopyTerminalId={copyTerminalId}
        onClearScreen={clearScreen}
        onClosePane={closePane}
      />
    </div>
  );
}

// Re-exported so tests and future App wiring share one contract.
export { TERMINAL_FILE_OPEN_EVENT };
export type { TerminalFileOpenDetail };
