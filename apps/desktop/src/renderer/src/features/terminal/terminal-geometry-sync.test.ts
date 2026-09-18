import { expect, test, vi } from "vitest";
import {
  createTerminalGeometrySync,
  TERMINAL_GEOMETRY_RECONCILE_MIN_INTERVAL_MS,
  TERMINAL_GRID_MAX_DIMENSION,
} from "./terminal-geometry-sync";
const wide = { cols: 76, rows: 26 };
const narrow = { cols: 21, rows: 26 };
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("reasserts a resize dropped while unavailable without needing another xterm resize event", async () => {
  let ready = false;
  const send = vi.fn(async () => {});
  const sync = createTerminalGeometrySync({ isReady: () => ready, send, onError: vi.fn() });
  sync.request(wide); sync.request(narrow);
  expect(send).not.toHaveBeenCalled();
  ready = true; sync.flush(); await settle();
  expect(send.mock.calls).toEqual([[narrow]]);
  sync.flush(); await settle();
  expect(send).toHaveBeenCalledTimes(1);
});
test("serializes and coalesces resizes, never allowing stale completion after the latest", async () => {
  const first = deferred();
  const send = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
  const sync = createTerminalGeometrySync({ isReady: () => true, send, onError: vi.fn() });
  sync.request(wide); sync.request({ cols: 40, rows: 26 }); sync.request(narrow);
  expect(send).toHaveBeenCalledTimes(1);
  first.resolve(); await settle();
  expect(send.mock.calls).toEqual([[wide], [narrow]]);
});
test("retries a failed confirmation on the next live event, without a busy loop", async () => {
  const send = vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue(undefined);
  const onError = vi.fn();
  const sync = createTerminalGeometrySync({ isReady: () => true, send, onError });
  sync.request(narrow); await settle();
  expect(send).toHaveBeenCalledTimes(1); expect(onError).toHaveBeenCalledTimes(1);
  sync.flush(); await settle();
  expect(send).toHaveBeenCalledTimes(2);
});
test("an old acknowledgment cannot confirm geometry across a connection boundary", async () => {
  let ready = true;
  const first = deferred();
  const send = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
  const sync = createTerminalGeometrySync({ isReady: () => ready, send, onError: vi.fn() });
  sync.request(wide);
  ready = false; sync.invalidate(); first.resolve(); await settle();
  expect(send).toHaveBeenCalledTimes(1);
  ready = true; sync.flush(); await settle();
  expect(send.mock.calls).toEqual([[wide], [wide]]);
});
test("hidden panes retain desired geometry without taking the viewport", async () => {
  let visible = true;
  const send = vi.fn(async () => {});
  const sync = createTerminalGeometrySync({ isReady: () => visible, send, onError: vi.fn() });
  sync.request(wide); await settle();
  visible = false; sync.invalidate(); sync.request(narrow); sync.flush();
  expect(send).toHaveBeenCalledTimes(1);
  visible = true; sync.flush(); await settle();
  expect(send).toHaveBeenLastCalledWith(narrow);
});
test("disposal fences pending completion and prevents later requests", async () => {
  const first = deferred();
  const send = vi.fn().mockReturnValue(first.promise);
  const onError = vi.fn();
  const sync = createTerminalGeometrySync({ isReady: () => true, send, onError });
  sync.request(wide); sync.request(narrow); sync.dispose();
  first.reject(new Error("old failure")); await settle(); sync.flush(); sync.request(wide);
  expect(send).toHaveBeenCalledTimes(1); expect(onError).not.toHaveBeenCalled();
});

