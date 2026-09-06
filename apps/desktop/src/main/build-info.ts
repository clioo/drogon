import { readFileSync } from "node:fs";
import path from "node:path";

export type BuildInfo = { revision: string; builtAt: string; version: string };

const BUILD_INFO_FILE = "build-info.json";

function isBuildInfo(value: unknown): value is BuildInfo {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.revision === "string" &&
    typeof v.builtAt === "string" &&
    typeof v.version === "string"
  );
}

/**
 * Reads the packaged `resources/build-info.json` the coordinator's
 * packaging step supplies. Absent (development, or a build that predates
 * this file) or malformed both read as `null` — no revision is ever
 * invented, and nothing here is secret (a revision/build time/version, not
 * a token or path with user data).
 */
export function readBuildInfo(resourcesPath: string): BuildInfo | null {
  try {
    const raw = readFileSync(path.join(resourcesPath, BUILD_INFO_FILE), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return isBuildInfo(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
