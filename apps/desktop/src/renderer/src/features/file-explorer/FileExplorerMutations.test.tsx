// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc. Regression suite for
   clioo/drogon#156 (rename editor semantics) and clioo/drogon#157
   (the tree must reflect daemon-confirmed mutations without a manual
   Refresh). Mounts the real FileExplorer against a scripted source: the
   store only changes when the test says the daemon did, so every row
   assertion proves the component reconciled — never the fake. */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FileExplorer, type FileExplorerDataSource } from "./FileExplorer";
import type { ExplorerNode } from "./tree-model";
import type { Result } from "../../../../shared/session-contract";

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

type Gate = { resolve: (value: Result<null>) => void };
type ListGate = { resolve: (value: Result<ExplorerNode[]>) => void };

function makeSource(seed: ExplorerNode[]) {
  const store = new Map<string, ExplorerNode[]>([["", [...seed]]]);
  const calls: Array<[string, ...unknown[]]> = [];
  const gates: Gate[] = [];
  const listGates: ListGate[] = [];
  const listeners = new Set<() => void>();
  const ok: Result<null> = { ok: true, result: null };
  const source: FileExplorerDataSource = {
    listDir: (dir: string, _includeHidden: boolean) => {
      void _includeHidden;
      calls.push(["list", dir]);
      return new Promise<Result<ExplorerNode[]>>((resolve) => {
        listGates.push({ resolve });
      });
    },
    create: (parentDir: string, name: string) => {
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
    tick: () => {
      for (const listener of [...listeners]) listener();
    },
    listenerCount: () => listeners.size,
    flushLists: async () => {
      // Resolve every pending listing against the current store truth
      // (these cases only ever list the root).
      await act(async () => {
        for (const gate of listGates.splice(0)) {
          gate.resolve({ ok: true, result: [...(store.get("") ?? [])] });
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

async function renderExplorer(
  harness: ReturnType<typeof makeSource>,
  extra?: Partial<React.ComponentProps<typeof FileExplorer>>,
) {
  const onDeleted = vi.fn();
  const onSelect = vi.fn();
  render(
    <FileExplorer
      workspaceId="ws"
      workspaceName="folder"
      source={harness.source}
      activePath={null}
      onSelect={onSelect}
      onDeleted={onDeleted}
      {...extra}
    />,
  );
  await harness.flushLists();
  return { onDeleted, onSelect };
}

function row(name: string) {
  return screen.getByRole("button", { name });
}

function renameInput() {
  return screen.getByLabelText(/Rename to /) as HTMLInputElement;
}

describe("rename editor (#156)", () => {
  it("pre-selects the stem, commits the typed replacement verbatim, and shows it once", async () => {
    const harness = makeSource([node("README.md", "README.md"), node("scratch.txt", "scratch.txt")]);
    const { onSelect } = await renderExplorer(harness);

    row("scratch.txt").focus();
    fireEvent.keyDown(row("scratch.txt"), { key: "Enter" });
    const input = renameInput();
    expect(input.value).toBe("scratch.txt");
    // Stem selected, extension kept: typing replaces the selection.
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("scratch".length);

    // Emulate the browser replacing the selected stem with typed text.
    input.setRangeText("notes", input.selectionStart ?? 0, input.selectionEnd ?? 0, "end");
    expect(input.value).toBe("notes.txt");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(harness.calls).toContainEqual(["rename", "scratch.txt", "notes.txt"]);
    // Daemon truth lands; resolve the mutation, then its parent reload.
    harness.store.set("", [node("README.md", "README.md"), node("notes.txt", "notes.txt")]);
    await harness.resolveNext();
    await harness.flushLists();

    await waitFor(() => expect(screen.queryByRole("button", { name: "scratch.txt" })).toBeNull());
    const renamed = screen.getAllByRole("button", { name: "notes.txt" });
    expect(renamed).toHaveLength(1);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ path: "notes.txt" }),
    );
  });

  it("commits a fully retyped name verbatim (never appends, never strips)", async () => {
    const harness = makeSource([node("scratch.txt", "scratch.txt")]);
    await renderExplorer(harness);

    row("scratch.txt").focus();
    fireEvent.keyDown(row("scratch.txt"), { key: "Enter" });
    const input = renameInput();
    // The user selects everything and types a brand-new full name.
    input.setRangeText("notes.md", 0, input.value.length, "end");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(harness.calls).toContainEqual(["rename", "scratch.txt", "notes.md"]);
  });

  it("selects the whole name when there is no extension", async () => {
    const harness = makeSource([node("Makefile", "Makefile")]);
    await renderExplorer(harness);

    row("Makefile").focus();
    fireEvent.keyDown(row("Makefile"), { key: "Enter" });
    const input = screen.getByLabelText("Rename to Makefile") as HTMLInputElement;
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("Makefile".length);
  });

  it("Escape cancels without touching the bridge", async () => {
    const harness = makeSource([node("scratch.txt", "scratch.txt")]);
    await renderExplorer(harness);

    row("scratch.txt").focus();
    fireEvent.keyDown(row("scratch.txt"), { key: "Enter" });
    const input = renameInput();
    input.setRangeText("nope", 0, 7, "end");
    fireEvent.keyDown(input, { key: "Escape" });

    expect(harness.calls.filter(([op]) => op === "rename")).toHaveLength(0);
    await waitFor(() =>
      expect(screen.queryByLabelText(/Rename to /)).toBeNull(),
    );
    expect(row("scratch.txt")).toBeTruthy();
  });

  it("submitting the unchanged name calls no bridge", async () => {
    const harness = makeSource([node("scratch.txt", "scratch.txt")]);
    await renderExplorer(harness);

    row("scratch.txt").focus();
    fireEvent.keyDown(row("scratch.txt"), { key: "Enter" });
    fireEvent.keyDown(renameInput(), { key: "Enter" });

    expect(harness.calls.filter(([op]) => op === "rename")).toHaveLength(0);
    await waitFor(() =>
      expect(screen.queryByLabelText(/Rename to /)).toBeNull(),
    );
  });
});

describe("delete (#157)", () => {
  it("confirms with the permanent copy and drops the row without a Refresh", async () => {
    const harness = makeSource([node("README.md", "README.md"), node("notes.txt", "notes.txt")]);
    const { onDeleted } = await renderExplorer(harness);

    fireEvent.contextMenu(row("notes.txt"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete/ }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Permanently delete 'notes.txt'?");
    expect(dialog.textContent).toContain("This permanently deletes the file.");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    // Daemon confirms; the row is gone BEFORE its parent reload lands.
    harness.store.set("", [node("README.md", "README.md")]);
    await harness.resolveNext();
    await waitFor(() => expect(screen.queryByRole("button", { name: "notes.txt" })).toBeNull());
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onDeleted).toHaveBeenCalledWith(["notes.txt"]);
    // The follow-up reload reconciles: the row stays gone.
    await harness.flushLists();
    expect(screen.queryByRole("button", { name: "notes.txt" })).toBeNull();
    expect(row("README.md")).toBeTruthy();
  });
});

describe("create", () => {
  it("shows the created row after the parent reload", async () => {
    const harness = makeSource([node("README.md", "README.md")]);
    await renderExplorer(harness);

    fireEvent.click(screen.getByRole("button", { name: "New File" }));
    const input = screen.getByLabelText("New file name") as HTMLInputElement;
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "fresh.txt" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(harness.calls).toContainEqual(["create", "", "fresh.txt"]);
    harness.store.set("", [node("README.md", "README.md"), node("fresh.txt", "fresh.txt")]);
    await harness.resolveNext();
    await harness.flushLists();

    await waitFor(() => expect(row("fresh.txt")).toBeTruthy());
  });
});

describe("live watch ticks", () => {
  it("reloads loaded directories on a tick, and defers while editing", async () => {
    const harness = makeSource([node("a.txt", "a.txt")]);
    await renderExplorer(harness);
    expect(harness.listenerCount()).toBe(1);
    const listsBefore = harness.calls.filter(([op]) => op === "list").length;

    harness.store.set("", [node("a.txt", "a.txt"), node("outside.txt", "outside.txt")]);
    await act(async () => {
      harness.tick();
    });
    await harness.flushLists();
    await waitFor(() => expect(row("outside.txt")).toBeTruthy());
    expect(harness.calls.filter(([op]) => op === "list").length).toBeGreaterThan(listsBefore);
  });

  it("defers a tick while the rename editor is open and replays on close", async () => {
    const harness = makeSource([node("a.txt", "a.txt")]);
    await renderExplorer(harness);

    row("a.txt").focus();
    fireEvent.keyDown(row("a.txt"), { key: "Enter" });
    expect(renameInput()).toBeTruthy();
    const listsBefore = harness.calls.filter(([op]) => op === "list").length;

    harness.store.set("", [node("a.txt", "a.txt"), node("outside.txt", "outside.txt")]);
    await act(async () => {
      harness.tick();
    });
    // Deferred: no reload while rows could shift under the editor.
    expect(harness.calls.filter(([op]) => op === "list").length).toBe(listsBefore);
    expect(screen.queryByRole("button", { name: "outside.txt" })).toBeNull();

    fireEvent.keyDown(renameInput(), { key: "Escape" });
    await harness.flushLists();
    await waitFor(() => expect(row("outside.txt")).toBeTruthy());
  });
});
