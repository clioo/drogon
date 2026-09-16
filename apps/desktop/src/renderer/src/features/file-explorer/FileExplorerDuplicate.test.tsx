// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc. Regression suite for
   clioo/drogon#334 (the explorer's Duplicate row runs on the
   `files.duplicate` RPC). Mounts the real FileExplorer against a scripted
   source: the store only changes when the test says the daemon did, so
   every row assertion proves the component reconciled — never the fake. */

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

function makeSource(seed: ExplorerNode[], withDuplicate = true) {
  const store = new Map<string, ExplorerNode[]>([["", [...seed]]]);
  const calls: Array<[string, ...unknown[]]> = [];
  const gates: Gate[] = [];
  const listGates: ListGate[] = [];
  const ok: Result<null> = { ok: true, result: null };
  const source: FileExplorerDataSource = {
    listDir: (dir: string) => {
      calls.push(["list", dir]);
      return new Promise<Result<ExplorerNode[]>>((resolve) => {
        listGates.push({ resolve });
      });
    },
    ...(withDuplicate
      ? {
          duplicate: (from: string, to: string) => {
            calls.push(["duplicate", from, to]);
            return new Promise<Result<null>>((resolve) => gates.push({ resolve }));
          },
        }
      : {}),
  };
  return {
    source,
    calls,
    store,
    flushLists: async () => {
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
  const onSelect = vi.fn();
  render(
    <FileExplorer
      workspaceId="ws"
      workspaceName="folder"
      source={harness.source}
      activePath={null}
      onSelect={onSelect}
      {...extra}
    />,
  );
  await harness.flushLists();
  return { onSelect };
}

function row(name: string) {
  return screen.getByRole("button", { name });
}

describe("duplicate row (#334)", () => {
  it("duplicates the row, shows the copy after reload, and opens it", async () => {
    const harness = makeSource([node("notes.txt", "notes.txt")]);
    const { onSelect } = await renderExplorer(harness);

    fireEvent.contextMenu(row("notes.txt"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(harness.calls).toContainEqual(["duplicate", "notes.txt", "notes copy.txt"]);

    // Daemon confirms; the parent reload carries the copy into the tree.
    harness.store.set("", [node("notes.txt", "notes.txt"), node("notes copy.txt", "notes copy.txt")]);
    await harness.resolveNext();
    await harness.flushLists();
    await waitFor(() => expect(row("notes copy.txt")).toBeTruthy());
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ path: "notes copy.txt", isDirectory: false }),
    );
  });

  it("increments the copy name past colliding siblings", async () => {
    const harness = makeSource([
      node("a.txt", "a.txt"),
      node("a copy.txt", "a copy.txt"),
    ]);
    await renderExplorer(harness);

    fireEvent.contextMenu(row("a.txt"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(harness.calls).toContainEqual(["duplicate", "a.txt", "a copy 2.txt"]);
  });

  it("fails closed with an inline error when the bridge lacks files.duplicate", async () => {
    const harness = makeSource([node("notes.txt", "notes.txt")], false);
    await renderExplorer(harness);

    fireEvent.contextMenu(row("notes.txt"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(harness.calls.filter(([op]) => op === "duplicate")).toHaveLength(0);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/files\.duplicate/),
    );
  });

  it("surfaces the daemon refusal without adding a row", async () => {
    const harness = makeSource([node("notes.txt", "notes.txt")]);
    await renderExplorer(harness);

    fireEvent.contextMenu(row("notes.txt"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    await harness.resolveNext({
      ok: false,
      error: { code: "invalid_argument", message: "destination path already exists", retryable: false },
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "destination path already exists",
      ),
    );
    await harness.flushLists();
    expect(screen.queryByRole("button", { name: "notes copy.txt" })).toBeNull();
  });
});
