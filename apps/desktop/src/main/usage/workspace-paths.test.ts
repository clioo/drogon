import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const { nextResult } = vi.hoisted(() => ({
  nextResult: { current: undefined as unknown },
}));

vi.mock("../native-client", () => ({
  callNative: (...args: unknown[]) => {
    const impl = nextResult.current as () => Promise<unknown>;
    return impl(...(args as []));
  },
}));

// Worker-reuse hermeticity (docs/reference/desktop-test-isolation.md): the
// desktop suite shares one module registry per worker, so a statically
// imported reader would stay bound to whichever `../native-client` won the
// import race — the real client, which shells out to the live daemon and
// returns real workspaces (observed as rotating failures). Rebinding after
// a registry reset keeps the mocked transport deterministic.
let readWorkspaceProbes: typeof import("./workspace-paths").readWorkspaceProbes;

beforeAll(async () => {
  vi.resetModules();
  ({ readWorkspaceProbes } = await import("./workspace-paths"));
});

afterAll(() => {
  vi.resetModules();
});

function answer(result: unknown) {
  nextResult.current = () => Promise.resolve(result);
}

beforeEach(() => {
  answer({ ok: true, result: { workspaces: [] } });
});

describe("readWorkspaceProbes", () => {
  test("a daemon that will not answer yields no probes, never a throw", async () => {
    answer({ ok: false, error: { code: "x", message: "down", retryable: true } });
    await expect(readWorkspaceProbes()).resolves.toEqual([]);
    nextResult.current = () => Promise.reject(new Error("socket gone"));
    await expect(readWorkspaceProbes()).resolves.toEqual([]);
  });
  test("a shape outside the contract yields no probes", async () => {
    answer({ ok: true, result: { workspaces: [{ id: 7 }] } });
    await expect(readWorkspaceProbes()).resolves.toEqual([]);
    answer({ ok: true, result: null });
    await expect(readWorkspaceProbes()).resolves.toEqual([]);
  });
  test("the daemon name wins; otherwise the path basename names the row", async () => {
    answer({
      ok: true,
      result: {
        workspaces: [
          { id: "ws-1", path: "/repo/worktrees/feat", name: "Pretty" },
          { id: "ws-2", path: "/repo/worktrees/other" },
          { id: "ws-3", path: "/repo/worktrees/trailing/" },
        ],
      },
    });
    await expect(readWorkspaceProbes()).resolves.toEqual([
      { id: "ws-1", path: "/repo/worktrees/feat", name: "Pretty" },
      { id: "ws-2", path: "/repo/worktrees/other", name: "other" },
      { id: "ws-3", path: "/repo/worktrees/trailing/", name: "trailing" },
    ]);
  });
  test("a blank name fails the contract, so no probe is invented", async () => {
    answer({ ok: true, result: { workspaces: [{ id: "ws-1", path: "/repo/a", name: "" }] } });
    await expect(readWorkspaceProbes()).resolves.toEqual([]);
  });
});
