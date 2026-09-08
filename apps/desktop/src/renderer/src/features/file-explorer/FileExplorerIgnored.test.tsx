// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc. R16-AM: the explorer dims
   git-ignored rows like the reference. Mounts the real FileExplorer against
   a scripted source whose `ignored` answers a fixed set: the italic +
   "Ignored by .gitignore" badge assertions prove the component classified
   through the daemon query — never a local guess. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("Show Git Ignored Files toggle (fork settings.showGitIgnoredFiles)", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("git workspaces get the toggle, folder workspaces do not", async () => {
    const { source } = makeSource([node("a.txt", "a.txt")], []);
    const { unmount } = render(
      <FileExplorer workspaceId="ws" workspaceName="ws" source={source} activePath={null} isGitWorkspace />,
    );
    await waitFor(() => expect(screen.getByText("a.txt")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "More Explorer Actions" }));
    const toggle = screen.getByRole("menuitemcheckbox", { name: "Show Git Ignored Files" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    unmount();

    render(
      <FileExplorer workspaceId="ws" workspaceName="ws" source={source} activePath={null} />,
    );
    await waitFor(() => expect(screen.getByText("a.txt")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "More Explorer Actions" }));
    expect(screen.queryByRole("menuitemcheckbox", { name: "Show Git Ignored Files" })).toBeNull();
    expect(screen.getByRole("menuitemcheckbox", { name: "Show Dotfiles" })).toBeDefined();
  });

  it("hides ignored rows and their descendants while off, persisted across remounts", async () => {
    const source: FileExplorerDataSource = {
      listDir: async (dir) => ({
        ok: true,
        result:
          dir === ""
            ? [node("dist", "dist", true), node("app.ts", "app.ts")]
            : dir === "dist"
              ? [node("bundle.js", "dist/bundle.js")]
              : [],
      }),
      // Only the directory is reported ignored; its child still hides.
      ignored: async (paths) => ({ ok: true, result: paths.filter((p) => p === "dist") }),
    };
    const { unmount } = render(
      <FileExplorer workspaceId="ws" workspaceName="ws" source={source} activePath={null} isGitWorkspace />,
    );
    await waitFor(() => expect(screen.getByText("dist")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: /^dist/ }));
    await waitFor(() => expect(screen.getByText("bundle.js")).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: "More Explorer Actions" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Show Git Ignored Files" }));

    await waitFor(() => expect(screen.queryByText("dist")).toBeNull());
    expect(screen.queryByText("bundle.js")).toBeNull();
    expect(screen.getByText("app.ts")).toBeDefined();
    unmount();

    // Global preference (fork: app settings, not per-worktree): a remount
    // of ANY workspace keeps ignored rows hidden.
    render(
      <FileExplorer workspaceId="other" workspaceName="other" source={source} activePath={null} isGitWorkspace />,
    );
    await waitFor(() => expect(screen.getByText("app.ts")).toBeDefined());
    await waitFor(() => expect(screen.queryByLabelText("Ignored by .gitignore")).toBeNull());
    expect(screen.queryByText("dist")).toBeNull();
  });
});

describe("Show Dotfiles persistence (fork showDotfilesByWorktree)", () => {
  afterEach(() => {
    localStorage.clear();
  });

  const dotfileSource = (): FileExplorerDataSource => ({
    listDir: async (_dir, includeHidden) => ({
      ok: true,
      result: includeHidden
        ? [node(".env", ".env"), node("a.txt", "a.txt")]
        : [node("a.txt", "a.txt")],
    }),
  });

  it("remembers the toggle per workspace across remounts", async () => {
    const { unmount } = render(
      <FileExplorer workspaceId="ws" workspaceName="ws" source={dotfileSource()} activePath={null} />,
    );
    await waitFor(() => expect(screen.getByText(".env")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "More Explorer Actions" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Show Dotfiles" }));
    await waitFor(() => expect(screen.queryByText(".env")).toBeNull());
    unmount();

    // Same workspace: hidden stays hidden.
    const second = render(
      <FileExplorer workspaceId="ws" workspaceName="ws" source={dotfileSource()} activePath={null} />,
    );
    await waitFor(() => expect(screen.getByText("a.txt")).toBeDefined());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(screen.queryByText(".env")).toBeNull();
    second.unmount();

    // Another workspace keeps the source default (dotfiles shown).
    render(
      <FileExplorer workspaceId="other" workspaceName="other" source={dotfileSource()} activePath={null} />,
    );
    await waitFor(() => expect(screen.getByText(".env")).toBeDefined());
  });
});
