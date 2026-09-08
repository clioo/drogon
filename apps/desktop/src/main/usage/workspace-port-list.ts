// MIT Copyright (c) 2026 Lovecast Inc.
// R13-B: the `drogon:workspacePorts {workspaceId}` reader behind the
// right-sidebar Ports panel. Ported shape from the read-only reference's
// src/shared/workspace-ports.ts (WorkspacePortScanResult) and
// src/main/ports/local-workspace-port-attribution.ts (enrichPort):
// one host-wide scan, attribution to every workspace probe, workspace rows
// first. Unlike the source's always-running WorkspacePortScanner there is
// no background loop here — the panel polls this channel while visible.
import {
  workspacePortsSnapshotSchema,
  type UsageResult,
  type WorkspacePortsSnapshot,
} from "../../shared/usage-contract";
import { readWorkspaceProbes } from "./workspace-paths";
import {
  attributePortToWorkspace,
  scanPlatformListeningPorts,
  type NamedWorkspacePortProbe,
} from "./workspace-ports";
import {
  compareWorkspacePortRows,
  enrichWorkspacePortRow,
} from "./workspace-port-rows";

export type ListWorkspacePortsDeps = {
  readProbes?: () => Promise<NamedWorkspacePortProbe[]>;
  scan?: typeof scanPlatformListeningPorts;
  now?: () => number;
};

function errorResult(): UsageResult<never> {
  return {
    ok: false,
    error: { code: "internal_error", message: "Workspace port scan failed validation.", retryable: false },
  };
}

function unavailable(
  platform: NodeJS.Platform,
  scannedAt: number,
  reason: string,
): UsageResult<WorkspacePortsSnapshot> {
  const parsed = workspacePortsSnapshotSchema.safeParse({
    platform,
    scannedAt,
    ports: [],
    unavailableReason: reason,
  });
  if (!parsed.success) return errorResult();
  return { ok: true, result: parsed.data };
}

/**
 * One listener scan attributed to the daemon's workspaces. The requested
 * workspace scopes the caller's panel; the scan stays host-wide so the
 * panel's Other Workspaces / External sections match the source's.
 */
export async function listWorkspacePorts(
  workspaceId: string,
  deps: ListWorkspacePortsDeps = {},
): Promise<UsageResult<WorkspacePortsSnapshot>> {
  void workspaceId;
  const readProbes = deps.readProbes ?? readWorkspaceProbes;
  const scan = deps.scan ?? scanPlatformListeningPorts;
  const now = deps.now ?? Date.now;
  const platform = process.platform;
  const scannedAt = now();
  const probes = await readProbes().catch(() => [] as NamedWorkspacePortProbe[]);
  let raw;
  try {
    raw = await scan();
  } catch {
    return unavailable(platform, scannedAt, "Port scan unavailable.");
  }
  if (!raw.metadataAvailable) {
    return unavailable(
      platform,
      scannedAt,
      "Port scan could not read process metadata.",
    );
  }
  const rows = raw.ports
    .map((port) =>
      enrichWorkspacePortRow(port, attributeOwner(port, probes)),
    )
    .sort(compareWorkspacePortRows);
  const parsed = workspacePortsSnapshotSchema.safeParse({
    platform,
    scannedAt,
    ports: rows,
    unavailableReason: null,
  });
  if (!parsed.success) return errorResult();
  return { ok: true, result: parsed.data };
}

function attributeOwner(
  port: Parameters<typeof attributePortToWorkspace>[0],
  probes: readonly NamedWorkspacePortProbe[],
): { workspaceId: string; displayName: string; confidence: "cwd" | "command" } | undefined {
  const owner = attributePortToWorkspace(port, probes);
  if (!owner) return undefined;
  const probe = probes.find((candidate) => candidate.id === owner.workspaceId);
  return {
    workspaceId: owner.workspaceId,
    displayName: probe?.name ?? owner.workspaceId,
    confidence: owner.confidence,
  };
}
