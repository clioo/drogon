// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { QuickOpen } from "./QuickOpen";
import type { FileBridge } from "../../../../shared/file-contract";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";

beforeEach(installRadixJsdomStubs);
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function searchBridge(
  files: string[],
  seen: Array<{ query: string; limit?: number }>,
): FileBridge {
  return {
    fileList: () =>
      Promise.resolve({
        ok: true,
        result: {
          hostId: "host",
          workspaceId: "ws-1",
          path: ".",
          entries: [],
          truncated: false,
        },
      }),
    fileRead: () => Promise.reject(new Error("unused")),
    fileWrite: () => Promise.reject(new Error("unused")),
    fileSearch: (input) => {
      seen.push({ query: input.query, limit: input.limit });
      return Promise.resolve({
        ok: true,
        result: {
          hostId: input.hostId,
          workspaceId: input.workspaceId,
          query: input.query.trim(),
          files,
          truncated: false,
        },
      });
    },
  };
}

function props(overrides: Partial<React.ComponentProps<typeof QuickOpen>> = {}) {
  return {
    query: "",
    onQueryChange: vi.fn(),
    onClose: vi.fn(),
    fileBridge: searchBridge([], []),
    hostId: "host",
    workspaceId: "ws-1",
    filesAvailable: true,
    onOpenFile: vi.fn(),
    ...overrides,
  };
}

describe("QuickOpen", () => {
  test("searches the daemon and ranks filename matches first", async () => {
    const seen: Array<{ query: string; limit?: number }> = [];
    render(
      <QuickOpen
        {...props({
          query: "fb",
          fileBridge: searchBridge(["frobnicator/x.ts", "foo/bar.ts"], seen),
        })}
      />,
    );
    expect(await screen.findByText("bar.ts")).toBeTruthy();
    expect(seen).toEqual([{ query: "fb", limit: 200 }]);
    const rows = document.querySelectorAll(".quick-open-row");
    expect(rows).toHaveLength(2);
    // Fuzzy rank leads; the dir renders dimmed beside the name.
    expect(rows[0].textContent).toContain("bar.ts");
    expect(rows[0].querySelector(".quick-open-dir")?.textContent).toBe("foo/");
    expect(screen.getByText("2 files found")).toBeTruthy();
    // Fork-parity row: per-type file icon, filename, dimmed directory.
    const firstIcon = rows[0].querySelector("svg");
    expect(firstIcon).toBeTruthy();
  });

  test("recent files lead the empty-query list", async () => {
    window.localStorage.setItem(
      "drogon.quick-open.recent:ws-1",
      JSON.stringify(["b.ts"]),
    );
    render(
      <QuickOpen
        {...props({ fileBridge: searchBridge(["a.ts", "b.ts"], []) })}
      />,
    );
    expect(await screen.findByText("b.ts")).toBeTruthy();
    const rows = Array.from(document.querySelectorAll(".quick-open-row")).map(
      (row) => row.textContent,
    );
    expect(rows[0]).toContain("b.ts");
  });

  test("falls back to the list walk when files.search is absent", async () => {
    const bridge: FileBridge = {
      fileList: () =>
        Promise.resolve({
          ok: true,
          result: {
            hostId: "host",
            workspaceId: "ws-1",
            path: ".",
            entries: [
              { name: "fallback.ts", kind: "file", size: 1, mtime: "" },
            ],
            truncated: false,
          },
        }),
      fileRead: () => Promise.reject(new Error("unused")),
      fileWrite: () => Promise.reject(new Error("unused")),
    };
    expect(bridge.fileSearch).toBeUndefined();
    render(<QuickOpen {...props({ fileBridge: bridge, query: "fallback" })} />);
    expect(await screen.findByText("fallback.ts")).toBeTruthy();
  });

  test("daemon failure renders an alert, not a crash", async () => {
    const bridge: FileBridge = {
      fileList: () => Promise.reject(new Error("unused")),
      fileRead: () => Promise.reject(new Error("unused")),
      fileWrite: () => Promise.reject(new Error("unused")),
      fileSearch: () =>
        Promise.resolve({
          ok: false,
          error: { code: "io_error", message: "boom", retryable: false },
        }),
    };
    render(<QuickOpen {...props({ fileBridge: bridge, query: "x" })} />);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "boom");
  });

  test("unavailable files explain instead of searching", async () => {
    const fileSearch = vi.fn();
    render(
      <QuickOpen
        {...props({
          fileBridge: { ...searchBridge([], []), fileSearch },
          filesAvailable: false,
        })}
      />,
    );
    expect(
      await screen.findByText("Files unavailable: service does not advertise files.v1"),
    ).toBeTruthy();
    expect(fileSearch).not.toHaveBeenCalled();
  });
});
