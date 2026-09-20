import { describe, expect, test } from "vitest";
import {
  compareWorkspacePortRows,
  enrichWorkspacePortRow,
  inferProtocol,
  type WorkspacePortRow,
} from "./workspace-port-rows";
import type { RawListeningPort } from "./workspace-ports";

function row(overrides: Partial<WorkspacePortRow> = {}): WorkspacePortRow {
  return {
    id: "127.0.0.1:3000:7",
    bindHost: "127.0.0.1",
    connectHost: "127.0.0.1",
    port: 3000,
    pid: 7,
    processName: "node",
    protocol: "http",
    kind: "workspace",
    owner: { workspaceId: "ws-1", displayName: "ws-1", confidence: "cwd" },
    ...overrides,
  };
}

describe("inferProtocol", () => {
  test("marks the TLS dev ports https and the dev-server table http", () => {
    expect(inferProtocol(443)).toBe("https");
    expect(inferProtocol(8443)).toBe("https");
    for (const port of [80, 3000, 3001, 4200, 5000, 5173, 5174, 8000, 8080, 8888]) {
      expect(inferProtocol(port)).toBe("http");
    }
  });
  test("anything else stays unknown, never a guessed scheme", () => {
    for (const port of [22, 17500, 5432, 65500, 30000]) {
      expect(inferProtocol(port)).toBe("unknown");
    }
  });
});

describe("enrichWorkspacePortRow", () => {
  test("row id keys on host, port and pid like the source", () => {
    const enriched = enrichWorkspacePortRow(
      { host: "127.0.0.1", port: 3000, pid: 7, processName: "node" },
      { workspaceId: "ws-1", displayName: "feat", confidence: "cwd" },
    );
    expect(enriched).toMatchObject({
      id: "127.0.0.1:3000:7",
      bindHost: "127.0.0.1",
      connectHost: "127.0.0.1",
      port: 3000,
      pid: 7,
      processName: "node",
      protocol: "http",
      kind: "workspace",
      owner: { workspaceId: "ws-1", displayName: "feat", confidence: "cwd" },
    });
  });
  test("a missing pid keys as unknown but the row keeps a null pid", () => {
    const enriched = enrichWorkspacePortRow({ host: "*", port: 8080 }, undefined);
    expect(enriched.id).toBe("*:8080:unknown");
    expect(enriched.pid).toBeNull();
    expect(enriched.connectHost).toBe("localhost");
    expect(enriched.kind).toBe("external");
    expect(enriched.owner).toBeNull();
  });
  test("long process names are cut to 256 chars, missing names stay null", () => {
    const long: RawListeningPort = {
      host: "127.0.0.1",
      port: 3000,
      pid: 7,
      processName: `node ${"x".repeat(400)}`,
    };
    expect(enrichWorkspacePortRow(long, undefined).processName).toHaveLength(256);
    expect(
      enrichWorkspacePortRow({ host: "127.0.0.1", port: 3000 }, undefined).processName,
    ).toBeNull();
  });
});

describe("compareWorkspacePortRows", () => {
  test("workspace rows sort before external rows regardless of port", () => {
    const external = row({ kind: "external", owner: null, port: 80 });
    const workspace = row({ kind: "workspace", port: 65500 });
    expect([external, workspace].sort(compareWorkspacePortRows)).toEqual([
      workspace,
      external,
    ]);
  });
  test("same-kind rows sort by port, then by connect host", () => {
    const high = row({ port: 8080, connectHost: "a" });
    const low = row({ port: 3000, connectHost: "z" });
    expect([high, low].sort(compareWorkspacePortRows)).toEqual([low, high]);
    const tieA = row({ port: 3000, connectHost: "b" });
    const tieB = row({ port: 3000, connectHost: "a" });
    expect([tieA, tieB].sort(compareWorkspacePortRows)).toEqual([tieB, tieA]);
  });
});
