// Unit cover for the pure sample math in measure-terminal-input.mjs (the
// probe's Playwright/daemon lifecycle is exercised live, never mocked).
import assert from "node:assert/strict";
import test from "node:test";
import {
  keystrokeSeries,
  percentile,
  summarizeValues,
} from "./measure-terminal-input.mjs";

test("percentile is nearest-rank and null on empty input", () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([5], 50), 5);
  assert.equal(percentile([5], 95), 5);
  assert.equal(percentile([1, 2, 3, 4], 50), 2);
  assert.equal(percentile([1, 2, 3, 4], 95), 4);
  // Input is pre-sorted by contract (same as measure-navigation.mjs).
  assert.equal(percentile([1, 10], 50), 1);
});

test("summarizeValues reports median/p95/max over finite samples only", () => {
  const summary = summarizeValues([Number.NaN, 30, 10, 20, Number.POSITIVE_INFINITY]);
  assert.equal(summary.count, 3);
  assert.equal(summary.median, 20);
  assert.equal(summary.p95, 30);
  assert.equal(summary.max, 30);
  assert.equal(summary.unit, "ms");
  assert.deepEqual(summarizeValues([]), {
    unit: "ms",
    count: 0,
    median: null,
    p95: null,
    max: null,
  });
});

test("keystrokeSeries splits parse/render latencies and counts unmatched echoes", () => {
  const series = keystrokeSeries([
    { dispatchAt: 100, parsedAt: 112, renderedAt: 120 },
    { dispatchAt: 200, parsedAt: 240 },
    { dispatchAt: 300 },
    { parsedAt: 999 }, // no dispatch: ignored entirely
  ]);
  assert.deepEqual(series.dispatchToParsed, {
    unit: "ms",
    count: 2,
    median: 12,
    p95: 40,
    max: 40,
  });
  assert.deepEqual(series.dispatchToRendered, {
    unit: "ms",
    count: 1,
    median: 20,
    p95: 20,
    max: 20,
  });
  assert.equal(series.unmatchedEchoes, 1);
  const empty = keystrokeSeries(undefined);
  assert.equal(empty.dispatchToParsed.count, 0);
  assert.equal(empty.unmatchedEchoes, 0);
});
