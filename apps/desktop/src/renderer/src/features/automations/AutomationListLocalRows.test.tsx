// MIT Copyright (c) 2026 Lovecast Inc. Row/cell background contract for the
// automations table: unselected rows stay visually uniform (the sticky NAME
// cell tracks the row's hover/selection wash instead of painting its own),
// and only a truly selected row carries the selected wash.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { AutomationSummary } from "../../../../shared/automation-contract";
import { AutomationListLocalRows } from "./AutomationListLocalRows";
import { projectAutomationRows } from "./automation-list-projection";

function summary(overrides: Partial<AutomationSummary>): AutomationSummary {
  return {
    id: "salute",
    name: "salute",
    cron: "0 1 * * *",
    workspaceId: "w1",
    harness: "pi",
    prompt: "say hi",
    enabled: true,
    nextRunAt: 2_000,
    lastRunAt: null,
    lastRun: null,
    ...overrides,
  };
}

const workspaceNameFor = (id: string | null): string =>
  id === "w1" ? "some-feature" : "Missing workspace";

const noop = (): void => {};

function render(selectedId: string | null): string {
  const rows = projectAutomationRows(
    [summary({}), summary({ id: "b2", name: "other" })],
    workspaceNameFor,
  );
  return renderToString(
    createElement(AutomationListLocalRows, {
      rows,
      selectedId,
      relativeNow: 1_000,
      runningId: null,
      onSelect: noop,
      onRunNow: noop,
      onEdit: noop,
      onToggle: noop,
      onDelete: noop,
    }),
  );
}

function rowClassFor(html: string, rowId: string): string {
  const tag = html.match(
    new RegExp(`<div[^>]*data-automation-row-id="${rowId}"[^>]*>`),
  );
  expect(tag, `row ${rowId} renders`).toBeTruthy();
  const match = /class="([^"]*)"/.exec(tag![0]);
  expect(match, `row ${rowId} has a class`).toBeTruthy();
  return match![1];
}

describe("AutomationListLocalRows background contract", () => {
  it("leaves unselected rows without any selected/focused wash", () => {
    const html = render(null);
    expect(html).not.toContain('data-current="true"');
    // No zebra striping: rows must not carry alternating washes.
    expect(html).not.toContain("odd:");
    expect(html).not.toContain("even:");
    // The salute row must not carry the selected wash while nothing is
    // selected (the hover wash `hover:bg-accent/40` is fine — it only
    // applies on real hover).
    expect(rowClassFor(html, "salute")).not.toContain("bg-accent/60");
  });

  it("drives the sticky NAME cell from the row state (hover + selection)", () => {
    const html = render(null);
    // The row owns a named group so the frozen cell can follow it; without
    // the group the cell's group-hover rule is dead and the NAME cell keeps
    // its own background on hover (the salute-row bug).
    expect(rowClassFor(html, "salute")).toContain("group/list-table-row");
    // The frozen cell must go transparent with the row on hover and when the
    // row carries data-current, revealing the row wash instead of its own.
    expect(html).toContain("group-hover/list-table-row:bg-transparent");
    expect(html).toContain("group-data-[current=true]/list-table-row:bg-transparent");
  });

  it("marks only the truly selected row", () => {
    const html = render("salute");
    expect(html.match(/data-current="true"/g)?.length ?? 0).toBe(1);
    expect(rowClassFor(html, "salute")).toContain("bg-accent/60");
    expect(rowClassFor(html, "b2")).not.toContain("bg-accent/60");
    expect(rowClassFor(html, "b2")).not.toContain('data-current="true"');
  });
});
