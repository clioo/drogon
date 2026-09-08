// MIT Copyright (c) 2026 Lovecast Inc.
// Regression table copied from the read-only fork definitions: every non-empty
// source default must remain present with the same platform modifiers.
import { describe, expect, test } from "vitest";
import { KEYBINDING_DEFINITIONS } from "./definitions";

const FORK_DEFAULTS = {
  "worktree.quickOpen": {
    darwin: ["Mod+P"],
    linux: ["Mod+P"],
    win32: ["Mod+P"],
  },
  "app.settings": {
    darwin: ["Mod+Comma"],
    linux: ["Mod+Comma"],
    win32: ["Mod+Comma"],
  },
  "app.forceReload": {
    darwin: ["Mod+Shift+R"],
    linux: ["Mod+Shift+R"],
    win32: ["Mod+Shift+R"],
  },
  "worktree.palette": {
    darwin: ["Mod+J"],
    linux: ["Mod+Shift+J"],
    win32: ["Mod+Shift+J"],
  },
  "worktree.navigateUp": {
    darwin: ["Mod+Shift+ArrowUp"],
    linux: ["Mod+Shift+ArrowUp"],
    win32: ["Mod+Shift+ArrowUp"],
  },
  "worktree.navigateDown": {
    darwin: ["Mod+Shift+ArrowDown"],
    linux: ["Mod+Shift+ArrowDown"],
    win32: ["Mod+Shift+ArrowDown"],
  },
  "workspace.create": {
    darwin: ["Mod+N", "Mod+Shift+N"],
    linux: ["Mod+N", "Mod+Shift+N"],
    win32: ["Mod+N", "Mod+Shift+N"],
  },
  "workspace.rename": {
    darwin: ["Mod+Alt+R"],
    linux: [],
    win32: [],
  },
  "workspace.delete": {
    darwin: ["Mod+Shift+Backspace"],
    linux: ["Mod+Shift+Backspace"],
    win32: ["Mod+Shift+Backspace"],
  },
  "workspace.selectByIndex": {
    darwin: ["Mod+1"],
    linux: ["Mod+1"],
    win32: ["Mod+1"],
  },
  "voice.dictation": {
    darwin: ["Mod+E"],
    linux: ["Mod+E"],
    win32: ["Mod+E"],
  },
  "sidebar.left.toggle": {
    darwin: ["Mod+B"],
    linux: ["Mod+B"],
    win32: ["Mod+B"],
  },
  "sidebar.right.toggle": {
    darwin: ["Mod+L"],
    linux: ["Mod+L"],
    win32: ["Mod+L"],
  },
  "sidebar.explorer.toggle": {
    darwin: ["Mod+Shift+E"],
    linux: ["Mod+Shift+E"],
    win32: ["Mod+Shift+E"],
  },
  "sidebar.search.toggle": {
    darwin: ["Mod+Shift+F"],
    linux: ["Mod+Shift+F"],
    win32: ["Mod+Shift+F"],
  },
  "sidebar.sourceControl.toggle": {
    darwin: ["Mod+Shift+G"],
    linux: ["Mod+Shift+G"],
    win32: ["Mod+Shift+G"],
  },
  "sidebar.ports.toggle": {
    darwin: ["Mod+Shift+I"],
    linux: [],
    win32: [],
  },
  "sidebar.focusWorktreeList": {
    darwin: ["Mod+Shift+0"],
    linux: ["Mod+Shift+0"],
    win32: ["Mod+Shift+0"],
  },
  "floatingTerminal.toggle": {
    darwin: ["Mod+Alt+A"],
    linux: ["Mod+Alt+A"],
    win32: ["Mod+Alt+A"],
  },
  "floatingWorkspace.maximize": {
    darwin: ["Mod+Alt+Shift+A"],
    linux: [],
    win32: [],
  },
  "zoom.in": {
    darwin: ["Mod+Equal", "Mod+Shift+Plus", "Mod+NumpadAdd"],
    linux: ["Mod+Equal", "Mod+Shift+Plus", "Mod+NumpadAdd"],
    win32: ["Mod+Equal", "Mod+Shift+Plus", "Mod+NumpadAdd"],
  },
  "zoom.out": {
    darwin: ["Mod+Minus", "Mod+NumpadSubtract"],
    linux: ["Mod+Minus", "Mod+NumpadSubtract"],
    win32: ["Mod+Minus", "Mod+NumpadSubtract"],
  },
  "zoom.reset": {
    darwin: ["Mod+0"],
    linux: ["Mod+0"],
    win32: ["Mod+0"],
  },
  "worktree.history.back": {
    darwin: ["Mod+Alt+ArrowLeft"],
    linux: ["Mod+Alt+ArrowLeft"],
    win32: ["Mod+Alt+ArrowLeft"],
  },
  "worktree.history.forward": {
    darwin: ["Mod+Alt+ArrowRight"],
    linux: ["Mod+Alt+ArrowRight"],
    win32: ["Mod+Alt+ArrowRight"],
  },
  "tab.newTerminal": {
    darwin: ["Mod+T"],
    linux: ["Mod+T"],
    win32: ["Mod+T"],
  },
  "tab.newAgent": {
    darwin: ["Mod+Alt+T"],
    linux: [],
    win32: [],
  },
  "tab.newBrowser": {
    darwin: ["Mod+Shift+B"],
    linux: ["Mod+Shift+B"],
    win32: ["Mod+Shift+B"],
  },
  "tab.newSimulator": {
    darwin: ["Mod+Alt+Shift+E"],
    linux: [],
    win32: [],
  },
  "tab.newMarkdown": {
    darwin: ["Mod+Shift+M"],
    linux: ["Mod+Shift+M"],
    win32: ["Mod+Shift+M"],
  },
  "tab.openMarkdown": {
    darwin: ["Mod+Shift+O"],
    linux: ["Mod+Shift+O"],
    win32: ["Mod+Shift+O"],
  },
  "tab.close": {
    darwin: ["Mod+W"],
    linux: ["Mod+W"],
    win32: ["Mod+W"],
  },
  "tab.closeAll": {
    darwin: ["Mod+Alt+W"],
    linux: ["Mod+Alt+W"],
    win32: ["Mod+Alt+W"],
  },
  "tab.rename": {
    darwin: ["Mod+R"],
    linux: [],
    win32: [],
  },
  "tab.reopenClosed": {
    darwin: ["Mod+Shift+T"],
    linux: ["Mod+Shift+T"],
    win32: ["Mod+Shift+T"],
  },
  "tab.nextSameType": {
    darwin: ["Mod+Alt+BracketRight"],
    linux: ["Mod+Alt+BracketRight"],
    win32: ["Mod+Alt+BracketRight"],
  },
  "tab.previousSameType": {
    darwin: ["Mod+Alt+BracketLeft"],
    linux: ["Mod+Alt+BracketLeft"],
    win32: ["Mod+Alt+BracketLeft"],
  },
  "tab.nextAllTypes": {
    darwin: ["Mod+Shift+BracketRight"],
    linux: ["Mod+Shift+BracketRight"],
    win32: ["Mod+Shift+BracketRight"],
  },
  "tab.previousAllTypes": {
    darwin: ["Mod+Shift+BracketLeft"],
    linux: ["Mod+Shift+BracketLeft"],
    win32: ["Mod+Shift+BracketLeft"],
  },
  "tab.previousRecent": {
    darwin: ["Ctrl+Tab"],
    linux: ["Ctrl+Tab"],
    win32: ["Ctrl+Tab"],
  },
  "tab.nextTerminal": {
    darwin: ["Ctrl+PageDown"],
    linux: ["Ctrl+PageDown"],
    win32: ["Ctrl+PageDown"],
  },
  "tab.previousTerminal": {
    darwin: ["Ctrl+PageUp"],
    linux: ["Ctrl+PageUp"],
    win32: ["Ctrl+PageUp"],
  },
  "tab.selectByIndex": {
    darwin: ["Ctrl+1"],
    linux: ["Alt+1"],
    win32: ["Alt+1"],
  },
  "browser.find": {
    darwin: ["Mod+F"],
    linux: ["Mod+F"],
    win32: ["Mod+F"],
  },
  "browser.back": {
    darwin: ["Mod+BracketLeft"],
    linux: ["Alt+ArrowLeft"],
    win32: ["Alt+ArrowLeft"],
  },
  "browser.forward": {
    darwin: ["Mod+BracketRight"],
    linux: ["Alt+ArrowRight"],
    win32: ["Alt+ArrowRight"],
  },
  "browser.reload": {
    darwin: ["Mod+R"],
    linux: ["Mod+R"],
    win32: ["Mod+R"],
  },
  "browser.hardReload": {
    darwin: ["Mod+Shift+R"],
    linux: ["Mod+Shift+R"],
    win32: ["Mod+Shift+R"],
  },
  "browser.focusAddressBar": {
    darwin: ["Mod+L"],
    linux: ["Mod+L"],
    win32: ["Mod+L"],
  },
  "browser.grabElement": {
    darwin: ["Mod+C"],
    linux: ["Mod+C"],
    win32: ["Mod+C"],
  },
  "editor.find": {
    darwin: ["Mod+F"],
    linux: ["Mod+F"],
    win32: ["Mod+F"],
  },
  "editor.replace": {
    darwin: ["Mod+Alt+F"],
    linux: ["Mod+H"],
    win32: ["Mod+H"],
  },
  "editor.save": {
    darwin: ["Mod+S"],
    linux: ["Mod+S"],
    win32: ["Mod+S"],
  },
  "editor.markdownPreview": {
    darwin: ["Mod+Shift+V"],
    linux: ["Mod+Shift+V"],
    win32: ["Mod+Shift+V"],
  },
  "editor.toggleWordWrap": {
    darwin: ["Alt+Z"],
    linux: ["Alt+Z"],
    win32: ["Alt+Z"],
  },
  "editor.copyContext": {
    darwin: ["Mod+Alt+C"],
    linux: ["Mod+Alt+C"],
    win32: ["Mod+Alt+C"],
  },
  "editor.previousChange": {
    darwin: ["Shift+F7"],
    linux: ["Shift+F7"],
    win32: ["Shift+F7"],
  },
  "editor.nextChange": {
    darwin: ["F7"],
    linux: ["F7"],
    win32: ["F7"],
  },
  "editor.addReviewNote": {
    darwin: ["Mod+Shift+A"],
    linux: ["Mod+Shift+A"],
    win32: ["Mod+Shift+A"],
  },
  "fileExplorer.undo": {
    darwin: ["Mod+Z"],
    linux: ["Mod+Z"],
    win32: ["Mod+Z"],
  },
  "fileExplorer.redo": {
    darwin: ["Mod+Shift+Z"],
    linux: ["Mod+Shift+Z", "Ctrl+Y"],
    win32: ["Mod+Shift+Z", "Ctrl+Y"],
  },
  "fileExplorer.copyPath": {
    darwin: ["Mod+Alt+C"],
    linux: ["Alt+Shift+C"],
    win32: ["Alt+Shift+C"],
  },
  "fileExplorer.copyRelativePath": {
    darwin: ["Mod+Alt+Shift+C"],
    linux: ["Mod+Alt+Shift+C"],
    win32: ["Mod+Alt+Shift+C"],
  },
  "fileExplorer.delete": {
    darwin: ["Mod+Backspace", "Delete"],
    linux: ["Delete"],
    win32: ["Delete"],
  },
  "settings.search": {
    darwin: ["Mod+F"],
    linux: ["Mod+F"],
    win32: ["Mod+F"],
  },
  "terminal.copySelection": {
    darwin: ["Mod+C"],
    linux: ["Ctrl+Shift+C", "Ctrl+C"],
    win32: ["Ctrl+Shift+C", "Ctrl+C"],
  },
  "terminal.selectAll": {
    darwin: ["Mod+A"],
    linux: ["Ctrl+Shift+A"],
    win32: ["Ctrl+Shift+A"],
  },
  "terminal.paste": {
    darwin: ["Mod+V"],
    linux: ["Ctrl+V", "Ctrl+Shift+V", "Shift+Insert"],
    win32: ["Ctrl+V", "Ctrl+Shift+V", "Shift+Insert"],
  },
  "terminal.search": {
    darwin: ["Mod+F"],
    linux: ["Mod+F"],
    win32: ["Mod+F"],
  },
  "terminal.clear": {
    darwin: ["Mod+K"],
    linux: ["Mod+K"],
    win32: ["Mod+K"],
  },
  "terminal.focusNextPane": {
    darwin: ["Mod+BracketRight"],
    linux: ["Mod+BracketRight"],
    win32: ["Mod+BracketRight"],
  },
  "terminal.focusPreviousPane": {
    darwin: ["Mod+BracketLeft"],
    linux: ["Mod+BracketLeft"],
    win32: ["Mod+BracketLeft"],
  },
  "terminal.expandPane": {
    darwin: ["Mod+Shift+Enter"],
    linux: ["Mod+Shift+Enter"],
    win32: ["Mod+Shift+Enter"],
  },
  "terminal.closePane": {
    darwin: ["Mod+W"],
    linux: ["Mod+W"],
    win32: ["Mod+W"],
  },
  "terminal.splitRight": {
    darwin: ["Mod+D"],
    linux: ["Mod+Shift+D"],
    win32: ["Mod+Shift+D"],
  },
  "terminal.splitDown": {
    darwin: ["Mod+Shift+D"],
    linux: ["Alt+Shift+D"],
    win32: ["Alt+Shift+D"],
  },
} as const;

