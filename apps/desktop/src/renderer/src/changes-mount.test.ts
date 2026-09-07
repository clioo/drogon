import { describe, expect, test } from "vitest";
import { GIT_CAPABILITY } from "../../shared/git-contract";
import type { GitBridge } from "../../shared/git-contract";
import {
  CHANGES_ROUTE_ID,
  createGatedGitBridge,
  isChangesAvailable,
  registerChangesRoute,
} from "./changes-mount";
import { createRouteRegistry, resolveRoute } from "./route-panel-contract";

const passthrough: GitBridge = {
  gitStatus: async () => {
    throw new Error("must not be called");
  },
  gitDiff: async () => {
    throw new Error("must not be called");
  },
  gitStage: async () => {
    throw new Error("must not be called");
  },
  gitUnstage: async () => {
    throw new Error("must not be called");
  },
  gitCommit: async () => {
    throw new Error("must not be called");
  },
  gitPush: async () => {
    throw new Error("must not be called");
  },
  gitPrCreate: async () => {
    throw new Error("must not be called");
  },
};

describe("changes mount", () => {
  test("capability gate mirrors the advertised service contract", () => {
    expect(isChangesAvailable([GIT_CAPABILITY])).toBe(true);
    expect(isChangesAvailable(["files.v1"])).toBe(false);
  });

  test("gated bridge refuses every method while git.v1 is withheld", async () => {
    const gated = createGatedGitBridge(passthrough, () => false);
    const scope = { hostId: "h", workspaceId: "w" };
    for (const result of [
      await gated.gitStatus(scope),
      await gated.gitDiff({ ...scope, path: "a.txt" }),
      await gated.gitStage({ ...scope, paths: ["a.txt"] }),
      await gated.gitUnstage({ ...scope, paths: ["a.txt"] }),
      await gated.gitCommit({ ...scope, message: "m" }),
      await gated.gitPush(scope),
      await gated.gitPrCreate({ ...scope, title: "t" }),
    ]) {
      expect(result).toMatchObject({
        ok: false,
        error: { code: "unsupported_capability", retryable: true },
      });
    }
  });

  test("route registers under the changes id with the git capability", () => {
    const registry = registerChangesRoute(
      createRouteRegistry({
        capabilities: [GIT_CAPABILITY],
        fallbackId: CHANGES_ROUTE_ID,
      }),
      passthrough,
    );
    const descriptor = resolveRoute(registry, CHANGES_ROUTE_ID);
    expect(descriptor.title).toBe("Changes");
    expect(descriptor.capability).toBe("git.v1");
  });
});
