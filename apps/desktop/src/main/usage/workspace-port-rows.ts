// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/main/ports/local-workspace-port-attribution.ts
//     (inferProtocol + the HTTP_PORTS/HTTPS_PORTS tables, enrichPort's row
//     shape, compareWorkspacePorts ordering)
// Adapted: rows carry this repo's owner ({ workspaceId, displayName,
// confidence }); unattributed listeners become plain external rows (the
// source's container detection and advertised-URL enrichment have no
// counterpart in this repo's reader).
import {
  connectHostForBindHost,
  type RawListeningPort,
} from "./workspace-ports";
import type { WorkspacePortOwnerInfo } from "./workspace-paths";

const HTTP_PORTS: Record<number, true> = {
  80: true,
  3000: true,
  3001: true,
  4200: true,
  5000: true,
  5173: true,
  5174: true,
  8000: true,
  8080: true,
  8888: true,
};
const HTTPS_PORTS: Record<number, true> = { 443: true, 8443: true };

/** Source's inferProtocol: well-known dev-server ports only, else unknown. */
export function inferProtocol(port: number): "http" | "https" | "unknown" {
  if (HTTPS_PORTS[port] === true) return "https";
  if (HTTP_PORTS[port] === true) return "http";
  return "unknown";
}

/** The row the right-sidebar Ports panel renders (shared/usage-contract). */
export type WorkspacePortRow = {
  id: string;
  bindHost: string;
  connectHost: string;
  port: number;
  pid: number | null;
  processName: string | null;
  protocol: "http" | "https" | "unknown";
  kind: "workspace" | "external";
  owner: WorkspacePortOwnerInfo | null;
};

/**
 * Source's enrichPort minus container/advertised-URL handling: attributed
 * listeners become workspace rows with their owner evidence, everything
 * else stays an external row keyed like the source
 * (`host:port:pid`).
 */
export function enrichWorkspacePortRow(
  port: RawListeningPort,
  owner: WorkspacePortOwnerInfo | undefined,
): WorkspacePortRow {
  return {
    id: `${port.host}:${port.port}:${port.pid ?? "unknown"}`,
    bindHost: port.host,
    connectHost: connectHostForBindHost(port.host),
    port: port.port,
    pid: port.pid ?? null,
    processName: port.processName ? port.processName.slice(0, 256) : null,
    protocol: inferProtocol(port.port),
    kind: owner ? "workspace" : "external",
    owner: owner ?? null,
  };
}

/** Source's compareWorkspacePorts with two kinds: workspace rows first. */
export function compareWorkspacePortRows(a: WorkspacePortRow, b: WorkspacePortRow): number {
  const aRank = a.kind === "workspace" ? 0 : 1;
  const bRank = b.kind === "workspace" ? 0 : 1;
  return (
    aRank - bRank || a.port - b.port || a.connectHost.localeCompare(b.connectHost)
  );
}
