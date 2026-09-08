// @vitest-environment jsdom
// Tab strip interactions: pinned-first render order, Ctrl/Cmd+arrow keyboard
// reorder, plain-arrow navigation preserved, context menu entries in source
// order, and rename commit.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Tooltip } from "radix-ui";
import type { Session } from "../../../../shared/session-contract";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import type { EditorTabState } from "./editor-tab";
import { TabBar } from "./TabBar";

beforeEach(installRadixJsdomStubs);
afterEach(cleanup);

function session(id: string): Session {
  return {
    id,
    workspaceId: "ws",
    hostId: "host",
    incarnation: "1",
    command: `cmd-${id}`,
    args: [],
    cols: 80,
    rows: 24,
    verdict: "live",
    exitCode: null,
    createdAt: "2026-09-08T00:00:00Z",
  };
}

function renderStrip(overrides: {
  sessions?: Session[];
  stripOrder?: string[];
  pinnedIds?: string[];
  customTitles?: Record<string, string>;
  editorTabs?: EditorTabState[];
  activeEditorTabId?: string | null;
  onOrderChange?: (order: string[]) => void;
  onCommitTitle?: (id: string, title: string | null) => void;
  onTogglePin?: (id: string) => void;
  onSelectEditorTab?: (id: string) => void;
  onCloseEditorTab?: (id: string) => void;
  onCopyText?: (text: string) => void;
}) {
  const onOrderChange = overrides.onOrderChange ?? (() => {});
  const onCommitTitle = overrides.onCommitTitle ?? (() => {});
  // Why: App owns the single Tooltip.Provider; the strip needs one here too.
  return render(
    <Tooltip.Provider>
    <TabBar
      sessions={overrides.sessions ?? [session("a"), session("b"), session("c")]}
      activeSessionId="a"
      browserTabs={[]}
      activeBrowserTabId={null}
      editorTabs={overrides.editorTabs ?? []}
      activeEditorTabId={overrides.activeEditorTabId ?? null}
      harnesses={[]}
      workspaceId="ws"
      hostId="host"
      newTerminalShortcut=""
      newBrowserShortcut=""
      closeDisabled={false}
      retryDisabled={false}
      createDisabled={false}
      stripOrder={overrides.stripOrder ?? []}
      pinnedIds={overrides.pinnedIds ?? []}
      customTitles={overrides.customTitles ?? {}}
      onOrderChange={onOrderChange}
      onTogglePin={overrides.onTogglePin ?? (() => {})}
      onCloseOthers={() => {}}
      onCloseToRight={() => {}}
      onCloseToLeft={() => {}}
      onCommitTitle={onCommitTitle}
      onCopyText={overrides.onCopyText ?? (() => {})}
      onSelectSession={() => {}}
      onSelectBrowserTab={() => {}}
      onSelectEditorTab={overrides.onSelectEditorTab ?? (() => {})}
      onCloseSession={() => {}}
      onCloseBrowserTab={() => {}}
      onCloseEditorTab={overrides.onCloseEditorTab ?? (() => {})}
      onRetry={() => {}}
      onCreateTerminal={() => {}}
      onLaunchHarness={() => Promise.resolve(false)}
      onNewBrowserTab={() => {}}
    />
    </Tooltip.Provider>,
  );
}

function tabIds(): string[] {
  return screen
    .getAllByRole("tab")
    .map((tab) => tab.getAttribute("data-tab-id") ?? "");
}

describe("TabBar strip order", () => {
  it("renders pinned tabs first in stored relative order", () => {
    renderStrip({ pinnedIds: ["c"] });
    expect(tabIds()).toEqual(["c", "a", "b"]);
    expect(
      screen
        .getByRole("tab", { name: /Terminal 1/ })
        .getAttribute("data-pinned"),
    ).toBe("true");
  });

  it("follows the stored order and shows custom titles", () => {
    renderStrip({
      stripOrder: ["c", "b", "a"],
      customTitles: { b: "db" },
    });
    expect(tabIds()).toEqual(["c", "b", "a"]);
    expect(screen.getByRole("tab", { name: /db/ })).not.toBeNull();
  });

  it("reorders with Ctrl+Arrow without moving selection", () => {
    const onOrderChange = vi.fn();
    renderStrip({ onOrderChange });
    const first = screen.getAllByRole("tab")[0];
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight", ctrlKey: true });
    expect(onOrderChange).toHaveBeenCalledWith(["b", "a", "c"]);
  });

  it("keeps plain-arrow roving navigation (accept-desktop contract)", () => {
    const onSelect = vi.fn();
    const { unmount } = renderStrip({});
    unmount();
    render(
      <Tooltip.Provider>
      <TabBar
        sessions={[session("a"), session("b")]}
        activeSessionId="a"
        browserTabs={[]}
        activeBrowserTabId={null}
        editorTabs={[]}
        activeEditorTabId={null}
        harnesses={[]}
        workspaceId="ws"
        hostId="host"
        newTerminalShortcut=""
        newBrowserShortcut=""
        closeDisabled={false}
        retryDisabled={false}
        createDisabled={false}
        stripOrder={[]}
        pinnedIds={[]}
        customTitles={{}}
        onOrderChange={() => {}}
        onTogglePin={() => {}}
        onCloseOthers={() => {}}
        onCloseToRight={() => {}}
        onCloseToLeft={() => {}}
        onCommitTitle={() => {}}
        onCopyText={() => {}}
        onSelectSession={onSelect}
        onSelectBrowserTab={() => {}}
        onSelectEditorTab={() => {}}
        onCloseSession={() => {}}
        onCloseBrowserTab={() => {}}
        onCloseEditorTab={() => {}}
        onRetry={() => {}}
        onCreateTerminal={() => {}}
        onLaunchHarness={() => Promise.resolve(false)}
        onNewBrowserTab={() => {}}
      />
      </Tooltip.Provider>,
    );
    const first = screen.getAllByRole("tab")[0];
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(onSelect).toHaveBeenCalledWith("b");
  });
});

