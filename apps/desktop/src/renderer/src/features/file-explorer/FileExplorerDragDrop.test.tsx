// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc. Regression suite for the R16-BC
// explorer internal drag-and-drop move (fork useFileExplorerDragDrop /
// useFileExplorerMoveDrop parity). Mounts the real FileExplorer against a
// scripted source: the store only changes when the test says the daemon
// did, so every assertion proves the component issued (or refused) the
// move — never the fake.

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FileExplorer, type FileExplorerDataSource } from "./FileExplorer";
import type { ExplorerNode } from "./tree-model";
import type { Result } from "../../../../shared/session-contract";
import {
  encodeWorkspaceFilePaths,
  getTopLevelForTests,
  WORKSPACE_FILE_PATH_MIME,
  WORKSPACE_FILE_PATHS_MIME,
} from "./workspace-file-drag";

// jsdom implements no scrolling: the explorer's bring-into-view calls
// would otherwise throw asynchronously from a frame callback.
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

function dataTransfer(sourcePath: string, paths?: string[]): DataTransfer {
  const store = new Map<string, string>();
  store.set(WORKSPACE_FILE_PATH_MIME, sourcePath);
  if (paths) store.set(WORKSPACE_FILE_PATHS_MIME, encodeWorkspaceFilePaths(paths));
  return {
    types: [...store.keys()],
    getData: (type: string) => store.get(type) ?? "",
    setData: (type: string, value: string) => void store.set(type, value),
    setDragImage: vi.fn(),
    effectAllowed: "",
    dropEffect: "",
  } as unknown as DataTransfer;
}

function makeSource(seed: ExplorerNode[]) {
  const calls: Array<[string, ...unknown[]]> = [];
  const gates: { resolve: (value: Result<null>) => void }[] = [];
  const listGates: { resolve: (value: Result<ExplorerNode[]>) => void }[] = [];
  const ok: Result<null> = { ok: true, result: null };
  const source: FileExplorerDataSource = {
    listDir: () =>
      new Promise<Result<ExplorerNode[]>>((resolve) => {
        listGates.push({ resolve });
      }),
    rename: (from: string, to: string) => {
      calls.push(["rename", from, to]);
      return new Promise<Result<null>>((resolve) => gates.push({ resolve }));
    },
  };
  return {
    source,
    calls,
    flushLists: async () => {
      await act(async () => {
        for (const gate of listGates.splice(0)) {
          gate.resolve({ ok: true, result: [...seed] });
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
    />,
  );
  await harness.flushLists();
}

function row(name: string) {
  return screen.getByRole("button", { name });
}

function scrollContainer() {
  return document.querySelector(".file-explorer-scroll") as HTMLElement;
}

describe("explorer internal drag-and-drop move (R16-BC)", () => {
  it("dropping a root file onto a directory row renames it into that directory", async () => {
    const harness = makeSource([
      node("src", "src", true),
      node("notes.txt", "notes.txt"),
    ]);
    await renderExplorer(harness);

    fireEvent.dragStart(row("notes.txt"), {
      dataTransfer: dataTransfer("notes.txt"),
    });
    fireEvent.dragEnter(row("src"), { dataTransfer: dataTransfer("notes.txt") });
    fireEvent.drop(row("src"), { dataTransfer: dataTransfer("notes.txt") });

    expect(harness.calls).toContainEqual(["rename", "notes.txt", "src/notes.txt"]);
    await harness.resolveNext();
  });

  it("dropping onto the scroll background moves to the workspace root", async () => {
    const harness = makeSource([
      node("src", "src", true),
      node("main.ts", "src/main.ts", false, 1),
    ]);
    await renderExplorer(harness);

    fireEvent.dragStart(row("main.ts"), {
      dataTransfer: dataTransfer("src/main.ts"),
    });
    fireEvent.dragEnter(scrollContainer(), { dataTransfer: dataTransfer("src/main.ts") });
    fireEvent.drop(scrollContainer(), { dataTransfer: dataTransfer("src/main.ts") });

    expect(harness.calls).toContainEqual(["rename", "src/main.ts", "main.ts"]);
    await harness.resolveNext();
  });

  it("a same-directory drop is a no-op", async () => {
    const harness = makeSource([
      node("notes.txt", "notes.txt"),
      node("README.md", "README.md"),
    ]);
    await renderExplorer(harness);

    fireEvent.dragStart(row("notes.txt"), {
      dataTransfer: dataTransfer("notes.txt"),
    });
    // README.md is a root file: its drop dir is the root, where the drag
    // source already lives.
    fireEvent.dragEnter(row("README.md"), { dataTransfer: dataTransfer("notes.txt") });
    fireEvent.drop(row("README.md"), { dataTransfer: dataTransfer("notes.txt") });

    expect(harness.calls.filter(([kind]) => kind === "rename")).toHaveLength(0);
  });

  it("dropping a directory into its own subtree is refused", async () => {
    const harness = makeSource([
      node("src", "src", true),
      node("main.ts", "src/main.ts", false, 1),
    ]);
    await renderExplorer(harness);

    fireEvent.dragStart(row("src"), { dataTransfer: dataTransfer("src") });
    // main.ts is a file inside src: its drop dir IS the dragged directory.
    fireEvent.dragEnter(row("main.ts"), { dataTransfer: dataTransfer("src") });
    fireEvent.drop(row("main.ts"), { dataTransfer: dataTransfer("src") });

    expect(harness.calls.filter(([kind]) => kind === "rename")).toHaveLength(0);
  });

  it("a multi-selection drag moves each top-level path once", async () => {
    const harness = makeSource([
      node("src", "src", true),
      node("docs", "docs", true),
      node("a.txt", "docs/a.txt", false, 1),
      node("b.txt", "b.txt"),
    ]);
    await renderExplorer(harness);

    // Select docs + b.txt, then drag from docs: docs/a.txt is a child of
    // the docs selection and must not produce its own move.
    const paths = ["docs", "docs/a.txt", "b.txt"];
    fireEvent.dragStart(row("docs"), {
      dataTransfer: dataTransfer("docs", paths),
    });
    fireEvent.dragEnter(row("src"), { dataTransfer: dataTransfer("docs", paths) });
    fireEvent.drop(row("src"), { dataTransfer: dataTransfer("docs", paths) });

    const moves = harness.calls.filter(([kind]) => kind === "rename");
    expect(moves).toContainEqual(["rename", "docs", "src/docs"]);
    expect(moves).toContainEqual(["rename", "b.txt", "src/b.txt"]);
    expect(moves).toHaveLength(2);
    await harness.resolveNext();
    await harness.resolveNext();
  });
});

describe("workspace-file-drag payload helpers", () => {
  it("keeps only top-level paths and preserves the source order", () => {
    expect(getTopLevelForTests(["docs", "docs/a.txt", "b.txt", "b.txt"])).toEqual([
      "docs",
      "b.txt",
    ]);
    expect(getTopLevelForTests([])).toEqual([]);
  });
});
