import { describe, expect, it } from "vitest";
import {
  createReplayTailBuffer,
  createSessionUpdateCoalescer,
  shouldKeepSeeking,
  TERMINAL_READ_PAGE_BYTES,
  TERMINAL_REPLAY_TAIL_BYTE_LIMIT,
  TERMINAL_SEEK_MAX_PAGES,
} from "./terminal-read-pacing";

describe("createReplayTailBuffer", () => {
  it("keeps everything under the limit without marking a drop", () => {
    const tail = createReplayTailBuffer(100);
    tail.push(new Uint8Array([1, 2, 3]), false);
    tail.push(new Uint8Array([4, 5, 6]), false);
    expect(tail.dropped).toBe(false);
    const drained = tail.drain();
    expect(drained.map((c) => [...c])).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it("drops the oldest chunks past the limit and marks the replay dropped", () => {
    const tail = createReplayTailBuffer(100);
    const page = new Uint8Array(60);
    tail.push(page, false);
    tail.push(new Uint8Array(60), false);
    expect(tail.dropped).toBe(true);
    const drained = tail.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]).toHaveLength(60);
  });

  it("marks a drop when the daemon itself reports truncation", () => {
    const tail = createReplayTailBuffer(TERMINAL_REPLAY_TAIL_BYTE_LIMIT);
    tail.push(new Uint8Array([1]), true);
    expect(tail.dropped).toBe(true);
  });

  it("drain empties the buffer so a live read starts clean", () => {
    const tail = createReplayTailBuffer(100);
    tail.push(new Uint8Array([1]), false);
    tail.drain();
    expect(tail.drain()).toEqual([]);
  });
});

describe("shouldKeepSeeking", () => {
  it("keeps seeking on full pages below the page guard", () => {
    expect(shouldKeepSeeking(TERMINAL_READ_PAGE_BYTES, 1)).toBe(true);
    expect(shouldKeepSeeking(TERMINAL_READ_PAGE_BYTES, TERMINAL_SEEK_MAX_PAGES - 1)).toBe(true);
  });

  it("stops at a short page (live edge)", () => {
    expect(shouldKeepSeeking(TERMINAL_READ_PAGE_BYTES - 1, 1)).toBe(false);
    expect(shouldKeepSeeking(0, 1)).toBe(false);
  });

  it("stops at the page guard even when pages stay full", () => {
    expect(shouldKeepSeeking(TERMINAL_READ_PAGE_BYTES, TERMINAL_SEEK_MAX_PAGES)).toBe(false);
    expect(shouldKeepSeeking(TERMINAL_READ_PAGE_BYTES, TERMINAL_SEEK_MAX_PAGES + 10)).toBe(false);
  });
});

describe("createSessionUpdateCoalescer", () => {
  const live = { verdict: "live", exitCode: null, incarnation: "i-1", cols: 80, rows: 24 };
  const exited = { ...live, verdict: "exited", exitCode: 0 };

  it("emits the first observation", () => {
    const c = createSessionUpdateCoalescer(500);
    expect(c.shouldEmit(live, 1000)).toBe(true);
  });

  it("coalesces metadata-only repeats inside the interval", () => {
    const c = createSessionUpdateCoalescer(500);
    expect(c.shouldEmit(live, 1000)).toBe(true);
    expect(c.shouldEmit(live, 1200)).toBe(false);
    expect(c.shouldEmit(live, 1499)).toBe(false);
    expect(c.shouldEmit(live, 1500)).toBe(true);
  });

  it("emits structural changes instantly, even inside the interval", () => {
    const c = createSessionUpdateCoalescer(500);
    expect(c.shouldEmit(live, 1000)).toBe(true);
    expect(c.shouldEmit(exited, 1100)).toBe(true);
    expect(c.shouldEmit(exited, 1200)).toBe(false);
  });

  it("treats agent-state transitions as structural", () => {
    const c = createSessionUpdateCoalescer(500);
    expect(c.shouldEmit(live, 1000)).toBe(true);
    expect(c.shouldEmit({ ...live, agentState: "needs_input", agentStateAt: "t" }, 1050)).toBe(true);
    expect(c.shouldEmit({ ...live, agentState: "needs_input", agentStateAt: "t" }, 1100)).toBe(false);
  });

  it("restarts the throttle window after an emitted repeat", () => {
    const c = createSessionUpdateCoalescer(500);
    c.shouldEmit(live, 1000);
    expect(c.shouldEmit(live, 1500)).toBe(true);
    expect(c.shouldEmit(live, 1800)).toBe(false);
    expect(c.shouldEmit(live, 2000)).toBe(true);
  });
});