describe("TabBar context menu", () => {
  it("opens with the source's entries in order", async () => {
    renderStrip({});
    const first = screen.getAllByRole("tab")[0];
    fireEvent.contextMenu(first);
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Pin Tab",
      "Close",
      "Close Others",
      "Close Tabs To The Right",
      "Close Tabs To The Left",
      "Change Title",
      "Copy Session ID",
    ]);
  });

  it("pins through the menu", async () => {
    const onTogglePin = vi.fn();
    renderStrip({ onTogglePin });
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.getAttribute("data-tab-id"))).toEqual([
      "a",
      "b",
      "c",
    ]);
    fireEvent.contextMenu(tabs[1]);
    expect(tabs[1].isConnected).toBe(true);
    const item = await screen.findByRole("menuitem", { name: "Pin Tab" });
    fireEvent.click(item);
    expect(onTogglePin).toHaveBeenCalledWith("b");
  });
});

describe("TabBar rename", () => {
  it("commits a double-click rename on Enter", async () => {
    const onCommitTitle = vi.fn();
    renderStrip({ onCommitTitle });
    const first = screen.getAllByRole("tab")[0];
    fireEvent.doubleClick(first);
    const input = (await screen.findByDisplayValue(
      "Terminal 1",
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "db" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommitTitle).toHaveBeenCalledWith("a", "db");
  });

  it("cancels the rename on Escape", async () => {
    const onCommitTitle = vi.fn();
    renderStrip({ onCommitTitle });
    fireEvent.doubleClick(screen.getAllByRole("tab")[0]);
    const input = await screen.findByDisplayValue("Terminal 1");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCommitTitle).not.toHaveBeenCalled();
  });
});

describe("TabBar default titles", () => {
  it("titles session tabs Terminal N in strip order (never the process name)", () => {
    renderStrip({});
    expect(
      screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-label")),
    ).toEqual(["Terminal 1 live", "Terminal 2 live", "Terminal 3 live"]);
    expect(screen.queryByRole("tab", { name: /cmd-a/ })).toBeNull();
  });

  it("keeps strip-position numbering after a removal", () => {
    renderStrip({ sessions: [session("a"), session("c")] });
    expect(
      screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-label")),
    ).toEqual(["Terminal 1 live", "Terminal 2 live"]);
  });

  it("prefers the committed rename over the default", () => {
    renderStrip({ customTitles: { b: "db" } });
    expect(
      screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-label")),
    ).toEqual(["Terminal 1 live", "db live", "Terminal 3 live"]);
  });
});

describe("TabBar editor tabs", () => {
  const editorTabs: EditorTabState[] = [
    { tabId: "ws::src/a.ts", workspaceId: "ws", path: "src/a.ts", dirty: false },
    { tabId: "ws::src/b.ts", workspaceId: "ws", path: "src/b.ts", dirty: true },
  ];

  it("renders one tab per open file, titled by base name, alongside sessions", () => {
    renderStrip({ editorTabs });
    expect(tabIds()).toEqual(["a", "b", "c", "ws::src/a.ts", "ws::src/b.ts"]);
    expect(screen.getByRole("tab", { name: "a.ts" })).not.toBeNull();
    expect(screen.getByRole("tab", { name: /b\.ts \(unsaved\)/ })).not.toBeNull();
  });

  it("shows the dirty indicator only for a dirty editor tab", () => {
    renderStrip({ editorTabs });
    const clean = screen.getByRole("tab", { name: "a.ts" });
    const dirty = screen.getByRole("tab", { name: /b\.ts \(unsaved\)/ });
    expect(clean.querySelector('[aria-label="Unsaved changes"]')).toBeNull();
    expect(dirty.querySelector('[aria-label="Unsaved changes"]')).not.toBeNull();
  });

  it("activating an editor tab reports its id and no session is marked active", () => {
    const onSelectEditorTab = vi.fn();
    renderStrip({ editorTabs, onSelectEditorTab });
    fireEvent.click(screen.getByRole("tab", { name: "a.ts" }));
    expect(onSelectEditorTab).toHaveBeenCalledWith("ws::src/a.ts");
  });

  it("an active editor tab clears the session's active state", () => {
    renderStrip({ editorTabs, activeEditorTabId: "ws::src/a.ts" });
    expect(
      screen.getByRole("tab", { name: /^Terminal 1/ }).getAttribute("data-active"),
    ).toBe("false");
    expect(
      screen.getByRole("tab", { name: "a.ts" }).getAttribute("data-active"),
    ).toBe("true");
  });

  it("closes an editor tab through its close button", () => {
    const onCloseEditorTab = vi.fn();
    renderStrip({ editorTabs, onCloseEditorTab });
    fireEvent.click(
      screen.getByRole("button", { name: "Close a.ts" }),
    );
    expect(onCloseEditorTab).toHaveBeenCalledWith("ws::src/a.ts");
  });

  it("copies the path through the editor tab's context menu", async () => {
    const onCopyText = vi.fn();
    renderStrip({ editorTabs, onCopyText });
    fireEvent.contextMenu(screen.getByRole("tab", { name: "a.ts" }));
    const item = await screen.findByRole("menuitem", { name: "Copy Path" });
    fireEvent.click(item);
    expect(onCopyText).toHaveBeenCalledWith("src/a.ts");
  });
});
