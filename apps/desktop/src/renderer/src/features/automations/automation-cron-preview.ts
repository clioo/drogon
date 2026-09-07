// Minimal 5-field cron preview for the automation form: the next `count`
// UTC fire times at or after `fromMs`, or null when the expression is not
// a supported 5-field schedule. The daemon (croner) remains the scheduling
// authority; this only previews common shapes in the form. Supported per
// field: `*`, `*/n`, `a-b`, `a-b/n`, comma lists, single values, and
// JAN..DEC / MON..SUN names. Day-of-month/day-of-week follow standard cron:
// both restricted means either may match.

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

/** Next `count` UTC fire times (ms epoch) strictly after `fromMs`. */
export function previewCronFires(
  cron: string,
  fromMs: number,
  count = 3,
): number[] | null {
  const schedule = parseCron(cron);
  if (schedule === null) return null;
  const fires: number[] = [];
  // Start at the next minute boundary strictly after fromMs.
  let cursor = Math.floor(fromMs / 60_000) * 60_000 + 60_000;
  const deadline = fromMs + 366 * 24 * 60 * 60 * 1000;
  for (; cursor <= deadline && fires.length < count; cursor += 60_000) {
    const date = new Date(cursor);
    if (
      schedule.minutes.has(date.getUTCMinutes()) &&
      schedule.hours.has(date.getUTCHours()) &&
      matchesDay(schedule, date)
    ) {
      fires.push(cursor);
    }
  }
  return fires.length === count ? fires : null;
}