const FORK_STATIC_IDS = [
  "worktree.quickOpen",
  "app.settings",
  "app.forceReload",
  "worktree.palette",
  "worktree.navigateUp",
  "worktree.navigateDown",
  "workspace.create",
  "workspace.rename",
  "workspace.delete",
  "workspace.openBoard",
  "dashboard.toggle",
  "workspace.selectByIndex",
  "voice.dictation",
  "view.tasks",
  "sidebar.left.toggle",
  "sidebar.right.toggle",
  "sidebar.explorer.toggle",
  "sidebar.search.toggle",
  "sidebar.sourceControl.toggle",
  "sidebar.checks.toggle",
  "sidebar.ports.toggle",
  "sidebar.sleepingWorkspaces.toggle",
  "sidebar.focusWorktreeList",
  "floatingTerminal.toggle",
  "floatingWorkspace.maximize",
  "floatingWorkspace.minimize",
  "zoom.in",
  "zoom.out",
  "zoom.reset",
  "worktree.history.back",
  "worktree.history.forward",
  "tab.newTerminal",
  "tab.newAgent",
  "tab.newBrowser",
  "tab.newSimulator",
  "tab.newMarkdown",
  "tab.openMarkdown",
  "tab.close",
  "tab.closeAll",
  "tab.rename",
  "tab.reopenClosed",
  "tab.nextSameType",
  "tab.previousSameType",
  "tab.nextAllTypes",
  "tab.previousAllTypes",
  "tab.previousRecent",
  "tab.nextTerminal",
  "tab.previousTerminal",
  "tab.selectByIndex",
  "tab.openQuickCommandsMenu",
  "browser.find",
  "browser.back",
  "browser.forward",
  "browser.reload",
  "browser.hardReload",
  "browser.focusAddressBar",
  "browser.grabElement",
  "editor.find",
  "editor.replace",
  "editor.save",
  "editor.markdownPreview",
  "editor.toggleWordWrap",
  "editor.copyContext",
  "editor.previousChange",
  "editor.nextChange",
  "editor.addReviewNote",
  "sourceControl.sendReviewNotes",
  "fileExplorer.undo",
  "fileExplorer.redo",
  "fileExplorer.copyPath",
  "fileExplorer.copyRelativePath",
  "fileExplorer.delete",
  "settings.search",
  "terminal.copySelection",
  "terminal.selectAll",
  "terminal.paste",
  "terminal.search",
  "terminal.clear",
  "terminal.focusNextPane",
  "terminal.focusPreviousPane",
  "terminal.equalizePaneSizes",
  "terminal.expandPane",
  "terminal.setTitle",
  "terminal.clearPaneTitle",
  "terminal.closePane",
  "terminal.splitRight",
  "terminal.splitDown",
  "terminal.switchInputSource",
] as const;

describe("fork default keybinding parity", () => {
  test("every non-empty fork default is present verbatim", () => {
    const byId = new Map(
      KEYBINDING_DEFINITIONS.map((definition) => [definition.id, definition]),
    );
    for (const [id, expected] of Object.entries(FORK_DEFAULTS)) {
      const definition = byId.get(id);
      expect(definition, id).toBeDefined();
      expect(definition?.defaultBindings, id).toEqual(expected);
    }
  });

  test("the static source rows keep order and all registered ids", () => {
    const ids = KEYBINDING_DEFINITIONS.map((definition) => definition.id);
    expect(ids.slice(0, FORK_STATIC_IDS.length)).toEqual([...FORK_STATIC_IDS]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(124);
  });
});
