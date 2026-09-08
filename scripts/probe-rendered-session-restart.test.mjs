import assert from "node:assert/strict";
import test from "node:test";
import { assertRestartedSessionList } from "./probe-rendered-session-restart.mjs";

const waited = {
  id: "waited-1",
  verdict: "unverifiable",
  agentState: "needs_input",
  agentStateAt: "2026-09-08T06:01:00Z",
};
// Legacy #222 row: exited but still carrying its last agent-state timestamp.
const exited = {
  id: "exited-1",
  verdict: "exited",
  agentState: "exited",
  agentStateAt: "2026-09-08T05:30:00Z",
};

test("accepts the honest post-restart list", () => {
  assert.doesNotThrow(() =>
    assertRestartedSessionList([waited, exited], {
      waitedId: "waited-1",
      exitedId: "exited-1",
    }),
  );
});

test("rejects a wiped or auto-exited list", () => {
  assert.throws(
    () =>
      assertRestartedSessionList([waited], {
        waitedId: "waited-1",
        exitedId: "exited-1",
      }),
    /exited session is still listed/,
  );
  assert.throws(
    () =>
      assertRestartedSessionList(
        [{ ...waited, verdict: "exited", agentState: "exited" }, exited],
        { waitedId: "waited-1", exitedId: "exited-1" },
      ),
    /unverifiable/,
  );
  assert.throws(
    () =>
      assertRestartedSessionList([waited, { ...exited }].map((item) =>
        item.id === "exited-1"
          ? { ...item, agentState: "needs_input" }
          : item,
      ), { waitedId: "waited-1", exitedId: "exited-1" }),
    /exited/,
  );
});
