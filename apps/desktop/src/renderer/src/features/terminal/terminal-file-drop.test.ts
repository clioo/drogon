// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  hasNativeTerminalFileDragTypes,
  isTerminalFileDropPayload,
  MAX_TERMINAL_FILE_DROP_BYTES,
  MAX_TERMINAL_FILE_DROP_PATHS,
  resolveTerminalFileDropTarget,
  validateTerminalFileDropPaths,
  WORKSPACE_FILE_PATH_MIME,
  WORKSPACE_FILE_PATHS_MIME,
} from "../../../../shared/terminal-file-drop-contract";
import {
  formatTerminalFileDropPaths,
  hasWorkspaceFileDragType,
  registerTerminalInternalFileDropListeners,
  resolveWorkspaceFileDropPath,
  shellEscapeTerminalFilePath,
  terminalFileDropShellForPlatform,
  terminalFileDropShellForUserAgent,
} from "./terminal-file-drop";
import { createTerminalPanePaste } from "./terminal-pane-paste";

describe("terminal native file-drop contract", () => {
  it("accepts OS file drags and leaves Explorer path drags alone", () => {
    expect(hasNativeTerminalFileDragTypes(["Files"])).toBe(true);
    expect(
      hasNativeTerminalFileDragTypes(["Files", WORKSPACE_FILE_PATH_MIME]),
    ).toBe(false);
    expect(
      hasNativeTerminalFileDragTypes(["Files", WORKSPACE_FILE_PATHS_MIME]),
    ).toBe(false);
    expect(hasNativeTerminalFileDragTypes(["text/plain"])).toBe(false);
  });

  it("routes through the nearest terminal pane marker", () => {
    expect(
      resolveTerminalFileDropTarget([
        {},
        {
          nativeFileDropTarget: "terminal",
          terminalTabId: "tab-1",
          terminalPaneLeafId: "pane-2",
        },
      ]),
    ).toEqual({ tabId: "tab-1", paneLeafId: "pane-2" });
    expect(
      resolveTerminalFileDropTarget([{ nativeFileDropTarget: "editor" }]),
    ).toBeNull();
  });

  it("rejects oversized native payloads before IPC", () => {
    expect(
      validateTerminalFileDropPaths(
        Array.from(
          { length: MAX_TERMINAL_FILE_DROP_PATHS + 1 },
          () => "/tmp/a",
        ),
      ),
    ).toMatchObject({ status: "rejected", reason: "too-many-paths" });
    expect(
      validateTerminalFileDropPaths([
        "x".repeat(MAX_TERMINAL_FILE_DROP_BYTES + 1),
      ]),
    ).toMatchObject({ status: "rejected", reason: "paths-too-large" });
    expect(
      isTerminalFileDropPayload({ paths: ["/tmp/a"], paneLeafId: "p" }),
    ).toBe(true);
    expect(isTerminalFileDropPayload({ paths: [""], paneLeafId: "p" })).toBe(
      false,
    );
    expect(isTerminalFileDropPayload({ paths: [42], paneLeafId: "p" })).toBe(
      false,
    );
  });
});

describe("terminal native file-drop path paste", () => {
  it("quotes paths and separates multiple files", () => {
    expect(shellEscapeTerminalFilePath("/tmp/hello world.txt", "posix")).toBe(
      "'/tmp/hello world.txt'",
    );
    expect(shellEscapeTerminalFilePath("/tmp/it's.txt", "posix")).toBe(
      "'/tmp/it'\\''s.txt'",
    );
    expect(formatTerminalFileDropPaths(["/tmp/a", "/tmp/b c"], "posix")).toBe(
      "/tmp/a '/tmp/b c' ",
    );
    expect(formatTerminalFileDropPaths(["C:\\work\\a b.txt"], "windows")).toBe(
      '"C:\\work\\a b.txt" ',
    );
  });

  it("resolves Explorer-relative paths without allowing traversal", () => {
    expect(resolveWorkspaceFileDropPath("/workspace", "src/index.ts")).toBe(
      "/workspace/src/index.ts",
    );
    expect(resolveWorkspaceFileDropPath("C:\\workspace", "src\\index.ts")).toBe(
      "C:\\workspace\\src\\index.ts",
    );
    expect(resolveWorkspaceFileDropPath("/workspace", "../secret")).toBeNull();
    expect(resolveWorkspaceFileDropPath("/workspace", "/absolute")).toBeNull();
  });

  it("selects the local shell from Electron's platform identity", () => {
    expect(terminalFileDropShellForPlatform("win32")).toBe("windows");
    expect(terminalFileDropShellForPlatform("darwin")).toBe("posix");
    expect(terminalFileDropShellForUserAgent("Mozilla Windows")).toBe(
      "windows",
    );
    expect(terminalFileDropShellForUserAgent("Mozilla Macintosh")).toBe(
      "posix",
    );
  });

  it("routes internal Explorer drops to the pane that received them", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const pasteFilePaths = vi.fn(async () => undefined);
    const focus = vi.fn();
    const report = vi.fn();
    const dispose = registerTerminalInternalFileDropListeners({
      container,
      workspaceId: "workspace-1",
      resolveWorkspacePath: async () => "/workspace",
      pasteFilePaths,
      focus,
      report,
    });
    const data = new Map([[WORKSPACE_FILE_PATH_MIME, "src/index.ts"]]);
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: {
        types: [WORKSPACE_FILE_PATH_MIME],
        getData: (type: string) => data.get(type) ?? "",
      },
    });

    container.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(hasWorkspaceFileDragType([WORKSPACE_FILE_PATH_MIME])).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(pasteFilePaths).toHaveBeenCalledWith(["/workspace/src/index.ts"]);
    expect(report).not.toHaveBeenCalled();
    dispose();
    container.remove();
  });

  it("sends formatted paths through the existing terminal paste executor", async () => {
    const pasted: string[] = [];
    const paste = createTerminalPanePaste({
      writePty: vi.fn(async () => true),
      isTargetCurrent: () => true,
      sessionIdentity: { sessionId: "pane-1", incarnation: "inc-1" },
      report: vi.fn(),
    });
    paste.bindTerminal({
      modes: { bracketedPasteMode: false },
      options: { ignoreBracketedPasteMode: false },
      input: vi.fn(),
      paste: (text) => pasted.push(text),
    });

    await paste.pasteFilePaths(["/tmp/a file.txt"]);

    expect(pasted).toEqual(["'/tmp/a file.txt' "]);
  });
});
