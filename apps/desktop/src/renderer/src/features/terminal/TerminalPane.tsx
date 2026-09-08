// MIT Copyright (c) 2026 Lovecast Inc. Moved from
// apps/desktop/src/renderer/src/TerminalPane.tsx and extended with the
// terminal-parity ports: src/renderer/src/assets/terminal.css,
// terminal-appearance.ts, useTerminalFontZoom.ts (chords handled in the
// container keydown below), TerminalSearch.tsx, terminal-handle-links.ts /
// terminal-web-link-click.ts / terminal-file-link-actions.ts (adapted),
// TerminalContextMenu.tsx, terminal-selection-copy.ts, terminal-handle-copy.ts,
// osc52-clipboard.ts, TerminalProcessExitOverlay.tsx,
// terminal-renderer-policy.ts and terminal-webgl-lifecycle.ts (WebGL
// activation order and DPR guards from the fork's pane-manager:
// pane-webgl-renderer.ts, terminal-canvas-dpr-repair.ts,
// terminal-webgl-addon-loader.ts, pane-fit-webgl-attach-signal.ts and
// terminal-visibility-resume.ts).
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import type { WebglAddon } from "@xterm/addon-webgl";
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
import {
  clearTerminalWebglAtlas,
  disposeTerminalWebglAddon,
  hasMeasurableTerminalBox,
  observeTerminalWebglCanvasBackingStore,
  primeTerminalWebglAddon,
  rearmTerminalWebglAddonLoad,
  repairTerminalWebglBackingStore,
  shouldAttachTerminalWebgl,
} from "./terminal-webgl-lifecycle";
import {
  readTerminalGpuAcceleration,
  readTerminalTypography,
} from "../../settings-store";
import type { TerminalGpuAcceleration } from "../../settings-store";
import {
  buildTerminalFontFamily,
  resolveTerminalFontWeights,
} from "../settings/terminal-typography";
import TerminalSearch, { type TerminalSearchState } from "./TerminalSearch";
import TerminalContextMenu, {
  type TerminalContextMenuPoint,
} from "./TerminalContextMenu";
import { splitRightShortcutLabel } from "./terminal-split";
import { TerminalProcessExitOverlay } from "./TerminalProcessExitOverlay";
import { DaemonReconnectBanner } from "./DaemonReconnectBanner";
import { useDaemonConnection } from "../shell/daemon-connection-store";
import {
  isRecoverableAfterReconnect,
  showRecoveryOverlay,
} from "../../session-recovery";
import {
  projectTerminalProcessExit,
  type TerminalProcessExit,
} from "./terminal-process-exit";
import {
  extractTerminalFileLinks,
  requestTerminalFileOpen,
  TERMINAL_FILE_OPEN_EVENT,
  type TerminalFileOpenDetail,
} from "./terminal-file-link";
import { handleTerminalWebLinkClick } from "./terminal-web-link-click";
import {
  isTerminalLinkDirectActivation,
  terminalLinkModifierHint,
} from "./terminal-link-activation";
import {
  installTerminalLinkPointerGesture,
  type TerminalLinkPointerGesture,
} from "./terminal-link-pointer-gesture";
import { installTerminalLinkifierClickPriming } from "./terminal-linkifier-click-priming";
import {
  installTerminalBell,
  readBellNotificationsEnabled,
} from "./terminal-bell";
import {
  closeTerminalLinkActionRequest,
  requestTerminalLinkAction,
  type TerminalLinkActionContext,
  type TerminalLinkActionRequest,
} from "./terminal-link-action-request";
import { TerminalLinkActionPopover } from "./TerminalLinkActionPopover";
import { copyTerminalSelection } from "./terminal-selection-copy";
import { copyTerminalHandleForPane } from "./terminal-handle-copy";
import { createOsc52OscHandler } from "./osc52-clipboard";
import {
  showOsc52ClipboardBlockedToast,
  showOsc52ClipboardFailedToast,
} from "./osc52-clipboard-toast";
import {
  markTerminalBracketedPasteInterrupted,
  observeTerminalBracketedPasteModeOutput,
} from "./terminal-bracketed-paste";
import {
  createReplayTailBuffer,
  createSessionUpdateCoalescer,
  shouldKeepSeeking,
  TERMINAL_HIDDEN_POLL_MS,
  TERMINAL_LIVE_POLL_MS,
  TERMINAL_READ_PAGE_BYTES,
  type SessionSignal,
} from "./terminal-read-pacing";
import {
  createTerminalPanePaste,
  registerTerminalPanePasteListeners,
} from "./terminal-pane-paste";
import { windowBrowserBridge } from "../browser/browser-bridge";
import type { Session } from "../../../../shared/session-contract";
import type { TerminalPasteSource } from "./terminal-paste-model";

/**
 * Dispatched by the App-level `terminal.clear` chord (Cmd+K, source id from
 * definitions-core-3.ts). The optional session id lets split panes route the
 * chord to the focused pane instead of clearing a sibling.
 */
