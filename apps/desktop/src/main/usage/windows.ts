// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only; never edit the reference):
//   src/main/rate-limits/claude-usage-window.ts
//   src/main/rate-limits/claude-oauth-credentials.ts (parse only; no keychain
//     write helpers, no writes of any kind)
//   src/main/rate-limits/codex-pty-status-parser.ts
//   src/main/rate-limits/codex-rate-limit-window-classification.ts
//   src/main/rate-limits/codex-rate-limit-window-mapper.ts
// Pure parsers/projections: no I/O, no credentials, safe to unit test.

export type ClaudeUsageWindowInput = {
  utilization?: number;
  used_percentage?: number;
  resets_at?: string | number;
};

// 1e10 sits between any plausible seconds epoch (<2286) and any millisecond
// epoch (>2001), so it distinguishes the two units without extra metadata.
export function parseClaudeUsageResetTimestamp(
  value: string | number | undefined,
): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (!value) return null;
  const numericValue = Number(value);
  if (Number.isFinite(numericValue) && value.trim() !== "") {
    return numericValue > 10_000_000_000 ? numericValue : numericValue * 1000;
  }
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function describeResetTimestamp(resetValue: string | number | undefined): string | null {
  const resetTimestamp = parseClaudeUsageResetTimestamp(resetValue);
  if (resetTimestamp === null) return null;
  try {
    const date = new Date(resetTimestamp);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    }
    return date.toLocaleDateString(undefined, {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

export type UsageWindow = {
  usedPercent: number;
  windowMinutes: number;
  resetsAt: number | null;
  resetDescription: string | null;
};

export function mapClaudeUsageWindow(
  raw: ClaudeUsageWindowInput | undefined,
  windowMinutes: number,
): UsageWindow | null {
  if (!raw) return null;
  const usedPercent =
    typeof raw.utilization === "number"
      ? raw.utilization
      : typeof raw.used_percentage === "number"
        ? raw.used_percentage
        : null;
  if (usedPercent === null || !Number.isFinite(usedPercent)) return null;
  return {
    usedPercent: Math.min(100, Math.max(0, usedPercent)),
    windowMinutes,
    resetsAt: parseClaudeUsageResetTimestamp(raw.resets_at),
    resetDescription: describeResetTimestamp(raw.resets_at),
  };
}

export type ClaudeOAuthCredentialSource =
  | "keychain"
  | "credentials-file"
  | "none";

export type ClaudeOAuthCredentialRead = {
  token: string | null;
  hasRefreshableCredentials: boolean;
  source: ClaudeOAuthCredentialSource;
};

/** Parse only: reads a credentials JSON blob, never writes it. */
export function parseClaudeOAuthCredentialsJson(
  raw: string,
  source: ClaudeOAuthCredentialSource,
): ClaudeOAuthCredentialRead {
  try {
    const oauth = (JSON.parse(raw) as {
      claudeAiOauth?: {
        accessToken?: string;
        refreshToken?: string;
        expiresAt?: number;
      };
    })?.claudeAiOauth;
    const hasRefreshableCredentials =
      typeof oauth?.refreshToken === "string" && oauth.refreshToken.trim() !== "";
    if (!oauth?.accessToken || typeof oauth.accessToken !== "string") {
      return { token: null, hasRefreshableCredentials, source };
    }
    // expiresAt is not authoritative for the usage endpoint; the server decides.
    return { token: oauth.accessToken, hasRefreshableCredentials, source };
  } catch {
    return { token: null, hasRefreshableCredentials: false, source: "none" };
  }
}

// Reject model-scoped rows regardless of row order in cursor-positioned output.
const FIVE_HOUR_RE =
  /(?<![\w-][^\S\r\n]{0,4})5h\s+limit[^\d%\r\n]*(\d+)%(?:\s*(used|left))?/i;
const WEEKLY_RE =
  /(?<![\w-][^\S\r\n]{0,4})weekly\s+limit[^\d%\r\n]*(\d+)%(?:\s*(used|left))?/i;
// eslint-disable-next-line no-control-regex
const PTY_CONTROL_SEQUENCE_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;
// Trailing "resets <text>" hint on a limit line; parsed best-effort, else kept
// as a description so a partial read still renders honestly.
const RESET_HINT_RE = /resets?\s+([^()\r\n]{1,48})/i;

export function stripPtyControlSequences(output: string): string {
  return output.replace(PTY_CONTROL_SEQUENCE_RE, "");
}

function ptyUsedPercent(match: RegExpExecArray): number {
  const pct = Number.parseInt(match[1], 10);
  const oriented = match[2]?.toLowerCase() === "left" ? 100 - pct : pct;
  return Math.min(100, Math.max(0, oriented));
}

function ptyResetHint(line: string): { resetsAt: number | null; resetDescription: string | null } {
  const hint = RESET_HINT_RE.exec(line)?.[1]?.trim() ?? null;
  if (!hint) return { resetsAt: null, resetDescription: null };
  const parsed = new Date(hint).getTime();
  return {
    resetsAt: Number.isNaN(parsed) ? null : parsed,
    resetDescription: hint,
  };
}

function ptyLineFor(output: string, re: RegExp): string | null {
  // Fresh regex state per call: the shared patterns are global-flag-free, but
  // callers may pass a reused instance, so reset lastIndex defensively.
  re.lastIndex = 0;
  for (const line of output.split(/\r\n|\n|\r/)) {
    re.lastIndex = 0;
    if (re.test(line)) return line;
  }
  return null;
}

/** Parses `codex`-reported "5h limit"/"weekly limit" percentages from PTY text. */
export function parseCodexPtyStatus(output: string): {
  session: UsageWindow | null;
  weekly: UsageWindow | null;
} {
  const clean = stripPtyControlSequences(output);
  const fiveMatch = FIVE_HOUR_RE.exec(clean);
  const weeklyMatch = WEEKLY_RE.exec(clean);
  const sessionReset = fiveMatch
    ? ptyResetHint(ptyLineFor(clean, FIVE_HOUR_RE) ?? "")
    : { resetsAt: null, resetDescription: null };
  const weeklyReset = weeklyMatch
    ? ptyResetHint(ptyLineFor(clean, WEEKLY_RE) ?? "")
    : { resetsAt: null, resetDescription: null };
  return {
    session: fiveMatch
      ? {
          usedPercent: ptyUsedPercent(fiveMatch),
          windowMinutes: 300,
          resetsAt: sessionReset.resetsAt,
          resetDescription: sessionReset.resetDescription,
        }
      : null,
    weekly: weeklyMatch
      ? {
          usedPercent: ptyUsedPercent(weeklyMatch),
          windowMinutes: 10080,
          resetsAt: weeklyReset.resetsAt,
          resetDescription: weeklyReset.resetDescription,
        }
      : null,
  };
}

export const CODEX_SESSION_WINDOW_MINUTES = 300;
export const CODEX_WEEKLY_WINDOW_MINUTES = 10080;

// Tolerate the one-minute drift seen in older Codex bucket lengths without
// absorbing other durations.
const CODEX_WINDOW_DURATION_TOLERANCE_MINUTES = 1;

export type CodexRateWindowSnapshot = {
  usedPercent?: unknown;
  windowDurationMins?: unknown;
  resetsAt?: unknown;
};

export type CodexRateLimitWindowsSnapshot = {
  primary?: CodexRateWindowSnapshot | null;
  secondary?: CodexRateWindowSnapshot | null;
};

type MappableCodexRateWindow = CodexRateWindowSnapshot & { usedPercent: number };

function isMappableWindow(
  raw: CodexRateWindowSnapshot | null | undefined,
): raw is MappableCodexRateWindow {
  return typeof raw?.usedPercent === "number" && Number.isFinite(raw.usedPercent);
}

function classifyWindowDuration(raw: MappableCodexRateWindow): "session" | "weekly" | null {
  const duration = raw.windowDurationMins;
  if (typeof duration !== "number" || !Number.isFinite(duration)) return null;
  if (Math.abs(duration - CODEX_SESSION_WINDOW_MINUTES) <= CODEX_WINDOW_DURATION_TOLERANCE_MINUTES) {
    return "session";
  }
  if (Math.abs(duration - CODEX_WEEKLY_WINDOW_MINUTES) <= CODEX_WINDOW_DURATION_TOLERANCE_MINUTES) {
    return "weekly";
  }
  return null;
}

export function classifyCodexRateLimitWindows(
  result: CodexRateLimitWindowsSnapshot | null | undefined,
): { session: MappableCodexRateWindow | null; weekly: MappableCodexRateWindow | null } {
  const primary = isMappableWindow(result?.primary) ? result.primary : null;
  const secondary = isMappableWindow(result?.secondary) ? result.secondary : null;
  let session: MappableCodexRateWindow | null = null;
  let weekly: MappableCodexRateWindow | null = null;
  for (const window of [primary, secondary]) {
    if (!window) continue;
    const kind = classifyWindowDuration(window);
    if (kind === "session" && !session) session = window;
    else if (kind === "weekly" && !weekly) weekly = window;
  }
  // Unknown app-server durations retain the legacy primary/session and
  // secondary/weekly mapping.
  if (!session && primary && classifyWindowDuration(primary) === null) session = primary;
  if (!weekly && secondary && classifyWindowDuration(secondary) === null) weekly = secondary;
  return { session, weekly };
}

export function mapCodexRateLimitWindow(
  raw: CodexRateWindowSnapshot | null | undefined,
  expectedWindowMinutes: number,
): UsageWindow | null {
  if (!raw || typeof raw.usedPercent !== "number" || !Number.isFinite(raw.usedPercent)) {
    return null;
  }
  let resetDescription: string | null = null;
  let resetsAt: number | null = null;
  if (typeof raw.resetsAt === "number" && Number.isFinite(raw.resetsAt) && raw.resetsAt > 0) {
    // Codex returns resetsAt as Unix seconds, not milliseconds.
    const date = new Date(raw.resetsAt * 1000);
    if (!Number.isNaN(date.getTime())) {
      resetsAt = date.getTime();
      const now = new Date();
      resetDescription =
        date.toDateString() === now.toDateString()
          ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
          : date.toLocaleDateString(undefined, {
              weekday: "short",
              hour: "numeric",
              minute: "2-digit",
            });
    }
  }
  return {
    usedPercent: Math.min(100, Math.max(0, raw.usedPercent)),
    windowMinutes: expectedWindowMinutes,
    resetsAt,
    resetDescription,
  };
}
