// MIT Copyright (c) 2026 Lovecast Inc. Tests for the #153 WebGL activation
// order and guards: attach only after the first non-zero layout while
// visible, stale-backing-store detection, and the DPR repair call order.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import {
  clearTerminalWebglAtlas,
  disposeTerminalWebglAddon,
  getTerminalWebglAddonConstructor,
  hasMeasurableTerminalBox,
  observeTerminalWebglCanvasBackingStore,
  primeTerminalWebglAddon,
  repairTerminalWebglBackingStore,
  shouldAttachTerminalWebgl,
  terminalWebglBackingStoreIsStale,
  type TerminalWebglRenderer,
} from "./terminal-webgl-lifecycle";

function fakeCanvas(box: {
  width: number;
  height: number;
  connected?: boolean;
  dpr?: number;
}) {
  return {
    width: box.width,
    height: box.height,
    isConnected: box.connected ?? true,
    ownerDocument: { defaultView: { devicePixelRatio: box.dpr ?? 1 } },
  };
}

function fakeRenderer(box: {
  backingWidth: number;
  backingHeight: number;
  expectedWidth: number;
  expectedHeight: number;
  cachedDpr?: number;
  dpr?: number;
  connected?: boolean;
}): TerminalWebglRenderer {
  return {
    _canvas: fakeCanvas({
      width: box.backingWidth,
      height: box.backingHeight,
      connected: box.connected,
      dpr: box.dpr,
    }) as unknown as HTMLCanvasElement,
    _devicePixelRatio: box.cachedDpr,
    dimensions: {
      device: {
        canvas: { width: box.expectedWidth, height: box.expectedHeight },
      },
    },
    handleDevicePixelRatioChange: () => {},
    handleResize: () => {},
  };
}

describe("hasMeasurableTerminalBox", () => {
  it("rejects null and 0x0 containers (hidden mount, #153)", () => {
    expect(hasMeasurableTerminalBox(null)).toBe(false);
    expect(hasMeasurableTerminalBox(undefined)).toBe(false);
    expect(
      hasMeasurableTerminalBox({ clientWidth: 0, clientHeight: 0 }),
    ).toBe(false);
    expect(
      hasMeasurableTerminalBox({ clientWidth: 824, clientHeight: 0 }),
    ).toBe(false);
    expect(
      hasMeasurableTerminalBox({
        isConnected: false,
        clientWidth: 824,
        clientHeight: 711,
      }),
    ).toBe(false);
  });

  it("accepts a laid-out container", () => {
    expect(
      hasMeasurableTerminalBox({ clientWidth: 824, clientHeight: 711 }),
    ).toBe(true);
    expect(
      hasMeasurableTerminalBox({
        isConnected: true,
        clientWidth: 824,
        clientHeight: 711,
      }),
    ).toBe(true);
  });
});

describe("shouldAttachTerminalWebgl", () => {
  const healthy = {
    gpuEnabled: true,
    hasLayout: true,
    isVisible: true,
    alreadyAttached: false,
    attachFailedSinceRecovery: false,
  };

  it("attaches after the first non-zero layout while visible", () => {
    expect(shouldAttachTerminalWebgl(healthy)).toBe(true);
  });

  it("defers while the pane has no layout or is hidden", () => {
    expect(
      shouldAttachTerminalWebgl({ ...healthy, hasLayout: false }),
    ).toBe(false);
    expect(
      shouldAttachTerminalWebgl({ ...healthy, isVisible: false }),
    ).toBe(false);
  });

  it("never stacks a second addon and honors the failure latch", () => {
    expect(
      shouldAttachTerminalWebgl({ ...healthy, alreadyAttached: true }),
    ).toBe(false);
    expect(
      shouldAttachTerminalWebgl({
        ...healthy,
        attachFailedSinceRecovery: true,
      }),
    ).toBe(false);
  });

  it("stays on canvas when the renderer policy disables the GPU", () => {
    expect(
      shouldAttachTerminalWebgl({ ...healthy, gpuEnabled: false }),
    ).toBe(false);
  });
});

