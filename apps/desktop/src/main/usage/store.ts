// Cached usage snapshot with fail-closed backoff. No Electron imports here so
// vitest can cover the scheduling/merging logic directly; service.ts adds IPC.
import type {
  AwakeSnapshot,
  MemorySnapshot,
  PortsSnapshot,
  ProviderUsage,
  UsageSnapshot,
} from "../../shared/usage-contract";
import { AwakeController } from "./awake";
import { readClaudeUsage } from "./claude";
import { readCodexUsage } from "./codex";
import { readUsageFixture, usageFixturePath, type UsageFixture } from "./fixture";
import { readMemory, readWorkspacePorts } from "./system";
import { readWorkspaceProbes } from "./workspace-paths";
import type { WorkspacePortProbe } from "./workspace-ports";

export const USAGE_POLL_MS = 60_000;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 10 * 60_000;

/** Exponential backoff per consecutive failure, capped; pure for tests. */
export function nextBackoffMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return 0;
  const grown = BACKOFF_BASE_MS * 2 ** Math.min(consecutiveFailures - 1, 8);
  return Math.min(grown, BACKOFF_MAX_MS);
}

export function shouldRefreshProvider(
  lastFailedAt: number | null,
  consecutiveFailures: number,
  now: number,
): boolean {
  if (lastFailedAt === null || consecutiveFailures <= 0) return true;
  return now - lastFailedAt >= nextBackoffMs(consecutiveFailures);
}

function idleProvider(provider: "claude" | "codex"): ProviderUsage {
  return {
    provider,
    session: null,
    weekly: null,
    fableWeekly: null,
    updatedAt: 0,
    error: null,
    status: "idle",
  };
}

/**
 * Merge a fresh provider read over the cached one. Transient "error" keeps
 * the last-good windows (stale numbers beat no numbers); "unavailable"
 * (signed out / CLI missing) replaces authoritatively so the bar can say so.
 */
export function mergeProviderReading(
  previous: ProviderUsage,
  next: ProviderUsage,
): ProviderUsage {
  if (next.status === "error" && previous.status === "ok") {
    return {
      ...next,
      session: previous.session,
      weekly: previous.weekly,
      fableWeekly: previous.fableWeekly,
    };
  }
  return next;
}

export type UsageStoreDeps = {
  readClaude?: () => Promise<ProviderUsage>;
  readCodex?: () => Promise<ProviderUsage>;
  readMemory?: () => Promise<MemorySnapshot>;
  /** Receives the daemon's workspace probes; only workspace-owned listeners count. */
  readPorts?: (workspaces: readonly WorkspacePortProbe[]) => Promise<PortsSnapshot>;
  readWorkspaceProbes?: () => Promise<WorkspacePortProbe[]>;
  /** Env-gated fixture seam (DROGON_USAGE_FIXTURE); null probes for real. */
  readFixture?: () => Promise<UsageFixture | null>;
  awake?: AwakeController;
  now?: () => number;
};

/** Env-forced provider outage for screenshots/tests: "claude,codex". */
export function forcedUnavailableProviders(
  env: NodeJS.ProcessEnv = process.env,
): Set<"claude" | "codex"> {
  const forced = new Set<"claude" | "codex">();
  for (const name of (env.DROGON_USAGE_FORCE_UNAVAILABLE ?? "").split(",")) {
    const trimmed = name.trim().toLowerCase();
    if (trimmed === "claude" || trimmed === "codex") forced.add(trimmed);
  }
  return forced;
}

function forcedUnavailable(provider: "claude" | "codex"): ProviderUsage {
  return {
    provider,
    session: null,
    weekly: null,
    fableWeekly: null,
    updatedAt: Date.now(),
    error: `${provider === "claude" ? "Claude" : "Codex"} is unavailable (forced for testing).`,
    status: "unavailable",
  };
}

export class UsageStore {
  private snapshot: UsageSnapshot;
  private refreshing: Promise<UsageSnapshot> | null = null;
  private failures = { claude: 0, codex: 0 };
  private lastFailedAt: { claude: number | null; codex: number | null } = {
    claude: null,
    codex: null,
  };
  private readonly deps: Required<
    Omit<UsageStoreDeps, "awake" | "now" | "readFixture">
  > & {
    awake: AwakeController;
    now: () => number;
    readFixture: () => Promise<UsageFixture | null>;
  };

