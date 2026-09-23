import { describe, expect, it } from "vitest";
import {
  createReplayTailBuffer,
  createSessionUpdateCoalescer,
  shouldKeepSeeking,
  TERMINAL_READ_PAGE_BYTES,
  TERMINAL_REPLAY_TAIL_BYTE_LIMIT,
  TERMINAL_SEEK_MAX_PAGES,
} from "./terminal-read-pacing";

import type { ReplayTailPage } from "./terminal-read-pacing";

const page = (
  bytes: number[],
  overrides: Partial<ReplayTailPage> = {},
): ReplayTailPage => ({
  bytes: new Uint8Array(bytes),
  startCursor: 0,
  nextCursor: bytes.length,
  cols: 100,
  rows: 24,
  truncated: false,
  ...overrides,
});

describe("createReplayTailBuffer", () => {
  it("keeps everything under the limit without marking a drop", () => {
    const tail = createReplayTailBuffer(100);
    tail.push(page([1, 2, 3]));
    tail.push(page([4, 5, 6]));
    expect(tail.dropped).toBe(false);
    const drained = tail.drain();
    expect(drained.map((p) => [...p.bytes])).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it("keeps each page's grid report, so a replay can plan at its cuts", () => {
    // #605: the tail is replayed page by page, and a page that spans a resize
    // is only replayable at the right widths if its cuts survived the seek.
    const tail = createReplayTailBuffer(100);
    tail.push(
      page([1, 2, 3], {
        startCursor: 40,
        nextCursor: 43,
        cols: 72,
        rows: 24,
        gridCursor: 41,
        gridChanges: [{ cursor: 41, cols: 72, rows: 24 }],
      }),
    );
    const [kept] = tail.drain();
    expect(kept.startCursor).toBe(40);
    expect(kept.nextCursor).toBe(43);
    expect(kept.cols).toBe(72);
    expect(kept.gridCursor).toBe(41);
    expect(kept.gridChanges).toEqual([{ cursor: 41, cols: 72, rows: 24 }]);
  });

  it("drops the oldest pages past the limit and marks the replay dropped", () => {
    const tail = createReplayTailBuffer(100);
    const first = page(new Array(60).fill(1), { startCursor: 0, nextCursor: 60 });
    const second = page(new Array(60).fill(2), {
      startCursor: 60,
      nextCursor: 120,
    });
    tail.push(first);
    tail.push(second);
    expect(tail.dropped).toBe(true);
    const drained = tail.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0].bytes).toHaveLength(60);
    // The page that survived keeps the range it covers: dropping an older page
    // never renumbers a later one.
    expect(drained[0].startCursor).toBe(60);
  });

  it("marks a drop when the daemon itself reports truncation", () => {
    const tail = createReplayTailBuffer(TERMINAL_REPLAY_TAIL_BYTE_LIMIT);
    tail.push(page([1], { truncated: true }));
    expect(tail.dropped).toBe(true);
  });

  it("drain empties the buffer so a live read starts clean", () => {
    const tail = createReplayTailBuffer(100);
    tail.push(page([1]));
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
