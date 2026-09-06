import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { waitForBridgeObservation } from "./acceptance-bridge-observation.mjs";

test("awaits false IPC results and retries until an actual true result", async () => {
  let calls = 0;
  const page = { evaluate: async (predicate, arg) => predicate(arg) };
  await waitForBridgeObservation(page, async (limit) => ++calls === limit, 3, {
    timeoutMs: 1000,
    intervalMs: 1,
  });
  assert.equal(calls, 3);
});

test("bounds a never-resolving IPC and ignores its late completion", async () => {
  let complete;
  let calls = 0;
  const page = {
    evaluate: () => {
      calls++;
      return new Promise((resolve) => {
        complete = resolve;
      });
    },
  };
  await assert.rejects(
    waitForBridgeObservation(page, () => true, null, {
      timeoutMs: 10,
      intervalMs: 1,
    }),
    /before its deadline/,
  );
  complete(false);
  await setImmediate();
  assert.equal(calls, 1);
});

test("a rejected IPC fails the observation without silent retry", async () => {
  let calls = 0;
  const page = {
    evaluate: async () => {
      calls++;
      throw new Error("connection lost");
    },
  };
  await assert.rejects(
    waitForBridgeObservation(page, () => true),
    /connection lost/,
  );
  assert.equal(calls, 1);
});
