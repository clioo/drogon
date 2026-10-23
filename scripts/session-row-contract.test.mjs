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

// #605: `gridCursor` is a ring offset, and the ring does not survive a
// restart. A live row reports where its grid took effect; the restored row
// has no ring for that number to index into, so the field is not part of a
// cross-restart comparison at all.
test("normalizeSessionRow drops gridCursor from the comparison", () => {
  assert.equal("gridCursor" in normalizeSessionRow({ id: "s1", gridCursor: 4096 }), false);
  assert.equal("gridCursor" in normalizeSessionRow({ id: "s1" }), false);
});

test("a live row and its restored stub compare equal whatever the cut was", () => {
  const live = { id: "s1", cols: 120, rows: 40, gridCursor: 512, hasForegroundChild: false };
  const { gridCursor: _dropped, ...restored } = live;
  assert.deepEqual(normalizeSessionRows([restored]), normalizeSessionRows([live]));
  // And a different live cut is still the same row.
  assert.deepEqual(
    normalizeSessionRows([{ ...live, gridCursor: 103 }]),
    normalizeSessionRows([restored]),
  );
});

test("dropping the cut never hides a real difference in the grid itself", () => {
  const a = { id: "s1", cols: 120, rows: 40, gridCursor: 0 };
  const b = { id: "s1", cols: 80, rows: 24, gridCursor: 0 };
  assert.notDeepEqual(normalizeSessionRows([a]), normalizeSessionRows([b]));
});

// #684: the hook lifecycle's turn boundaries live on the handle only. A
// live row reports them; a row restored from SQLite has no handle behind
// it, so they are not part of a cross-restart comparison — exactly the
// shape that turned the core-cli journey red when they were first added.
test("normalizeSessionRow drops the hook turn boundaries from the comparison", () => {
  const normalized = normalizeSessionRow({
    id: "s1",
    agentTurnStartedAt: "2026-10-23T18:33:01Z",
    agentTurnEndedAt: "2026-10-23T18:33:09Z",
  });
  assert.equal("agentTurnStartedAt" in normalized, false);
  assert.equal("agentTurnEndedAt" in normalized, false);
  assert.equal("agentTurnStartedAt" in normalizeSessionRow({ id: "s1" }), false);
});

test("a hook-launched live row equals its restored stub across a crash", () => {
  // The core-cli journey's exact comparison: the live handle carries the
  // turn boundaries, the restored row does not, and everything durable
  // (including agentState and its stamp) still has to match.
  const live = {
    id: "s1",
    verdict: "live",
    agentState: "idle",
    agentStateAt: "2026-10-23T18:33:01Z",
    agentStateAuthority: "hook",
    agentTurnStartedAt: null,
    agentTurnEndedAt: null,
    hasForegroundChild: false,
  };
  const { agentTurnStartedAt: _a, agentTurnEndedAt: _b, ...restored } = live;
  assert.deepEqual(normalizeSessionRows([restored]), normalizeSessionRows([live]));
  // A session that really did run a turn compares equal to its stub too.
  assert.deepEqual(
    normalizeSessionRows([
      { ...live, agentTurnStartedAt: "2026-10-23T18:33:04Z", agentTurnEndedAt: "2026-10-23T18:33:09Z" },
    ]),
    normalizeSessionRows([restored]),
  );
});

test("dropping the boundaries never hides a real difference in the state itself", () => {
  const working = { id: "s1", agentState: "working", agentStateAt: "2026-10-23T18:33:04Z" };
  const idle = { id: "s1", agentState: "idle", agentStateAt: "2026-10-23T18:33:09Z" };
  assert.notDeepEqual(normalizeSessionRows([working]), normalizeSessionRows([idle]));
});
