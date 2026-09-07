import assert from "node:assert/strict";
import test from "node:test";
import { assertFilesLayout } from "./probe-rendered-files.mjs";

const usable = () => ({
  editor: { x: 250, y: 60, width: 400, height: 500 },
  rows: [
    { y: 60, height: 28 },
    { y: 88, height: 28 },
  ],
  clientWidth: 650,
  scrollWidth: 650,
});

test("accepts a usable vertical explorer/editor layout", () => {
  assert.doesNotThrow(() => assertFilesLayout(usable()));
});

test("rejects horizontal rows, undersized editors and overflow", () => {
  const horizontal = usable();
  horizontal.rows[1].y = horizontal.rows[0].y;
  assert.throws(() => assertFilesLayout(horizontal), /vertical rows/);
  for (const dimension of ["width", "height"]) {
    const undersized = usable();
    undersized.editor[dimension] = 100;
    assert.throws(() => assertFilesLayout(undersized), /usable/);
  }
  const overflow = usable();
  overflow.scrollWidth += 30;
  assert.throws(() => assertFilesLayout(overflow), /overflow/);
});
