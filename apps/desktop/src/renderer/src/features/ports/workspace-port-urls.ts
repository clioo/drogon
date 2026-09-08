// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the read-only reference
// src/renderer/src/lib/workspace-port-urls.ts (addressForPort,
// browserUrlForPort, hostForLocalAction). Adapted: this repo's port rows
// carry no advertised terminal URL, so only the OS-derived address path
// remains — the wildcard-bind normalization is kept verbatim.

import type { WorkspacePortRow } from "../../../../shared/usage-contract";

// Why: the scanner reports numeric addresses (127.0.0.1, 0.0.0.0, ::1, ::)
// while UI actions should use an address a browser can reliably open.
function hostForLocalAction(host: string): string {
  if (!host) {
    return "localhost";
  }
  return host.includes(":") ? `[${host}]` : host;
}

export function addressForPort(port: WorkspacePortRow): string {
  return `${hostForLocalAction(port.connectHost)}:${port.port}`;
}

export function browserUrlForPort(port: WorkspacePortRow): string {
  const protocol = port.protocol === "https" ? "https" : "http";
  return `${protocol}://${hostForLocalAction(port.connectHost)}:${port.port}`;
}
