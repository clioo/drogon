import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertSessionRowsPinForegroundChild,
  normalizeSessionRow,
  normalizeSessionRows,
} from "./session-row-contract.mjs";

test("normalizes a restored row that predates the additive field to idle", () => {
  assert.deepEqual(normalizeSessionRow({ id: "a" }), {
    id: "a",
    hasForegroundChild: false,
  });
});

test("normalization preserves a present census value", () => {
  assert.equal(
    normalizeSessionRow({ hasForegroundChild: true }).hasForegroundChild,
    true,
  );
  assert.equal(
    normalizeSessionRow({ hasForegroundChild: false }).hasForegroundChild,
    false,
  );
});

test("pins a boolean hasForegroundChild on live rows", () => {
  assertSessionRowsPinForegroundChild([
    { id: "idle-live", verdict: "live", hasForegroundChild: false },
    { id: "busy-live", verdict: "live", hasForegroundChild: true },
  ]);
});

test("rejects rows that drop the additive field instead of pinning it", () => {
  assert.throws(
    () =>
      assertSessionRowsPinForegroundChild([
        { id: "stripped", verdict: "live" },
      ]),
    /must carry a boolean hasForegroundChild/,
  );
  assert.throws(
    () =>
      assertSessionRowsPinForegroundChild([
        { id: "wrong-type", verdict: "live", hasForegroundChild: "false" },
      ]),
    /must carry a boolean hasForegroundChild/,
  );
});

test("proves quiet rows report no foreground child", () => {
  assertSessionRowsPinForegroundChild(
    [{ id: "idle", verdict: "exited", hasForegroundChild: false }],
    {
      expectFalseFor: (row) => row.verdict !== "live",
      label: "idle session rows",
    },
  );
  assert.throws(
    () =>
      assertSessionRowsPinForegroundChild(
        [{ id: "busy", verdict: "exited", hasForegroundChild: true }],
        { expectFalseFor: (row) => row.verdict !== "live" },
      ),
    /must report hasForegroundChild:false/,
  );
});

test("normalized rows compare equal across the restart boundary", () => {
  // Reproduces the macOS CI shape: pre-crash rows carry the live census
  // field while post-restart rows restored from SQLite predate it.
  const beforeCrash = [{ id: "a", verdict: "exited", hasForegroundChild: false }];
  const afterRestart = [{ id: "a", verdict: "exited" }];
  assert.deepEqual(
    normalizeSessionRows(afterRestart),
    normalizeSessionRows(beforeCrash),
  );
});
