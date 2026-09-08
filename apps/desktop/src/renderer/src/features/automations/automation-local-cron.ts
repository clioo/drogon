// Local wall-clock <-> UTC-cron conversion for preset schedules.
//
// The daemon evaluates cron in UTC and stores no timezone (it has no tz
// database crate), while the editor's time field and every schedule label
// speak the user's local wall clock, like the reference (which stores the
// local IANA zone next to a local wall time). These helpers bridge the two:
// preset drafts convert local -> UTC on save, schedule labels convert
// UTC -> local on display, so entering "9:00 AM" fires at 9 AM local and
// the list shows "Daily at 9:00 AM".
//
// Custom cron stays verbatim UTC end to end (the CLI documents "schedule
// runs in UTC"); only preset shapes convert.
//
// Limitations (documented, not silent):
// - The offset is captured at save/display time. Across a DST transition
//   a daily fire can move by an hour; the daemon cannot do better without
//   a timezone database.
// - Shifting a weekdays band across midnight is not expressible as one
//   5-field cron (e.g. 9 PM Friday at UTC-6 fires Saturday 03:00 UTC,
//   outside Mon-Fri). The hour still converts; the band stays Mon-Fri.

export type ShiftedWallTime = {
  hour: number;
  minute: number;
  /** Whole days the shift carried across midnight (-1, 0, or +1). */
  dayShift: number;
};

/**
 * Minutes to add to a local wall clock to get UTC. That is exactly what
 * `Date#getTimezoneOffset` returns (UTC minus local); the sign is easy to
 * get backwards, so the round-trip test below pins it in the live zone.
 */
export function localToUtcOffsetMinutes(atMs: number = Date.now()): number {
  return new Date(atMs).getTimezoneOffset();
}

function shift(
  hour: number,
  minute: number,
  shiftMinutes: number,
): ShiftedWallTime {
  const total = hour * 60 + minute + shiftMinutes;
  const dayShift = Math.floor(total / 1440);
  const norm = ((total % 1440) + 1440) % 1440;
  return { hour: Math.floor(norm / 60), minute: norm % 60, dayShift };
}

function shiftDay(dayOfWeek: number, dayShift: number): number {
  return (((dayOfWeek + dayShift) % 7) + 7) % 7;
}

export type PresetScheduleParts = {
  hour: number;
  minute: number;
  /** 0=Sunday..6=Saturday; only read for weekly presets. */
  dayOfWeek: number;
};

/**
 * Converts a local preset wall time to the UTC cron parts the daemon
 * evaluates. `offsetMinutes` defaults to the live local offset; tests pass
 * explicit values. Hourly callers can skip this (minute-only crons need no
 * conversion); weekdays convert the hour while the Mon-Fri band stays put
 * (see the module note).
 */
export function localPresetToUtcCronParts(
  preset: "daily" | "weekdays" | "weekly",
  hour: number,
  minute: number,
  dayOfWeek: number,
  offsetMinutes: number = localToUtcOffsetMinutes(),
): PresetScheduleParts {
  const shifted = shift(hour, minute, offsetMinutes);
  return {
    hour: shifted.hour,
    minute: shifted.minute,
    dayOfWeek:
      preset === "weekly" ? shiftDay(dayOfWeek, shifted.dayShift) : dayOfWeek,
  };
}

export type LocalWallTime = {
  hour: number;
  minute: number;
  /** Shifted day of week (0=Sunday..6=Saturday); present when given. */
  dayOfWeek?: number;
};

/**
 * Converts UTC cron parts back to the local wall clock for display.
 * `dayOfWeek` (0=Sunday..6=Saturday) shifts jointly with the hour, so a
 * Monday-3 AM-UTC fire at UTC-6 labels as "Sundays at 9:00 PM".
 */
export function utcCronPartsToLocal(
  hour: number,
  minute: number,
  dayOfWeek: number | null,
  offsetMinutes: number = localToUtcOffsetMinutes(),
): LocalWallTime {
  const shifted = shift(hour, minute, -offsetMinutes);
  if (dayOfWeek === null) return { hour: shifted.hour, minute: shifted.minute };
  return {
    hour: shifted.hour,
    minute: shifted.minute,
    dayOfWeek: shiftDay(dayOfWeek, shifted.dayShift),
  };
}
