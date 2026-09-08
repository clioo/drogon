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

function matchesDay(schedule: CronSchedule, date: Date): boolean {
  if (!schedule.months.has(date.getUTCMonth() + 1)) return false;
  const domMatch = schedule.daysOfMonth.has(date.getUTCDate());
  const dowMatch = schedule.daysOfWeek.has(date.getUTCDay());
  if (schedule.domRestricted && schedule.dowRestricted) return domMatch || dowMatch;
  return domMatch && dowMatch;
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
    if (!matchesDay(schedule, new Date(dayStartMs))) continue;
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
