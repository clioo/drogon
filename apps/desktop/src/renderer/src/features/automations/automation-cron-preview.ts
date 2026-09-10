// Minimal 5-field cron preview for the automation form: up to `count`
// next UTC fire times strictly after `fromMs`, iterated croner-style
// (next fire after the last, bounded by a per-fire horizon, never by a
// fixed window) so rare schedules — yearly, leap day — still preview and
// save. Null means the expression is not a supported 5-field schedule or
// never fires within the horizon; the daemon (croner) remains the
// scheduling authority. Supported per field: `*`, `*/n`, `a-b`, `a-b/n`,
// comma lists, single values, and JAN..DEC / MON..SUN names.
// Day-of-month/day-of-week follow standard cron: both restricted means
// either may match.

const MONTH_NAMES: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

const DAY_NAMES: Record<string, number> = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};

function parseValue(
  token: string,
  names: Record<string, number> | null,
  min: number,
  max: number,
): number | null {
  const upper = token.toUpperCase();
  const named = names?.[upper];
  const value = named ?? Number(upper);
  if (!Number.isInteger(value)) return null;
  if (upper === "") return null;
  // Cron Sunday is 0 or 7.
  const normalized = names === DAY_NAMES && value === 7 ? 0 : value;
  if (normalized < min || normalized > max) return null;
  return normalized;
}

function parseField(
  raw: string,
  names: Record<string, number> | null,
  min: number,
  max: number,
): { values: Set<number>; restricted: boolean } | null {
  const values = new Set<number>();
  const text = raw.trim();
  if (text === "") return null;
  const restricted = text !== "*";
  for (const part of text.split(",")) {
    const [range, stepText] = part.split("/");
    if (range === undefined || range === "") return null;
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) return null;
    let from: number;
    let to: number;
    if (range === "*") {
      from = min;
      to = max;
    } else if (range.includes("-")) {
      const [lo, hi] = range.split("-");
      if (lo === undefined || hi === undefined) return null;
      const low = parseValue(lo, names, min, max);
      const high = parseValue(hi, names, min, max);
      if (low === null || high === null || low > high) return null;
      from = low;
      to = high;
    } else {
      const single = parseValue(range, names, min, max);
      if (single === null) return null;
      from = single;
      to = single;
    }
    for (let value = from; value <= to; value += step) values.add(value);
  }
  if (values.size === 0) return null;
  return { values, restricted };
}

type CronSchedule = {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
};

function parseCron(cron: string): CronSchedule | null {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minute, hour, dom, month, dow] = fields as [
    string, string, string, string, string,
  ];
  const minutes = parseField(minute, null, 0, 59);
  const hours = parseField(hour, null, 0, 23);
  const daysOfMonth = parseField(dom, null, 1, 31);
  const months = parseField(month, MONTH_NAMES, 1, 12);
  const daysOfWeek = parseField(dow, DAY_NAMES, 0, 7);
  if (!minutes || !hours || !daysOfMonth || !months || !daysOfWeek) return null;
  return {
    minutes: minutes.values,
    hours: hours.values,
    daysOfMonth: daysOfMonth.values,
    months: months.values,
    daysOfWeek: daysOfWeek.values,
    domRestricted: daysOfMonth.restricted,
    dowRestricted: daysOfWeek.restricted,
  };
}

function matchesDay(
  schedule: CronSchedule,
  month1_12: number,
  dayOfMonth: number,
  dayOfWeek: number,
): boolean {
  if (!schedule.months.has(month1_12)) return false;
  const domMatch = schedule.daysOfMonth.has(dayOfMonth);
  const dowMatch = schedule.daysOfWeek.has(dayOfWeek);
  if (schedule.domRestricted && schedule.dowRestricted) return domMatch || dowMatch;
  return domMatch && dowMatch;
}

function matchesUtcDay(schedule: CronSchedule, date: Date): boolean {
  return matchesDay(
    schedule,
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCDay(),
  );
}

// Minute/day constants for the day-stepped scan below.
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
// Per-fire search horizon, in days. The widest gap a valid 5-field cron
// can have is the 8-year leap-day hole around 2100 (2096-02-29 fires next
// on 2104-02-29), so ten years always finds a real schedule's next fire;
// anything still unfired past it never fires (e.g. Feb 31), which the
// daemon's croner check also rejects at save time ("no future occurrence").
const FIRE_SEARCH_HORIZON_DAYS = 3660;

/** Earliest time-of-day fire (ms) on the UTC day `dayStartMs`, strictly
 *  after `afterMs`, or null when no hour/minute pair qualifies. */
