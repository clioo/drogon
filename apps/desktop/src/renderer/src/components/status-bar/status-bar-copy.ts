// Pure status-bar projections: snapshot -> display strings. No React, no I/O,
// covered by status-bar-copy.test.ts; StatusBar.tsx only arranges the output.
import {
  clampUsedPercent,
  formatBytes,
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

export function memoryLabel(rssBytes: number | null): string {
  return formatBytes(rssBytes) ?? "unavailable";
}

export function memoryTitle(args: {
  rssBytes: number | null;
  processCount: number | null;
  unavailableReason: string | null;
}): string {
  if (args.rssBytes === null) return `Memory unavailable: ${args.unavailableReason ?? "no reason given"}`;
  const processes =
    args.processCount === null ? "process tree" : `${args.processCount} processes`;
  return `Memory used by the Drogon process tree (${processes}): ${formatBytes(args.rssBytes)}`;
}

/** Source PortsStatusSegment form: the workspace port count only (the
    word "ports" lives in the aria-label and tooltip, not the strip). */
export function portsLabel(ports: PortsSnapshot): string {
  if (ports.unavailableReason !== null) return "unavailable";
  return `${ports.listening.length}`;
}

export function portsAriaLabel(ports: PortsSnapshot): string {
  if (ports.unavailableReason !== null) return "Ports unavailable";
  const count = ports.listening.length;
  return `Ports, ${count} workspace ${count === 1 ? "port" : "ports"}`;
}

export function portsTitle(ports: PortsSnapshot): string {
  if (ports.unavailableReason !== null) {
    return `Ports unavailable: ${ports.unavailableReason}`;
  }
  if (ports.listening.length === 0) return "Ports: none listening";
  const listed = ports.listening
    .slice(0, 5)
    .map((port) => `${port.port} (${port.process})`)
    .join(", ");
  const extra =
    ports.listening.length > 5 ? `, +${ports.listening.length - 5} more` : "";
  return `Listening ports: ${listed}${extra}`;
}

export function terminalsTitle(terminalCount: number): string {
  return `${terminalCount} ${terminalCount === 1 ? "live terminal" : "live terminals"}`;
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
