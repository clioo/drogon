// @vitest-environment jsdom
// Tab create menu parity (#135): fork order (New Terminal, New Browser Tab,
// Mentu, harness entries with icons, Agent settings…), fork copy ("Mentu"),
// search combobox filtering, and chord hints. #167: the static-row chords
// resolve through the shared keybinding table (never a host constant) and
// stay exposed to assistive tech like the fork's DropdownMenuShortcut.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Tooltip } from "radix-ui";
import type { Harness } from "../../../../shared/session-contract";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import {
  matchesTabCreateQuery,
  TAB_CREATE_MENU_NOT_PORTED,
  TAB_CREATE_SEARCH_PLACEHOLDER,
  TabCreateMenu,
} from "./TabCreateMenu";
import { tabCreateMenuChord } from "./TabCreateMenuChords";

beforeEach(installRadixJsdomStubs);
afterEach(cleanup);

function harness(
  harnessId: Harness["harnessId"],
  displayName: string,
): Harness {
  return { harnessId, displayName, availability: "available", executable: "/usr/bin/x" };
}

const HARNESSES: Harness[] = [
  harness("claude", "Claude"),
  harness("pi", "Pi"),
  harness("opencode", "OpenCode"),
  harness("antigravity", "Antigravity"),
];

/**
 * jsdom is non-Mac, so the shared table resolves to the "other" chords
 * (Ctrl+T / Ctrl+Shift+B); darwin rendering (⌘T / ⌘⇧B) is pinned by
 * TabCreateMenuChords.test.ts. The host props mirror production: App still
 * sends the stale terminal chord and "" for the browser row, and the menu
 * must render the table values regardless (see #167).
 */
const TABLE_TERMINAL_CHORD = tabCreateMenuChord("tab.newTerminal", "other");
const TABLE_BROWSER_CHORD = tabCreateMenuChord("tab.newBrowser", "other");

function mount(overrides?: Partial<React.ComponentProps<typeof TabCreateMenu>>) {
  render(
    <Tooltip.Provider>
      <TabCreateMenu
        workspaceId="ws"
        hostId="host"
        harnesses={HARNESSES}
        disabled={false}
        newTerminalShortcut="⌘⇧N"
        newBrowserShortcut=""
        onCreateTerminal={() => {}}
        onLaunch={() => Promise.resolve(false)}
        onNewBrowserTab={() => {}}
        onOpenMentu={() => {}}
        mentuAvailable
        {...overrides}
      />
    </Tooltip.Provider>,
  );
}

function openMenu() {
  const trigger = screen.getByRole("button", { name: "New tab" });
  // Radix opens the menu on the pointer gesture, not a bare click.
  fireEvent.pointerDown(trigger, { pointerType: "mouse", button: 0 });
  fireEvent.click(trigger);
}

function menuItemNames(): string[] {
  // All menu icons are aria-hidden SVGs, so drop them first to mirror the
  // accessible name (e.g. the Antigravity letter glyph must not leak "A").
  return screen.getAllByRole("menuitem").map((item) => {
    const clone = item.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("svg").forEach((svg) => svg.remove());
    return clone.textContent ?? "";
  });
}

describe("matchesTabCreateQuery", () => {
  it("matches everything on an empty query", () => {
    expect(matchesTabCreateQuery("New Terminal", "terminal shell", "")).toBe(true);
    expect(matchesTabCreateQuery("New Terminal", "terminal shell", "   ")).toBe(true);
  });

  it("requires every token to appear in the label or keywords", () => {
    expect(matchesTabCreateQuery("New Terminal", "terminal shell", "term")).toBe(true);
    expect(matchesTabCreateQuery("New Terminal", "terminal shell", "new term")).toBe(true);
    expect(matchesTabCreateQuery("New Terminal", "terminal shell", "browser")).toBe(false);
    expect(matchesTabCreateQuery("Mentu", "mentu recipe workflow", "recipe")).toBe(true);
  });
});

