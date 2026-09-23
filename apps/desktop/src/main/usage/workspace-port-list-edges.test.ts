import { describe, expect, test } from "vitest";
import { listWorkspacePorts } from "./workspace-port-list";
import type { RawListeningPort } from "./workspace-ports";

describe("listWorkspacePorts edges", () => {
  test("a probe without a name falls back to the workspace id", async () => {
    const ports: RawListeningPort[] = [
      { host: "127.0.0.1", port: 4000, pid: 7, processName: "node", cwd: "/repo/nameless/app" },
    ];
    const result = await listWorkspacePorts("ws-9", {
      readProbes: async () => [{ id: "ws-9", path: "/repo/nameless" }],
      scan: async () => ({ ports, metadataAvailable: true }),
      now: () => 5_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.ports).toEqual([
      {
        id: "127.0.0.1:4000:7",
        bindHost: "127.0.0.1",
        connectHost: "127.0.0.1",
        port: 4000,
        pid: 7,
        processName: "node",
        protocol: "unknown",
        kind: "workspace",
        owner: { workspaceId: "ws-9", displayName: "ws-9", confidence: "cwd" },
      },
    ]);
  });
  test("a named probe keeps its display name on the row", async () => {
    const ports: RawListeningPort[] = [
      { host: "127.0.0.1", port: 4001, pid: 8, processName: "node", cwd: "/repo/named/app" },
    ];
    const result = await listWorkspacePorts("ws-1", {
      readProbes: async () => [{ id: "ws-1", path: "/repo/named", name: "Pretty" }],
      scan: async () => ({ ports, metadataAvailable: true }),
      now: () => 6_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.ports[0]?.owner).toEqual({
      workspaceId: "ws-1",
      displayName: "Pretty",
      confidence: "cwd",
    });
  });
});
