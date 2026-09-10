import { describe, expect, it } from "vitest";
import type { Result } from "../../shared/session-contract";
import type {
  BotSnapshotInput,
  BotsPanelSnapshot,
} from "../../shared/bot-contract";
import { loadBotSnapshot, resolveBotsScope } from "./bots-loader";
import type { BotsLoadScope } from "./bots-loader";

const scopeA: BotsLoadScope = {
  hostId: "local",
  workspaceId: "w1",
  locale: "en",
};
const scopeB: BotsLoadScope = {
  hostId: "remote-1",
  workspaceId: "w2",
  locale: "de",
};

const validBot = {
  id: "bot-1",
  characterPreset: "reviewer",
  displayIdentity: { displayName: "Reviewer", handle: null, title: null },
  harnessPolicy: { defaultHarness: "pi", explicitModel: null },
  instructions: "review code",
  memories: [],
  responsibilities: [],
  currentSession: null,
  createdAt: 1,
  updatedAt: 2,
};

const snapshot: BotsPanelSnapshot = { bots: [validBot], history: [] };

type SnapshotEnvelope = Result<
  BotsPanelSnapshot & { hostId: string; workspaceId: string }
>;

function fakeBridge(
  respond: (input: BotSnapshotInput) => Promise<SnapshotEnvelope>,
) {
  const calls: BotSnapshotInput[] = [];
  return {
    calls,
    async botSnapshot(input: BotSnapshotInput) {
      calls.push(input);
      return respond(input);
    },
  };
}

