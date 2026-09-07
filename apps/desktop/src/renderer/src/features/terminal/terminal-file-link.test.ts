// MIT Copyright (c) 2026 Lovecast Inc. Drogon-new tests for the adapted
// terminal-file-link.ts (extraction is MVP-scoped to single-line tokens;
// routing goes through the drogon:open-file window event).
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractTerminalFileLinks,
  handleTerminalFileLink,
  TERMINAL_FILE_OPEN_EVENT,
} from "./terminal-file-link";

describe("extractTerminalFileLinks", () => {
  it("extracts absolute paths with line and column", () => {
    const links = extractTerminalFileLinks(
      "error in /repo/src/app.ts:12:4: boom",
    );
    expect(links).toEqual([
      {
        path: "/repo/src/app.ts",
        line: 12,
        column: 4,
        startIndex: 9,
        endIndex: 9 + "/repo/src/app.ts:12:4".length,
      },
    ]);
  });

  it("extracts home, dot-relative and bare relative paths", () => {
    expect(
      extractTerminalFileLinks("see ~/notes/todo.md").map((l) => l.path),
    ).toEqual(["~/notes/todo.md"]);
    expect(
      extractTerminalFileLinks("see ./src/app.ts").map((l) => l.path),
    ).toEqual(["./src/app.ts"]);
    expect(
      extractTerminalFileLinks("see src/app.ts").map((l) => l.path),
    ).toEqual(["src/app.ts"]);
  });

  it("trims trailing punctuation and skips http urls", () => {
    expect(
      extractTerminalFileLinks("open (src/app.ts).").map((l) => l.path),
    ).toEqual(["src/app.ts"]);
    expect(extractTerminalFileLinks("see https://example.com/a/b")).toEqual(
      [],
    );
  });

  it("ignores bare words without a path shape", () => {
    expect(extractTerminalFileLinks("run make test now")).toEqual([]);
  });
});

describe("requestTerminalFileOpen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dispatches the Files-panel contract with shift state", () => {
    // Node vitest env has no DOM: stub the window event surface with a
    // minimal emitter (the renderer always has a real window).
    const listeners = new Map<string, Set<(event: Event) => void>>();
    vi.stubGlobal("window", {
      addEventListener: (type: string, listener: (event: Event) => void) => {
        let set = listeners.get(type);
        if (!set) {
          set = new Set();
          listeners.set(type, set);
        }
        set.add(listener);
      },
      removeEventListener: (
        type: string,
        listener: (event: Event) => void,
      ) => {
        listeners.get(type)?.delete(listener);
      },
      dispatchEvent: (event: Event) => {
        listeners.get(event.type)?.forEach((listener) => listener(event));
        return true;
      },
    });
    const seen: CustomEvent[] = [];
    const listener = (event: Event) => seen.push(event as CustomEvent);
    window.addEventListener(TERMINAL_FILE_OPEN_EVENT, listener);
    try {
      const handled = handleTerminalFileLink(
        "src/app.ts",
        12,
        null,
        { shiftKey: true } as MouseEvent,
        { workspaceId: "ws-1" },
      );
      expect(handled).toBe(true);
      expect(seen).toHaveLength(1);
      expect(seen[0].detail).toEqual({
        path: "src/app.ts",
        line: 12,
        column: null,
        workspaceId: "ws-1",
        openWithSystemDefault: true,
      });
    } finally {
      window.removeEventListener(TERMINAL_FILE_OPEN_EVENT, listener);
    }
  });
});
