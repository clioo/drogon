// Timezone-aware schedule preview: DST gap skips, fold single-fires,
// zone edits and preview parity with the legacy UTC path. All fixtures use
// fixed instants and IANA zones, so they run identically in any host zone.
import { describe, expect, it } from "vitest";
import {
  isValidTimezone,
  localTimezone,
  normalizePreviewTimezone,
  previewCronFires,
  previewZonedCronFires,
  resolveZonedWallTime,
} from "./automation-cron-preview";
import { timezonePickerOptions } from "./AutomationTimezonePicker";

// America/New_York 2026: spring forward Mar 8 (02:00 -> 03:00, so 02:30
// does not exist), fall back Nov 1 (02:00 -> 01:00, so 01:30 happens twice).

describe("resolveZonedWallTime", () => {
  it("returns no instant for a wall time inside the spring gap", () => {
    expect(resolveZonedWallTime(2026, 3, 8, 2, 30, "America/New_York")).toEqual([]);
  });

  it("returns both instants for a repeated fall-back wall time, earliest first", () => {
    expect(resolveZonedWallTime(2026, 11, 1, 1, 30, "America/New_York")).toEqual([
      Date.UTC(2026, 10, 1, 5, 30),
      Date.UTC(2026, 10, 1, 6, 30),
    ]);
  });

  it("resolves an ordinary wall time to its single instant", () => {
    expect(resolveZonedWallTime(2026, 3, 7, 2, 30, "America/New_York")).toEqual([
      Date.UTC(2026, 2, 7, 7, 30),
    ]);
  });
});

