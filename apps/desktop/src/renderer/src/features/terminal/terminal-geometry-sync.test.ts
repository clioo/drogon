import { expect, test, vi } from "vitest";
import { createTerminalGeometrySync } from "./terminal-geometry-sync";
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
