// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/right-sidebar/source-control/commit/use-discard-confirmation.ts
// aggregated failure copy (first error plus a bounded path sample).
import { describe, expect, test } from "vitest";
import { getDiscardFailureToastCopy } from "./discard-failure-toast";

describe("getDiscardFailureToastCopy", () => {
  test("singular file", () => {
    expect(getDiscardFailureToastCopy(["a.txt"], "locked")).toEqual({
      title: "Failed to discard 1 file",
      description: "locked (e.g. a.txt)",
    });
  });

  test("plural files without a first message list the sample", () => {
    expect(getDiscardFailureToastCopy(["a.txt", "b.txt"])).toEqual({
      title: "Failed to discard 2 files",
      description: "a.txt, b.txt",
    });
  });

  test("long failure lists truncate with a remainder count", () => {
    const copy = getDiscardFailureToastCopy(
      ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"],
      "denied",
    );
    expect(copy.title).toBe("Failed to discard 5 files");
    expect(copy.description).toBe("denied (e.g. a.txt, b.txt, c.txt, +2 more)");
  });
});
