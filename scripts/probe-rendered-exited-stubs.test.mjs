import assert from "node:assert/strict";
import test from "node:test";
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
