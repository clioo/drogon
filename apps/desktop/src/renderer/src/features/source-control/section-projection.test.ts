// MIT Copyright (c) 2026 Lovecast Inc.
// Test cases ported from Orca's
// src/renderer/src/components/right-sidebar/source-control-file-filter.test.ts
// (case-insensitive path matching, oversized-query blanking), adapted to
// the local grouped-entry filter model.
import { describe, expect, test } from "vitest";
import {
  buildSourceControlDisplaySections,
  groupSourceControlEntries,
} from "./section-order";
import {
  filterSourceControlGroupedPathEntries,
  getSourceControlFileFilterState,
} from "./file-filter";
import type { SourceControlEntry } from "./source-control-entry";

function row(path: string, area: SourceControlEntry["area"]): SourceControlEntry {
  return { path, area, status: area === "untracked" ? "untracked" : "modified" };
}

describe("section projection", () => {
  test("sections build staged-first and skip empty groups", () => {
    const sections = buildSourceControlDisplaySections(
      groupSourceControlEntries([
        row("u.txt", "untracked"),
        row("s.txt", "staged"),
        row("m.txt", "unstaged"),
      ]),
    );
    expect(sections.map((section) => section.id)).toEqual(["staged", "unstaged", "untracked"]);
    expect(sections[0].items.map((item) => item.path)).toEqual(["s.txt"]);
  });

  test("empty groups produce no sections", () => {
    expect(buildSourceControlDisplaySections(groupSourceControlEntries([]))).toEqual([]);
  });

  test("file filter matches case-insensitively on the path", () => {
    const grouped = groupSourceControlEntries([
      row("src/App.tsx", "unstaged"),
      row("src/main.css", "unstaged"),
    ]);
    const filtered = filterSourceControlGroupedPathEntries(
      grouped,
      getSourceControlFileFilterState("app"),
    );
    expect(filtered.unstaged.map((entry) => entry.path)).toEqual(["src/App.tsx"]);
  });

  test("oversized filter queries blank every group", () => {
    const grouped = groupSourceControlEntries([row("a.txt", "staged")]);
    const state = getSourceControlFileFilterState("x".repeat(4_096));
    expect(state.tooLarge).toBe(true);
    expect(filterSourceControlGroupedPathEntries(grouped, state)).toEqual({
      staged: [],
      unstaged: [],
      untracked: [],
    });
  });
});
