// Pure status-bar projections: snapshot -> display strings. No React, no I/O,
// covered by status-bar-copy.test.ts; StatusBar.tsx only arranges the output.
import {
  clampUsedPercent,
  formatResetCountdown,
  formatWindowChipLabel,
  formatWindowLabel,
  type AwakeMode,
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

// --- Usage popover roster (R16-AY2; fork UsageRosterPanel.tsx helpers) ----

export type UsageRosterWindow = {
  key: "session" | "weekly" | "fable";
  /** Short bucket/window label: 5h, wk, or Fable (fork shortLabel). */
  label: string;
  used: number;
  resetsAt: number | null;
};

/** Windows that actually carry data (fork usedSections), with roster labels. */
export function usageRosterWindows(provider: ProviderUsage): UsageRosterWindow[] {
  const rows: UsageRosterWindow[] = [];
  if (provider.session) {
    rows.push({
      key: "session",
      label: formatWindowLabel(provider.session.windowMinutes),
      used: clampUsedPercent(provider.session.usedPercent),
      resetsAt: provider.session.resetsAt,
    });
  }
  if (provider.weekly) {
    rows.push({
      key: "weekly",
      label: formatWindowLabel(provider.weekly.windowMinutes),
      used: clampUsedPercent(provider.weekly.usedPercent),
      resetsAt: provider.weekly.resetsAt,
    });
  }
  if (provider.fableWeekly) {
    // Fable shares the 7d window with weekly; labeled distinctly (fork).
    rows.push({
      key: "fable",
      label: "Fable",
      used: clampUsedPercent(provider.fableWeekly.usedPercent),
      resetsAt: provider.fableWeekly.resetsAt,
    });
  }
  return rows;
}

/** Worst-first roster order: the agent nearest a limit sits on top. */
export function usageRosterMaxUsed(provider: ProviderUsage): number {
  const rows = usageRosterWindows(provider);
  return rows.length > 0 ? Math.max(...rows.map((row) => row.used)) : 0;
}

/** The soonest-resetting window summarizes the next reset in one line. */
export function usageRosterResetLabel(
  provider: ProviderUsage,
  now: number,
): string | null {
  const resets = usageRosterWindows(provider)
    .map((row) => row.resetsAt)
    .filter((resetsAt): resetsAt is number => resetsAt !== null);
  if (resets.length === 0) return null;
  return formatResetCountdown(Math.min(...resets) - now);
}

export type UsageRosterTightest = { label: string; used: number };

/**
 * Compact-mode summary (fork getTightestUsageSection): the tightest window
 * with its live remaining duration, chosen by consumption even when the
 * display shows the complementary value.
 */
export function usageRosterTightest(
  provider: ProviderUsage,
  now: number,
): UsageRosterTightest | null {
  const rows = usageRosterWindows(provider);
  if (rows.length === 0) return null;
  const tightest = rows.reduce((current, candidate) =>
    candidate.used > current.used ? candidate : current,
  );
  const windows = {
    session: provider.session,
    weekly: provider.weekly,
    fable: provider.fableWeekly ?? null,
  } as const;
  const window = windows[tightest.key];
  const label =
    window && window.resetsAt !== null
      ? formatWindowChipLabel(window, now)
      : tightest.label;
  return { label, used: tightest.used };
}

/** Mirrors the 60/80 bar bands so the number matches its bar (fork
    usage-roster-formatting usageTextColorClass). */
export function usageTextColorClass(used: number): string {
  if (used >= 80) return "text-red-500";
  if (used >= 60) return "text-yellow-500";
  return "text-foreground";
}

/**
 * Source awake form (CaffeinateStatusSegment.tsx): mode label plus the
 * Active/Inactive activity suffix, e.g. "Keep computer awake, Off · Inactive".
 * Auto renders the fork's user-facing label "Agent" (agent-awake-copy.ts
 * getAgentAwakeModeLabel: On / Agent / Off).
 */
export function agentAwakeModeLabel(mode: AwakeMode): string {
  if (mode === "on") return "On";
  if (mode === "auto") return "Agent";
  return "Off";
}

export function awakeStatusLabel(mode: AwakeMode, active: boolean): string {
  return `Keep computer awake, ${agentAwakeModeLabel(mode)} · ${active ? "Active" : "Inactive"}`;
}

/** Fork menu copy (CaffeinateStatusSegment onDescription). */
export const AWAKE_MODE_DESCRIPTIONS: Record<AwakeMode, string> = {
  on: "Keep this computer awake continuously",
  auto: "Stay awake while an agent is working",
  off: "Allow normal system sleep behavior",
};

/**
 * Source empty-usage gate (status-bar-provider-visibility.ts
 * isUsageEmptyState, adapted): both providers must have settled (never while
 * the first snapshot is still loading) and report themselves unconfigured —
 * unavailable. A configured provider failing transiently stays visible on
 * purpose, so error never counts as empty. Drogon has no managed-account
 * settings signal, so the snapshot is the only voice.
 */
export function isUsageEmptyState(
  providers: readonly ProviderUsage[],
): boolean {
  return (
    providers.length > 0 &&
    providers.every((provider) => provider.status === "unavailable")
  );
}

export type UsageRosterRowKind =
  | "usage"
  | "loading"
  | "sign-in"
  | "unavailable"
  | "error"
  | "empty";

export type UsageRosterRowState = {
  kind: UsageRosterRowKind;
  statusLabel: string | null;
};

// Source sign-out patterns (usage-roster-row-state.ts): only explicit
// signed-out copy earns the sign-in CTA — credential refresh and network
// failures can mention auth while live sessions remain valid.
const CONFIRMED_SIGN_OUT_PATTERNS = [
  /\bnot signed in\b/i,
  /\bnot logged in\b/i,
  /\blogged out\b/i,
  /\bauthentication required\b/i,
  /\b(?:sign|log)[ -]?in required\b/i,
  /\bplease (?:sign|log) in\b/i,
  /\bplease reauthenticate\b/i,
];

function isConfirmedSignedOut(provider: ProviderUsage): boolean {
  return Boolean(
    provider.error &&
      CONFIRMED_SIGN_OUT_PATTERNS.some((pattern) => pattern.test(provider.error ?? "")),
  );
}

/**
 * Source roster row state (usage-roster-row-state.ts
 * getUsageRosterRowState): which footer a provider row renders — its windows,
 * a loading line, a sign-in prompt, or the honest failure label.
 */
export function usageRosterRowState(
  provider: ProviderUsage,
  hasUsage: boolean,
): UsageRosterRowState {
  if (hasUsage) return { kind: "usage", statusLabel: null };
  if (provider.status === "idle" || provider.status === "fetching") {
    return { kind: "loading", statusLabel: "Loading usage…" };
  }
  if (isConfirmedSignedOut(provider)) {
    return { kind: "sign-in", statusLabel: "not signed in" };
  }
  if (provider.status === "error") {
    return { kind: "error", statusLabel: providerStatusLabel(provider) };
  }
  if (provider.status === "unavailable") {
    return { kind: "unavailable", statusLabel: "Usage unavailable" };
  }
  return { kind: "empty", statusLabel: "No usage data" };
}
