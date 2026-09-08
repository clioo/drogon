import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEditorSaveQueue } from "./editor-save-queue";

// Why: `queueSave` chains onto `previous.catch().then(run)`, so even the
// very first call to a key with nothing queued defers `run` by a couple of
// microtask turns (promise reactions never run synchronously). Real code
// only ever observes this through `await`ing the returned promise; these
// helpers flush the same turns for tests that need to assert mid-flight.
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("createEditorSaveQueue: queueSave", () => {
  it("runs a single save immediately", async () => {
    const queue = createEditorSaveQueue();
    const run = vi.fn(async () => {});
    await queue.queueSave("a", run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("serializes overlapping saves for the same key in call order", async () => {
    const queue = createEditorSaveQueue();
    const order: string[] = [];
    let resolveFirst: (() => void) | undefined;
    const first = queue.queueSave("a", () => {
      order.push("first-start");
      return new Promise<void>((resolve) => {
        resolveFirst = () => {
          order.push("first-end");
          resolve();
        };
      });
    });
    const second = queue.queueSave("a", async () => {
      order.push("second");
    });
    await flushMicrotasks();
    // The second save must not have run yet — it is queued behind the first.
    expect(order).toEqual(["first-start"]);
    resolveFirst?.();
    await first;
    await second;
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });

  it("runs saves for different keys independently (no cross-key blocking)", async () => {
    const queue = createEditorSaveQueue();
    const order: string[] = [];
    let resolveA: (() => void) | undefined;
    const a = queue.queueSave("a", () => {
      order.push("a-start");
      return new Promise<void>((resolve) => {
        resolveA = () => {
          order.push("a-end");
          resolve();
        };
      });
    });
    const b = queue.queueSave("b", async () => {
      order.push("b");
    });
    await b;
    expect(order).toEqual(["a-start", "b"]);
    resolveA?.();
    await a;
  });

  it("a failed save does not block the next queued save for the same key", async () => {
    const queue = createEditorSaveQueue();
    const order: string[] = [];
    const failing = queue.queueSave("a", async () => {
      order.push("fail");
      throw new Error("boom");
    });
    const next = queue.queueSave("a", async () => {
      order.push("next");
    });
    await expect(failing).rejects.toThrow("boom");
    await next;
    expect(order).toEqual(["fail", "next"]);
  });
});

describe("createEditorSaveQueue: quiesce", () => {
  it("resolves immediately when nothing is queued", async () => {
    const queue = createEditorSaveQueue();
    await expect(queue.quiesce("a")).resolves.toBeUndefined();
  });

  it("waits for the in-flight save to settle, even if it fails", async () => {
    const queue = createEditorSaveQueue();
    let resolveRun: (() => void) | undefined;
    const settled: string[] = [];
    void queue
      .queueSave("a", () => new Promise<void>((resolve) => (resolveRun = resolve)))
      .catch(() => {});
    await flushMicrotasks();
    const quiesced = queue.quiesce("a").then(() => settled.push("quiesced"));
    resolveRun?.();
    await quiesced;
    expect(settled).toEqual(["quiesced"]);
  });
});

describe("createEditorSaveQueue: autosave scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires the scheduled save after the delay", async () => {
    const queue = createEditorSaveQueue();
    const run = vi.fn(async () => {});
    queue.scheduleAutosave("a", 800, run);
    // Why Async: `scheduleAutosave`'s timer callback calls `queueSave`,
    // whose `.then(run)` needs a microtask turn to fire even once the fake
    // clock reaches the deadline — `advanceTimersByTimeAsync` drains those
    // turns between firing timers, unlike the sync `advanceTimersByTime`.
    await vi.advanceTimersByTimeAsync(799);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("rescheduling before the delay elapses resets the timer (debounce)", async () => {
    const queue = createEditorSaveQueue();
    const run = vi.fn(async () => {});
    queue.scheduleAutosave("a", 800, run);
    await vi.advanceTimersByTimeAsync(500);
    queue.scheduleAutosave("a", 800, run);
    await vi.advanceTimersByTimeAsync(500);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("cancelAutosave prevents the pending save from firing", () => {
    const queue = createEditorSaveQueue();
    const run = vi.fn(async () => {});
    queue.scheduleAutosave("a", 800, run);
    queue.cancelAutosave("a");
    vi.advanceTimersByTime(2_000);
    expect(run).not.toHaveBeenCalled();
  });

  it("dispose clears every pending autosave timer", () => {
    const queue = createEditorSaveQueue();
    const run = vi.fn(async () => {});
    queue.scheduleAutosave("a", 800, run);
    queue.scheduleAutosave("b", 800, run);
    queue.dispose();
    vi.advanceTimersByTime(2_000);
    expect(run).not.toHaveBeenCalled();
  });
});
