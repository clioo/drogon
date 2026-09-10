// Timezone picker for the automation editor: the IANA zone a schedule's
// cron wall time evaluates in. The daemon re-validates the stored zone
// against its own tz database and rejects unknown zones; this control only
// offers zones the host Intl database resolves, so a picked zone is always
// saveable. New features do not exist in the reference; styling follows the
// editor's other selects.
import { useMemo } from "react";
import { cn } from "./automation-class-names";
import { isValidTimezone, localTimezone } from "./automation-cron-preview";

const COMMON_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Sao_Paulo",
  "Atlantic/Azores",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Moscow",
  "Africa/Cairo",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Pacific/Auckland",
] as const;

function shortZoneLabel(timezone: string, atMs: number): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date(atMs));
    const offset = parts.find((part) => part.type === "timeZoneName")?.value;
    return offset ? `${timezone} (${offset})` : timezone;
  } catch {
    return timezone;
  }
}

/** Zones offered by the picker: common zones plus the host local zone. */
export function timezonePickerOptions(atMs: number = Date.now()): string[] {
  const local = localTimezone();
  const options: string[] = [...COMMON_TIMEZONES];
  if (!options.includes(local)) {
    options.splice(1, 0, local);
  }
  return options.filter((zone) => isValidTimezone(zone));
}

export function AutomationTimezonePicker({
  timezone,
  onTimezoneChange,
}: {
  timezone: string;
  onTimezoneChange: (timezone: string) => void;
}): React.JSX.Element {
  const options = useMemo(() => timezonePickerOptions(), []);
  const shown = isValidTimezone(timezone) ? timezone : "UTC";
  return (
    <select
      aria-label="Timezone"
      value={options.includes(shown) ? shown : ""}
      onChange={(event) => onTimezoneChange(event.target.value)}
      className={cn(
        "h-9 w-full min-w-0 rounded-md border px-3 py-1 text-sm outline-none",
        "border-input bg-input/30 shadow-xs dark:bg-input/30",
        "focus-visible:ring-[3px] focus-visible:ring-ring/50",
      )}
    >
      {options.includes(shown) ? null : (
        <option value="">{`${shown} (unknown here)`}</option>
      )}
      {options.map((zone) => (
        <option key={zone} value={zone}>
          {shortZoneLabel(zone, Date.now())}
        </option>
      ))}
    </select>
  );
}
