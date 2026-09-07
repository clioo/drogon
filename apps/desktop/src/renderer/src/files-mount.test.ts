import { describe, expect, it } from "vitest";
import { FILES_CAPABILITY } from "../../shared/file-contract";
import type { Session, Status, Workspace } from "../../shared/session-contract";
import {
  checkAvailability,
  createRouteRegistry,
  registerRoute,
  resolveRoute,
  routeId,
} from "./route-panel-contract";
import type { PanelProps } from "./route-panel-contract";
import {
  FILES_ROUTE_ID,
  isFilesAvailable,
  registerFilesRoute,
} from "./files-mount";

const status: Status = {
  hostId: "local",
  serviceInstanceId: "inst1",
  protocol: 1,
  capabilities: [FILES_CAPABILITY],
  version: "1.0.0",
};
const workspace: Workspace = {
  id: "w1",
  path: "/tmp/repo",
  name: "repo",
  kind: "git",
  hostId: "local",
};
const session: Session = {
  id: "s1",
  workspaceId: "w1",
  hostId: "local",
  incarnation: "i1",
  command: "/bin/sh",
  args: [],
  cols: 80,
  rows: 24,
  verdict: "live",
  exitCode: null,
  createdAt: "2026-09-07T00:00:00Z",
};

function filesRegistry() {
  const base = createRouteRegistry({
    capabilities: [FILES_CAPABILITY],
    fallbackId: routeId("terminal"),
  });
  return registerRoute(base, {
    id: routeId("terminal"),
    title: "Terminal",
    component: () => null,
  });
}

describe("isFilesAvailable", () => {
  it("is true when the service advertises files.v1", () => {
    expect(isFilesAvailable([FILES_CAPABILITY])).toBe(true);
    expect(isFilesAvailable(["harness.catalog.v1", FILES_CAPABILITY])).toBe(
      true,
    );
  });
  it("is false without the capability or on an empty list", () => {
    expect(isFilesAvailable(["harness.catalog.v1"])).toBe(false);
    expect(isFilesAvailable([])).toBe(false);
  });
});

describe("registerFilesRoute", () => {
  it("registers the Files descriptor and resolveRoute finds it", () => {
    const registry = registerFilesRoute(filesRegistry(), () => null);
    expect(resolveRoute(registry, FILES_ROUTE_ID).title).toBe("Files");
    expect(resolveRoute(registry, FILES_ROUTE_ID).capability).toBe(
      FILES_CAPABILITY,
    );
  });
  it("unknown ids fall back to the registry fallback and never throw", () => {
    const registry = registerFilesRoute(filesRegistry(), () => null);
    let descriptor: { id: string } | undefined;
    expect(() => {
      descriptor = resolveRoute(registry, "no-such-panel");
    }).not.toThrow();
    expect(descriptor?.id).toBe("terminal");
  });
  it("rejects duplicate registration of the files route", () => {
    const once = registerFilesRoute(filesRegistry(), () => null);
    expect(() => registerFilesRoute(once, () => null)).toThrow(/duplicate/);
  });
});

describe("capability gating", () => {
  it("gates the descriptor on the live service capabilities", () => {
    const registry = registerFilesRoute(filesRegistry(), () => null);
    const descriptor = resolveRoute(registry, FILES_ROUTE_ID);
    expect(checkAvailability(descriptor, [FILES_CAPABILITY])).toBe("available");
    expect(checkAvailability(descriptor, [])).toBe("unsupported");
    expect(checkAvailability(descriptor, ["harness.catalog.v1"])).toBe(
      "unsupported",
    );
  });
});

describe("panel props", () => {
  it("accepts a null session (session-less mount) without throwing", () => {
    const received: Array<Session | null> = [];
    const registry = registerFilesRoute(filesRegistry(), (props: PanelProps) => {
      received.push(props.session);
      return null;
    });
    const descriptor = resolveRoute(registry, FILES_ROUTE_ID);
    expect(() =>
      descriptor.component({
        routeId: FILES_ROUTE_ID,
        session: null,
        workspace,
        status,
        focusTarget: null,
      }),
    ).not.toThrow();
    expect(received).toEqual([null]);
  });
});