  constructor(deps: UsageStoreDeps = {}) {
    const awake = deps.awake ?? new AwakeController();
    this.deps = {
      readClaude: deps.readClaude ?? readClaudeUsage,
      readCodex: deps.readCodex ?? readCodexUsage,
      readMemory: deps.readMemory ?? readMemory,
      readPorts: deps.readPorts ?? readWorkspacePorts,
      readWorkspaceProbes: deps.readWorkspaceProbes ?? readWorkspaceProbes,
      readFixture: deps.readFixture ?? (() => readUsageFixture(usageFixturePath())),
      awake,
      now: deps.now ?? Date.now,
    };
    this.snapshot = {
      claude: idleProvider("claude"),
      codex: idleProvider("codex"),
      memory: { rssBytes: null, processCount: null, unavailableReason: "Not measured yet." },
      ports: { listening: [], unavailableReason: "Not scanned yet." },
      awake: awake.getSnapshot(),
      updatedAt: this.deps.now(),
    };
  }

  current(): UsageSnapshot {
    return this.snapshot;
  }

  awakeSnapshot(): AwakeSnapshot {
    return this.deps.awake.getSnapshot();
  }

  /** Release the owned caffeinate child (app quit). */
  dispose(): void {
    this.deps.awake.dispose();
  }

  setAwake(mode: "on" | "off"): AwakeSnapshot {
    const next = this.deps.awake.setMode(mode);
    this.snapshot = { ...this.snapshot, awake: next, updatedAt: this.deps.now() };
    return next;
  }

  /** Cached snapshot; kicks a background refresh when older than the poll interval. */
  getSnapshot(): UsageSnapshot {
    if (!this.refreshing && this.deps.now() - this.snapshot.updatedAt >= USAGE_POLL_MS) {
      this.refreshing = this.probeAll(false).finally(() => {
        this.refreshing = null;
      });
      // Background only: a rejection here must never surface as unhandled.
      // probeAll is fully guarded, this is the belt.
      void this.refreshing.catch(() => {});
    }
    return this.snapshot;
  }

  /** Manual refresh (status-bar control): always re-probes, bypassing backoff. */
  async refresh(): Promise<UsageSnapshot> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.probeAll(true).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async probeAll(force: boolean): Promise<UsageSnapshot> {
    // Fixture seam: the whole snapshot comes from the file; nothing local is
    // read and no provider CLI is spawned.
    const fixture = await this.deps.readFixture();
    if (fixture) {
      this.snapshot = {
        ...fixture,
        awake: this.deps.awake.getSnapshot(),
        updatedAt: this.deps.now(),
      };
      return this.snapshot;
    }
    const forced = forcedUnavailableProviders();
    const workspaces = await this.deps.readWorkspaceProbes().catch(
      (): WorkspacePortProbe[] => [],
    );
    const [claude, codex, memory, ports] = await Promise.all([
      this.probeProvider("claude", forced, force),
      this.probeProvider("codex", forced, force),
      this.deps.readMemory().catch(
        (): MemorySnapshot => ({
          rssBytes: null,
          processCount: null,
          unavailableReason: "Process list unavailable.",
        }),
      ),
      this.deps.readPorts(workspaces).catch(
        (): PortsSnapshot => ({ listening: [], unavailableReason: "Port scan unavailable." }),
      ),
    ]);
    this.snapshot = {
      claude,
      codex,
      memory,
      ports,
      awake: this.deps.awake.getSnapshot(),
      updatedAt: this.deps.now(),
    };
    return this.snapshot;
  }

  private async probeProvider(
    provider: "claude" | "codex",
    forced: Set<"claude" | "codex">,
    force: boolean,
  ): Promise<ProviderUsage> {
    const previous = this.snapshot[provider];
    if (forced.has(provider)) {
      this.failures[provider] += 1;
      this.lastFailedAt[provider] = this.deps.now();
      return mergeProviderReading(previous, forcedUnavailable(provider));
    }
    if (
      !force &&
      !shouldRefreshProvider(this.lastFailedAt[provider], this.failures[provider], this.deps.now())
    ) {
      return previous;
    }
    let next: ProviderUsage;
    try {
      next =
        provider === "claude" ? await this.deps.readClaude() : await this.deps.readCodex();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      next = {
        provider,
        session: null,
        weekly: null,
        fableWeekly: null,
        updatedAt: Date.now(),
        error: `${provider === "claude" ? "Claude" : "Codex"} probe failed (${message}).`,
        status: "error",
      };
    }
    if (next.status === "ok") {
      this.failures[provider] = 0;
      this.lastFailedAt[provider] = null;
    } else {
      this.failures[provider] += 1;
      this.lastFailedAt[provider] = this.deps.now();
    }
    return mergeProviderReading(previous, next);
  }
}
