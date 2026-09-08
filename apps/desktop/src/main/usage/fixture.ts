// MIT Copyright (c) 2026 Lovecast Inc.
// Env-gated usage fixture for tests, screenshots and rendered walkthroughs:
// DROGON_USAGE_FIXTURE points at a JSON file whose shape mirrors the shared
// contract (providers plus the memory/ports/awake sections). When set, the
// store serves the file instead of probing real providers, so harness runs
// never read local credentials or spawn provider CLIs. Nothing else may
// enable it: a missing/unreadable/broken file disables the fixture and the
// store falls back to real probing (fail open to honesty, fail closed to
// secrets).
import { readFile } from "node:fs/promises";
import {
  memorySnapshotSchema,
  portsSnapshotSchema,
  providerUsageSchema,
  type MemorySnapshot,
  type PortsSnapshot,
  type ProviderUsage,
} from "../../shared/usage-contract";

export type UsageFixture = {
  claude: ProviderUsage;
  codex: ProviderUsage;
  memory: MemorySnapshot;
  ports: PortsSnapshot;
};

/** The fixture path from the environment, or null when unset/blank. */
export function usageFixturePath(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = (env.DROGON_USAGE_FIXTURE ?? "").trim();
  return raw === "" ? null : raw;
}

function parseFixture(raw: string): UsageFixture | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const source = data as Record<string, unknown>;
  const claude = providerUsageSchema.safeParse(source.claude);
  const codex = providerUsageSchema.safeParse(source.codex);
  if (!claude.success || !codex.success) return null;
  const memory = source.memory
    ? memorySnapshotSchema.safeParse(source.memory)
    : null;
  const ports = source.ports ? portsSnapshotSchema.safeParse(source.ports) : null;
  return {
    claude: claude.data,
    codex: codex.data,
    memory:
      memory && memory.success
        ? memory.data
        : { rssBytes: null, processCount: null, unavailableReason: "Not in fixture." },
    ports:
      ports && ports.success
        ? ports.data
        : { listening: [], unavailableReason: "Not in fixture." },
  };
}

/**
 * Read and validate the fixture file; null when unset or unusable (the
 * store then probes for real, exactly as without the seam).
 */
export async function readUsageFixture(
  path: string | null,
  readFileFn: typeof readFile = readFile,
): Promise<UsageFixture | null> {
  if (path === null) return null;
  let raw: string;
  try {
    raw = await readFileFn(path, "utf8");
  } catch {
    return null;
  }
  return parseFixture(raw);
}
