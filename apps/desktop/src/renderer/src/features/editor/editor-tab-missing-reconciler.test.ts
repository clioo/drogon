// MIT Copyright (c) 2026 Lovecast Inc. #302: the tick reconciler that
// marks open editor tabs whose file vanished from disk. Pure-driver tests:
// the subscription lives in the app shell, the decision lives here.

import { describe, expect, test } from "vitest";
import {
  reconcileEditorTabsOnTick,
  type EditorTabMissingProbeInput,
} from "./editor-tab-missing-reconciler";
import type { FileListResult } from "../../../../shared/file-contract";
import type { Result } from "../../../../shared/session-contract";

function listing(
  dir: string,
  names: string[],
  truncated = false,
): Promise<Result<FileListResult>> {
  return Promise.resolve({
    ok: true,
    result: {
      hostId: "host-1",
      workspaceId: "ws-1",
      path: dir,
      entries: names.map((name) => ({
        name,
        kind: "file" as const,
        size: 1,
        mtime: "2026-01-01T00:00:00Z",
      })),
      truncated,
    },
  });
}

function makeInput(
  fileList: (input: { path: string }) => Promise<Result<FileListResult>>,
  marks: { missing: string[]; present: string[] },
): EditorTabMissingProbeInput {
  return {
    scope: { hostId: "host-1", workspaceId: "ws-1" },
    tabs: [
      { tabId: "ws-1::index.html", path: "index.html" },
      { tabId: "ws-1::notes/scratch.txt", path: "notes/scratch.txt" },
      { tabId: "ws-1::gone.txt", path: "gone.txt" },
    ],
    bridge: {
      fileList: (input) => fileList(input),
    },
    subscribeFilesChanged: () => () => {},
    onMissing: (tabId) => marks.missing.push(tabId),
    onPresent: (tabId) => marks.present.push(tabId),
  };
}

describe("editor tab missing reconciler (#302)", () => {
  test("a vanished basename marks its tab deleted; present ones are cleared", async () => {
    const marks: { missing: string[]; present: string[] } = {
      missing: [],
      present: [],
    };
    const input = makeInput((input) => {
      if (input.path === ".") return listing(".", ["index.html"]);
      return listing("notes", ["scratch.txt"]);
    }, marks);
    await reconcileEditorTabsOnTick(input);
    expect(marks.missing).toEqual(["ws-1::gone.txt"]);
    expect(marks.present).toEqual([
      "ws-1::index.html",
      "ws-1::notes/scratch.txt",
    ]);
  });

  test("tabs are grouped by directory: one listing per distinct parent", async () => {
    const listed: string[] = [];
    const marks: { missing: string[]; present: string[] } = {
      missing: [],
      present: [],
    };
    const input = makeInput((input) => {
      listed.push(input.path);
      return listing(input.path, ["index.html", "gone.txt"]);
    }, marks);
    await reconcileEditorTabsOnTick(input);
    // index.html and gone.txt share the root; only notes/ is separate.
    expect([...listed].sort()).toEqual([".", "notes"]);
  });

  test("a truncated listing proves nothing: no tab is ever marked", async () => {
    const marks: { missing: string[]; present: string[] } = {
      missing: [],
      present: [],
    };
    const input = makeInput((input) => listing(input.path, [], true), marks);
    await reconcileEditorTabsOnTick(input);
    await reconcileEditorTabsOnTick(input);
    expect(marks.missing).toEqual([]);
    expect(marks.present).toEqual([]);
  });

  test("a failed listing is unverifiable: it marks nothing", async () => {
    const marks: { missing: string[]; present: string[] } = {
      missing: [],
      present: [],
    };
    const input: EditorTabMissingProbeInput = {
      ...makeInput(() => listing(".", ["index.html"]), marks),
      bridge: {
        fileList: () =>
          Promise.resolve({
            ok: false,
            error: { code: "io_error", message: "disk gone" },
          }) as never,
      },
    };
    await reconcileEditorTabsOnTick(input);
    expect(marks.missing).toEqual([]);
    expect(marks.present).toEqual([]);
  });
});
