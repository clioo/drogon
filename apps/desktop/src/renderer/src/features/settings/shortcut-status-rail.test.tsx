// MIT Copyright (c) 2026 Lovecast Inc.
// Unit tests for the status rail's filter vocabulary and matchers (ported
// from ShortcutFilterRail.tsx) plus the rail's own rendered shape.
import { describe, expect, test } from "vitest";
import { renderToString } from "react-dom/server";
import {
  matchesShortcutFilter,
  matchesShortcutLocalSearch,
  SHORTCUT_FILTER_LABELS,
  ShortcutFilterRail,
  type ShortcutRowModel,
} from "./shortcut-status-rail";
import { KEYBINDING_DEFINITIONS } from "../../../../shared/keybindings/definitions";

function row(overrides: Partial<ShortcutRowModel> = {}): ShortcutRowModel {
  const definition = KEYBINDING_DEFINITIONS[0]!;
  return {
    id: definition.id,
    title: definition.title,
    group: definition.group,
    definition,
    bindings: ["Mod+P"],
    groupTitle: definition.group,
    modified: false,
    warnings: [],
    ...overrides,
  };
}

describe("matchesShortcutFilter", () => {
  const base = row();
  const modified = row({ id: "m", modified: true });
  const unassigned = row({ id: "u", bindings: [] });
  const conflict = row({ id: "c", warnings: ["Ctrl+P conflicts with X."] });
  test("all matches everything", () => {
    for (const candidate of [base, modified, unassigned, conflict])
      expect(matchesShortcutFilter(candidate, "all")).toBe(true);
  });
  test("modified matches overridden rows", () => {
    expect(matchesShortcutFilter(modified, "modified")).toBe(true);
    expect(matchesShortcutFilter(base, "modified")).toBe(false);
  });
  test("unassigned matches rows with no effective binding", () => {
    expect(matchesShortcutFilter(unassigned, "unassigned")).toBe(true);
    expect(matchesShortcutFilter(base, "unassigned")).toBe(false);
  });
  test("conflicts matches rows with warnings", () => {
    expect(matchesShortcutFilter(conflict, "conflicts")).toBe(true);
    expect(matchesShortcutFilter(base, "conflicts")).toBe(false);
  });
});

describe("matchesShortcutLocalSearch", () => {
  test("matches title, id, group and formatted chords", () => {
    const entry = row();
    expect(matchesShortcutLocalSearch(entry, "go to file", "other")).toBe(true);
    expect(matchesShortcutLocalSearch(entry, "worktree.quickopen", "other")).toBe(true);
    expect(matchesShortcutLocalSearch(entry, "ctrl+p", "other")).toBe(true);
    expect(matchesShortcutLocalSearch(entry, "nothing-hits", "other")).toBe(false);
  });
  test("an empty query matches everything", () => {
    expect(matchesShortcutLocalSearch(row(), "", "other")).toBe(true);
  });
});

describe("ShortcutFilterRail", () => {
  test("renders the fork's DOM: label, count, search box, status nav", () => {
    const html = renderToString(
      <ShortcutFilterRail
        query=""
        onQueryChange={() => {}}
        filter="all"
        onFilterChange={() => {}}
        filterCounts={{ all: 12, modified: 3, unassigned: 4, conflicts: 0 }}
        visibleCount={12}
        totalCount={12}
      />,
    ).replace(/<!-- -->/g, "");
    expect(html).toContain("Find shortcuts");
    expect(html).toContain("12/12");
    expect(html).toContain('id="shortcut-filter-search"');
    expect(html).toContain('placeholder="Search command or keys"');
    expect(html).toContain('aria-label="Shortcut status filters"');
    expect(html).toContain("Status");
    // Label and count spans render adjacently (Chrome flattens them into the
    // button's accessible name, e.g. "Modified 3").
    expect(html).toMatch(/All<\/span><span[^>]*>12<\/span>/);
    expect(html).toMatch(/Modified<\/span><span[^>]*>3<\/span>/);
    expect(html).toMatch(/Unassigned<\/span><span[^>]*>4<\/span>/);
    expect(html).toMatch(/Conflicts<\/span><span[^>]*>0<\/span>/);
  });

  test("a non-empty query shows the clear control", () => {
    const html = renderToString(
      <ShortcutFilterRail
        query="mod"
        onQueryChange={() => {}}
        filter="all"
        onFilterChange={() => {}}
        filterCounts={{ all: 2, modified: 0, unassigned: 0, conflicts: 0 }}
        visibleCount={2}
        totalCount={12}
      />,
    ).replace(/<!-- -->/g, "");
    expect(html).toContain('aria-label="Clear shortcut search"');
    expect(html).toContain("2/12");
  });

  test("labels cover exactly the four statuses", () => {
    expect(Object.keys(SHORTCUT_FILTER_LABELS).sort()).toEqual([
      "all",
      "conflicts",
      "modified",
      "unassigned",
    ]);
  });
});
