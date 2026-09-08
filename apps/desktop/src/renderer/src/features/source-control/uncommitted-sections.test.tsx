// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// #175: section bulk stage/unstage resolve their paths from the unfiltered
// items of their own section, exactly like the fork's grouped actions
// (listing/uncommitted-sections.tsx). The two headers keep the fork's plain
// shared titles, so these tests pin the paths each button acts on.
import { createElement } from "react";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Tooltip } from "radix-ui";
import { SourceControlUncommittedSections } from "./uncommitted-sections";
import {
  buildSourceControlDisplaySections,
  groupSourceControlEntries,
} from "./section-order";
import type { SourceControlEntry } from "./source-control-entry";

afterEach(cleanup);

function renderSections(
  rows: readonly SourceControlEntry[],
  handles: {
    onStageAll?: (paths: readonly string[]) => Promise<void>;
    onUnstage?: (paths: readonly string[]) => Promise<void>;
  } = {},
  normalizedFilter = "",
) {
  const grouped = groupSourceControlEntries(rows);
  const displaySections = buildSourceControlDisplaySections(grouped);
  const unfiltered = new Map(displaySections.map((section) => [section.id, section]));
  const noop = () => {};
  const asyncNoop = () => Promise.resolve();
  render(
    createElement(Tooltip.Provider, {
      delayDuration: 400,
      children: createElement(SourceControlUncommittedSections, {
        displaySections,
        unfilteredDisplaySectionsById: unfiltered,
        normalizedFilter,
        collapsedSections: new Set<string>(),
        toggleSection: noop,
        isExecutingBulk: false,
        requestDiscardAllInArea: noop,
        handleStageAllPaths: handles.onStageAll ?? asyncNoop,
        handleUnstagePaths: handles.onUnstage ?? asyncNoop,
        sourceControlViewMode: "list",
        collapsedTreeDirs: new Set<string>(),
        toggleTreeDir: noop,
        requestDiscardPaths: noop,
        selectedKeySet: new Set<string>(),
        activeOpenRowKeys: new Set<string>(),
        handleSelect: noop,
        handleContextMenu: noop,
        handleOpenDiff: noop,
        handleStage: asyncNoop,
        handleUnstage: asyncNoop,
        requestDiscardEntry: noop,
      }),
    }),
  );
}

describe("section bulk stage/unstage scope", () => {
  test("the #175 layout stages each section's own entries", async () => {
    const calls: string[][] = [];
    renderSections(
      [
        { path: "index.html", area: "unstaged", status: "deleted" },
        { path: "<!-- qa edit r1 -->.html", area: "untracked", status: "untracked" },
        { path: "cli-created.txt", area: "untracked", status: "untracked" },
      ],
      {
        onStageAll: async (paths) => {
          calls.push([...paths]);
        },
      },
    );
    // Fork parity: both headers carry the plain shared title.
    const buttons = screen.getAllByRole("button", { name: "Stage all" });
    expect(buttons).toHaveLength(2);
    for (const button of buttons) await fireEvent.click(button);
    expect(calls).toHaveLength(2);
    const scoped = calls.map((paths) => [...paths].sort()).sort();
    expect(scoped).toEqual([["<!-- qa edit r1 -->.html", "cli-created.txt"], ["index.html"]]);
  });

  test("unstage all covers staged rows only, even for a path changed on both sides", async () => {
    const unstagedCalls: string[][] = [];
    renderSections(
      [
        { path: "a.txt", area: "staged", status: "modified" },
        { path: "a.txt", area: "unstaged", status: "modified" },
        { path: "m.txt", area: "unstaged", status: "modified" },
      ],
      {
        onUnstage: async (paths) => {
          unstagedCalls.push([...paths]);
        },
      },
    );
    await fireEvent.click(screen.getByRole("button", { name: "Unstage all" }));
    expect(unstagedCalls).toEqual([["a.txt"]]);
  });

  test("bulk actions hide while filtering so they never act on more than shown", () => {
    renderSections(
      [
        { path: "index.html", area: "unstaged", status: "deleted" },
        { path: "cli-created.txt", area: "untracked", status: "untracked" },
      ],
      {},
      "cli",
    );
    expect(screen.queryByRole("button", { name: "Stage all" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Unstage all" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete all untracked" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Discard all" })).toBeNull();
  });
});
