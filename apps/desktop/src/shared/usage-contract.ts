// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only; never edit the reference):
//   src/shared/rate-limit-types.ts (RateLimitWindow, ProviderRateLimits status subset)
//   src/shared/rate-limit-reset-format.ts (formatResetDuration, formatResetCountdown,
//     getResetCountdownNextTickDelay)
//   src/shared/usage-percentage-display.ts (clampUsedPercent)
//   src/renderer/src/components/status-bar/tooltip.tsx (barColor thresholds 60/80)
//   src/renderer/src/lib/window-label-formatter.ts (formatWindowLabel,
//     formatRateLimitWindowChipLabel)
// Adapted: Claude/Codex only, no zustand/i18n, zod-validated at the IPC boundary.
import { z } from "zod";

export const rateLimitWindowSchema = z.object({
  /** Percentage of the window consumed (0-100). */
  usedPercent: z.number().finite().min(0).max(100),
  /** Window duration in minutes: 300 (5h) or 10080 (7d). */
  windowMinutes: z.number().int().positive(),
  /** Unix ms timestamp when the window resets, if known. */
  resetsAt: z.number().int().nonnegative().nullable(),
  /** Human-readable reset description, e.g. "2:30 PM" or "Thu". */
  resetDescription: z.string().max(64).nullable(),
});
export type RateLimitWindow = z.infer<typeof rateLimitWindowSchema>;

export const providerUsageStatusSchema = z.enum([
  "idle",
  "fetching",
  "ok",
  "error",
  "unavailable",
]);
export type ProviderUsageStatus = z.infer<typeof providerUsageStatusSchema>;

export const providerUsageSchema = z.object({
  provider: z.enum(["claude", "codex"]),
  /** 5-hour session window, null when not reported. */
  session: rateLimitWindowSchema.nullable(),
  /** 7-day weekly window, null when not reported. */
  weekly: rateLimitWindowSchema.nullable(),
  /** Claude model-tier weekly share (e.g. Fable), null when not reported. */
  fableWeekly: rateLimitWindowSchema.nullable().optional(),
  /** Unix ms timestamp of the last successful data update. */
  updatedAt: z.number().int().nonnegative(),
  /** Human-readable error reason, null when status is 'ok'. Never a secret. */
  error: z.string().max(500).nullable(),
  status: providerUsageStatusSchema,
});
export type ProviderUsage = z.infer<typeof providerUsageSchema>;

export const memorySnapshotSchema = z.object({
  /** Summed RSS of the Drogon process tree in bytes; null when unmeasured. */
  rssBytes: z.number().int().nonnegative().nullable(),
  /** Processes counted in the tree; null when unmeasured. */
  processCount: z.number().int().nonnegative().nullable(),
  /** Why the measurement is missing; null when measured. */
  unavailableReason: z.string().max(300).nullable(),
});
export type MemorySnapshot = z.infer<typeof memorySnapshotSchema>;

export const portInfoSchema = z.object({
  port: z.number().int().min(1).max(65535),
  process: z.string().max(128),
});
export type PortInfo = z.infer<typeof portInfoSchema>;

export const portsSnapshotSchema = z.object({
  /** Listening TCP ports attributed to this host. */
  listening: z.array(portInfoSchema).max(4096),
  /** Why the scan is missing; null when the scan ran. */
  unavailableReason: z.string().max(300).nullable(),
});
export type PortsSnapshot = z.infer<typeof portsSnapshotSchema>;

export const awakeModeSchema = z.enum(["on", "off"]);
export type AwakeMode = z.infer<typeof awakeModeSchema>;

export const awakeSnapshotWireSchema = z.object({
  mode: awakeModeSchema,
  /** True while our own sleep-prevention assertion is held. */
  active: z.boolean(),
  /** False off macOS, where caffeinate cannot run. */
  supported: z.boolean(),
});
export type AwakeSnapshot = z.infer<typeof awakeSnapshotWireSchema>;

export const usageSnapshotSchema = z.object({
  claude: providerUsageSchema,
  codex: providerUsageSchema,
  memory: memorySnapshotSchema,
  ports: portsSnapshotSchema,
  awake: awakeSnapshotWireSchema,
  updatedAt: z.number().int().nonnegative(),
});
export type UsageSnapshot = z.infer<typeof usageSnapshotSchema>;

export const setAwakeInputSchema = awakeModeSchema;
export type SetAwakeInput = z.infer<typeof setAwakeInputSchema>;

export type UsageResult<T> =
  | { ok: true; result: T }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

export interface UsageBridge {
  snapshot(): Promise<UsageResult<UsageSnapshot>>;
  refresh(): Promise<UsageResult<UsageSnapshot>>;
  setAwake(mode: AwakeMode): Promise<UsageResult<AwakeSnapshot>>;
}

declare module "./session-contract" {
  interface DesktopBridge {
    usage: UsageBridge;
  }
}

/** Single clamp+round for bar width and label so they never disagree. */
export function clampUsedPercent(usedPercent: number): number {
  if (!Number.isFinite(usedPercent)) return 0;
  return Math.max(0, Math.min(100, Math.round(usedPercent)));
}

/**
 * Bar fill urgency class on the same 60/80 bands as Orca. Plain classes
 * (defined in the status-bar CSS section, not Tailwind utilities) because the
 * class name is chosen at runtime and Tailwind only emits static literals.
 */
export function barColorClass(usedPercent: number): string {
  if (usedPercent < 60) return "status-bar-fill-low";
  if (usedPercent < 80) return "status-bar-fill-mid";
  return "status-bar-fill-high";
}

/** Compact human duration flooring to whole units: "47m", "3h 54m", "6d 7h". */
export function formatResetDuration(ms: number): string {
  if (ms <= 0) return "now";
  const totalMins = Math.floor(ms / 60_000);
  if (totalMins < 60) return `${totalMins}m`;
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
  }
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/** "Resets in 3h 54m" / "Resets now" for a window's time-until-reset (ms). */
export function formatResetCountdown(ms: number): string {
  const duration = formatResetDuration(ms);
  return duration === "now" ? "Resets now" : `Resets in ${duration}`;
}

/** Short label for a usage window duration; 10080 hard-codes to "wk". */
export function formatWindowLabel(windowMinutes: number): string {
  if (windowMinutes === 10080) return "wk";
  if (windowMinutes === 300) return "5h";
  if (windowMinutes === 60) return "1h";
  if (windowMinutes < 60) return `${windowMinutes}m`;
  if (windowMinutes % (60 * 24 * 7) === 0) return `${windowMinutes / (60 * 24 * 7)}wk`;
  if (windowMinutes % (60 * 24) === 0) return `${windowMinutes / (60 * 24)}d`;
  if (windowMinutes % 60 === 0) return `${windowMinutes / 60}h`;
  return `${windowMinutes}m`;
}

/**
 * Status-bar chip label for a rate-limit window. Prefer the live remaining
 * duration when resetsAt is known; fall back to the fixed window size only
 * when no reset timestamp is available.
 */
export function formatWindowChipLabel(
  window: { windowMinutes: number; resetsAt: number | null },
  now: number = Date.now(),
): string {
  if (window.resetsAt != null) return formatResetDuration(window.resetsAt - now);
  return formatWindowLabel(window.windowMinutes);
}

/** "1.2 GB" style byte rendering for the memory segment; null stays null. */
export function formatBytes(bytes: number | null): string | null {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (const next of units) {
    unit = next;
    if (value < 1024 || next === "TB") break;
    value /= 1024;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${unit}`;
}