describe("loadBotSnapshot", () => {
  it("passes a valid snapshot through with the scope echoed back", async () => {
    const bridge = fakeBridge(async (input) => ({
      ok: true,
      result: {
        hostId: input.hostId,
        workspaceId: input.workspaceId,
        ...snapshot,
      },
    }));
    const result = await loadBotSnapshot(bridge, scopeA);
    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") return;
    expect(result.scope).toEqual(scopeA);
    expect(result.snapshot).toEqual(snapshot);
    expect(result.observedLiveness).toEqual({});
    expect(bridge.calls).toEqual([scopeA]);
  });

  it("maps snapshot_too_large to a distinct too_large result", async () => {
    const bridge = fakeBridge(async () => ({
      ok: false,
      error: {
        code: "snapshot_too_large",
        message: "snapshot exceeds the size limit",
        retryable: false,
      },
    }));
    const result = await loadBotSnapshot(bridge, scopeA);
    expect(result).toEqual({
      scope: scopeA,
      status: "too_large",
      message: "snapshot exceeds the size limit",
    });
  });

  it("maps other source errors verbatim", async () => {
    const bridge = fakeBridge(async () => ({
      ok: false,
      error: { code: "scope_forbidden", message: "no access", retryable: true },
    }));
    const result = await loadBotSnapshot(bridge, scopeA);
    expect(result).toEqual({
      scope: scopeA,
      status: "error",
      code: "scope_forbidden",
      message: "no access",
      retryable: true,
    });
  });

  it("maps a malformed ok payload to invalid_snapshot, never empty success", async () => {
    const bridge = fakeBridge(async (input) => ({
      ok: true,
      // Deliberately malformed payload: the source said ok but the shape is
      // wrong, which the loader must surface as invalid_snapshot.
      result: {
        hostId: input.hostId,
        workspaceId: input.workspaceId,
        bots: "not-a-list",
      },
    }) as unknown as SnapshotEnvelope);
    const result = await loadBotSnapshot(bridge, scopeA);
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.code).toBe("invalid_snapshot");
    expect(result.retryable).toBe(false);
    expect(result.message.length).toBeGreaterThan(0);
    expect(result.scope).toEqual(scopeA);
  });

  it("rejects an empty hostId or locale without calling the bridge", async () => {
    for (const empty of [
      { hostId: "", workspaceId: "w1", locale: "en" },
      { hostId: "local", workspaceId: "w1", locale: "" },
    ]) {
      const bridge = fakeBridge(async () => {
        throw new Error("bridge must not be called");
      });
      const result = await loadBotSnapshot(bridge, empty);
      expect(result.status).toBe("error");
      if (result.status !== "error") continue;
      expect(result.code).toBe("invalid_scope");
      expect(result.scope).toEqual(empty);
      expect(bridge.calls).toHaveLength(0);
    }
  });

  it("treats an empty workspaceId as the app-global scope (#348)", async () => {
    // The fork's controller lists Bots app-globally via
    // window.api.bots.list(), so a zero-workspace Bots page asks the
    // daemon for the host-wide snapshot: workspaceId "" must reach the
    // bridge, never be rejected as an empty scope.
    const globalScope = { hostId: "local", workspaceId: "", locale: "en" };
    const bridge = fakeBridge(async (input) => ({
      ok: true,
      result: { hostId: input.hostId, workspaceId: input.workspaceId, ...snapshot },
    }));
    const result = await loadBotSnapshot(bridge, globalScope);
    expect(result.status).toBe("loaded");
    expect(bridge.calls).toHaveLength(1);
    expect(bridge.calls[0].workspaceId).toBe("");
  });

  it("always resolves the app-global scope, never the selected workspace (#348/R17-E)", () => {
    // Track2: App must always pass workspaceId "" while the service is
    // live — narrowing to current.id rendered 'No Bots yet' for bots owned
    // by another folder. The helper takes no workspace id by construction.
    expect(resolveBotsScope({ hostId: "local" }, "en")).toEqual({
      hostId: "local",
      workspaceId: "",
      locale: "en",
    });
    expect(resolveBotsScope(null, "en")).toBeNull();
  });

  it("treats retry as a fresh call: error then success succeeds", async () => {
    let attempts = 0;
    const bridge = fakeBridge(async (input) => {
      attempts += 1;
      if (attempts === 1)
        return {
          ok: false,
          error: {
            code: "transport_unavailable",
            message: "host unreachable",
            retryable: true,
          },
        };
      return {
        ok: true,
        result: {
          hostId: input.hostId,
          workspaceId: input.workspaceId,
          ...snapshot,
        },
      };
    });
    const first = await loadBotSnapshot(bridge, scopeA);
    expect(first.status).toBe("error");
    const second = await loadBotSnapshot(bridge, scopeA);
    expect(second.status).toBe("loaded");
    expect(bridge.calls).toHaveLength(2);
  });

  it("never crosses scopes across sequential loads", async () => {
    let attempt = 0;
    const bridge = fakeBridge(async (input) => {
      attempt += 1;
      return {
        ok: true,
        result: {
          hostId: input.hostId,
          workspaceId: input.workspaceId,
          ...(attempt === 1 ? snapshot : { bots: [], history: [] }),
        },
      };
    });
    const first = await loadBotSnapshot(bridge, scopeA);
    const second = await loadBotSnapshot(bridge, scopeB);
    expect(first.status).toBe("loaded");
    expect(second.status).toBe("loaded");
    if (second.status !== "loaded") return;
    expect(second.scope).toEqual(scopeB);
    expect(second.scope).not.toEqual(scopeA);
    expect(second.snapshot).toEqual({ bots: [], history: [] });
  });
});

describe("loadBotSnapshot transport and scope regressions", () => {
  it("maps a thrown transport error to an explicit retryable error", async () => {
    const bridge = fakeBridge(async () => {
      throw new Error("ipc gone");
    });
    const result = await loadBotSnapshot(bridge, scopeA);
    expect(result).toMatchObject({
      scope: scopeA,
      status: "error",
      code: "snapshot_transport",
      retryable: true,
    });
    if (result.status === "error") expect(result.message).toContain("ipc gone");
    else throw new Error("expected error result");
  });
  it("rejects a response scoped to another host/workspace", async () => {
    const bridge = fakeBridge(async () => ({
      ok: true,
      result: { hostId: "other-host", workspaceId: "w1", ...snapshot },
    }));
    const result = await loadBotSnapshot(bridge, scopeA);
    expect(result).toMatchObject({
      scope: scopeA,
      status: "error",
      code: "scope_mismatch",
    });
  });
});
