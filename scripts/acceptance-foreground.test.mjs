import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyForegroundObservation } from "./acceptance-foreground.mjs";

test("allows the user to switch unrelated apps while test desktops stay hidden", () => {
  verifyForegroundObservation(
    { sampleCount: 100, activatedPids: [1, 2], visibleWindowPids: [1, 2, 3] },
    [10, 11],
  );
});

test("rejects a transient activation even if the test desktop is no longer frontmost", () => {
  assert.throws(
    () =>
      verifyForegroundObservation(
        { sampleCount: 100, activatedPids: [1, 10, 2], visibleWindowPids: [] },
        [10],
      ),
    /activated on macOS/,
  );
});

test("rejects an inactive but visible test window", () => {
  assert.throws(
    () =>
      verifyForegroundObservation(
        { sampleCount: 100, activatedPids: [1], visibleWindowPids: [10] },
        [10],
      ),
    /displayed a native window/,
  );
});

test("does not accept missing OS observations or missing test identities", () => {
  assert.throws(
    () => verifyForegroundObservation({ sampleCount: 0 }, [10]),
    /unavailable/,
  );
  assert.throws(
    () => verifyForegroundObservation({ sampleCount: 100 }, []),
    /No desktop/,
  );
});
