// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc. Verification suite for
   clioo/drogon#163 (Explorer New File / New Folder must create the entry
   on disk, surface it in the tree and refresh without a contract banner).
   Mounts the real FileExplorer against a dir-aware scripted source: rows
   only appear after the test resolves the daemon confirmation AND the
   parent reload, so every assertion proves the component reconciled the
   full create path — never the fake. */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FileExplorer, type FileExplorerDataSource } from "./FileExplorer";
import type { ExplorerNode } from "./tree-model";
import type { Result } from "../../../../shared/session-contract";

beforeAll(() => {
  if (typeof Element.prototype.scrollIntoView !== "function") {
    Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView;
  }
});

afterEach(cleanup);

const node = (name: string, path: string, isDirectory = false, depth = 0): ExplorerNode => ({
  name,
  path,
  isDirectory,
  depth,
});

type Gate = { resolve: (value: Result<null>) => void };

function makeSource(seed: Record<string, ExplorerNode[]>) {
  const store = new Map<string, ExplorerNode[]>(Object.entries(seed));
  const calls: Array<[string, ...unknown[]]> = [];
  const gates: Gate[] = [];
  const listGates: Array<{ dir: string; resolve: (value: Result<ExplorerNode[]>) => void }> = [];
  const listeners = new Set<() => void>();
  const ok: Result<null> = { ok: true, result: null };
  const source: FileExplorerDataSource = {
    listDir: (dir: string, _includeHidden: boolean) => {
      void _includeHidden;
      calls.push(["list", dir]);
      return new Promise<Result<ExplorerNode[]>>((resolve) => {
        listGates.push({ dir, resolve });
      });
    },
    create: (parentDir: string, name: string, _kind: "file" | "directory") => {
      void _kind;
      calls.push(["create", parentDir, name]);
      return new Promise<Result<null>>((resolve) => gates.push({ resolve }));
    },
    rename: (from: string, to: string) => {
      calls.push(["rename", from, to]);
      return new Promise<Result<null>>((resolve) => gates.push({ resolve }));
    },
    remove: (paths: string[]) => {
      calls.push(["remove", [...paths]]);
      return new Promise<Result<null>>((resolve) => gates.push({ resolve }));
    },
    subscribeFilesChanged: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    source,
    calls,
    store,
    flushLists: async () => {
      await act(async () => {
        for (const gate of listGates.splice(0)) {
          gate.resolve({ ok: true, result: [...(store.get(gate.dir) ?? [])] });
        }
      });
    },
    resolveNext: async (value: Result<null> = ok) => {
      const gate = gates.shift();
      if (!gate) throw new Error("no pending mutation");
      await act(async () => {
        gate.resolve(value);
      });
    },
  };
}

async function renderExplorer(harness: ReturnType<typeof makeSource>) {
  render(
    <FileExplorer
      workspaceId="ws"
      workspaceName="folder"
      source={harness.source}
      activePath={null}
      onSelect={() => {}}
      onDeleted={() => {}}
    />,
  );
  await harness.flushLists();
}

function row(name: string) {
  return screen.getByRole("button", { name });
}

describe("create (#163)", () => {
  it("creates a folder at the root and shows it after the reload", async () => {
    const harness = makeSource({ "": [node("README.md", "README.md")] });
    await renderExplorer(harness);

    fireEvent.click(screen.getByRole("button", { name: "New Folder" }));
    const input = screen.getByLabelText("New folder name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "qadir" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(harness.calls).toContainEqual(["create", "", "qadir"]);
    harness.store.set("", [node("README.md", "README.md"), node("qadir", "qadir", true)]);
    await harness.resolveNext();
    await harness.flushLists();

    await waitFor(() => expect(row("qadir")).toBeTruthy());
  });

  it("creates a file inside a nested folder", async () => {
    const harness = makeSource({
      "": [node("README.md", "README.md"), node("docs", "docs", true)],
      docs: [],
    });
    await renderExplorer(harness);

    fireEvent.contextMenu(row("docs"));
    fireEvent.click(screen.getByRole("menuitem", { name: "New File" }));
    const input = screen.getByLabelText("New file name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "guide.md" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(harness.calls).toContainEqual(["create", "docs", "guide.md"]);
    harness.store.set("docs", [node("guide.md", "docs/guide.md", false, 1)]);
    await harness.resolveNext();
    await harness.flushLists();

    await waitFor(() => expect(row("guide.md")).toBeTruthy());
  });

  it("keeps spaces in the entered name", async () => {
    const harness = makeSource({ "": [node("README.md", "README.md")] });
    await renderExplorer(harness);

    fireEvent.click(screen.getByRole("button", { name: "New File" }));
    const input = screen.getByLabelText("New file name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "my notes.txt" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(harness.calls).toContainEqual(["create", "", "my notes.txt"]);
    harness.store.set("", [
      node("README.md", "README.md"),
      node("my notes.txt", "my notes.txt"),
    ]);
    await harness.resolveNext();
    await harness.flushLists();

    await waitFor(() => expect(row("my notes.txt")).toBeTruthy());
  });

  it("rejects a duplicate name inline without calling the daemon", async () => {
    const harness = makeSource({ "": [node("README.md", "README.md")] });
    await renderExplorer(harness);

    fireEvent.click(screen.getByRole("button", { name: "New File" }));
    const input = screen.getByLabelText("New file name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "README.md" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByRole("alert").textContent).toContain(
      "A file or folder with this name already exists.",
    );
    expect(harness.calls.filter(([op]) => op === "create")).toEqual([]);
    // The input stays open for a corrected name.
    expect(screen.getByLabelText("New file name")).toBeTruthy();
  });

  it("cancels with Escape without calling the daemon", async () => {
    const harness = makeSource({ "": [node("README.md", "README.md")] });
    await renderExplorer(harness);

    fireEvent.click(screen.getByRole("button", { name: "New File" }));
    const input = screen.getByLabelText("New file name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "abandoned.txt" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(harness.calls.filter(([op]) => op === "create")).toEqual([]);
    expect(screen.queryByLabelText("New file name")).toBeNull();
    expect(screen.queryByRole("button", { name: "abandoned.txt" })).toBeNull();
  });

  it("surfaces a daemon failure as an action error, never a contract banner", async () => {
    const harness = makeSource({ "": [node("README.md", "README.md")] });
    await renderExplorer(harness);

    fireEvent.click(screen.getByRole("button", { name: "New File" }));
    const input = screen.getByLabelText("New file name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "fresh.txt" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await harness.resolveNext({
      ok: false,
      error: { code: "io_error", message: "Drogon could not create the file.", retryable: false },
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Drogon could not create the file.",
      ),
    );
    expect(screen.queryByRole("button", { name: "fresh.txt" })).toBeNull();
  });
});
