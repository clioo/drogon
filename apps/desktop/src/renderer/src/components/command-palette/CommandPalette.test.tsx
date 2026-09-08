// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Issue #257: the host owns the worktree.palette chord (⌘J on darwin,
// Ctrl+Shift+J elsewhere — the fork's exact defaults) and the chord opens
// the source's jump palette (workspaces/sessions/tabs, commands mode), not
// a Drogon-only command list. jsdom resolves the table's non-darwin
// platform, so the dispatch carries Ctrl+Shift+J.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FileBridge } from "../../../../shared/file-contract";
import { installRadixJsdomStubs } from "../ui/radix-jsdom-stubs";
import { CommandPaletteHost } from "./CommandPalette";

beforeEach(installRadixJsdomStubs);
afterEach(cleanup);

function renderHost() {
  return render(
    <CommandPaletteHost
      fileBridge={{} as FileBridge}
      hostId="host"
      workspaceId="ws-1"
      workspaces={[]}
      sessions={[]}
      activeSessionId=""
      editorTabs={[]}
      activeEditorTabId={null}
      projectGroups={[]}
      browserTabs={[]}
      activeBrowserTabId={null}
      filesAvailable={false}
      botsAvailable={false}
      changesAvailable={false}
      harnessAvailable={false}
      worktreesAvailable={false}
      canCreateWorktree={false}
      onNewWorktree={() => {}}
      theme="dark"
      connected={true}
      busy={false}
      onNewTerminal={() => {}}
      onNewBrowserTab={() => {}}
      onSelectWorkspace={() => {}}
      onSelectSession={() => {}}
      onSelectEditorTab={() => {}}
      onSelectBrowserTab={() => {}}
      onOpenFiles={() => {}}
      onOpenBots={() => {}}
      onToggleRightSidebar={() => {}}
      onToggleSidebar={() => {}}
      onShowExplorer={() => {}}
      onShowSourceControl={() => {}}
      onToggleInspector={() => {}}
      onOpenSettings={() => {}}
      onSetTheme={() => {}}
      onAddWorkspace={() => {}}
      onAddProject={() => {}}
      onOpenFile={() => {}}
    />,
  );
}

describe("CommandPaletteHost worktree.palette chord", () => {
  test("the palette chord opens the jump palette combobox, and toggles closed", () => {
    renderHost();
    expect(screen.queryByRole("combobox", { name: "Jump to..." })).toBeNull();
    fireEvent.keyDown(window, { key: "j", ctrlKey: true, shiftKey: true });
    expect(
      screen.getByRole("combobox", { name: "Jump to..." }),
    ).not.toBeNull();
    fireEvent.keyDown(window, { key: "j", ctrlKey: true, shiftKey: true });
    expect(screen.queryByRole("combobox", { name: "Jump to..." })).toBeNull();
  });

  test("an unbound chord (plain Meta+j off darwin) does not open it", () => {
    renderHost();
    fireEvent.keyDown(window, { key: "j", metaKey: true });
    expect(screen.queryByRole("combobox", { name: "Jump to..." })).toBeNull();
  });
});
