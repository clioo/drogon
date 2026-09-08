// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the read-only reference
// src/renderer/src/components/right-sidebar/local-workspace-port-sections.test.ts
// (the shouldShow cases), plus the section projection this repo's panel
// renders with single-workspace owners.
import { describe, expect, it } from "vitest";
import type { WorkspacePortRow } from "../../../../shared/usage-contract";
import {
  getLocalWorkspacePortSections,
  shouldShowLocalWorkspacePortSections,
} from "./local-workspace-port-sections";

function workspaceRow(overrides: Partial<WorkspacePortRow>): WorkspacePortRow {
  return {
    id: "127.0.0.1:3000:1",
    bindHost: "127.0.0.1",
    connectHost: "127.0.0.1",
    port: 3000,
    pid: 1,
    processName: "node",
    protocol: "http",
    kind: "workspace",
    owner: { workspaceId: "ws-1", displayName: "feat", confidence: "cwd" },
    ...overrides,
  };
}

const empty = { activePorts: [], otherWorkspacePorts: [], externalPorts: [] };

describe("getLocalWorkspacePortSections", () => {
  const active = workspaceRow({ port: 3000 });
  const other = workspaceRow({
    id: "127.0.0.1:4000:2",
    port: 4000,
    pid: 2,
    owner: { workspaceId: "ws-2", displayName: "main", confidence: "command" },
  });
  const external = workspaceRow({
    id: "127.0.0.1:17500:3",
    port: 17500,
    pid: 3,
    kind: "external",
    owner: null,
  });

  it("splits the scan by owner workspace and attribution", () => {
    const sections = getLocalWorkspacePortSections(
      { ports: [active, other, external] },
      "ws-1",
    );
    expect(sections.activePorts).toEqual([active]);
    expect(sections.otherWorkspacePorts).toEqual([other]);
    expect(sections.externalPorts).toEqual([external]);
  });

  it("reads sections from a null scan as empty", () => {
    expect(getLocalWorkspacePortSections(null, "ws-1")).toEqual(empty);
    expect(getLocalWorkspacePortSections(undefined, "ws-1")).toEqual(empty);
  });

  it("matches the active workspace by id, not by order", () => {
    const sections = getLocalWorkspacePortSections(
      { ports: [active, other] },
      "ws-2",
    );
    expect(sections.activePorts).toEqual([other]);
    expect(sections.otherWorkspacePorts).toEqual([active]);
  });
});

describe("shouldShowLocalWorkspacePortSections", () => {
  it("shows the sections whenever the scan succeeded", () => {
    expect(shouldShowLocalWorkspacePortSections(null, empty)).toBe(true);
    expect(shouldShowLocalWorkspacePortSections({}, empty)).toBe(true);
  });

  // Why: a failed scan keeps the host's last-good ports, and the status bar
  // still counts and lists them — hiding the sections here would strip the
  // open actions for ports the user can still see elsewhere.
  it.each([
    ["activePorts", { ...empty, activePorts: [{}] }],
    ["otherWorkspacePorts", { ...empty, otherWorkspacePorts: [{}] }],
    ["externalPorts", { ...empty, externalPorts: [{}] }],
  ])("keeps the sections when a failed scan retained %s", (_section, sections) => {
    expect(
      shouldShowLocalWorkspacePortSections({ unavailableReason: "dropped" }, sections),
    ).toBe(true);
  });

  it("lets the notice stand alone when a failed scan has nothing left to list", () => {
    expect(
      shouldShowLocalWorkspacePortSections({ unavailableReason: "dropped" }, empty),
    ).toBe(false);
  });
});