// #598: the pty grid is the daemon's, not this pane's cache of its own last
// send. Anything else holding the session can resize it, and a pane frozen
// one grid away from its pty renders an agent's redraws against the wrong
// geometry for the rest of the session.
test("an external pty resize is corrected from the size the daemon reports", async () => {
  const send = vi.fn(async () => {});
  const sync = createTerminalGeometrySync({ isReady: () => true, send, onError: vi.fn(), now: () => 0 });
  sync.request(wide);
  await settle();
  expect(send.mock.calls).toEqual([[wide]]);
  // One report may predate the resize that just landed; it proves nothing.
  expect(sync.observe(narrow)).toBe(false);
  expect(send).toHaveBeenCalledTimes(1);
  // The next report is evidence: something else resized the pty.
  expect(sync.observe(narrow)).toBe(true);
  await settle();
  expect(send.mock.calls).toEqual([[wide], [wide]]);
});
test("a matching report is not a resize, and no xterm event is needed to stay quiet", async () => {
  const send = vi.fn(async () => {});
  const sync = createTerminalGeometrySync({ isReady: () => true, send, onError: vi.fn(), now: () => 0 });
  sync.request(wide);
  await settle();
  sync.observe(wide);
  for (let i = 0; i < 5; i += 1) sync.observe(wide);
  await settle();
  expect(send).toHaveBeenCalledTimes(1);
});
test("a report confirms a send whose acknowledgment never arrived", async () => {
  const send = vi.fn().mockRejectedValueOnce(new Error("transport lost")).mockResolvedValue(undefined);
  const sync = createTerminalGeometrySync({ isReady: () => true, send, onError: vi.fn(), now: () => 0 });
  sync.request(wide);
  await settle();
  expect(send).toHaveBeenCalledTimes(1);
  sync.observe(wide); // stale-report skip
  sync.observe(wide); // the pty did take the size after all
  sync.flush();
  await settle();
  expect(send).toHaveBeenCalledTimes(1);
});
// The pane pairs every answered read with observe() and then an
// unconditional flush() (TerminalPane read loop, both branches). Any rate
// limit that only gates the flush inside observe() is decorative: dropping
// the cached confirmation is itself what lets the pane's own flush send.
// These drive that exact pairing, which is the only shape production has.
const readTick = async (
  sync: ReturnType<typeof createTerminalGeometrySync>,
  reported: { cols: number; rows: number },
) => {
  // The verdict matters as much as the send count: when the cache is null
  // for any reason the pane's own flush() sends too, so a send alone cannot
  // distinguish "observe corrected this" from "observe was bypassed".
  const corrected = sync.observe(reported);
  sync.flush();
  await settle();
  return corrected;
};
test("corrective resizes are rate limited under the pane's own observe-then-flush tick", async () => {
  const send = vi.fn(async () => {});
  let clock = 0;
  const sync = createTerminalGeometrySync({ isReady: () => true, send, onError: vi.fn(), now: () => clock });
  sync.request(wide);
  await settle();
  send.mockClear();
  // A second writer holding the session at `narrow` for a second of reads.
  for (let i = 0; i < 20; i += 1) {
    await readTick(sync, narrow);
    clock += 50;
  }
  expect(send).toHaveBeenCalledTimes(1);
  clock += TERMINAL_GEOMETRY_RECONCILE_MIN_INTERVAL_MS;
  await readTick(sync, narrow);
  await readTick(sync, narrow);
  expect(send).toHaveBeenCalledTimes(2);
});
test("a floor-blocked report leaves the confirmation standing so the pane's flush stays quiet", async () => {
  const send = vi.fn(async () => {});
  let clock = 0;
  const sync = createTerminalGeometrySync({ isReady: () => true, send, onError: vi.fn(), now: () => clock });
  sync.request(wide);
  await settle();
  await readTick(sync, narrow); // stale-report skip
  send.mockClear();
  expect(await readTick(sync, narrow)).toBe(true); // the one corrective resize
  expect(send).toHaveBeenCalledTimes(1);
  send.mockClear();
  clock += 100;
  // The corrective send armed its own skip, so this tick proves nothing.
  await readTick(sync, narrow);
  // This one reaches the floor: neither observe() nor the pane's trailing
  // flush may send, which requires the cached confirmation to still stand.
  expect(await readTick(sync, narrow)).toBe(false);
  expect(send).not.toHaveBeenCalled();
});
test("an external resize still heals within one read tick of the floor expiring", async () => {
  const send = vi.fn(async () => {});
  let clock = 10_000;
  const sync = createTerminalGeometrySync({ isReady: () => true, send, onError: vi.fn(), now: () => clock });
  sync.request(wide);
  await settle();
  send.mockClear();
  await readTick(sync, narrow); // stale-report skip
  expect(send).not.toHaveBeenCalled();
  await readTick(sync, narrow);
  expect(send.mock.calls).toEqual([[wide]]);
});
test("a wall clock that steps backwards cannot park reconciliation", async () => {
  const send = vi.fn(async () => {});
  let clock = 1_000_000;
  const sync = createTerminalGeometrySync({ isReady: () => true, send, onError: vi.fn(), now: () => clock });
  sync.request(wide);
  await settle();
  await readTick(sync, narrow); // stale-report skip
  send.mockClear();
  expect(await readTick(sync, narrow)).toBe(true);
  expect(send).toHaveBeenCalledTimes(1);
  // ntp correction / host resume: an hour backwards.
  clock -= 3_600_000;
  send.mockClear();
  await readTick(sync, narrow); // the skip that every send arms
  // The correction must come from observe() itself. Without the rewind
  // guard the floor still blocks here and any send is the trailing flush
  // leaking through a cache observe() should not have dropped.
  expect(await readTick(sync, narrow)).toBe(true);
  expect(send).toHaveBeenCalledTimes(1);
});
test("a send completing after a connection boundary does not eat a genuine report", async () => {
  let ready = true;
  const inflight = deferred();
  const send = vi.fn().mockReturnValueOnce(inflight.promise).mockResolvedValue(undefined);
  const sync = createTerminalGeometrySync({ isReady: () => ready, send, onError: vi.fn(), now: () => 0 });
  sync.request(wide);
  expect(send).toHaveBeenCalledTimes(1);
  // The transport dropped and came back: nothing is left in transit, so the
  // late completion must not arm a skip that swallows the next report. Held
  // unready across the boundary so the re-send cannot mask the skip.
  ready = false;
  sync.invalidate();
  inflight.resolve();
  await settle();
  expect(send).toHaveBeenCalledTimes(1);
  ready = true;
  send.mockClear();
  // The very first report after the boundary is genuine evidence, and it is
  // observe() that must act on it.
  expect(await readTick(sync, narrow)).toBe(true);
  expect(send.mock.calls).toEqual([[wide]]);
});
// Precedence, pinned deliberately: a session being displayed is sized by the
// surface displaying it. A visible pane already takes the pty on its first
// fit, so this only makes that ownership survive a later external resize;
// a hidden pane never takes it.
test("the visible pane owns the grid of the session it is displaying", async () => {
  let visible = true;
  const send = vi.fn(async () => {});
  const sync = createTerminalGeometrySync({ isReady: () => visible, send, onError: vi.fn(), now: () => 0 });
  sync.request(wide);
  await settle();
  await readTick(sync, wide); // stale-report skip, then confirmed
  await readTick(sync, wide);
  send.mockClear();
  // Something else takes the pty while this pane is hidden. A hidden pane
  // neither corrects nor drops its cache, so the pane's own flush on reveal
  // has nothing to re-send: the correction must come from the next report.
  visible = false;
  expect(await readTick(sync, narrow)).toBe(false);
  expect(await readTick(sync, narrow)).toBe(false);
  expect(send).not.toHaveBeenCalled();
  visible = true;
  sync.flush();
  await settle();
  expect(send).not.toHaveBeenCalled();
  expect(await readTick(sync, narrow)).toBe(true);
  expect(send.mock.calls).toEqual([[wide]]);
});
test("a grid past the daemon's limit is asked for at the limit, not retried forever", async () => {
  const send = vi.fn(async () => {});
  const onError = vi.fn();
  const sync = createTerminalGeometrySync({ isReady: () => true, send, onError, now: () => 0 });
  // A 5K display at the minimum font zoom measures past the daemon's bound.
  sync.request({ cols: 1500, rows: 26 });
  await settle();
  const clamped = { cols: TERMINAL_GRID_MAX_DIMENSION, rows: 26 };
  expect(send.mock.calls).toEqual([[clamped]]);
  send.mockClear();
  // The pty answers with what it took. That is agreement, not a
  // contradiction to correct, so no banner loop and no SIGWINCH per tick.
  for (let i = 0; i < 10; i += 1) expect(await readTick(sync, clamped)).toBe(false);
  expect(send).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
});
test("reports during an in-flight resize are ignored, and nonsense reports never resize", async () => {
  const first = deferred();
  const send = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
  const sync = createTerminalGeometrySync({ isReady: () => true, send, onError: vi.fn(), now: () => 0 });
  sync.request(wide);
  expect(sync.observe(narrow)).toBe(false);
  first.resolve();
  await settle();
  expect(send).toHaveBeenCalledTimes(1);
  expect(sync.observe({ cols: 0, rows: 0 })).toBe(false);
  expect(sync.observe({ cols: 80.5, rows: 24 })).toBe(false);
  expect(sync.observe({ cols: Number.NaN, rows: 24 })).toBe(false);
  await settle();
  expect(send).toHaveBeenCalledTimes(1);
});
test("a pane that never measured a grid has nothing to assert", async () => {
  const send = vi.fn(async () => {});
  const sync = createTerminalGeometrySync({ isReady: () => true, send, onError: vi.fn(), now: () => 0 });
  expect(sync.observe(wide)).toBe(false);
  await settle();
  expect(send).not.toHaveBeenCalled();
});
test("a disposed pane never resizes the pty from a late report", async () => {
  const send = vi.fn(async () => {});
  const sync = createTerminalGeometrySync({ isReady: () => true, send, onError: vi.fn(), now: () => 0 });
  sync.request(wide);
  await settle();
  sync.dispose();
  expect(sync.observe(narrow)).toBe(false);
  await settle();
  expect(send).toHaveBeenCalledTimes(1);
});
test("a connection boundary disarms a skip the completed send left behind", async () => {
  const send = vi.fn(async () => {});
  const sync = createTerminalGeometrySync({ isReady: () => true, send, onError: vi.fn(), now: () => 0 });
  sync.request(wide);
  await settle(); // completes, arming the one stale-report skip
  // The transport then dropped. Nothing is left in transit, so the armed
  // skip is stale bookkeeping: the first report after the boundary is
  // genuine evidence and observe() itself must act on it.
  sync.invalidate();
  send.mockClear();
  expect(await readTick(sync, narrow)).toBe(true);
  expect(send.mock.calls).toEqual([[wide]]);
});
