// Contract-scaffold tests for the files mount adapter: stub components
// only, NOT functional Files evidence. Real panel behavior lands with
// the stabilized V3 factory + App wiring + CDP.
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
  adaptFactoryDescriptor,
  createGatedFileBridge,
  isFilesAvailable,
  registerFactoryRoute,
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

describe("registerFilesRoute (real V3 factory)", () => {
  const bridge = {} as import("../../shared/file-contract").FileBridge;
  it("registers the Files descriptor and resolveRoute finds it", () => {
    const registry = registerFilesRoute(filesRegistry(), bridge);
    expect(resolveRoute(registry, FILES_ROUTE_ID).title).toBe("Files");
    expect(resolveRoute(registry, FILES_ROUTE_ID).capability).toBe(
      FILES_CAPABILITY,
    );
  });
  it("unknown ids fall back to the registry fallback and never throw", () => {
    const registry = registerFilesRoute(filesRegistry(), bridge);
    let descriptor: { id: string } | undefined;
    expect(() => {
      descriptor = resolveRoute(registry, "no-such-panel");
    }).not.toThrow();
    expect(descriptor?.id).toBe("terminal");
  });
  it("rejects duplicate registration of the files route", () => {
    const once = registerFilesRoute(filesRegistry(), bridge);
    expect(() => registerFilesRoute(once, bridge)).toThrow(/duplicate/);
  });
});

describe("capability gating", () => {
  const bridge = {} as import("../../shared/file-contract").FileBridge;
  it("gates the descriptor on the live service capabilities", () => {
    const registry = registerFilesRoute(filesRegistry(), bridge);
    const descriptor = resolveRoute(registry, FILES_ROUTE_ID);
    expect(checkAvailability(descriptor, [FILES_CAPABILITY])).toBe("available");
    expect(checkAvailability(descriptor, [])).toBe("unsupported");
    expect(checkAvailability(descriptor, ["harness.catalog.v1"])).toBe(
      "unsupported",
    );
  });
});

describe("real panel mount", () => {
  const bridge = {} as import("../../shared/file-contract").FileBridge;
  it("server-renders the real FilesPanel with a null session", async () => {
    const registry = registerFilesRoute(filesRegistry(), bridge);
    const descriptor = resolveRoute(registry, FILES_ROUTE_ID);
    const { createElement } = await import("react");
    const { renderToString } = await import("react-dom/server");
    let html = "";
    expect(() => {
      html = renderToString(
        createElement(descriptor.component, {
          routeId: FILES_ROUTE_ID,
          session: null,
          workspace,
          status,
          focusTarget: null,
        }),
      );
    }).not.toThrow();
    expect(html.length).toBeGreaterThan(0);
  });
});

describe("factory boundary (plain V3 shape in, validated contract out)", () => {
  const bridge = {} as import("../../shared/file-contract").FileBridge;
  it("preserves title/capability/restoreState/focus/cleanup hooks", () => {
    const seen: string[] = [];
    const adapted = adaptFactoryDescriptor({
      id: "files.explorer",
      title: "Files",
      component: () => null,
      capability: FILES_CAPABILITY,
      restoreState: { path: "/" },
      onFocus: () => void seen.push("focus"),
      onCleanup: () => void seen.push("cleanup"),
    });
    expect(adapted.title).toBe("Files");
    expect(adapted.capability).toBe(FILES_CAPABILITY);
    expect(adapted.restoreState).toEqual({ path: "/" });
    adapted.onFocus?.(adapted.id);
    adapted.onCleanup?.(adapted.id);
    expect(seen).toEqual(["focus", "cleanup"]);
  });
  it("rejects an empty factory id at the boundary, never at mount", () => {
    expect(() =>
      adaptFactoryDescriptor({ id: "  ", title: "x", component: () => null }),
    ).toThrow();
  });
  it("registers a plain-shape factory end to end", () => {
    const registry = registerFactoryRoute(
      filesRegistry(),
      ({ bridge: _bridge }) => ({
        id: "files.explorer",
        title: "Files",
        component: () => null,
        capability: FILES_CAPABILITY,
      }),
      bridge,
    );
    expect(resolveRoute(registry, "files.explorer").title).toBe("Files");
  });
});

describe("gated bridge (explicit withhold fails closed, drafts stay mounted)", () => {
  const scope = { hostId: "local", workspaceId: "w1", path: "/" };
  const calls: string[] = [];
  const source = {
    fileList: async () => {
      calls.push("list");
      return { ok: true as const, result: { ...scope, entries: [], truncated: false } };
    },
    fileRead: async () => {
      calls.push("read");
      return { ok: true as const, result: { ...scope, content: "", size: 0, mtime: "" } };
    },
    fileWrite: async () => {
      calls.push("write");
      return { ok: true as const, result: { ...scope, size: 0, mtime: "" } };
    },
  };
  it("passes calls through while allowed", async () => {
    const gated = createGatedFileBridge(source, () => true);
    const listed = await gated.fileList(scope);
    expect(listed.ok).toBe(true);
    expect(calls).toEqual(["list"]);
  });
  it("refuses all three calls locally once withheld, never touching source", async () => {
    calls.length = 0;
    const gated = createGatedFileBridge(source, () => false);
    for (const response of [
      await gated.fileList(scope),
      await gated.fileRead(scope),
      await gated.fileWrite({ ...scope, content: "x", requestId: "r1" }),
    ]) {
      expect(response.ok).toBe(false);
      if (!response.ok) {
        expect(response.error.code).toBe("unsupported_capability");
        expect(response.error.retryable).toBe(true);
      }
    }
    expect(calls).toEqual([]);
  });
  it("mid-life availability loss fails closed on the next call", async () => {
    calls.length = 0;
    let allowed = true;
    const gated = createGatedFileBridge(source, () => allowed);
    expect((await gated.fileList(scope)).ok).toBe(true);
    allowed = false;
    const refused = await gated.fileRead(scope);
    expect(refused.ok).toBe(false);
    expect(calls).toEqual(["list"]);
  });
});