describe("terminalWebglBackingStoreIsStale", () => {
  it("is current when the backing store matches at the live DPR", () => {
    expect(
      terminalWebglBackingStoreIsStale(
        fakeRenderer({
          backingWidth: 756,
          backingHeight: 720,
          expectedWidth: 756,
          expectedHeight: 720,
          cachedDpr: 1,
        }),
        1,
      ),
    ).toBe(false);
  });

  it("detects the #153 state: 2x backing store for a 1x device box", () => {
    expect(
      terminalWebglBackingStoreIsStale(
        fakeRenderer({
          backingWidth: 1512,
          backingHeight: 1440,
          expectedWidth: 756,
          expectedHeight: 720,
          cachedDpr: 1,
        }),
        1,
      ),
    ).toBe(true);
  });

  it("detects a cached DPR that no longer matches the live one", () => {
    expect(
      terminalWebglBackingStoreIsStale(
        fakeRenderer({
          backingWidth: 1545,
          backingHeight: 1410,
          expectedWidth: 1545,
          expectedHeight: 1410,
          cachedDpr: 1,
        }),
        2,
      ),
    ).toBe(true);
  });

  it("tolerates xterm's CSS rounding round trip", () => {
    expect(
      terminalWebglBackingStoreIsStale(
        fakeRenderer({
          backingWidth: 757,
          backingHeight: 720,
          expectedWidth: 756,
          expectedHeight: 720,
          cachedDpr: 1,
        }),
        1,
      ),
    ).toBe(false);
  });

  it("reports nothing to repair without a live canvas or known dims", () => {
    const detached = fakeRenderer({
      backingWidth: 1512,
      backingHeight: 1440,
      expectedWidth: 756,
      expectedHeight: 720,
      cachedDpr: 1,
      connected: false,
    });
    expect(terminalWebglBackingStoreIsStale(detached, 1)).toBe(false);
    const unknownDims = fakeRenderer({
      backingWidth: 1512,
      backingHeight: 1440,
      expectedWidth: 0,
      expectedHeight: 0,
      cachedDpr: 1,
    });
    expect(terminalWebglBackingStoreIsStale(unknownDims, 1)).toBe(false);
    expect(
      terminalWebglBackingStoreIsStale(
        { dimensions: { device: { canvas: { width: 8, height: 8 } } } },
        1,
      ),
    ).toBe(false);
  });
});

describe("repairTerminalWebglBackingStore", () => {
  function fakeTerminal(
    renderer: TerminalWebglRenderer | null,
    calls: string[],
  ): Terminal {
    return {
      cols: 108,
      rows: 48,
      refresh: () => {
        calls.push("refresh");
      },
      _core: { _renderService: { _renderer: { value: renderer } } },
    } as unknown as Terminal;
  }

  it("refreshes the DPR first, then resizes, then repaints (order matters)", () => {
    const calls: string[] = [];
    const renderer = fakeRenderer({
      backingWidth: 1512,
      backingHeight: 1440,
      expectedWidth: 756,
      expectedHeight: 720,
      cachedDpr: 1,
    });
    renderer.handleDevicePixelRatioChange = () => {
      calls.push("dpr");
    };
    renderer.handleResize = (cols, rows) => {
      calls.push(`resize:${cols}x${rows}`);
    };
    const repaired = repairTerminalWebglBackingStore(
      fakeTerminal(renderer, calls),
    );
    expect(repaired).toBe(true);
    expect(calls).toEqual(["dpr", "resize:108x48", "refresh"]);
  });

  it("leaves a current backing store alone", () => {
    const calls: string[] = [];
    const renderer = fakeRenderer({
      backingWidth: 756,
      backingHeight: 720,
      expectedWidth: 756,
      expectedHeight: 720,
      cachedDpr: 1,
    });
    renderer.handleDevicePixelRatioChange = () => {
      calls.push("dpr");
    };
    const repaired = repairTerminalWebglBackingStore(
      fakeTerminal(renderer, calls),
    );
    expect(repaired).toBe(false);
    expect(calls).toEqual([]);
  });

  it("is a no-op on the DOM/canvas fallback (no WebGL renderer)", () => {
    const calls: string[] = [];
    expect(repairTerminalWebglBackingStore(fakeTerminal(null, calls))).toBe(
      false,
    );
    expect(calls).toEqual([]);
  });
});

