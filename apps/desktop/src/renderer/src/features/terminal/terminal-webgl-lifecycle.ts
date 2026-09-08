// MIT Copyright (c) 2026 Lovecast Inc. Ported from
// src/renderer/src/lib/pane-manager/terminal-canvas-dpr-repair.ts (DPR repair),
// src/renderer/src/lib/pane-manager/terminal-webgl-addon-loader.ts (primed lazy
// load) and src/renderer/src/lib/pane-manager/pane-webgl-renderer.ts
// (attach+refit pairing, single-addon invariant, failure latch).
// Adapted: the fork heals per-pane inside its PaneManager; Drogon has one
// xterm per TerminalPane, so the same guards live here and the pane calls
// them after every fit, resize, visibility change and DPR change.
import type { Terminal } from "@xterm/xterm";
import type { WebglAddon } from "@xterm/addon-webgl";

/** Structural view of xterm's WebGL renderer internals (no public API). */
export type TerminalWebglRenderer = {
  _canvas?: HTMLCanvasElement | null;
  _devicePixelRatio?: number;
  dimensions?: {
    device?: { canvas?: { width?: number; height?: number } };
  };
  handleDevicePixelRatioChange?: () => void;
  handleResize?: (cols: number, rows: number) => void;
};

type MeasurableBox = {
  isConnected?: boolean;
  clientWidth: number;
  clientHeight: number;
};

/**
 * Fork `canMeasurePaneForFit`: a pane with no box (0x0, detached, or
 * display:none) cannot be fitted and must not activate WebGL — the addon
 * bakes cell metrics and the DPR at construction, and a hidden-time attach
 * is what strands panes at half scale in the bottom-left quadrant (#153).
 */
export function hasMeasurableTerminalBox(
  element: MeasurableBox | null | undefined,
): boolean {
  if (!element) return false;
  if (element.isConnected === false) return false;
  return element.clientWidth > 0 && element.clientHeight > 0;
}

type TerminalInternals = {
  _core?: {
    _renderService?: { _renderer?: { value?: unknown } };
  };
};

/**
 * Returns the live WebGL renderer, or null when the pane is on the
 * canvas/DOM fallback (or before any renderer exists). Structural check:
 * only the WebGL renderer owns a canvas plus a DPR handler.
 */
export function readTerminalWebglRenderer(
  terminal: Terminal,
): TerminalWebglRenderer | null {
  const internals = terminal as unknown as TerminalInternals;
  const candidate = internals._core?._renderService?._renderer?.value as
    | Partial<TerminalWebglRenderer>
    | null
    | undefined;
  if (
    !candidate ||
    typeof candidate.handleDevicePixelRatioChange !== "function" ||
    !candidate._canvas
  ) {
    return null;
  }
  return candidate as TerminalWebglRenderer;
}

export type TerminalWebglAttachState = {
  /** Renderer policy gate (user GPU mode / capability / context loss). */
  gpuEnabled: boolean;
  /** First non-zero layout has happened (fork: measurable fit). */
  hasLayout: boolean;
  /** Pane is intersecting / the page is visible (fork: reveal). */
  isVisible: boolean;
  alreadyAttached: boolean;
  /** A failed attach latches until the next recovery boundary. */
  attachFailedSinceRecovery: boolean;
};

/**
 * Fork `attachWebgl` gate: WebGL activates only after the first non-zero
 * layout while visible. A failure never downgrades permanently — visibility,
 * DPR and GPU-mode changes are recovery boundaries that clear the latch and
 * retry (the caller owns the latch; this stays a pure predicate).
 */
export function shouldAttachTerminalWebgl(
  state: TerminalWebglAttachState,
): boolean {
  return (
    state.gpuEnabled &&
    state.hasLayout &&
    state.isVisible &&
    !state.alreadyAttached &&
    !state.attachFailedSinceRecovery
  );
}

/**
 * Fork `repairPaneWebglCanvasDpr`: true when the canvas backing store no
 * longer matches the renderer's device dimensions — a DPR change (or a
 * hidden-time attach) that xterm's own observer missed. The canvas then
 * composites a stale-scale bitmap: half/double-size or smeared text (#153).
 * False when there is no live canvas (nothing to repair, not "current").
 */
export function terminalWebglBackingStoreIsStale(
  renderer: TerminalWebglRenderer,
  devicePixelRatio: number,
): boolean {
  const canvas = renderer._canvas;
  if (!canvas || canvas.isConnected === false) return false;
  const expected = renderer.dimensions?.device?.canvas;
  const expectedWidth = expected?.width ?? 0;
  const expectedHeight = expected?.height ?? 0;
  if (!(expectedWidth > 0 && expectedHeight > 0)) return false;
  const cached = renderer._devicePixelRatio;
  if (typeof cached === "number" && cached !== devicePixelRatio) return true;
  // xterm rounds its CSS canvas size before converting back to device
  // pixels; allow that round trip instead of repairing on every fit.
  const tolerance = Math.max(1, Math.ceil(devicePixelRatio / 2));
  return (
    Math.abs(canvas.width - expectedWidth) > tolerance ||
    Math.abs(canvas.height - expectedHeight) > tolerance
  );
}

function readLiveDevicePixelRatio(
  canvas: HTMLCanvasElement | null | undefined,
): number {
  const fromCanvas = canvas?.ownerDocument?.defaultView?.devicePixelRatio;
  if (typeof fromCanvas === "number" && Number.isFinite(fromCanvas)) {
    return fromCanvas;
  }
  if (
    typeof window !== "undefined" &&
    typeof window.devicePixelRatio === "number"
  ) {
    return window.devicePixelRatio;
  }
  return 1;
}

