import { expect, test } from "vitest";
import { TerminalInputQueue } from "./terminal-input-queue";

test("preserves the byte stream and UTF-8 accounting across coalescing", async () => {
  const seen: string[] = [];
  const queue = new TerminalInputQueue(
    async (text) => {
      seen.push(text);
      return {
        ok: true,
        result: { acceptedBytes: new TextEncoder().encode(text).length },
      };
    },
    () => true,
    (message) => {
      throw new Error(message);
    },
  );
  await Promise.all([queue.enqueue("ñ"), queue.enqueue("second")]);
  await queue.waitForDrain();
  // Coalesced or not, the pty receives exactly the typed byte stream in order.
  expect(seen.join("")).toBe("ñsecond");
  expect(seen.length).toBeGreaterThanOrEqual(1);
});

test("coalesces a dense input burst into one write", async () => {
  const seen: string[] = [];
  const queue = new TerminalInputQueue(
    async (text) => {
      // Hold each write open until the whole burst is queued, so the drain
      // observes the backlog the way a slow bridge round-trip presents it.
      await new Promise((resolve) => setTimeout(resolve, 20));
      seen.push(text);
      return {
        ok: true,
        result: { acceptedBytes: new TextEncoder().encode(text).length },
      };
    },
    () => true,
    (message) => {
      throw new Error(message);
    },
  );
  for (const key of ["a", "b", "c", "d", "e", "f"]) void queue.enqueue(key);
  await queue.waitForDrain();
  // Six keys queued within one macrotask coalesce into ONE write, not six
  // round-trips (fork drain parity).
  expect(seen).toEqual(["abcdef"]);
});

test("does not coalesce past the batch cap", async () => {
  const seen: string[] = [];
  const queue = new TerminalInputQueue(
    async (text) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      seen.push(text);
      return { ok: true, result: { acceptedBytes: text.length } };
    },
    () => true,
    (message) => {
      throw new Error(message);
    },
  );
  const big = "x".repeat(4096);
  void queue.enqueue(big);
  void queue.enqueue("tail");
  await queue.waitForDrain();
  expect(seen).toEqual([big, "tail"]);
});

test("ambiguous failure permanently fences queued input without retry", async () => {
  let calls = 0;
  const errors: string[] = [];
  const queue = new TerminalInputQueue(
    async () => {
      calls++;
      throw new Error("Disconnected after send");
    },
    () => true,
    (message) => errors.push(message),
  );
  await Promise.all([queue.enqueue("first"), queue.enqueue("second")]);
  await queue.waitForDrain();
  await queue.enqueue("new input despite later successful reads");
  await queue.waitForDrain();
  expect(calls).toBe(1);
  expect(errors).toHaveLength(1);
});

test("byte-mismatched confirmation fences queued input", async () => {
  const errors: string[] = [];
  const sent: string[] = [];
  const queue = new TerminalInputQueue(
    async (text) => {
      sent.push(text);
      return { ok: true, result: { acceptedBytes: 0 } };
    },
    () => true,
    (message) => errors.push(message),
  );
  void queue.enqueue("a");
  void queue.enqueue("b");
  await queue.waitForDrain();
  expect(sent).toHaveLength(1);
  expect(errors).toHaveLength(1);
});

test("bounds pending bytes and does not send oversized paste", async () => {
  let calls = 0;
  const errors: string[] = [];
  const queue = new TerminalInputQueue(
    async (text) => {
      calls++;
      return { ok: true, result: { acceptedBytes: text.length } };
    },
    () => true,
    (message) => errors.push(message),
    4,
  );
  await queue.enqueue("too long");
  await queue.waitForDrain();
  expect(calls).toBe(0);
  expect(errors).toHaveLength(1);
});

test("disposal prevents already queued writes from being sent", async () => {
  let writable = true;
  let calls = 0;
  const queue = new TerminalInputQueue(
    async (text) => {
      calls++;
      return { ok: true, result: { acceptedBytes: text.length } };
    },
    () => writable,
    () => {},
  );
  const queued = queue.enqueue("later");
  writable = false;
  await queued;
  await queue.waitForDrain();
  expect(calls).toBe(0);
});
