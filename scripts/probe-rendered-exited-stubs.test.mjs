import assert from "node:assert/strict";
import test, { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  assertNoLiveRecords,
  assertStubRecordsForgotten,
} from "./probe-rendered-exited-stubs.mjs";

test("forgotten stubs are absent from any session list shape", () => {
  assert.doesNotThrow(() =>
    assertStubRecordsForgotten(
      [
        { id: "other-1", verdict: "exited" },
        { id: "revived-1", verdict: "live" },
      ],
      { absentIds: ["stub-a", "stub-b"] },
    ),
  );
});

test("a surviving stub (of any verdict) fails the proof", () => {
  for (const verdict of ["unverifiable", "exited", "live"]) {
    assert.throws(
      () =>
        assertStubRecordsForgotten([{ id: "stub-a", verdict }], {
          absentIds: ["stub-a"],
        }),
      /forgotten stub records must not survive/,
      `verdict ${verdict} must not survive`,
    );
  }
});

test("Kill all leaves no records of any verdict", () => {
  assert.doesNotThrow(() => assertNoLiveRecords([]));
  for (const verdict of ["unverifiable", "exited", "live"]) {
    assert.throws(
      () => assertNoLiveRecords([{ id: "s", verdict }]),
      /Kill all must leave no session records/,
      `verdict ${verdict} must not survive Kill all`,
    );
  }
});

// Lane 1 second-pass pin: the label-turnover wait. After the recovery
// overlay Restart revives a stub, the strip re-derives the tab label on a
// later render than the session list — so the probe waits for the
// forgotten id to leave every tab label before asserting its tab is gone.
// Reverting that hunk must fail this test. The live run proves the
// behaviour itself.
const stubsProbeSource = readFileSync(
  path.join(
    fileURLToPath(new URL(".", import.meta.url)),
    "probe-rendered-exited-stubs.mjs",
  ),
  "utf8",
);

describe("exited stub revive label turnover", () => {
  it("waits for the forgotten id to leave the tab labels first", () => {
    const wait = stubsProbeSource.indexOf("never lets go of the forgotten id");
    assert.ok(wait !== -1, "the label-turnover wait must exist");
    const forgotten = stubsProbeSource.indexOf("assertStubRecordsForgotten");
    assert.ok(forgotten !== -1, "the record-forget assertion must exist");
    const gone = stubsProbeSource.indexOf("new RegExp(revivedFromId) }).count()");
    assert.ok(gone !== -1, "the tab-gone assertion must exist");
    assert.ok(
      forgotten < wait && wait < gone,
      "order must be record-forgotten, then label turnover, then tab gone",
    );
  });
});
