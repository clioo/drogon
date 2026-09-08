// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc. R16-AM: the explorer dims
   git-ignored rows like the reference. Mounts the real FileExplorer against
   a scripted source whose `ignored` answers a fixed set: the italic +
   "Ignored by .gitignore" badge assertions prove the component classified
   through the daemon query — never a local guess. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { FileExplorer, type FileExplorerDataSource } from "./FileExplorer";
import type { ExplorerNode } from "./tree-model";
import type { Result } from "../../../../shared/session-contract";
// Read-only use of the coordinator-owned gate: proves fileIgnored survives
// the App-level capability wrapper the explorer source is built on.
import { createGatedFileBridge } from "../../files-mount";

afterEach(cleanup);

const node = (name: string, path: string, isDirectory = false, depth = 0): ExplorerNode => ({
  name,
  path,
  isDirectory,
  depth,
});

function makeSource(seed: ExplorerNode[], ignored: readonly string[]) {
  const ignoredCalls: string[][] = [];
  const source: FileExplorerDataSource = {
    listDir: async () => ({ ok: true, result: [...seed] }),
    ignored: async (paths) => {
      ignoredCalls.push([...paths]);
      return { ok: true, result: ignored.filter((p) => paths.includes(p)) };
    },
  };
  return { source, ignoredCalls };
}

describe("explorer git-ignored dimming", () => {
  it("dims daemon-reported ignored rows with the source badge", async () => {
    const { source, ignoredCalls } = makeSource(
      [node("src", "src", true), node("build.log", "build.log"), node("app.ts", "app.ts")],
      ["build.log"],
    );
    render(
      <FileExplorer
        workspaceId="ws"
        workspaceName="ws"
        source={source}
        activePath={null}
      />,
    );
    await waitFor(() => expect(screen.getByText("build.log")).toBeDefined());
    // The visible-row query ran with the tree's relative paths.
    await waitFor(() => expect(ignoredCalls.length).toBeGreaterThan(0));
    expect(ignoredCalls[0]).toEqual(
      expect.arrayContaining(["src", "build.log", "app.ts"]),
    );
    // Ignored row: italic name plus the fork's badge copy.
    const badge = await screen.findByLabelText("Ignored by .gitignore");
    expect(badge).toBeDefined();
    const ignoredName = screen.getByText("build.log");
    expect(ignoredName.className).toContain("italic");
    // Untracked-but-visible rows stay plain.
    expect(screen.getByText("app.ts").className).not.toContain("italic");
  });

  it("decorates nothing when the source predates files.ignored", async () => {
    const bare: FileExplorerDataSource = {
      listDir: async () => ({ ok: true, result: [node("a.txt", "a.txt")] }),
    };
    render(
      <FileExplorer workspaceId="ws" workspaceName="ws" source={bare} activePath={null} />,
    );
    await waitFor(() => expect(screen.getByText("a.txt")).toBeDefined());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(screen.queryByLabelText("Ignored by .gitignore")).toBeNull();
    expect(screen.getByText("a.txt").className).not.toContain("italic");
  });

  it("survives the App capability gate (forwards when allowed, absent otherwise)", async () => {
    const source = {
      fileList: async () => ({ ok: false as const, error: { code: "x", message: "x", retryable: false } }),
      fileRead: async () => ({ ok: false as const, error: { code: "x", message: "x", retryable: false } }),
      fileWrite: async () => ({ ok: false as const, error: { code: "x", message: "x", retryable: false } }),
      fileIgnored: async (input: { paths: string[] }) => ({
        ok: true as const,
        result: { hostId: "h", workspaceId: "w", ignored: [...input.paths] },
      }),
    };
    const allowed = createGatedFileBridge(source, () => true);
    expect(allowed.fileIgnored).toBeDefined();
    const found = await allowed.fileIgnored!({ hostId: "h", workspaceId: "w", paths: ["a"] });
    expect(found).toEqual({
      ok: true,
      result: { hostId: "h", workspaceId: "w", ignored: ["a"] },
    });
    const { fileIgnored: _dropped, ...bare } = source;
    void _dropped;
    expect(createGatedFileBridge(bare, () => true).fileIgnored).toBeUndefined();
  });

  it("decorates nothing when the ignored query fails", async () => {
    const failing: FileExplorerDataSource = {
      listDir: async () => ({ ok: true, result: [node("a.txt", "a.txt")] }),
      ignored: async () => ({
        ok: false,
        error: { code: "unverifiable", message: "down", retryable: true },
      }),
    };
    const renderResult = render(
      <FileExplorer
        workspaceId="ws"
        workspaceName="ws"
        source={failing}
        activePath={null}
      />,
    );
    void renderResult;
    await waitFor(() => expect(screen.getByText("a.txt")).toBeDefined());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(screen.queryByLabelText("Ignored by .gitignore")).toBeNull();
  });
});
