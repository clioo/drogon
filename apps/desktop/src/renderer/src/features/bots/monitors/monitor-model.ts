/* C10 bots monitors: bounded local-file digest monitor model.
 * Original to this repo (no fork source). Pure helpers only: no daemon,
 * network, or model calls. Unchanged checks produce zero model requests;
 * changes default to a local notification/event. */

export const MONITOR_RULE_KIND = "local_file_digest.v1" as const;
export const MONITOR_RULE_KIND_SCRIPT = "script_command.v1" as const;
export const MONITOR_RULE_KIND_HTTP_POLL = "http_poll.v1" as const;
export const MONITOR_RESULT_SCHEMA_VERSION = 1;
export const MAX_MONITOR_FILE_BYTES = 256 * 1024;
export const MAX_MONITOR_PATH_BYTES = 1024;

/**
 * Rule kinds this renderer understands. New kinds are admitted by the
 * daemon before the UI that renders them ships, so anything outside this
 * set must fail CLOSED: it is never approved or run blindly from an old
 * UI. Widening this set is an explicit UI change, not a silent fallback.
 */
export const SUPPORTED_MONITOR_RULE_KINDS: readonly string[] = [MONITOR_RULE_KIND];

export function monitorRuleKindSupported(ruleKind: string): boolean {
  return SUPPORTED_MONITOR_RULE_KINDS.includes(ruleKind);
}

export type MonitorTriggerInput =
  | { kind: "manual" }
  | { kind: "scheduled"; cron: string };

export type MonitorFormValues = {
  name: string;
  resource: string;
  maxBytes: number;
  trigger: MonitorTriggerInput;
  enabled: boolean;
};

export type MonitorRecordView = {
  id: string;
  botId: string | null;
  version: number;
  ruleKind: string;
  hostId: string;
  projectId: string;
  resource: string;
  maxBytes: number;
  trigger: MonitorTriggerInput;
  cursor: string | null;
  enabled: boolean;
  approved: boolean;
  consecutiveErrors: number;
  lastEventId: string | null;
  lastError: string | null;
};

export type MonitorCheckView = {
  id: string;
  monitorId: string;
  monitorVersion: number;
  outcome: "no_change" | "changed" | "error";
  eventId: string | null;
  cursor: string | null;
  errorKind: string | null;
  message: string | null;
  observedAtMs: number;
  delivery: "not_applicable" | "pending" | "confirmed" | "uncertain";
};

export function emptyMonitorForm(): MonitorFormValues {
  return {
    name: "",
    resource: "",
    maxBytes: 64 * 1024,
    trigger: { kind: "manual" },
    enabled: true,
  };
}

function hasControlChars(value: string): boolean {
  // biome-ignore lint: explicit control scan, no regex control class.
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function validateMonitorResource(resource: string): string | null {
  if (!resource) return "Choose a project-relative file.";
  if (resource.length > MAX_MONITOR_PATH_BYTES) {
    return `Path must be at most ${MAX_MONITOR_PATH_BYTES} bytes.`;
  }
  if (hasControlChars(resource)) return "Path must not contain control characters.";
  if (resource.startsWith("/")) return "Path must be project-relative, not absolute.";
  if (resource.endsWith("/")) return "Path must name a file, not a directory.";
  for (const segment of resource.split("/")) {
    if (!segment) return "Path must not contain empty segments.";
    if (segment === "." || segment === "..") {
      return "Path must not contain '.' or '..' segments.";
    }
    if (segment.includes("\\")) return "Path must use '/' separators.";
  }
  return null;
}

export function validateMonitorCron(cron: string): string | null {
  const trimmed = cron.trim();
  if (!trimmed) return "Cron expression must not be empty.";
  if (trimmed.length > 256) return "Cron expression must be at most 256 bytes.";
  if (hasControlChars(trimmed)) return "Cron expression must not contain control characters.";
  return null;
}

export function isMonitorFormReady(form: MonitorFormValues): boolean {
  if (!form.name.trim()) return false;
  if (validateMonitorResource(form.resource) !== null) return false;
  if (!Number.isInteger(form.maxBytes) || form.maxBytes < 1 || form.maxBytes > MAX_MONITOR_FILE_BYTES) {
    return false;
  }
  if (form.trigger.kind === "scheduled") {
    if (validateMonitorCron(form.trigger.cron) !== null) return false;
  }
  return true;
}

export function monitorStatusLabel(record: MonitorRecordView): string {
  if (!monitorRuleKindSupported(record.ruleKind)) return "Unsupported rule kind";
  if (!record.enabled) return "Disabled";
  if (!record.approved) return "Needs approval";
  if (record.lastError) return "Error";
  if (record.cursor) return "Watching";
  return "New";
}

/**
 * Actions (approve, enable, run check) are gated on a rule kind this
 * renderer can actually describe. An unknown kind stays visible and
 * deletable, but it can never be approved or run from a UI that does not
 * understand its fields.
 */
export function monitorActionsEnabled(record: MonitorRecordView): boolean {
  return monitorRuleKindSupported(record.ruleKind);
}

export function monitorOutcomeLabel(check: MonitorCheckView): string {
  switch (check.outcome) {
    case "changed":
      return check.eventId ? `Changed · ${check.eventId}` : "Changed";
    case "error":
      return check.message ? `Error · ${check.message}` : "Error";
    case "no_change":
    default:
      return "No change";
  }
}

/** Visible history helpers: newest first, capped for the card surface. */
export function visibleMonitorChecks(checks: MonitorCheckView[], limit = 5): MonitorCheckView[] {
  return [...checks].sort((a, b) => b.observedAtMs - a.observedAtMs).slice(0, limit);
}
