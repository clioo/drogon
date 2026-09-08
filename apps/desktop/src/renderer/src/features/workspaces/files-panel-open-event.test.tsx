// @vitest-environment jsdom
// R16-A (fixes #133): an Explorer row click no longer opens an embedded
// EditorPane in this panel — it dispatches the same window event the
// terminal file-link popover and quick-open use, so App can open/reuse a
// main tab-group editor tab for the path. This exercises that wiring end
// to end through the real descriptor (not the pure functions, covered in
// files-panel.test.ts and features/editor/file-read-write.test.ts).

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createFilesPanelDescriptor,
  FILES_ROUTE_ID,
  type FileOpenRequestCell,
} from "./files-panel";
import { TERMINAL_FILE_OPEN_EVENT } from "../terminal/terminal-file-link";
import type { TerminalFileOpenDetail } from "../terminal/terminal-file-link";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import type { FileBridge } from "../../../../shared/file-contract";
import type { Status, Workspace } from "../../../../shared/session-contract";

beforeEach(installRadixJsdomStubs);
afterEach(cleanup);

const workspace: Workspace = {
  id: "w1",
  path: "/repo",
  name: "repo",
  kind: "git",
  hostId: "h1",
};

const status: Status = {
  hostId: "h1",
  serviceInstanceId: "svc",
  protocol: 1,
  capabilities: ["files.v1"],
  version: "0.1.0",
};

function fakeBridge(): FileBridge {
  return {
    fileList: () =>
      Promise.resolve({
        ok: true,
        result: {
          hostId: "h1",
          workspaceId: "w1",
          path: ".",
          truncated: false,
          entries: [{ name: "index.html", kind: "file", size: 10, mtime: "t" }],
        },
      }),
    fileRead: () => Promise.reject(new Error("unused: the tree never reads content")),
    fileWrite: () => Promise.reject(new Error("unused: the tree never writes content")),
  };
}

describe("FilesPanel row click routes to the tab group, not an embedded editor", () => {
  test("clicking a file row dispatches drogon:open-file instead of rendering EditorPane", async () => {
    const descriptor = createFilesPanelDescriptor({ bridge: fakeBridge() });
    expect(descriptor.id).toBe(FILES_ROUTE_ID);
    const events: TerminalFileOpenDetail[] = [];
    const onOpenFile = (event: Event) => {
      events.push((event as CustomEvent<TerminalFileOpenDetail>).detail);
    };
    window.addEventListener(TERMINAL_FILE_OPEN_EVENT, onOpenFile);
    try {
      render(
        descriptor.component({
          routeId: FILES_ROUTE_ID,
          session: null,
          workspace,
          status,
          focusTarget: null,
        }),
      );
      const row = await screen.findByRole("treeitem", { name: "index.html" });
      fireEvent.click(row);
      await waitFor(() => expect(events).toHaveLength(1));
      expect(events[0]).toEqual({
        path: "index.html",
        line: null,
        column: null,
        workspaceId: "w1",
        openWithSystemDefault: false,
      });
      // The old embedded editor never renders here anymore: no editor
      // landmark, no Monaco surface, inside this panel.
      expect(screen.queryByLabelText(/^Editor/)).toBeNull();
      expect(document.querySelector(".editor-pane-surface")).toBeNull();
    } finally {
      window.removeEventListener(TERMINAL_FILE_OPEN_EVENT, onOpenFile);
    }
  });
});

describe("FilesPanel quick-open reveal seeds the tree highlight only", () => {
  test("a matching cell request enables Reveal Active File; no cell leaves it disabled", async () => {
    const cell: FileOpenRequestCell = {
      current: { workspaceId: "w1", path: "index.html", nonce: 1 },
    };
    const descriptor = createFilesPanelDescriptor({
      bridge: fakeBridge(),
      openRequestCell: cell,
    });
    render(
      descriptor.component({
        routeId: FILES_ROUTE_ID,
        session: null,
        workspace,
        status,
        focusTarget: null,
      }),
    );
    await screen.findByRole("treeitem", { name: "index.html" });
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Reveal Active File" })
          .getAttribute("aria-disabled"),
      ).toBeNull(),
    );
  });

  test("no cell means nothing is revealed", async () => {
    const descriptor = createFilesPanelDescriptor({ bridge: fakeBridge() });
    render(
      descriptor.component({
        routeId: FILES_ROUTE_ID,
        session: null,
        workspace,
        status,
        focusTarget: null,
      }),
    );
    await screen.findByRole("treeitem", { name: "index.html" });
    expect(
      screen.getByRole("button", { name: "Reveal Active File" }).getAttribute("aria-disabled"),
    ).toBe("true");
  });
});