function firstFireOnDay(
  hours: readonly number[],
  minutes: readonly number[],
  dayStartMs: number,
  afterMs: number,
): number | null {
  for (const hour of hours) {
    for (const minute of minutes) {
      const at = dayStartMs + (hour * 60 + minute) * MINUTE_MS;
      if (at > afterMs) return at;
    }
  }
  return null;
}

/** Next fire strictly after `afterMs`, or null when none occurs within the
 *  horizon. Steps whole UTC days (not minutes) and jumps to the first
 *  matching time-of-day, so a leap-day schedule costs days of iteration
 *  instead of years of minute steps — croner `next()` semantics, bounded
 *  by the horizon rather than by a fixed window. */
function nextFireAfter(schedule: CronSchedule, afterMs: number): number | null {
  const hours = [...schedule.hours].sort((a, b) => a - b);
  const minutes = [...schedule.minutes].sort((a, b) => a - b);
  let dayStartMs = Math.floor(afterMs / DAY_MS) * DAY_MS;
  for (let day = 0; day < FIRE_SEARCH_HORIZON_DAYS; day += 1, dayStartMs += DAY_MS) {
    if (!matchesUtcDay(schedule, new Date(dayStartMs))) continue;
    const fire = firstFireOnDay(hours, minutes, dayStartMs, afterMs);
    if (fire !== null) return fire;
  }
  return null;
}

/** Next `count` UTC fire times (ms epoch) strictly after `fromMs`.
 *  Returns every fire found up to `count` — a yearly or leap-day schedule
 *  yields its real next fires even when they are years apart — and null
 *  only when the expression is not a supported 5-field schedule or has no
 *  occurrence within the horizon at all. */
export function previewCronFires(
  cron: string,
  fromMs: number,
  count = 3,
): number[] | null {
  const schedule = parseCron(cron);
  if (schedule === null) return null;
  const fires: number[] = [];
  let afterMs = fromMs;
  for (let i = 0; i < count; i += 1) {
    const fire = nextFireAfter(schedule, afterMs);
    if (fire === null) break;
    fires.push(fire);
    afterMs = fire;
  }
  return fires.length > 0 ? fires : null;
}

// ---------------------------------------------------------------------------
// Timezone-aware preview.
//
// The daemon evaluates a schedule's cron wall time in the automation's
// stored IANA zone (legacy rows: UTC). This mirrors that evaluation with
// the host Intl database so the editor preview and the backend agree:
// fixed-time slots (single minute and hour, like croner's FixedTime) whose
// local wall time falls in a DST gap are reported skipped, never shifted;
// repeated local slots (fall-back fold) yield their first occurrence once;
// interval/step/list schedules simply have no fire inside the gap.
// ---------------------------------------------------------------------------

export type ZonedGapSkip = {
  /** Local calendar date with no fire, e.g. "2026-03-08". */
  date: string;
  /** Local wall time that does not exist, e.g. "02:30". */
  wallTime: string;
  reason: string;
};

export type ZonedPreview = {
  /** Effective zone the preview evaluated in. */
  timezone: string;
  /** Next UTC fire instants (ms epoch), strictly after fromMs. */
  fires: number[];
  /** Fixed-time slots skipped as nonexistent local times (DST gaps). */
  skipped: ZonedGapSkip[];
};

/** Absent/blank means the legacy UTC behavior; never throws. */
export function normalizePreviewTimezone(timezone?: string | null): string {
  const trimmed = (timezone ?? "").trim();
  return trimmed === "" ? "UTC" : trimmed;
}

/** True for "UTC" and any zone the host Intl database resolves. */
export function isValidTimezone(timezone: string): boolean {
  if (timezone === "UTC") return true;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** The host's local IANA zone, or "UTC" when it cannot be determined. */
export function localTimezone(): string {
  try {
    const resolved = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof resolved === "string" && isValidTimezone(resolved)) return resolved;
  } catch {
    // Fall through to UTC below.
  }
  return "UTC";
}

type ZoneWallParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = zoneFormatters.get(timezone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone === "UTC" ? "UTC" : timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  zoneFormatters.set(timezone, formatter);
  return formatter;
}

function wallPartsInZone(utcMs: number, timezone: string): ZoneWallParts {
  const parts = zoneFormatter(timezone).formatToParts(new Date(utcMs));
  const get = (type: string): number => {
    const found = parts.find((part) => part.type === type)?.value ?? "0";
    return Number(found);
  };
  // h23 can render midnight as 24:00 in some ICU builds; normalize it.
  const hour = get("hour") % 24;
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
    minute: get("minute"),
  };
}

