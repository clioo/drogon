import { describe, expect, it } from "vitest";
import { LARGE_FILE_MONACO_CHAR_LIMIT, shouldUseLargeFileFallback } from "./editor-large-file-guard";

describe("shouldUseLargeFileFallback", () => {
  it("stays false at and below the limit", () => {
    expect(shouldUseLargeFileFallback(0)).toBe(false);
    expect(shouldUseLargeFileFallback(LARGE_FILE_MONACO_CHAR_LIMIT)).toBe(false);
  });

  it("trips just above the limit", () => {
    expect(shouldUseLargeFileFallback(LARGE_FILE_MONACO_CHAR_LIMIT + 1)).toBe(true);
  });
});
