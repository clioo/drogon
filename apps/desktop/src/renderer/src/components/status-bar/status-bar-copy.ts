// Pure status-bar projections: snapshot -> display strings. No React, no I/O,
// covered by status-bar-copy.test.ts; StatusBar.tsx only arranges the output.
import {
  clampUsedPercent,
  formatResetCountdown,
  formatWindowChipLabel,
  type PortsSnapshot,
  type ProviderUsage,
} from "../../../../shared/usage-contract";

export type MeterRow = {
  key: string;
  /** Compact chip text, e.g. "55% used 5h" or "8% used Fable". */
  label: string;
  /** bar fill 0-100. */
  used: number;
  /** Tooltip: window kind, percent and live reset countdown. */
  title: string;
};

function windowTitle(kind: string, used: number, resetsAt: number | null, now: number): string {
  const reset =
    resetsAt === null ? "reset unknown" : formatResetCountdown(resetsAt - now);
  return `${kind} · ${used}% used · ${reset}`;
}

/** Meter rows for one provider; empty when it reports no windows. */
export function providerMeterRows(provider: ProviderUsage, now: number): MeterRow[] {
  const rows: MeterRow[] = [];
  if (provider.session) {
    const used = clampUsedPercent(provider.session.usedPercent);
    rows.push({
      key: "session",
      label: `${used}% used ${formatWindowChipLabel(provider.session, now)}`,
      used,
      title: windowTitle("Session", used, provider.session.resetsAt, now),
    });
  }
  if (provider.weekly) {
    const used = clampUsedPercent(provider.weekly.usedPercent);
    rows.push({
      key: "weekly",
      label: `${used}% used ${formatWindowChipLabel(provider.weekly, now)}`,
      used,
      title: windowTitle("Weekly", used, provider.weekly.resetsAt, now),
    });
  }
  if (provider.fableWeekly) {
    const used = clampUsedPercent(provider.fableWeekly.usedPercent);
    rows.push({
      key: "fable",
      label: `${used}% used Fable`,
      used,
      title: windowTitle("Fable", used, provider.fableWeekly.resetsAt, now),
    });
  }
  return rows;
}

export function providerDisplayName(provider: "claude" | "codex"): string {
  return provider === "claude" ? "Claude" : "Codex";
}

/**
 * Source status-label copy (usage-error-copy.ts getProviderUsageStatusLabel),
 * classified from this repo's reader error strings (the fork keys off
 * structured failureKind metadata Drogon's readers do not ship):
 * a failed network request is a network issue, a provider-side rate-limit
 * refusal is "Limited", everything else is a failed refresh.
 */
export function providerStatusLabel(provider: ProviderUsage): string | null {
  if (provider.status !== "error") return null;
  const message = provider.error ?? "";
  if (/unreachable|network/i.test(message)) return "Network issue";
  if (/\brate[- ]?limits?\b|\brate[- ]?limited\b/i.test(message)) return "Limited";
  return "Refresh failed";
}

/** Source icon-only letter badge letters (StatusBarProviderSegment). */
export function providerBadgeLetter(provider: ProviderUsage["provider"]): string {
  return provider === "claude" ? "C" : "X";
}

/** Source resource-manager copy (resource-manager-terminal-copy.ts). */
export function resourceManagerSessionCount(count: number): string {
  return `${count} terminal ${count === 1 ? "session" : "sessions"}`;
}

export function resourceManagerAriaLabel(sessionCount: number): string {
  return `Resource Manager, ${resourceManagerSessionCount(sessionCount)}`;
}

/**
 * Source tooltip lines (getResourceManagerTooltipLines): summary, then the
 * grouped-by-workspace hint; an unmeasured memory figure degrades to the
 * source's "memory unavailable" wording inside the summary.
 */
export function resourceManagerTooltipLines(
  memory: string | null,
  sessionCount: number,
): string[] {
  return [
    `Resource Manager - ${memory === null ? "memory unavailable" : memory} - ${resourceManagerSessionCount(sessionCount)}`,
    sessionCount > 0
      ? "Terminal sessions are grouped by workspace."
      : "No terminal sessions yet.",
  ];
}

/** Group tooltip: name plus one line per meter, or the honest failure reason. */
export function providerTitle(provider: ProviderUsage, now: number): string {
  const name = providerDisplayName(provider.provider);
  const rows = providerMeterRows(provider, now);
  if (rows.length > 0) {
    return `${name}\n${rows.map((row) => row.title).join("\n")}`;
  }
  if (provider.status === "unavailable" || provider.status === "error") {
    return `${name} unavailable: ${provider.error ?? "no reason given"}`;
  }
  return `${name}: no usage yet`;
}

/**
 * Source badge format (resource-usage-metrics.tsx formatMemory): KB rounded
 * to whole units below 1 MB, one decimal in MB, two in GB; the fork renders
 * an em dash while the resource snapshot has never arrived.
 */
export function memoryBadge(rssBytes: number | null): string {
  if (rssBytes === null || !Number.isFinite(rssBytes) || rssBytes < 0) return "—";
  if (rssBytes < 1024 * 1024) return `${Math.round(rssBytes / 1024)} KB`;
  if (rssBytes < 1024 * 1024 * 1024) {
    return `${(rssBytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(rssBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Source PortsStatusSegment form: the workspace port count only (the
    word "ports" lives in the aria-label and tooltip, not the strip). */
export function portsLabel(ports: PortsSnapshot): string {
  return `${ports.listening.length}`;
}

export function portsAriaLabel(ports: PortsSnapshot): string {
  const count = ports.listening.length;
  return `Ports, ${count} workspace ${count === 1 ? "port" : "ports"}`;
}

/** Source tooltip copy (PortsStatusSegment tooltip content). */
export function portsTitle(ports: PortsSnapshot): string {
  if (ports.unavailableReason !== null) {
    return `Ports unavailable: ${ports.unavailableReason}`;
  }
  const count = ports.listening.length;
  return `Ports — ${count} workspace ${count === 1 ? "port" : "ports"}`;
}

/**
 * Source gate (StatusBarSurface.tsx): the refresh control renders only when
 * usage is visible and non-empty — never on the loading/empty strip.
 */
export function hasVisibleUsage(
  providers: readonly ProviderUsage[],
  now: number,
): boolean {
  return providers.some((provider) => providerMeterRows(provider, now).length > 0);
}

/** Source refresh copy: the accessible name names rate limits; the tooltip names the action. */
export const REFRESH_RATE_LIMITS_LABEL = "Refresh rate limits";
export const REFRESH_USAGE_DATA_TITLE = "Refresh usage data";

/**
 * Source awake form (CaffeinateStatusSegment.tsx): mode label plus the
 * Active/Inactive activity suffix, e.g. "Keep computer awake, Off · Inactive".
 */
export function awakeStatusLabel(mode: "on" | "off", active: boolean): string {
  const modeLabel = mode === "on" ? "On" : "Off";
  return `Keep computer awake, ${modeLabel} · ${active ? "Active" : "Inactive"}`;
}
