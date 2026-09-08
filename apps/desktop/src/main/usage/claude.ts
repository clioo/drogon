// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only; never edit the reference):
//   src/main/rate-limits/claude-oauth-usage-request.ts (OAuth usage endpoint
//     shape, fable-weekly scoped-limit mapping)
// Read-only: reads the local OAuth token (macOS keychain, then the credentials
// file) and GETs the usage endpoint. Never writes credentials, config, or any
// other file; every failure resolves to a fail-closed ProviderUsage.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import path from "node:path";
import type { ProviderUsage } from "../../shared/usage-contract";
import {
  mapClaudeUsageWindow,
  parseClaudeOAuthCredentialsJson,
  type ClaudeUsageWindowInput,
} from "./windows";

const OAUTH_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const API_TIMEOUT_MS = 10_000;
const KEYCHAIN_TIMEOUT_MS = 3_000;

/**
 * Request headers, literal from the source
 * (src/main/rate-limits/claude-oauth-usage-request.ts): the OAuth usage
 * endpoint throttles unfamiliar clients (HTTP 429 for anything else), so
 * the product UA stays `claude-code/2.1.0`.
 */
export const CLAUDE_OAUTH_REQUEST_HEADERS: Record<string, string> = {
  "anthropic-beta": "oauth-2025-04-20",
  "User-Agent": "claude-code/2.1.0",
};

type OAuthUsageLimit = {
  kind?: string;
  percent?: number;
  resets_at?: string | number;
  scope?: { model?: { display_name?: string } | null } | null;
};

type OAuthUsageResponse = {
  five_hour?: ClaudeUsageWindowInput;
  seven_day?: ClaudeUsageWindowInput;
  fable_weekly?: ClaudeUsageWindowInput;
  fable_seven_day?: ClaudeUsageWindowInput;
  seven_day_fable?: ClaudeUsageWindowInput;
  limits?: OAuthUsageLimit[] | null;
};

function mapFableWeeklyWindow(data: OAuthUsageResponse) {
  const scoped = Array.isArray(data.limits)
    ? data.limits.find(
        (limit) =>
          limit?.kind === "weekly_scoped" &&
          Number.isFinite(limit.percent) &&
          limit.scope?.model?.display_name?.trim().toLowerCase() === "fable",
      )
    : undefined;
  return (
    mapClaudeUsageWindow(
      scoped ? { used_percentage: scoped.percent, resets_at: scoped.resets_at } : undefined,
      10080,
    ) ??
    mapClaudeUsageWindow(data.fable_weekly, 10080) ??
    mapClaudeUsageWindow(data.fable_seven_day, 10080) ??
    mapClaudeUsageWindow(data.seven_day_fable, 10080)
  );
}

function closed(
  status: ProviderUsage["status"],
  error: string | null,
  extra?: Partial<ProviderUsage>,
): ProviderUsage {
  return {
    provider: "claude",
    session: null,
    weekly: null,
    fableWeekly: null,
    updatedAt: Date.now(),
    error,
    status,
    ...extra,
  };
}

function keychainUser(): string {
  try {
    return userInfo().username;
  } catch {
    return "";
  }
}

function readKeychainToken(): Promise<string | null> {
  if (process.platform !== "darwin") return Promise.resolve(null);
  const user = keychainUser();
  const args = ["find-generic-password", "-s", "Claude Code-credentials", "-w"];
  if (user) args.push("-a", user);
  return new Promise((resolve) => {
    execFile("/usr/bin/security", args, { timeout: KEYCHAIN_TIMEOUT_MS }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      const credentials = stdout.trim();
      if (!credentials) {
        resolve(null);
        return;
      }
      resolve(parseClaudeOAuthCredentialsJson(credentials, "keychain").token);
    });
  });
}

async function readCredentialsFileToken(configDir?: string): Promise<string | null> {
  const dir = configDir || path.join(homedir(), ".claude");
  try {
    const raw = await readFile(path.join(dir, ".credentials.json"), "utf8");
    return parseClaudeOAuthCredentialsJson(raw, "credentials-file").token;
  } catch {
    return null;
  }
}

export type ClaudeUsageDeps = {
  readKeychainToken?: () => Promise<string | null>;
  readCredentialsFileToken?: () => Promise<string | null>;
  fetchJson?: (token: string, signal: AbortSignal) => Promise<OAuthUsageResponse>;
};

async function defaultFetchJson(token: string, signal: AbortSignal): Promise<OAuthUsageResponse> {
  const response = await fetch(OAUTH_USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...CLAUDE_OAUTH_REQUEST_HEADERS,
    },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Claude usage request failed (HTTP ${response.status}).`);
  }
  return (await response.json()) as OAuthUsageResponse;
}

export async function readClaudeUsage(deps: ClaudeUsageDeps = {}): Promise<ProviderUsage> {
  const token =
    (await (deps.readKeychainToken ?? readKeychainToken)()) ??
    (await (deps.readCredentialsFileToken ?? readCredentialsFileToken)());
  if (!token) {
    return closed("unavailable", "Claude is not signed in on this machine.");
  }
  let data: OAuthUsageResponse;
  try {
    const signal = AbortSignal.timeout(API_TIMEOUT_MS);
    data = await (deps.fetchJson ?? defaultFetchJson)(token, signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return closed("error", `Claude usage is unreachable (${message}).`);
  }
  const session = mapClaudeUsageWindow(data.five_hour, 300);
  const weekly = mapClaudeUsageWindow(data.seven_day, 10080);
  const fableWeekly = mapFableWeeklyWindow(data);
  if (!session && !weekly && !fableWeekly) {
    return closed("error", "Claude reported no usable usage windows.");
  }
  return {
    provider: "claude",
    session,
    weekly,
    fableWeekly,
    updatedAt: Date.now(),
    error: null,
    status: "ok",
  };
}
