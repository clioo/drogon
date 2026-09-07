import { describe, expect, it } from "vitest";
import { previewCronFires } from "./automation-cron-preview";

// Monday 2026-09-07T00:00:00Z.
const MONDAY = Date.UTC(2026, 8, 7, 0, 0, 0);

describe("previewCronFires", () => {
  it("lists the next three minute boundaries for every-minute", () => {
    expect(previewCronFires("* * * * *", MONDAY)).toEqual([
      MONDAY + 60_000,
      MONDAY + 2 * 60_000,
      MONDAY + 3 * 60_000,
    ]);
  });

  it("fires a daily schedule at that UTC wall time", () => {
    expect(previewCronFires("30 8 * * *", MONDAY)).toEqual([
      Date.UTC(2026, 8, 7, 8, 30),
      Date.UTC(2026, 8, 8, 8, 30),
      Date.UTC(2026, 8, 9, 8, 30),
    ]);
  });

  it("resolves weekday names and skips the weekend", () => {
    // Friday 2026-09-11T10:00Z, weekdays at 09:00 -> Monday 09:00 next.
    const friday = Date.UTC(2026, 8, 11, 10, 0);
    expect(previewCronFires("0 9 * * MON-FRI", friday)).toEqual([
      Date.UTC(2026, 8, 14, 9, 0),
      Date.UTC(2026, 8, 15, 9, 0),
      Date.UTC(2026, 8, 16, 9, 0),
    ]);
  });

  it("supports steps and lists", () => {
    expect(previewCronFires("*/30 8 * * 1,2,3,4,5", MONDAY)).toEqual([
      Date.UTC(2026, 8, 7, 8, 0),
      Date.UTC(2026, 8, 7, 8, 30),
      Date.UTC(2026, 8, 8, 8, 0),
    ]);
  });

  it("returns null for non-cron and unsupported shapes", () => {
    expect(previewCronFires("", MONDAY)).toBeNull();
    expect(previewCronFires("FREQ=DAILY", MONDAY)).toBeNull();
    expect(previewCronFires("* * *", MONDAY)).toBeNull();
    expect(previewCronFires("61 * * * *", MONDAY)).toBeNull();
    expect(previewCronFires("*/0 * * * *", MONDAY)).toBeNull();
  });
});