describe("previewZonedCronFires", () => {
  it("skips a fixed-time slot inside the DST gap and resumes the next day", () => {
    // Mar 7 00:00 UTC is Mar 6 19:00 EST.
    const preview = previewZonedCronFires(
      "30 2 * * *",
      "America/New_York",
      Date.UTC(2026, 2, 7, 0, 0),
      3,
    );
    expect(preview).not.toBeNull();
    expect(preview?.timezone).toBe("America/New_York");
    expect(preview?.fires).toEqual([
      Date.UTC(2026, 2, 7, 7, 30), // Mar 7 02:30 EST
      Date.UTC(2026, 2, 9, 6, 30), // Mar 9 02:30 EDT (Mar 8 skipped)
      Date.UTC(2026, 2, 10, 6, 30), // Mar 10 02:30 EDT
    ]);
    expect(preview?.skipped).toEqual([
      {
        date: "2026-03-08",
        wallTime: "02:30",
        reason: expect.stringContaining("DST gap"),
      },
    ]);
  });

  it("fires a repeated fall-back slot exactly once, at its first occurrence", () => {
    // Oct 31 12:00 UTC is Oct 31 08:00 EDT; Nov 1 01:30 happens twice.
    const preview = previewZonedCronFires(
      "30 1 * * *",
      "America/New_York",
      Date.UTC(2026, 9, 31, 12, 0),
      3,
    );
    expect(preview?.fires).toEqual([
      Date.UTC(2026, 10, 1, 5, 30), // Nov 1 01:30 EDT (first occurrence)
      Date.UTC(2026, 10, 2, 6, 30), // Nov 2 01:30 EST
      Date.UTC(2026, 10, 3, 6, 30), // Nov 3 01:30 EST
    ]);
    expect(preview?.skipped).toEqual([]);
  });

  it("fires interval schedules on each repeated wall once, first half only", () => {
    // Nov 1 01:00 and 01:30 each happen twice (EDT then EST); an
    // interval schedule takes the first of each, never the later half.
    const preview = previewZonedCronFires(
      "*/30 1 * * *",
      "America/New_York",
      Date.UTC(2026, 10, 1, 4, 59),
      4,
    );
    expect(preview?.fires).toEqual([
      Date.UTC(2026, 10, 1, 5, 0), // Nov 1 01:00 EDT
      Date.UTC(2026, 10, 1, 5, 30), // Nov 1 01:30 EDT
      Date.UTC(2026, 10, 2, 6, 0), // Nov 2 01:00 EST
      Date.UTC(2026, 10, 2, 6, 30), // Nov 2 01:30 EST
    ]);
    expect(preview?.skipped).toEqual([]);
    // Resume from between the fold halves: both later halves are passed
    // over in favor of the next day's single occurrences.
    const resume = previewZonedCronFires(
      "*/30 1 * * *",
      "America/New_York",
      Date.UTC(2026, 10, 1, 5, 45),
      2,
    );
    expect(resume?.fires).toEqual([
      Date.UTC(2026, 10, 2, 6, 0),
      Date.UTC(2026, 10, 2, 6, 30),
    ]);
    expect(resume?.skipped).toEqual([]);
  });

  it("fires interval schedules through the gap with no skip rows", () => {
    // Mar 8 06:59 UTC is 01:59 EST; the next minute walls are 03:00+ EDT.
    const preview = previewZonedCronFires(
      "* * * * *",
      "America/New_York",
      Date.UTC(2026, 2, 8, 6, 59),
      3,
    );
    expect(preview?.fires).toEqual([
      Date.UTC(2026, 2, 8, 7, 0),
      Date.UTC(2026, 2, 8, 7, 1),
      Date.UTC(2026, 2, 8, 7, 2),
    ]);
    expect(preview?.skipped).toEqual([]);
  });

  it("evaluates weekly schedules on the zone calendar", () => {
    // Sun Mar 8 12:00 UTC is 08:00 EDT; next Monday 9 AM is Mar 9 13:00 UTC.
    const preview = previewZonedCronFires(
      "0 9 * * 1",
      "America/New_York",
      Date.UTC(2026, 2, 8, 12, 0),
      2,
    );
    expect(preview?.fires).toEqual([
      Date.UTC(2026, 2, 9, 13, 0),
      Date.UTC(2026, 2, 16, 13, 0),
    ]);
    expect(preview?.skipped).toEqual([]);
  });

  it("agrees with the legacy UTC preview for UTC schedules", () => {
    const from = Date.UTC(2026, 8, 7, 0, 0, 0);
    for (const cron of ["* * * * *", "30 8 * * *", "*/30 8 * * 1,2,3,4,5", "0 0 29 2 *"]) {
      const legacy = previewCronFires(cron, from);
      const zoned = previewZonedCronFires(cron, "UTC", from);
      expect(zoned?.fires).toEqual(legacy);
      expect(zoned?.skipped).toEqual([]);
    }
    // Blank/absent zones normalize to the same UTC evaluation.
    expect(previewZonedCronFires("30 8 * * *", "", from)?.fires).toEqual(
      previewCronFires("30 8 * * *", from),
    );
    expect(previewZonedCronFires("30 8 * * *", undefined, from)?.timezone).toBe("UTC");
  });

  it("returns null for unknown zones and non-schedules", () => {
    const from = Date.UTC(2026, 8, 7, 0, 0, 0);
    expect(previewZonedCronFires("30 8 * * *", "Mars/Olympus", from)).toBeNull();
    expect(previewZonedCronFires("bogus", "America/New_York", from)).toBeNull();
    expect(previewZonedCronFires("0 0 31 2 *", "America/New_York", from)).toBeNull();
  });
});

describe("timezone admission helpers", () => {
  it("accepts UTC and real IANA zones, rejects anything else", () => {
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("America/New_York")).toBe(true);
    expect(isValidTimezone("Asia/Tokyo")).toBe(true);
    expect(isValidTimezone("Mars/Olympus")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
    expect(isValidTimezone("America/New_York/Bronx")).toBe(false);
  });

  it("normalizes absent zones to UTC", () => {
    expect(normalizePreviewTimezone(undefined)).toBe("UTC");
    expect(normalizePreviewTimezone("")).toBe("UTC");
    expect(normalizePreviewTimezone("  ")).toBe("UTC");
    expect(normalizePreviewTimezone("America/New_York")).toBe("America/New_York");
  });

  it("offers UTC, the host zone and common zones", () => {
    expect(isValidTimezone(localTimezone())).toBe(true);
    const options = timezonePickerOptions();
    expect(options).toContain("UTC");
    expect(options).toContain(localTimezone());
    expect(options).toContain("America/New_York");
  });
});
