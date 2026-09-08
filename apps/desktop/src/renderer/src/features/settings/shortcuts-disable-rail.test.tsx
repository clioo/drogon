// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Interaction tests for the Shortcuts section's Disable control (#244) and
// status filter rail (#245), driven against the real persisted keybinding
// envelope in jsdom localStorage.
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ShortcutsSection } from "./shortcuts-section";
import { KEYBINDING_OVERRIDES_STORAGE_KEY } from "../../../../shared/keybindings/overrides";

function seedOverrides(overrides: Record<string, string[]>): void {
  window.localStorage.setItem(
    KEYBINDING_OVERRIDES_STORAGE_KEY,
    JSON.stringify({ version: 1, overrides }),
  );
}

function envelope(): Record<string, string[]> {
  const raw = window.localStorage.getItem(KEYBINDING_OVERRIDES_STORAGE_KEY);
  if (!raw) return {};
  return (JSON.parse(raw) as { overrides: Record<string, string[]> })
    .overrides;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("Shortcuts status filter rail (#245)", () => {
  test("renders the fork's rail: search, match count, status nav", () => {
    render(<ShortcutsSection />);
    expect(screen.getByText("Find shortcuts")).toBeDefined();
    const box = screen.getByPlaceholderText(
      "Search command or keys",
    ) as HTMLInputElement;
    expect(box.getAttribute("id")).toBe("shortcut-filter-search");
    expect(
      screen.getByRole("navigation", { name: "Shortcut status filters" }),
    ).toBeDefined();
    expect(screen.getByText("Status")).toBeDefined();
    // Label and count spans flatten into one accessible name; jsdom has no
    // inter-element space, so allow an optional one.
    expect(screen.getByRole("button", { name: /^All\s*\d+$/ })).toBeDefined();
    expect(
      screen.getByRole("button", { name: /^Modified\s*\d+$/ }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: /^Unassigned\s*\d+$/ }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: /^Conflicts\s*\d+$/ }),
    ).toBeDefined();
  });

  test("counts are computed over the search-matched base", () => {
    seedOverrides({ "worktree.quickOpen": ["Mod+Shift+O"] });
    render(<ShortcutsSection />);
    // One modified row (Go to File); conflicts stay at the conflict-free
    // default-table count. Unassigned depends on the catalog's unassigned
    // defaults, so only its shape is asserted here.
    expect(screen.getByRole("button", { name: /^Modified\s*1$/ })).toBeDefined();
    expect(
      screen.getByRole("button", { name: /^Unassigned\s*\d+$/ }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: /^Conflicts\s*0$/ })).toBeDefined();
  });

  test("the status filter narrows the list and the match count follows", () => {
    seedOverrides({ "worktree.quickOpen": ["Mod+Shift+O"] });
    render(<ShortcutsSection />);
    fireEvent.click(
      screen.getByRole("button", { name: /^Modified\s*1$/ }),
    );
    // Only the modified row stays visible; the count is 1 of the catalog.
    expect(screen.getByText("Go to File")).toBeDefined();
    expect(screen.queryByText("Open Settings")).toBeNull();
    expect(screen.getByText(/^1\/\d+$/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /^All\s*\d+$/ }));
    expect(screen.getByText("Open Settings")).toBeDefined();
  });

  test("the rail search filters rows and reports the match count", () => {
    render(<ShortcutsSection />);
    const box = screen.getByPlaceholderText("Search command or keys");
    fireEvent.change(box, { target: { value: "Open Settings" } });
    expect(screen.queryByText("Go to File")).toBeNull();
    expect(screen.getByText("Open Settings")).toBeDefined();
    fireEvent.change(box, { target: { value: "zzz-no-match" } });
    expect(screen.getByText("No shortcuts match those filters.")).toBeDefined();
  });
});

describe("per-row Disable control (#244)", () => {
  test("Disable persists the empty override and offers Enable", () => {
    seedOverrides({ "worktree.quickOpen": ["Mod+Shift+O"] });
    render(<ShortcutsSection />);
    fireEvent.click(screen.getByRole("button", { name: "Disable Go to File" }));
    // The override list is now empty (kept, not removed) — reversible.
    expect(envelope()["worktree.quickOpen"]).toEqual([]);
    expect(screen.getByText("Disabled")).toBeDefined();
    const enable = screen.getByRole("button", { name: "Enable Go to File" });
    expect(enable).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Disable Go to File" }),
    ).toBeNull();
  });

  test("Enable restores the remembered chords in one click", () => {
    seedOverrides({ "worktree.quickOpen": ["Mod+Shift+O"] });
    render(<ShortcutsSection />);
    fireEvent.click(screen.getByRole("button", { name: "Disable Go to File" }));
    fireEvent.click(screen.getByRole("button", { name: "Enable Go to File" }));
    expect(envelope()["worktree.quickOpen"]).toEqual(["Mod+Shift+O"]);
    expect(
      screen.getByRole("button", {
        name: "Change shortcut for Go to File, currently Ctrl+Shift+O.",
      }),
    ).toBeDefined();
    expect(screen.queryByText("Disabled")).toBeNull();
  });

  test("a default chord disabled then enabled drops the override", () => {
    render(<ShortcutsSection />);
    fireEvent.click(screen.getByRole("button", { name: "Disable Toggle Sidebar" }));
    expect(envelope()["sidebar.left.toggle"]).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Enable Toggle Sidebar" }));
    // The restored list matches the default, so the override is dropped.
    expect(envelope()["sidebar.left.toggle"]).toBeUndefined();
    expect(
      screen.getByRole("button", {
        name: "Change shortcut for Toggle Sidebar, currently Ctrl+B.",
      }),
    ).toBeDefined();
  });

  test("a disabled row keeps its Reset affordance and loses Disable", () => {
    seedOverrides({ "worktree.quickOpen": ["Mod+Shift+O"] });
    render(<ShortcutsSection />);
    fireEvent.click(screen.getByRole("button", { name: "Disable Go to File" }));
    expect(
      screen.getByRole("button", { name: "Reset Go to File to default" }),
    ).toBeDefined();
  });
});
