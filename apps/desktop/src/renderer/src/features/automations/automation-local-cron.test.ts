import { describe, expect, it } from "vitest";
import {
  localPresetToUtcCronParts,
  localToUtcOffsetMinutes,
  utcCronPartsToLocal,
} from "./automation-local-cron";

// Offsets are explicit, so these run identically in any host timezone.
// UTC-6 (offset +360: add 6h to local to get UTC); UTC+9 (offset -540).

describe("localPresetToUtcCronParts", () => {
  it("shifts a morning time forward at UTC-6", () => {
    expect(localPresetToUtcCronParts("daily", 9, 0, 1, 360)).toEqual({
      hour: 15,
      minute: 0,
      dayOfWeek: 1,
    });
  });

  it("carries a late evening across midnight with the weekday", () => {
    expect(localPresetToUtcCronParts("weekly", 21, 30, 5, 360)).toEqual({
      hour: 3,
      minute: 30,
      dayOfWeek: 6,
    });
  });

  it("wraps a negative shift back a day at UTC+9", () => {
    expect(localPresetToUtcCronParts("weekly", 0, 30, 1, -540)).toEqual({
      hour: 15,
      minute: 30,
      dayOfWeek: 0,
    });
  });

  it("leaves the weekday band alone for non-weekly presets", () => {
    expect(localPresetToUtcCronParts("daily", 21, 30, 5, 360)).toEqual({
      hour: 3,
      minute: 30,
      dayOfWeek: 5,
    });
  });

  it("is the identity at offset zero", () => {
    expect(localPresetToUtcCronParts("weekly", 9, 5, 2, 0)).toEqual({
      hour: 9,
      minute: 5,
      dayOfWeek: 2,
    });
  });
});

describe("utcCronPartsToLocal", () => {
  it("renders 15:00 UTC as 9 AM at UTC-6", () => {
    expect(utcCronPartsToLocal(15, 0, null, 360)).toEqual({
      hour: 9,
      minute: 0,
    });
  });

  it("moves Monday 03:00 UTC back to Sunday evening at UTC-6", () => {
    expect(utcCronPartsToLocal(3, 0, 1, 360)).toEqual({
      hour: 21,
      minute: 0,
      dayOfWeek: 0,
    });
  });

  it("round-trips a weekly wall time through UTC", () => {
    const utc = localPresetToUtcCronParts("weekly", 9, 0, 1, 360);
    expect(utcCronPartsToLocal(utc.hour, utc.minute, utc.dayOfWeek, 360)).toEqual({
      hour: 9,
      minute: 0,
      dayOfWeek: 1,
    });
  });

  it("matches Date.UTC arithmetic in the live zone", () => {
    // Independent oracle: local noon as an instant minus noon-as-UTC is
    // exactly the local->UTC wall-clock gap. A flipped sign fails this
    // in every non-UTC zone (vacuous only where the offset is zero).
    const localNoon = new Date(2026, 0, 15, 12, 0, 0);
    const expected =
      (localNoon.getTime() - Date.UTC(2026, 0, 15, 12, 0, 0)) / 60000;
    expect(localToUtcOffsetMinutes(localNoon.getTime())).toBe(expected);
  });
});
