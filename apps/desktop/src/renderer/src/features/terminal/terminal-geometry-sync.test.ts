import { expect, test, vi } from "vitest";
import {
  createTerminalGeometrySync,
  TERMINAL_GEOMETRY_RECONCILE_MIN_INTERVAL_MS,
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
test("corrective resizes are rate limited so two surfaces cannot storm SIGWINCH", async () => {
  const send = vi.fn(async () => {});
  let clock = 0;
  const sync = createTerminalGeometrySync({ isReady: () => true, send, onError: vi.fn(), now: () => clock });
  sync.request(wide);
  await settle();
  send.mockClear();
  for (let i = 0; i < 20; i += 1) {
    sync.observe(narrow);
    await settle();
    clock += 50;
  }
  expect(send).toHaveBeenCalledTimes(1);
  clock += TERMINAL_GEOMETRY_RECONCILE_MIN_INTERVAL_MS;
  sync.observe(narrow);
  sync.observe(narrow);
  await settle();
  expect(send).toHaveBeenCalledTimes(2);
});
test("a hidden pane drops its stale confirmation but never takes the pty", async () => {
  let visible = true;
  const send = vi.fn(async () => {});
  const sync = createTerminalGeometrySync({ isReady: () => visible, send, onError: vi.fn(), now: () => 0 });
  sync.request(wide);
  await settle();
  visible = false;
  sync.observe(narrow);
  expect(sync.observe(narrow)).toBe(false);
  await settle();
  expect(send).toHaveBeenCalledTimes(1);
  visible = true;
  sync.flush();
  await settle();
  expect(send.mock.calls).toEqual([[wide], [wide]]);
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
