// MIT Copyright (c) 2026 Lovecast Inc.
// Fixtures follow the read-only reference's scanner tests:
//   src/main/ports/local-workspace-port-scanner.test.ts
//   src/main/ports/workspace-port-ownership.test.ts
import { describe, expect, test } from "vitest";
import {
  attributePortToWorkspace,
  dedupeRawPorts,
  parseAddressWithPort,
  parseLsofListeningOutput,
} from "./workspace-ports";

describe("lsof -F pcn parsing", () => {
  test("parses pid/command/address records and dedupes rebinding families", () => {
    const output = [
      "p101",
      "cnode",
      "n*:3000",
      "n127.0.0.1:3000",
      "p102",
      "cdrogond",
      "n[::1]:8080",
      "pnotapid",
      "n*:garbage",
    ].join("\n");
    expect(parseLsofListeningOutput(output)).toEqual([
      { host: "*", port: 3000, pid: 101, processName: "node" },
      { host: "127.0.0.1", port: 3000, pid: 101, processName: "node" },
      { host: "::1", port: 8080, pid: 102, processName: "drogond" },
    ]);
  });
  test("empty output scans to zero ports", () => {
    expect(parseLsofListeningOutput("")).toEqual([]);
  });
});

describe("address parsing", () => {
  test("wildcard, IPv6 and plain binds", () => {
    expect(parseAddressWithPort("*:3000")).toEqual({ host: "*", port: 3000 });
    expect(parseAddressWithPort("[::1]:5173")).toEqual({ host: "::1", port: 5173 });
    expect(parseAddressWithPort("127.0.0.1:8080 (LISTEN)")).toEqual({
      host: "127.0.0.1",
      port: 8080,
    });
    expect(parseAddressWithPort("nope")).toBeNull();
    expect(parseAddressWithPort("*:0")).toBeNull();
    expect(parseAddressWithPort("*:99999")).toBeNull();
  });
  test("dedupe keys on connect host, port and pid", () => {
    const row = { host: "*", port: 3000, pid: 1 };
    expect(dedupeRawPorts([row, { ...row }, { ...row, pid: 2 }])).toHaveLength(2);
  });
});

describe("workspace attribution", () => {
  const workspaces = [
    { id: "root", path: "/repo" },
    { id: "leaf", path: "/repo/worktrees/feat" },
  ];

  test("cwd inside a workspace attributes with cwd confidence", () => {
    expect(
      attributePortToWorkspace({ cwd: "/repo/worktrees/feat/app" }, workspaces),
    ).toEqual({ workspaceId: "leaf", confidence: "cwd" });
  });
  test("the deepest matching workspace wins", () => {
    expect(
      attributePortToWorkspace({ cwd: "/repo/worktrees/feat" }, workspaces),
    ).toEqual({ workspaceId: "leaf", confidence: "cwd" });
    expect(attributePortToWorkspace({ cwd: "/repo" }, workspaces)).toEqual({
      workspaceId: "root",
      confidence: "cwd",
    });
  });
  test("command-line path evidence attributes with command confidence", () => {
    expect(
      attributePortToWorkspace(
        { commandLine: "node server.js --root /repo/worktrees/feat" },
        workspaces,
      ),
    ).toEqual({ workspaceId: "leaf", confidence: "command" });
  });
  test("command-line siblings attribute only to the deepest full match", () => {
    // "/repo/worktrees/feature-x" contains "/repo" on a boundary, so the
    // root workspace still owns it; the longer sibling prefix does not.
    expect(
      attributePortToWorkspace(
        { commandLine: "node /repo/worktrees/feature-x/run.js" },
        workspaces,
      ),
    ).toEqual({ workspaceId: "root", confidence: "command" });
    expect(
      attributePortToWorkspace(
        { commandLine: "node /reporun.js" },
        workspaces,
      ),
    ).toBeUndefined();
  });
  test("unrelated processes never attribute", () => {
    expect(
      attributePortToWorkspace(
        { cwd: "/Library/Preferences", commandLine: "Dropbox --daemon" },
        workspaces,
      ),
    ).toBeUndefined();
  });
  test("prefix tricks (sibling directories) do not attribute", () => {
    expect(attributePortToWorkspace({ cwd: "/repository" }, workspaces)).toBeUndefined();
  });
});