describe("TabCreateMenu order and copy", () => {
  it("lists static entries, harness entries, then Agent settings in fork order", () => {
    const onOpenAgentSettings = vi.fn();
    mount({ onOpenAgentSettings, onNewMarkdown: () => {} });
    openMenu();
    expect(menuItemNames()).toEqual([
      `New Terminal${TABLE_TERMINAL_CHORD}`,
      `New Browser Tab${TABLE_BROWSER_CHORD}`,
      "Mentu",
      `New Markdown${tabCreateMenuChord("tab.newMarkdown", "other")}`,
      "Claude",
      "Pi",
      "OpenCode",
      "Antigravity",
      "Agent settings…",
    ]);
  });

  it("renders the shared-table chords even when the host passes a stale chord", () => {
    // TABLE_* already resolve through shared/keybindings; a stale host
    // value must never reach the menu (see #167).
    expect(TABLE_TERMINAL_CHORD).not.toBe("");
    expect(TABLE_TERMINAL_CHORD).not.toBe("⌘⇧N");
    mount({ newTerminalShortcut: "⌘⇧N", newBrowserShortcut: "stale" });
    openMenu();
    const names = menuItemNames();
    expect(names[0]).toBe(`New Terminal${TABLE_TERMINAL_CHORD}`);
    expect(names[1]).toBe(`New Browser Tab${TABLE_BROWSER_CHORD}`);
  });

  it("exposes the static-row chords in the accessible name like the fork", () => {
    mount();
    openMenu();
    // The fork renders chords via DropdownMenuShortcut (a plain span, no
    // aria-hidden), so the chord is part of the accessible name.
    expect(
      screen.getByRole("menuitem", { name: `New Terminal${TABLE_TERMINAL_CHORD}` }),
    ).not.toBeNull();
    expect(
      screen.getByRole("menuitem", { name: `New Browser Tab${TABLE_BROWSER_CHORD}` }),
    ).not.toBeNull();
  });

  it("uses the fork copy Mentu, never Open Mentu", () => {
    mount({ onOpenAgentSettings: () => {} });
    openMenu();
    expect(screen.getByRole("menuitem", { name: "Mentu" })).not.toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Open Mentu" })).toBeNull();
  });

  it("shows the fork search combobox with its placeholder", () => {
    mount();
    openMenu();
    const search = screen.getByRole("combobox", {
      name: TAB_CREATE_SEARCH_PLACEHOLDER,
    });
    expect(search.getAttribute("placeholder")).toBe(
      TAB_CREATE_SEARCH_PLACEHOLDER,
    );
  });

  it("renders a brand icon inside every harness entry", () => {
    mount();
    openMenu();
    for (const name of ["Claude", "Pi", "OpenCode", "Antigravity"]) {
      const item = screen.getByRole("menuitem", { name });
      expect(item.querySelector("svg")).not.toBeNull();
    }
  });

  it("resolves the browser chord from the shared table when the host passes none", () => {
    mount({ harnesses: [], newBrowserShortcut: "" });
    openMenu();
    // jsdom UA is non-Mac: "Ctrl+Shift+B" (darwin renders "⌘⇧B").
    expect(
      screen.getByRole("menuitem", { name: `New Browser Tab${TABLE_BROWSER_CHORD}` })
        .textContent,
    ).toContain("Ctrl+Shift+B");
  });

  it("filters entries by the search query and reports no matches", () => {
    mount();
    openMenu();
    fireEvent.change(
      screen.getByRole("combobox", { name: TAB_CREATE_SEARCH_PLACEHOLDER }),
      { target: { value: "pi" } },
    );
    expect(menuItemNames()).toEqual(["Pi"]);
    fireEvent.change(
      screen.getByRole("combobox", { name: TAB_CREATE_SEARCH_PLACEHOLDER }),
      { target: { value: "zzz-no-such-entry" } },
    );
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
    expect(screen.getByRole("status").textContent).toContain(
      "No matching entries",
    );
  });

  it("omits Agent settings without a handler and calls through with one", () => {
    mount();
    openMenu();
    expect(
      screen.queryByRole("menuitem", { name: "Agent settings…" }),
    ).toBeNull();

    cleanup();
    const onOpenAgentSettings = vi.fn();
    mount({ onOpenAgentSettings });
    openMenu();
    const item = screen.getByRole("menuitem", { name: "Agent settings…" });
    fireEvent.pointerDown(item, { pointerType: "mouse", button: 0 });
    fireEvent.pointerUp(item, { pointerType: "mouse", button: 0 });
    fireEvent.click(item);
    expect(onOpenAgentSettings).toHaveBeenCalledTimes(1);
  });

  it("documents the entries intentionally not ported from the fork", () => {
    for (const entry of [
      "Open Markdown...",
      "Codex",
      "Gemini",
      "Kimi",
      "Hermes",
      "Claude Agent Teams",
    ]) {
      expect(TAB_CREATE_MENU_NOT_PORTED).toContain(entry);
    }
    // #197 ports New Markdown out of the not-ported list.
    expect(TAB_CREATE_MENU_NOT_PORTED).not.toContain("New Markdown");
  });

  it("shows New Markdown with its table chord and calls through (#197)", () => {
    const onNewMarkdown = vi.fn();
    mount({ onNewMarkdown });
    openMenu();
    const item = screen.getByRole("menuitem", {
      name: `New Markdown${tabCreateMenuChord("tab.newMarkdown", "other")}`,
    });
    expect(item.textContent).toContain("Ctrl+Shift+M");
    fireEvent.pointerDown(item, { pointerType: "mouse", button: 0 });
    fireEvent.pointerUp(item, { pointerType: "mouse", button: 0 });
    fireEvent.click(item);
    expect(onNewMarkdown).toHaveBeenCalledTimes(1);
  });

  it("omits New Markdown without a handler and matches it by search", () => {
    mount();
    openMenu();
    expect(screen.queryByRole("menuitem", { name: /New Markdown/ })).toBeNull();

    cleanup();
    mount({ onNewMarkdown: () => {} });
    openMenu();
    fireEvent.change(
      screen.getByRole("combobox", { name: TAB_CREATE_SEARCH_PLACEHOLDER }),
      { target: { value: "untitled" } },
    );
    expect(menuItemNames()).toEqual([
      `New Markdown${tabCreateMenuChord("tab.newMarkdown", "other")}`,
    ]);
  });
});

