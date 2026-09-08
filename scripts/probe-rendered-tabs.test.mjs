import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRestoredStripOrder,
  normalizeStripLabels,
} from "./probe-rendered-tabs.mjs";

test("normalizes the dirty suffix a leftover tab may carry", () => {
  assert.deepEqual(normalizeStripLabels(["a.txt (unsaved)", "b.txt"]), [
    "a.txt",
    "b.txt",
  ]);
});

test("accepts the same tabs in the same order", () => {
  assert.doesNotThrow(() =>
    assertRestoredStripOrder(["a.txt", "b.txt", "blank"], ["a.txt", "b.txt", "blank"]),
  );
});

test("rejects a missing tab, an extra tab and a reorder", () => {
  assert.throws(
    () => assertRestoredStripOrder(["a.txt", "b.txt"], ["a.txt"]),
    /same tabs in the same order/,
  );
  assert.throws(
    () => assertRestoredStripOrder(["a.txt"], ["a.txt", "b.txt"]),
    /same tabs in the same order/,
  );
  assert.throws(
    () => assertRestoredStripOrder(["a.txt", "b.txt"], ["b.txt", "a.txt"]),
    /same tabs in the same order/,
  );
});
