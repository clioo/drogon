// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/main/ipc/shell.ts (`shell:openUrl` handler: URL parse plus an
// http(s)-only gate) and src/preload/api/shell-bridge.ts (`openUrl`).
// Adapter: this repo's `drogon:*` channel vocabulary and Result envelope;
// only the URL case is ported (path/editor/file-manager cases are out of
// scope for R10-C).

import type { Result } from "./session-contract";

/** Main-channel for the system-browser primitive. */
export const SHELL_OPEN_EXTERNAL_CHANNEL = "drogon:openExternal" as const;

export type ShellOpenExternalResult = { opened: true };

/**
 * Port of the source's `shell:openUrl` gate: a string that parses as a URL
 * with an http(s) scheme. Anything else (non-strings, unparseable input,
 * javascript:/file:/data:/ftp:…) is refused before any shell call.
 */
export function isExternalUrlAllowed(url: unknown): url is string {
  if (typeof url !== "string") return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" || parsed.protocol === "http:";
}

export interface ShellBridge {
  openExternal(url: string): Promise<Result<ShellOpenExternalResult>>;
}
