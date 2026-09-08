// MIT Copyright (c) 2026 Lovecast Inc.
// Tests for the drogon:workspacePorts reader. Fixtures follow the
// read-only reference's scanner tests (src/main/ports/
// local-workspace-port-scanner.test.ts): real `lsof -F pcn` output shapes,
// parsed by the ported parser, then enriched by listWorkspacePorts with
// injected probe/scan deps so no real listener is needed.
import { describe, expect, test } from "vitest";
import { listWorkspacePorts } from "./workspace-port-list";
import { parseLsofListeningOutput } from "./workspace-ports";
import type { RawListeningPort } from "./workspace-ports";

const LSOF_OUTPUT = [
  "p4101",
  "cpython3",
  "n127.0.0.1:8765",
  "p4102",
  "cnode",
  "n*:3000",
  "p4103",
  "cDropbox",
  "n127.0.0.1:17500",
].join("\n");

const PROBES = [
  { id: "ws-1", path: "/repo/worktrees/feat", name: "feat" },
  { id: "ws-2", path: "/other", name: "other" },
];

describe("listWorkspacePorts", () => {
  test("workspace rows carry owner evidence; external rows do not", async () => {
    const ports = parseLsofListeningOutput(LSOF_OUTPUT).map((port) => {
      if (port.pid === 4101) return { ...port, cwd: "/repo/worktrees/feat/app" };
      if (port.pid === 4102)
        return { ...port, commandLine: "node server.js --root /other" };
      if (port.pid === 4103) return { ...port, cwd: "/Library/Preferences" };
      return port;
    });
    const result = await listWorkspacePorts("ws-1", {
      readProbes: async () => PROBES,
      scan: async () => ({ ports, metadataAvailable: true }),
      now: () => 1_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toEqual({
      platform: process.platform,
      scannedAt: 1_000,
      unavailableReason: null,
      ports: [
        {
          id: "*:3000:4102",
          bindHost: "*",
          connectHost: "localhost",
          port: 3000,
          pid: 4102,
          processName: "node",
          protocol: "http",
          kind: "workspace",
          owner: {
            workspaceId: "ws-2",
            displayName: "other",
            confidence: "command",
          },
        },
        {
          id: "127.0.0.1:8765:4101",
          bindHost: "127.0.0.1",
          connectHost: "127.0.0.1",
          port: 8765,
          pid: 4101,
          processName: "python3",
          protocol: "unknown",
          kind: "workspace",
          owner: { workspaceId: "ws-1", displayName: "feat", confidence: "cwd" },
        },
        {
          id: "127.0.0.1:17500:4103",
          bindHost: "127.0.0.1",
          connectHost: "127.0.0.1",
          port: 17500,
          pid: 4103,
          processName: "Dropbox",
          protocol: "unknown",
          kind: "external",
          owner: null,
        },
      ],
    });
  });

  test("workspace rows sort before external rows, then by port", async () => {
    const ports: RawListeningPort[] = parseLsofListeningOutput(LSOF_OUTPUT).map(
      (port) =>
        port.pid === 4101 || port.pid === 4102
          ? { ...port, cwd: "/repo/worktrees/feat" }
          : { ...port, cwd: "/Library/Preferences" },
    );
    // An external high port must not jump ahead of workspace rows.
    ports.push({ host: "127.0.0.1", port: 65500, pid: 99, processName: "junk" });
    const result = await listWorkspacePorts("ws-1", {
      readProbes: async () => PROBES,
      scan: async () => ({ ports, metadataAvailable: true }),
      now: () => 1_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.ports.map((port) => [port.kind, port.port])).toEqual([
      ["workspace", 3000],
      ["workspace", 8765],
      ["external", 17500],
      ["external", 65500],
    ]);
  });

  test("scan failure degrades to an honest unavailable snapshot", async () => {
    const result = await listWorkspacePorts("ws-1", {
      readProbes: async () => [],
      scan: async () => {
        throw new Error("lsof scan failed");
      },
      now: () => 2_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.ports).toEqual([]);
    expect(result.result.unavailableReason).toBe("Port scan unavailable.");
  });

  test("metadata-less scans stay unavailable instead of listing bare rows", async () => {
    const result = await listWorkspacePorts("ws-1", {
      readProbes: async () => [],
      scan: async () => ({ ports: [], metadataAvailable: false }),
      now: () => 3_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.unavailableReason).toContain("metadata");
  });

  test("a daemon that will not answer scans to zero owners, never a throw", async () => {
    const result = await listWorkspacePorts("ws-1", {
      readProbes: async () => {
        throw new Error("daemon down");
      },
      scan: async () => ({
        ports: parseLsofListeningOutput(LSOF_OUTPUT),
        metadataAvailable: true,
      }),
      now: () => 4_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.ports.map((port) => port.kind)).toEqual([
      "external",
      "external",
      "external",
    ]);
  });
});