describe("disposeTerminalWebglAddon", () => {
  it("disposes and tolerates a half-constructed addon", () => {
    let disposed = 0;
    disposeTerminalWebglAddon({
      dispose: () => {
        disposed += 1;
      },
    });
    expect(disposed).toBe(1);
    expect(() =>
      disposeTerminalWebglAddon({
        dispose: () => {
          throw new Error("half-constructed");
        },
      }),
    ).not.toThrow();
    expect(() => disposeTerminalWebglAddon(null)).not.toThrow();
    expect(() => disposeTerminalWebglAddon(undefined)).not.toThrow();
  });
});

describe("clearTerminalWebglAtlas", () => {
  it("clears a live atlas and tolerates failures", () => {
    let cleared = 0;
    expect(
      clearTerminalWebglAtlas({
        clearTextureAtlas: () => {
          cleared += 1;
        },
      }),
    ).toBe(true);
    expect(cleared).toBe(1);
    expect(
      clearTerminalWebglAtlas({
        clearTextureAtlas: () => {
          throw new Error("lost");
        },
      }),
    ).toBe(false);
    expect(clearTerminalWebglAtlas(null)).toBe(false);
    expect(clearTerminalWebglAtlas(undefined)).toBe(false);
  });
});

describe("observeTerminalWebglCanvasBackingStore", () => {
  const realResizeObserver = (globalThis as Record<string, unknown>)
    .ResizeObserver;
  afterEach(() => {
    if (realResizeObserver === undefined) {
      delete (globalThis as Record<string, unknown>).ResizeObserver;
    } else {
      (globalThis as Record<string, unknown>).ResizeObserver =
        realResizeObserver;
    }
  });

  function stubResizeObserver() {
    const seen: { target: unknown; options: unknown }[] = [];
    let callback: (() => void) | null = null;
    let disconnected = 0;
    class FakeResizeObserver {
      constructor(cb: () => void) {
        callback = cb;
      }
      observe(target: unknown, options?: unknown) {
        seen.push({ target, options });
      }
      disconnect() {
        disconnected += 1;
      }
    }
    (globalThis as Record<string, unknown>).ResizeObserver =
      FakeResizeObserver;
    return {
      seen,
      fire: () => callback?.(),
      disconnected: () => disconnected,
    };
  }

  function terminalWithCanvas(canvas: unknown): Terminal {
    return {
      cols: 80,
      rows: 24,
      refresh: () => {},
      _core: {
        _renderService: {
          _renderer: {
            value: {
              _canvas: canvas,
              handleDevicePixelRatioChange: () => {},
            },
          },
        },
      },
    } as unknown as Terminal;
  }

  it("watches the live canvas device-pixel box and disconnects", () => {
    const stub = stubResizeObserver();
    const canvas = { width: 100, height: 100, isConnected: true };
    const onChange = vi.fn();
    const disconnect = observeTerminalWebglCanvasBackingStore(
      terminalWithCanvas(canvas),
      onChange,
    );
    expect(disconnect).not.toBe(null);
    expect(stub.seen).toEqual([
      { target: canvas, options: { box: "device-pixel-content-box" } },
    ]);
    stub.fire();
    expect(onChange).toHaveBeenCalledTimes(1);
    disconnect?.();
    expect(stub.disconnected()).toBe(1);
    stub.fire();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("returns null without a WebGL canvas or observer support", () => {
    stubResizeObserver();
    expect(
      observeTerminalWebglCanvasBackingStore(
        terminalWithCanvas(null),
        () => {},
      ),
    ).toBe(null);
    delete (globalThis as Record<string, unknown>).ResizeObserver;
    expect(
      observeTerminalWebglCanvasBackingStore(
        terminalWithCanvas({ width: 1, height: 1, isConnected: true }),
        () => {},
      ),
    ).toBe(null);
  });
});

describe("primeTerminalWebglAddon", () => {
  it("shares one load and resolves the constructor", async () => {
    const first = primeTerminalWebglAddon();
    const second = primeTerminalWebglAddon();
    expect(second).toBe(first);
    const constructor = await first;
    expect(typeof constructor).toBe("function");
    expect(getTerminalWebglAddonConstructor()).toBe(constructor);
  });
});
