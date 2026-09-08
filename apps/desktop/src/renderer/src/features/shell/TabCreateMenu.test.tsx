// @vitest-environment jsdom
// Tab create menu parity (#135): fork order (New Terminal, New Browser Tab,
// Mentu, harness entries with icons, Agent settings…), fork copy ("Mentu"),
// search combobox filtering, and chord hints. #167: the static-row chords
// resolve through the shared keybinding table (never a host constant) and
// stay exposed to assistive tech like the fork's DropdownMenuShortcut.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    mount({ onOpenAgentSettings });
    openMenu();
    expect(menuItemNames()).toEqual([
      `New Terminal${TABLE_TERMINAL_CHORD}`,
      `New Browser Tab${TABLE_BROWSER_CHORD}`,
      "Mentu",
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
      "New Markdown",
      "Codex",
      "Gemini",
      "Kimi",
      "Hermes",
      "Claude Agent Teams",
    ]) {
      expect(TAB_CREATE_MENU_NOT_PORTED).toContain(entry);
    }
  });
});