/** Whole-minute offset (local minus UTC) in effect at `utcMs`. */
function zoneOffsetMs(timezone: string, utcMs: number): number {
  if (timezone === "UTC") return 0;
  const wall = wallPartsInZone(utcMs, timezone);
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute) - utcMs;
}

function padWall(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * UTC instants rendering as the given local wall time, ascending: empty
 * for a nonexistent (DST gap) wall time, two for a repeated (fold) one —
 * callers take the first — and one otherwise. Probes the offsets around
 * the target so both halves of a fold are found.
 */
export function resolveZonedWallTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): number[] {
  const base = Date.UTC(year, month - 1, day, hour, minute);
  const probes = new Set<number>([
    zoneOffsetMs(timezone, base - 86_400_000),
    zoneOffsetMs(timezone, base),
    zoneOffsetMs(timezone, base + 86_400_000),
  ]);
  // Refine once: the offset at the first guess can be stale when the
  // target sits right against a transition.
  for (const offset of [...probes]) {
    probes.add(zoneOffsetMs(timezone, base - offset));
  }
  const found = new Set<number>();
  for (const offset of probes) {
    const candidate = base - offset;
    const wall = wallPartsInZone(candidate, timezone);
    if (
      wall.year === year &&
      wall.month === month &&
      wall.day === day &&
      wall.hour === hour &&
      wall.minute === minute
    ) {
      // Truncate stray seconds: a fold probe can land off-minute when a
      // transition falls inside the minute (rare historical zones).
      found.add(Math.floor(candidate / 60_000) * 60_000);
    }
  }
  return [...found].sort((a, b) => a - b);
}

function zonedDateString(year: number, month: number, day: number): string {
  return `${year}-${padWall(month)}-${padWall(day)}`;
}

function zonedWallString(hour: number, minute: number): string {
  return `${padWall(hour)}:${padWall(minute)}`;
}

/**
 * Next `count` fire instants for a cron wall time in `timezone`, plus the
 * fixed-time DST-gap slots skipped along the way. Null when the
 * expression is not a supported 5-field schedule, the zone is unknown, or
 * nothing fires within the horizon. Day matching runs on the local
 * calendar date, like the daemon's zoned evaluation.
 */
export function previewZonedCronFires(
  cron: string,
  timezone: string | null | undefined,
  fromMs: number,
  count = 3,
): ZonedPreview | null {
  const schedule = parseCron(cron);
  if (schedule === null) return null;
  const zone = normalizePreviewTimezone(timezone);
  if (!isValidTimezone(zone)) return null;
  const fixedTime = schedule.minutes.size === 1 && schedule.hours.size === 1;
  const hours = [...schedule.hours].sort((a, b) => a - b);
  const minutes = [...schedule.minutes].sort((a, b) => a - b);
  const startWall = wallPartsInZone(fromMs, zone);
  const startDayMs = Date.UTC(startWall.year, startWall.month - 1, startWall.day);
  const fires: number[] = [];
  const skipped: ZonedGapSkip[] = [];
  const seenSkips = new Set<string>();
  for (let day = 0; day < FIRE_SEARCH_HORIZON_DAYS; day += 1) {
    if (fires.length >= count) break;
    const dayMs = startDayMs + day * DAY_MS;
    const date = new Date(dayMs);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const dayOfMonth = date.getUTCDate();
    const dayOfWeek = date.getUTCDay();
    if (!matchesDay(schedule, month, dayOfMonth, dayOfWeek)) continue;
    for (const hour of hours) {
      for (const minute of minutes) {
        const instants = resolveZonedWallTime(year, month, dayOfMonth, hour, minute, zone);
        if (instants.length === 0) {
          // Nonexistent local wall time. Fixed-time slots are recorded
          // skipped (the daemon writes the same skip row); interval
          // schedules simply have no fire here.
          if (fixedTime) {
            const key = `${zonedDateString(year, month, dayOfMonth)} ${zonedWallString(hour, minute)}`;
            if (!seenSkips.has(key)) {
              seenSkips.add(key);
              skipped.push({
                date: zonedDateString(year, month, dayOfMonth),
                wallTime: zonedWallString(hour, minute),
                reason: `No ${zonedWallString(hour, minute)} on ${zonedDateString(year, month, dayOfMonth)} in ${zone} (DST gap); recorded skipped.`,
              });
            }
          }
          continue;
        }
        // Repeated local slot: first occurrence only, like the daemon.
        const fire = instants[0] as number;
        if (fire > fromMs && fires.length < count) fires.push(fire);
      }
    }
  }
  if (fires.length === 0) return null;
  return { timezone: zone, fires, skipped };
}