export const TERMINAL_CLEAR_EVENT = "drogon:terminal-clear";
/** Dispatched by the shell dispatcher for the terminal-scope Find chord. */
export const TERMINAL_SEARCH_EVENT = "drogon:terminal-search";

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
 * Dispatched by the context menu's Close Pane item. App owns the close
 * effect (R16-AL2, issue #228): the event routes to the confirmed
 * `session.close` path, which stops a live PTY and forgets the record —
 * the pane only reports the event.
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

/**
 * Resolves the construction-time typography: explicit props win, otherwise
 * the persisted envelope (GPU-reader pattern). Pure enough to run once in
 * the ref initializer; storage failures fall through to xterm defaults.
 */
function resolveInitialTypography(options: {
  fontFamily?: string;
  fontWeight?: number;
  fontWeightBold?: number;
}): { fontFamily: string; fontWeight: number; fontWeightBold: number } {
  let family = options.fontFamily;
  let weight = options.fontWeight;
  let boldWeight = options.fontWeightBold;
  if (
    (family === undefined ||
      weight === undefined ||
      boldWeight === undefined) &&
    typeof window !== "undefined"
  ) {
    try {
      const persisted = readTerminalTypography(window.localStorage);
      family ??= persisted.terminalFontFamily;
      weight ??= persisted.terminalFontWeight;
      boldWeight ??= persisted.terminalFontWeightBold;
    } catch {
      // Storage unavailable: fall through to the defaults below.
    }
  }
  const weights = resolveTerminalFontWeights(weight, boldWeight);
  return {
    fontFamily: buildTerminalFontFamily(family ?? ""),
    fontWeight: weights.fontWeight,
    fontWeightBold: weights.fontWeightBold,
  };
}

type TerminalDebugRegistry = Map<string, Terminal>;
declare global {
  interface Window {
    __drogonTerminals?: TerminalDebugRegistry;
  }
}
function registerTerminalDebugHandle(sessionId: string, terminal: Terminal) {
  if (typeof window === "undefined") return;
  const registry = (window.__drogonTerminals ??= new Map());
  registry.set(sessionId, terminal);
}
function unregisterTerminalDebugHandle(sessionId: string, terminal: Terminal) {
  if (typeof window === "undefined") return;
  const registry = window.__drogonTerminals;
  if (registry?.get(sessionId) === terminal) registry.delete(sessionId);
}

export function TerminalPane({
  session,
  fontSize,
  fontFamily,
  fontWeight,
  fontWeightBold,
  gpuMode,
  canSplit,
  onSplitRight,
  recoveryNonce = 0,
  onError,
  onSession,
}: {
  session: Session;
  /** Terminal font size in px, mirrored from the settings store by App. */
  fontSize: number;
  /**
   * Source typography options (terminalFontFamily/terminalFontWeight/
   * terminalFontWeightBold). Optional: when omitted the pane reads the
   * persisted envelope at construction (same pattern as the GPU mode
   * reader), so App.tsx needs no new prop thread.
   */
  fontFamily?: string;
  fontWeight?: number;
  fontWeightBold?: number;
  /** Settings-owned GPU mode (App passes it; tests may omit it). */
  gpuMode?: TerminalGpuAcceleration;
  /**
   * Split Terminal Right availability for this pane's context menu (false
   * once the tab already holds two panes). Defaults to false so existing
   * single-pane hosts keep today's menu.
   */
  canSplit?: boolean;
  /** Split entry point for this pane (context menu item). */
  onSplitRight?: () => void;
  /**
   * R16-AL2 (issue #228): advances each time the user clicked Retry
   * connection and the fresh session list confirmed THIS pane's session
   * is still `unverifiable`. While the nonce is ahead of the pane's
   * dismissed nonce, the pane shows the recovery overlay (the fork's
   * exited-overlay structure with its Restart action) instead of the inert
   * retry loop. Omitted by hosts that never retry (tests, split host
   * callers pre-dating the prop): the overlay simply never shows.
   */
  recoveryNonce?: number;
  onError(message: string): void;
  onSession(value: Session): void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onError, onSession });
  callbacks.current = { onError, onSession };
  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;
  // Typography options resolve once per mount: explicit props win, otherwise
  // the persisted envelope (Settings change applies on next pane mount; the
  // live effect below also pushes prop-driven updates without remounting).
  const typographyRef = useRef<{
    fontFamily: string;
    fontWeight: number;
    fontWeightBold: number;
  }>(resolveInitialTypography({ fontFamily, fontWeight, fontWeightBold }));
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
  const daemonConnection = useDaemonConnection();
  const [menu, setMenu] = useState<TerminalContextMenuPoint | null>(null);
  const [processExit, setProcessExit] = useState<TerminalProcessExit | null>(
    () => projectTerminalProcessExit(session),
  );
  // R16-AL2 (issue #228): the nonce of the retry offer this pane has
  // dismissed. A remounting pane (tabs are cleared while a retry
  // refreshes) starts un-dismissed at the current nonce, so the offer only
  // ever re-arms on a NEW retry click that again confirms unverifiable.
  const [dismissedRecoveryNonce, setDismissedRecoveryNonce] = useState(0);
  // R12-E: the source's link action popover — plain clicks on a file link
  // open this instead of doing nothing; direct (⌘/Ctrl) clicks still open.
  const [linkActionRequest, setLinkActionRequest] =
    useState<TerminalLinkActionRequest | null>(null);
  const linkPointerGesture = useRef<TerminalLinkPointerGesture | null>(null);
  const linkActionContext = useRef<TerminalLinkActionContext | null>(null);
  const dismissedExitKey = useRef<string | null>(null);
  const [linkTooltip, setLinkTooltip] = useState<string | null>(null);
  const live = useRef<{
    terminal: Terminal;
    fit: FitAddon;
    search: SearchAddon;
    input: TerminalInputQueue;
    focus: () => void;
    pasteFromClipboard: (source: TerminalPasteSource) => void;
    /** Re-fit plus WebGL attach/DPR repair (every fit is a heal chance). */
    syncRenderer: () => void;
  } | null>(null);
  const gpuModeRef = useRef(gpuMode);
  gpuModeRef.current = gpuMode;
  // Lets the settings-owned GPU mode effect below drive the mount effect's
  // WebGL state without remounting the session.
  const webglSyncRef = useRef<{
    disable(): void;
    recover(): void;
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
    const ownsEvent = (event: Event): boolean => {
      const detail = (event as CustomEvent<{ sessionId?: unknown }>).detail;
      return (
        detail?.sessionId === undefined ||
        detail.sessionId === sessionRef.current.id
      );
    };
    const onClear = (event: Event) => {
      if (ownsEvent(event)) live.current?.terminal.clear();
    };
    const onSearch = (event: Event) => {
      if (ownsEvent(event)) setSearchOpen(true);
    };
    window.addEventListener(TERMINAL_CLEAR_EVENT, onClear);
    window.addEventListener(TERMINAL_SEARCH_EVENT, onSearch);
    return () => {
      window.removeEventListener(TERMINAL_CLEAR_EVENT, onClear);
      window.removeEventListener(TERMINAL_SEARCH_EVENT, onSearch);
    };
  }, []);

  // Applies a later settings change without remounting the session: the
  // creation effect below stays keyed on session identity only. A zoom
  // override wins over the settings size until ⌘0 resets it. Typography
  // props ride the same effect so a Settings edit applies live.
  useEffect(() => {
    const current = live.current;
    if (!current) return;
    current.terminal.options.fontSize = zoomOverride ?? fontSize;
    const weights = resolveTerminalFontWeights(fontWeight, fontWeightBold);
    if (fontFamily !== undefined)
      current.terminal.options.fontFamily = buildTerminalFontFamily(fontFamily);
    if (fontWeight !== undefined)
      current.terminal.options.fontWeight = weights.fontWeight;
    if (fontWeightBold !== undefined)
      current.terminal.options.fontWeightBold = weights.fontWeightBold;
    // A metrics change can strand the WebGL backing store exactly like a DPR
    // change, so this goes through the same fit+attach+repair sync (#153).
    current.syncRenderer();
  }, [fontSize, fontFamily, fontWeight, fontWeightBold, zoomOverride]);

  useEffect(() => {
    const mount = surface.current!;
    const initialScheme = readEffectiveSchemeFromRoot(
      typeof document !== "undefined" ? document.documentElement : null,
    );
    const terminal = new Terminal({
      fontFamily: typographyRef.current.fontFamily,
      fontSize: zoomOverrideRef.current ?? fontSizeRef.current,
      fontWeight: typographyRef.current.fontWeight,
      fontWeightBold: typographyRef.current.fontWeightBold,
      cursorBlink: true,
      cursorStyle: "block",
      scrollback: 5000,
      // Required for the SearchAddon match-decoration colors (proposed API).
      allowProposedApi: true,
      screenReaderMode: true,
      theme:
        composeActiveTerminalTheme(terminalThemeForScheme(initialScheme), {}) ??
        undefined,
    });
    // Debug/e2e registry like Orca's `window.__paneManagers`: rendered
    // acceptance reads the live buffer here because the WebGL renderer
    // paints to a canvas and leaves no row text in the DOM.
    registerTerminalDebugHandle(session.id, terminal);
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
    // WebGL with canvas fallback per the renderer policy (#153, fork
    // pane-webgl-renderer.ts): the addon bakes cell metrics and the DPR at
    // construction, so it activates only after the first non-zero layout
    // while visible; a late attach is followed by a refit (the grid was
    // measured under the DOM renderer) and every fit/resize/visibility/DPR
    // event re-offers attach plus a backing-store repair. A failed
    // load/activation keeps the canvas renderer and latches only until the
    // next recovery boundary — never a permanent downgrade.
    const webgl: {
      addon: WebglAddon | null;
      attachPending: boolean;
      failedSinceRecovery: boolean;
      refitRafId: number | null;
    } = {
      addon: null,
      attachPending: false,
      failedSinceRecovery: false,
      refitRafId: null,
    };
    // IntersectionObserver is the reveal signal (fork schedulePaneRevealRepaint);
    // until it fires, page visibility is the best known state.
    const paneVisible = {
      current:
        typeof document === "undefined" ||
        document.visibilityState !== "hidden",
    };
    const isGpuEnabled = () =>
      resolvePaneRendererPolicy({
        userGpuMode:
          gpuModeRef.current ??
          readTerminalGpuAcceleration(window.localStorage),
      }).gpuEnabled;
    const refreshViewport = () => {
      try {
        terminal.refresh(0, Math.max(0, terminal.rows - 1));
      } catch {
        // Pane may be mid-teardown; the next reveal/fit retries.
      }
    };
    const cancelPendingWebglRefit = () => {
      if (webgl.refitRafId === null) return;
      if (typeof cancelAnimationFrame === "function") {
        try {
          cancelAnimationFrame(webgl.refitRafId);
        } catch {
          // Ignore: the frame may already have run.
        }
      }
      webgl.refitRafId = null;
    };
    let disconnectCanvasWatch: (() => void) | null = null;
    const unwatchWebglCanvasBackingStore = () => {
      disconnectCanvasWatch?.();
      disconnectCanvasWatch = null;
    };
    const watchWebglCanvasBackingStore = () => {
      unwatchWebglCanvasBackingStore();
      if (disposed || webgl.addon === null) return;
      // The addon's own device-pixel observer resizes the backing store
      // behind the renderer's back when the compositor DPR disagrees with
      // the cached one (#153): no fit/resize/visibility event follows, so
      // the canvas itself is watched and a silent resize rebuilds through
      // the resize path. Predicate-gated: a converged canvas goes quiet.
      disconnectCanvasWatch = observeTerminalWebglCanvasBackingStore(
        terminal,
        () => {
          if (!disposed) repairTerminalWebglBackingStore(terminal);
        },
      );
    };
    const attachWebgl = () => {
      if (
        !shouldAttachTerminalWebgl({
          gpuEnabled: isGpuEnabled(),
          hasLayout: hasMeasurableTerminalBox(mount),
          isVisible: paneVisible.current,
          alreadyAttached: webgl.addon !== null || webgl.attachPending,
          attachFailedSinceRecovery: webgl.failedSinceRecovery,
        })
      ) {
        return;
      }
      // Fetch off the critical path (fork primeTerminalWebglAddon); the
      // layout/visibility gates re-run in the continuation because the pane
      // may have hidden while the chunk loaded.
      webgl.attachPending = true;
      void primeTerminalWebglAddon().then((constructor) => {
        webgl.attachPending = false;
        if (disposed || webgl.addon !== null || webgl.failedSinceRecovery) {
          return;
        }
        if (
          !shouldAttachTerminalWebgl({
            gpuEnabled: isGpuEnabled(),
            hasLayout: hasMeasurableTerminalBox(mount),
            isVisible: paneVisible.current,
            alreadyAttached: false,
            attachFailedSinceRecovery: false,
          })
        ) {
          return;
        }
        if (!constructor) {
          // Chunk load failed: latch like a failed construction so the pane
          // retries at a recovery boundary instead of on every frame.
          webgl.failedSinceRecovery = true;
          return;
        }
        let addon: WebglAddon | null = null;
        try {
          // Single-addon invariant: never stack a second addon on a live one.
          unwatchWebglCanvasBackingStore();
          disposeTerminalWebglAddon(webgl.addon);
          webgl.addon = null;
          addon = new constructor();
          addon.onContextLoss(() => {
            // Lost context wipes the glyph atlas: fall back to canvas until
            // the next recovery boundary (fork context-loss policy).
            webgl.failedSinceRecovery = true;
            unwatchWebglCanvasBackingStore();
            disposeTerminalWebglAddon(webgl.addon);
            if (!disposed) webgl.addon = null;
          });
          terminal.loadAddon(addon);
          webgl.addon = addon;
          watchWebglCanvasBackingStore();
          // A newly attached canvas starts empty; repaint immediately so the
          // pane does not look frozen until new output lands.
          refreshViewport();
          // The running grid was measured under the DOM renderer (WebGL
          // floors the device cell width): refit on the next frame, once
          // xterm has re-measured against the new renderer.
          cancelPendingWebglRefit();
          const refit = () => {
            webgl.refitRafId = null;
            fitAndSyncTerminal();
          };
          if (typeof requestAnimationFrame === "function") {
            webgl.refitRafId = requestAnimationFrame(refit);
          } else {
            setTimeout(refit, 0);
          }
        } catch {
          webgl.failedSinceRecovery = true;
          try {
            addon?.dispose();
          } catch {
            // A half-constructed addon may throw on dispose.
          }
          if (!disposed) webgl.addon = null;
        }
      });
    };
    // Every successful layout is the event-anchored moment a canvas-stuck
    // pane can heal (fork attachWebglAfterFitIfMissing): fit() itself no-ops
    // when cols/rows match, so the attach offer and the DPR repair must run
    // explicitly — they are the only path that rebuilds a stale backing
    // store and glyph atlas.
    const fitAndSyncTerminal = () => {
      if (disposed || !hasMeasurableTerminalBox(mount)) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      if (webgl.addon === null) attachWebgl();
      repairTerminalWebglBackingStore(terminal);
    };
    const osc52Handler = createOsc52OscHandler({
      // OSC 52 clipboard defaults on (source gate); queries stay blocked.
      getSettingEnabled: () => true,
      // True while the initial history catch-up is being painted, so a
      // stale `\e]52;…` in scrollback cannot overwrite a newer clipboard.
      getReplaying: () => !caughtUp.current,
      writeClipboardText,
      showBlockedWriteToast: () => showOsc52ClipboardBlockedToast(),
      showWriteFailedToast: () => {
        void report("Terminal clipboard write failed.");
        showOsc52ClipboardFailedToast();
      },
    });
    terminal.parser.registerOscHandler(52, (data) => osc52Handler(data));
    // Fork parity (pane-pty-visibility-bind.ts onBell): BEL raises an
    // attention signal, debounced so completion bursts surface once. The
    // renderer cannot reach the native notification service, so the signal
    // is a toast with the fork's copy, gated by the master switch and
    // silent while this window is focused.
    const disposeBell = installTerminalBell(terminal, {
      notificationsEnabled: () => {
        try {
          return readBellNotificationsEnabled(window.localStorage);
        } catch {
          return true;
        }
      },
      terminalFocused: () =>
        typeof document !== "undefined" && document.hasFocus(),
      labels: () => ({}),
      notify: (title, body) => {
        void toast(title, { description: body });
      },
    });
    // Fork parity (terminal-url-link-hit-testing.ts openTerminalHttpLink):
    // a modifier-held direct activation states the destination outright —
    // the in-app browser tab — skipping the routing preference; ⇧ inverts
    // to the system browser like the fork's alternate destination. The
    // popover's "Open link" (no gesture event) always opens a tab: terminal
    // link UI never routes to the system browser unasked.
    const openHttpUrl = async (
      url: string,
      event?: Pick<MouseEvent, "shiftKey">,
    ): Promise<{ ok: true } | { ok: false; message: string }> => {
      if (event?.shiftKey) {
        window.dispatchEvent(
          new CustomEvent("drogon:open-external-url", {
            detail: { url },
          }),
        );
        return { ok: true };
      }
      const workspaceId = sessionRef.current.workspaceId;
      if (!workspaceId) {
        return {
          ok: false,
          message: "No workspace is selected, so the link cannot open.",
        };
      }
      try {
        const result = await windowBrowserBridge().createTab({
          workspaceId,
          url,
        });
        return result.ok
          ? { ok: true }
          : { ok: false, message: result.error.message };
      } catch {
        return { ok: false, message: "The link could not be opened." };
      }
    };
    terminal.loadAddon(
      new WebLinksAddon((event, url) =>
        handleTerminalWebLinkClick(url, event, {
          openUrl: (linkUrl) => openHttpUrl(linkUrl, event ?? undefined),
          requestAction: (mouse) =>
            requestTerminalLinkAction(mouse, linkActionContext.current, {
              destination: url,
              kind: "url",
              primary: {
                label: "Open link",
                run: () => {
                  void openHttpUrl(url).then((result) => {
                    if (!result.ok) report(result.message);
                  });
                },
              },
            }),
          clearSelection: () => terminal.clearSelection(),
          report,
        }),
      ),
    );
    const fileLinkProvider: ILinkProvider = {
      provideLinks: (bufferLineNumber, callback) => {
        // Why -1: xterm hands the provider a 1-based buffer line number;
        // getLine is 0-based. The #68 port read the row below the cursor,
        // so file links never hit-tested on the row they print on.
        const line = terminal.buffer.active.getLine(bufferLineNumber - 1);
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
              // Direct activation (⌘/Ctrl+click) opens as before; a plain
              // click raises the source's link action popover instead of
              // being ignored (R12-E remainder).
              if (isTerminalLinkDirectActivation(mouse)) {
                mouse?.preventDefault?.();
                requestTerminalFileOpen({
                  path: parsed.path,
                  line: parsed.line,
                  column: parsed.column,
                  workspaceId: sessionRef.current.workspaceId,
                  openWithSystemDefault: Boolean(mouse?.shiftKey),
                });
                terminal.clearSelection();
                setLinkTooltip(null);
                return;
              }
              requestTerminalLinkAction(mouse, linkActionContext.current, {
                destination: parsed.path,
                kind: "file",
                primary: {
                  label: "Open file",
                  run: () =>
                    requestTerminalFileOpen({
                      path: parsed.path,
                      line: parsed.line,
                      column: parsed.column,
                      workspaceId: sessionRef.current.workspaceId,
                      openWithSystemDefault: false,
                    }),
                },
                alternate: {
                  label: isMac ? "Open in Finder" : "Open folder",
                  run: () =>
                    requestTerminalFileOpen({
                      path: parsed.path,
                      line: parsed.line,
                      column: parsed.column,
                      workspaceId: sessionRef.current.workspaceId,
                      openWithSystemDefault: true,
                    }),
                },
              });
              void linkText;
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
    // Wait between read retries while the daemon is unreachable: long enough
    // to stay quiet, short enough that a returning service resumes promptly.
    const TERMINAL_READ_RETRY_MS = 2000;
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
      pasteFromClipboard: (source: TerminalPasteSource) =>
        paste.pasteFromClipboard(source),
      syncRenderer: fitAndSyncTerminal,
    };
    // Paste policy target (R12-E): plan/execute writes bracketed or chunked
    // paste payloads through the same policy modules as the source. The
    // chunked path writes the PTY directly (source parity); direct and
    // bracketed paths go through xterm's input/paste, i.e. the same queue
    // as keyboard input.
    const paste = createTerminalPanePaste({
      sessionIdentity: inputIdentity,
      writePty: (data) =>
        window.drogon
          .write({ ...inputIdentity, text: data })
          .then((result) => {
            if (!result.ok) {
              report(result.error.message);
              return false;
            }
            return true;
          })
          .catch(() => false),
      isTargetCurrent: () => !disposed && canWrite,
      report,
    });
    paste.bindTerminal(terminal);
    const disposePasteListeners = registerTerminalPanePasteListeners({
      container: mount,
      paste,
      isMac:
        typeof navigator !== "undefined" && navigator.userAgent.includes("Mac"),
    });
    // The gesture + action context back the file-link popover: a plain click
    // (no drag, no selection) on a link raises the popover; PTY mouse-report
    // suppression is out of MVP scope, so the claim always succeeds.
    linkPointerGesture.current = installTerminalLinkPointerGesture(terminal);
    // Fork parity (terminal-linkifier-click-priming.ts): xterm snapshots its
    // current link on mousedown but resolves links only on mousemove, so a
    // capture-phase primer re-runs the hover resolution for owned gestures
    // before xterm's own mousedown snapshot.
    const disposeLinkClickPriming =
      installTerminalLinkifierClickPriming(terminal);
    linkActionContext.current = {
      paneId: 1,
      pointerGesture: linkPointerGesture.current,
      claimPtyMouse: () => true,
      request: setLinkActionRequest,
      focusTerminal: () => terminal.focus(),
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
    // R16-AT replay pacing: a fresh mount seeks to the live edge, discarding
    // older ring pages without parsing them, and renders only the retained
    // 512 KiB tail (fork terminal-scrollback-limits). Session observations
    // fan out to the shell per read otherwise — thousands of full-app
    // re-render triggers while a big scrollback replays.
    const replayTail = createReplayTailBuffer();
    const sessionUpdates = createSessionUpdateCoalescer();
    const outputDecoder = new TextDecoder();
    let seeking = true;
    let seekPages = 0;
    let readInFlight = false;
    const emitSessionUpdate = (value: Session) => {
      const signal: SessionSignal = {
        verdict: value.verdict,
        exitCode: value.exitCode,
        incarnation: value.incarnation,
        cols: value.cols,
        rows: value.rows,
        agentState: value.agentState,
        agentStateAt: value.agentStateAt,
        harnessId: value.harnessId,
      };
      if (!sessionUpdates.shouldEmit(signal, Date.now())) return;
      lastObserved = value;
      callbacks.current.onSession(value);
    };
    // Loss of contact is never proof of exit: a read failure or transport
    // error must not leave a stale "live" badge showing. Once exited is
    // positively observed, that stays authoritative — a later transport
    // hiccup does not un-exit a session that already reported its real end.
    const projectUnverifiable = () => {
      if (lastObserved.verdict === "exited") return;
      // Already projected: keep polling quietly instead of re-emitting the
      // same verdict (and re-rendering the shell) on every retry.
      if (lastObserved.verdict === "unverifiable") return;
      lastObserved = { ...lastObserved, verdict: "unverifiable" };
      callbacks.current.onSession(lastObserved);
    };
    // A failed read never freezes the pane and never raises an app-level
    // error: the verdict projection already flips the tab to unverifiable
    // (with its own retry affordance), and while the daemon is down the
    // connection banner covers the outage. The loop keeps polling so a
    // returning service resumes on its own; scrollback stays untouched.
    const scheduleReadRetry = () => {
      canWrite = false;
      projectUnverifiable();
      if (!disposed) timeout = setTimeout(read, TERMINAL_READ_RETRY_MS);
    };
    const subscription = terminal.onData((text) => {
      // Source parity: Ctrl+C can leave xterm's bracketed-paste bit stale;
      // the mark lets the next single-line paste skip the wrappers.
      if (text === "\x03") markTerminalBracketedPasteInterrupted(terminal);
      void queue.enqueue(text);
    });
    // 0x0 containers stay deferred: the ResizeObserver below retries once
    // the pane has a live box (fork canMeasurePaneForFit).
    const fitTerminal = () => fitAndSyncTerminal();
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
    // Reveal is a recovery boundary (fork terminal-visibility-resume): a pane
    // created while its tab was hidden attaches, repairs and repaints here,
    // once it has a live box. A stale failure latch must not strand it on
    // the canvas renderer (fork resumeRendering).
    const revealPane = () => {
      if (disposed || !paneVisible.current) return;
      // A hidden pane polls at TERMINAL_HIDDEN_POLL_MS; a reveal should not
      // wait out that cadence for fresh output (R16-AT read pacing).
      clearTimeout(timeout);
      if (!readInFlight) timeout = setTimeout(read, 0);
      webgl.failedSinceRecovery = false;
      fitAndSyncTerminal();
      // A hidden-time DPR change can strand the glyph atlas at the old scale
      // while canvas and dimensions still agree (fork settled-reveal reset).
      if (webgl.addon !== null) clearTerminalWebglAtlas(webgl.addon);
      refreshViewport();
    };
    let visibility: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === "function") {
      visibility = new IntersectionObserver((entries) => {
        const entry = entries[entries.length - 1];
        paneVisible.current = !!entry?.isIntersecting;
        if (paneVisible.current) revealPane();
      });
      visibility.observe(mount);
    }
    const onPageVisibilityChange = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "hidden") {
        paneVisible.current = false;
        return;
      }
      paneVisible.current = true;
      revealPane();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onPageVisibilityChange);
    }
    // xterm's own DPR monitor misses changes that land while the pane has no
    // box (parked/off-screen window, #153): re-arm per DPR and re-sync, so a
    // display move heals through the same fit+attach+repair path.
    let dprMedia: MediaQueryList | null = null;
    const onDprChange = () => {
      armDprListener();
      fitAndSyncTerminal();
    };
    const armDprListener = () => {
      dprMedia?.removeEventListener("change", onDprChange);
      dprMedia = null;
      if (
        typeof matchMedia !== "function" ||
        typeof window === "undefined" ||
        typeof window.devicePixelRatio !== "number"
      ) {
        return;
      }
      dprMedia = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      dprMedia.addEventListener("change", onDprChange);
    };
    armDprListener();
    // Lets the settings-owned GPU mode apply live without remounting.
    webglSyncRef.current = {
      disable: () => {
        // User turned the GPU off: canvas fallback, no failure latch.
        cancelPendingWebglRefit();
        unwatchWebglCanvasBackingStore();
        disposeTerminalWebglAddon(webgl.addon);
        webgl.addon = null;
        if (!disposed && hasMeasurableTerminalBox(mount)) {
          try {
            fit.fit();
          } catch {
            // Container may not have dimensions yet.
          }
          refreshViewport();
        }
      },
      recover: () => {
        // GPU-mode change is a recovery boundary (fork
        // resetTerminalWebglSuggestion): re-arm the load and retry WebGL
        // instead of stranding the pane on the canvas renderer.
        rearmTerminalWebglAddonLoad();
        webgl.failedSinceRecovery = false;
        if (disposed) return;
        attachWebgl();
        fitAndSyncTerminal();
      },
    };
    fitTerminal();
    // First attach offer defers itself while the box is 0x0 or hidden; the
    // observers above retry (fork: activate only after first non-zero layout).
    // The addon chunk fetch starts here, off the critical path.
    attachWebgl();
    if (document.activeElement?.getAttribute("role") !== "tab")
      terminal.focus();
    async function read() {
      if (disposed || readInFlight) return;
      readInFlight = true;
      try {
        const response = await window.drogon.read({
          ...inputIdentity,
          cursor,
        });
        if (disposed) return;
        if (!response.ok) {
          scheduleReadRetry();
          return;
        }
        const value = response.result;
        const bytes = Uint8Array.from(atob(value.dataBase64), (char) =>
          char.charCodeAt(0),
        );
        if (seeking) {
          // Seek phase: retain the newest tail of the ring without writing
          // anything, until a short page says the live edge is reached (or
          // the page guard trips on a session that out-writes the seek).
          seekPages += 1;
          replayTail.push(bytes, value.truncated);
          cursor = value.nextCursor;
          if (shouldKeepSeeking(bytes.length, seekPages)) {
            timeout = setTimeout(read, 0);
            return;
          }
          seeking = false;
          const dropped = replayTail.dropped;
          const tailChunks = replayTail.drain();
          if (dropped)
            terminal.write("\r\n[Earlier output is no longer retained]\r\n");
          for (const chunk of tailChunks) {
            // Track DECA 2004 (bracketed paste) transitions in the PTY
            // output so the paste policy brackets/decrypts exactly when the
            // app asked.
            observeTerminalBracketedPasteModeOutput(
              terminal,
              outputDecoder.decode(chunk),
            );
            await new Promise<void>((resolve) =>
              terminal.write(chunk, resolve),
            );
            if (disposed) return;
          }
          caughtUp.current = bytes.length < TERMINAL_READ_PAGE_BYTES;
          canWrite = value.session.verdict === "live";
          emitSessionUpdate(value.session);
          const exit = projectTerminalProcessExit(value.session);
          if (exit) showExit(exit);
          timeout = setTimeout(
            read,
            paneVisible.current ? TERMINAL_LIVE_POLL_MS : TERMINAL_HIDDEN_POLL_MS,
          );
          return;
        }
        if (value.truncated)
          terminal.write("\r\n[Earlier output is no longer retained]\r\n");
        // Track DECA 2004 (bracketed paste) transitions in the PTY output so
        // the paste policy brackets/decrypts exactly when the app asked.
        observeTerminalBracketedPasteModeOutput(
          terminal,
          outputDecoder.decode(bytes),
        );
        await new Promise<void>((resolve) => terminal.write(bytes, resolve));
        if (disposed) return;
        cursor = value.nextCursor;
        canWrite = value.session.verdict === "live";
        emitSessionUpdate(value.session);
        if (bytes.length < TERMINAL_READ_PAGE_BYTES) caughtUp.current = true;
        const exit = projectTerminalProcessExit(value.session);
        if (exit) showExit(exit);
        if (value.session.verdict === "exited" && bytes.length === 0) return;
        timeout = setTimeout(
          read,
          bytes.length === TERMINAL_READ_PAGE_BYTES
            ? 0
            : paneVisible.current
              ? TERMINAL_LIVE_POLL_MS
              : TERMINAL_HIDDEN_POLL_MS,
        );
      } catch {
        scheduleReadRetry();
      } finally {
        readInFlight = false;
      }
    }
    void read();
    return () => {
      disposed = true;
      live.current = null;
      webglSyncRef.current = null;
      unregisterTerminalDebugHandle(session.id, terminal);
      setSearchAddon(null);
      clearTimeout(timeout);
      media.removeEventListener("change", updateTheme);
      rootObserver.disconnect();
      observer.disconnect();
      visibility?.disconnect();
      if (typeof document !== "undefined") {
        document.removeEventListener(
          "visibilitychange",
          onPageVisibilityChange,
        );
      }
      dprMedia?.removeEventListener("change", onDprChange);
      cancelPendingWebglRefit();
      unwatchWebglCanvasBackingStore();
      disposeTerminalWebglAddon(webgl.addon);
      webgl.addon = null;
      disposePasteListeners();
      disposeBell.dispose();
      disposeLinkClickPriming.dispose();
      linkPointerGesture.current?.dispose();
      linkPointerGesture.current = null;
      linkActionContext.current = null;
      setLinkActionRequest(null);
      fileLinkDisposable.dispose();
      subscription.dispose();
      resize.dispose();
      terminal.dispose();
    };
    // Keyed on session identity only; font size rides the effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, session.incarnation]);

  // Settings-owned GPU mode applies live without remounting the session
  // (R11-A single writer): `off` drops to the canvas renderer, `on`/`auto`
  // re-arms the addon load and retries the attach at this recovery boundary.
  useEffect(() => {
    const sync = webglSyncRef.current;
    if (!sync) return;
    if (gpuMode === "off") sync.disable();
    else sync.recover();
    // Keyed on the mode only; the mount effect owns everything else.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpuMode]);

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
    void copyTerminalSelection({
      terminal: current.terminal,
      writeClipboardText,
    })
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
    const focus = current.focus;
    current.pasteFromClipboard("context-menu");
    focus();
  };
  const splitRight = () => {
    setMenu(null);
    onSplitRight?.();
    current?.focus();
  };
  const copyTerminalId = () => {
    setMenu(null);
    void copyTerminalHandleForPane({
      handle: sessionRef.current.id,
      writeClipboardText,
    })
      .then(() => {
        void toast.success("Terminal ID copied");
      })
      .catch(() => {
        callbacks.current.onError("Copy failed: clipboard unavailable.");
        void toast.error("Unable to copy terminal ID");
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
    // App owns close semantics (R16-AL2, issue #228): the event routes to
    // the confirmed `session.close` path, which stops a live PTY and
    // forgets the record — including unverifiable stubs. A second,
    // pane-local stop here would race that RPC (a stub already forgotten
    // answers `not_found` and would surface a spurious error banner).
    window.dispatchEvent(new CustomEvent(TERMINAL_CLOSE_EVENT, { detail }));
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
  // R16-AL2 (issue #228): the recovery overlay for a session an explicit
  // Retry click confirmed still unverifiable. Same overlay component and
  // actions as the exit overlay (Restart re-launches the same harness,
  // Close dismisses the offer); only the copy differs and never asserts
  // an exit. `null` while the offer does not apply.
  const recoveryOffer = showRecoveryOverlay({
    verdict: session.verdict,
    recoveryNonce,
    dismissedNonce: dismissedRecoveryNonce,
    connected: daemonConnection.state === "connected",
  });
  const dismissRecoveryOffer = () => {
    setDismissedRecoveryNonce(recoveryNonce);
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
      ) : recoveryOffer ? (
        <TerminalProcessExitOverlay
          processExit={{ exitCode: null, reason: "connection-unrecoverable" }}
          onRestart={restartExits}
          onClose={dismissRecoveryOffer}
        />
      ) : null}
      {/* Daemon loss keeps the tab and its scrollback: the banner covers
          the stalled pane while live/unverifiable sessions wait to
          re-attach. Exited sessions keep the exit overlay above instead —
          a confirmed exit never re-attaches. */}
      {daemonConnection.state !== "connected" &&
      isRecoverableAfterReconnect(session.verdict) ? (
        <DaemonReconnectBanner />
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
        canSplit={canSplit ?? false}
        splitShortcut={splitRightShortcutLabel(isMac)}
        onSplitRight={splitRight}
        onCopyTerminalId={copyTerminalId}
        onClearScreen={clearScreen}
        onClosePane={closePane}
      />
      <TerminalLinkActionPopover
        request={linkActionRequest}
        onClose={(dismissed) =>
          setLinkActionRequest((currentRequest) =>
            closeTerminalLinkActionRequest(currentRequest, dismissed),
          )
        }
      />
    </div>
  );
}

// Re-exported so tests and future App wiring share one contract.
export { TERMINAL_FILE_OPEN_EVENT };
export type { TerminalFileOpenDetail };