/**
 * Runs xterm's own resize path against the live DPR and repaints. Order
 * matters (fork): refresh the cached DPR/dimensions first, then the resize
 * recreates the backing store, layer sizes and glyph atlas from them.
 * Returns true when a stale backing store was repaired.
 */
export function repairTerminalWebglBackingStore(
  terminal: Terminal,
): boolean {
  const renderer = readTerminalWebglRenderer(terminal);
  if (!renderer) return false;
  if (
    !terminalWebglBackingStoreIsStale(
      renderer,
      readLiveDevicePixelRatio(renderer._canvas),
    )
  ) {
    return false;
  }
  try {
    renderer.handleDevicePixelRatioChange?.();
    renderer.handleResize?.(terminal.cols, terminal.rows);
    terminal.refresh(0, Math.max(0, terminal.rows - 1));
  } catch {
    return false;
  }
  return true;
}

/**
 * Wipes the glyph atlas and model so the next paint re-rasterizes every
 * visible cell from the buffer (fork `resetWebglTextureAtlas`, run on every
 * settled reveal). Covers atlas-only staleness — a 1x atlas under a 2x
 * canvas with agreeing dimensions — which the backing-store predicate
 * cannot see. Buffer contents are untouched. Returns true when cleared.
 */
export function clearTerminalWebglAtlas(
  addon: Pick<WebglAddon, "clearTextureAtlas"> | null | undefined,
): boolean {
  if (!addon || typeof addon.clearTextureAtlas !== "function") return false;
  try {
    addon.clearTextureAtlas();
  } catch {
    return false;
  }
  return true;
}

/**
 * Watches the live WebGL canvas's device-pixel box and reports silent
 * backing-store resizes. xterm's addon resizes the canvas behind the
 * renderer's back when the compositor's DPR disagrees with the cached one
 * (parked/off-screen window, display move across a lazy attach) and no
 * fit, resize, visibility or DPR event ever follows — the pane would sit
 * half-scale forever. The report is predicate-gated by the caller
 * (`repairTerminalWebglBackingStore`), so a converged canvas goes quiet
 * instead of oscillating. Returns a disconnect, or null when unsupported.
 */
export function observeTerminalWebglCanvasBackingStore(
  terminal: Terminal,
  onBackingStoreChange: () => void,
): (() => void) | null {
  const canvas = readTerminalWebglRenderer(terminal)?._canvas;
  if (!canvas || typeof ResizeObserver === "undefined") return null;
  let live = true;
  let observer: ResizeObserver | null = null;
  try {
    observer = new ResizeObserver(() => {
      if (live) onBackingStoreChange();
    });
    observer.observe(canvas, { box: "device-pixel-content-box" });
  } catch {
    try {
      observer?.disconnect();
    } catch {
      // Ignore: the observer may already be torn down.
    }
    return null;
  }
  return () => {
    live = false;
    try {
      observer?.disconnect();
    } catch {
      // Ignore: disconnect must not throw on teardown paths.
    }
    observer = null;
  };
}

/** Release the GL context promptly: rapid re-activation can otherwise hit
 * Chromium's active-context budget (fork `releaseXtermWebglContext`). */
export function disposeTerminalWebglAddon(
  addon: Pick<WebglAddon, "dispose"> | null | undefined,
): void {
  if (!addon) return;
  try {
    const internals = addon as unknown as {
      _renderer?: {
        _gl?: {
          getExtension?: (name: string) => { loseContext?: () => void } | null;
        } | null;
        _canvas?: HTMLCanvasElement | null;
      } | null;
    };
    try {
      internals._renderer?._gl
        ?.getExtension?.("WEBGL_lose_context")
        ?.loseContext?.();
    } catch {
      // Teardown must not block the canvas fallback.
    }
    const canvas = internals._renderer?._canvas;
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  } catch {
    // Teardown must not block the canvas fallback.
  }
  try {
    addon.dispose();
  } catch {
    // A half-constructed addon may throw on dispose.
  }
}

type WebglAddonConstructor = new () => WebglAddon;

let webglAddonConstructor: WebglAddonConstructor | null = null;
let webglAddonLoad: Promise<WebglAddonConstructor | null> | null = null;

export function getTerminalWebglAddonConstructor(): WebglAddonConstructor | null {
  return webglAddonConstructor;
}

/**
 * Fork `primeTerminalWebglAddon`: the 139 KB addon stays out of the critical
 * path, but the first pane mount starts the fetch so the constructor is
 * usually resolved by the first non-zero layout. A failed load clears the
 * memo so the next recovery boundary retries instead of stranding every
 * later pane on the canvas renderer.
 */
export function primeTerminalWebglAddon(): Promise<WebglAddonConstructor | null> {
  if (webglAddonConstructor) return Promise.resolve(webglAddonConstructor);
  if (!webglAddonLoad) {
    webglAddonLoad = import("@xterm/addon-webgl").then(
      (module) => {
        webglAddonConstructor = module.WebglAddon;
        return webglAddonConstructor;
      },
      () => {
        webglAddonLoad = null;
        return null;
      },
    );
  }
  return webglAddonLoad;
}

/** Recovery boundary (GPU setting changed, pane revealed): let a failed
 * load try again (fork `rearmTerminalWebglAddonLoad`). */
export function rearmTerminalWebglAddonLoad(): void {
  if (webglAddonConstructor) return;
  webglAddonLoad = null;
}
