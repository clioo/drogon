import { expect, test } from "vitest";
import { TerminalInputQueue } from "./terminal-input-queue";

test("serializes input and accounts for UTF-8 bytes", async () => {
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
  expect(seen).toEqual(["ñ", "second"]);
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
  await queue.enqueue("new input despite later successful reads");
  expect(calls).toBe(1);
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
  expect(calls).toBe(0);
});