describe("TabCreateMenu immediate harness launch (#231)", () => {
  beforeEach(() => window.localStorage.clear());

  function clickMenuItem(name: string | RegExp) {
    const item = screen.getByRole("menuitem", { name });
    fireEvent.pointerDown(item, { pointerType: "mouse", button: 0 });
    fireEvent.pointerUp(item, { pointerType: "mouse", button: 0 });
    fireEvent.click(item);
  }

  it("launches a harness row at once with the stored defaults, no dialog", async () => {
    let launched: unknown;
    const onLaunch = vi.fn(async (input: unknown) => {
      launched = input;
      return true;
    });
    mount({
      onLaunch,
      launchDefaults: {
        pi: {
          model: "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4",
          effort: "",
          permissionMode: "unattended",
        },
      },
    });
    openMenu();
    clickMenuItem("Pi");
    await waitFor(() => expect(onLaunch).toHaveBeenCalledTimes(1));
    expect(launched).toMatchObject({
      workspaceId: "ws",
      harnessId: "pi",
      provider: "dgx-spark",
      model: "qwen3.8-flash-next-nvidia-nvfp4",
      permissionMode: "unattended",
    });
    expect(typeof (launched as { requestId: unknown }).requestId).toBe(
      "string",
    );
    // No per-launch dialog may appear: the fork launches from the row.
    expect(document.querySelector(".harness-launch-form")).toBeNull();
    expect(screen.queryByRole("button", { name: "Launch" })).toBeNull();
    expect(
      screen.queryByRole("textbox", { name: /^Model\b/ }),
    ).toBeNull();
  });

  it("falls back to the fork defaults: Claude Code launches yolo/unattended", async () => {
    let launched: unknown;
    const onLaunch = vi.fn(async (input: unknown) => {
      launched = input;
      return true;
    });
    mount({ onLaunch, launchDefaults: {} });
    openMenu();
    clickMenuItem("Claude");
    await waitFor(() => expect(onLaunch).toHaveBeenCalledTimes(1));
    expect(launched).toMatchObject({
      workspaceId: "ws",
      harnessId: "claude",
      permissionMode: "unattended",
    });
  });

  it("keeps permission prompts for Pi by fork default until stored otherwise", async () => {
    let launched: unknown;
    const onLaunch = vi.fn(async (input: unknown) => {
      launched = input;
      return true;
    });
    mount({ onLaunch, launchDefaults: {} });
    openMenu();
    clickMenuItem("Pi");
    await waitFor(() => expect(onLaunch).toHaveBeenCalledTimes(1));
    expect(launched).toMatchObject({
      harnessId: "pi",
      permissionMode: "inherit",
    });
  });

  it("reuses the admission id for an unchanged retry instead of spawning twice", async () => {
    const seen: string[] = [];
    const onLaunch = vi.fn(async (input: { requestId: string }) => {
      seen.push(input.requestId);
      return true;
    });
    mount({ onLaunch });
    openMenu();
    clickMenuItem("Pi");
    await waitFor(() => expect(onLaunch).toHaveBeenCalledTimes(1));
    openMenu();
    clickMenuItem("Pi");
    await waitFor(() => expect(onLaunch).toHaveBeenCalledTimes(2));
    expect(seen[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(seen[1]).toBe(seen[0]);
  });

  it("never launches an unavailable harness row, even by keyboard", () => {
    const onLaunch = vi.fn(() => Promise.resolve(true));
    mount({
      onLaunch,
      harnesses: [{ ...harness("pi", "Pi"), availability: "missing" }],
      mentuAvailable: false,
    });
    openMenu();
    // The row names the missing binary instead of offering a launch.
    expect(menuItemNames()).toContain("Pinot found on this host");
    fireEvent.change(
      screen.getByRole("combobox", { name: TAB_CREATE_SEARCH_PLACEHOLDER }),
      { target: { value: "pi" } },
    );
    expect(menuItemNames()).toEqual(["Pinot found on this host"]);
    fireEvent.keyDown(
      screen.getByRole("combobox", { name: TAB_CREATE_SEARCH_PLACEHOLDER }),
      { key: "Enter" },
    );
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it("keeps the interrupted-launch retry row for an unconfirmed attempt", async () => {
    const onLaunch = vi.fn(() => Promise.resolve(false));
    mount({ onLaunch });
    openMenu();
    clickMenuItem("Pi");
    await waitFor(() => expect(onLaunch).toHaveBeenCalledTimes(1));
    // An unconfirmed attempt stays recoverable: reopening the menu offers
    // the exact retry instead of losing the intent.
    openMenu();
    const retry = screen.getByRole("menuitem", {
      name: "Retry interrupted Pi launch",
    });
    expect(retry).not.toBeNull();
    fireEvent.pointerDown(retry, { pointerType: "mouse", button: 0 });
    fireEvent.pointerUp(retry, { pointerType: "mouse", button: 0 });
    fireEvent.click(retry);
    await waitFor(() => expect(onLaunch).toHaveBeenCalledTimes(2));
  });
});
