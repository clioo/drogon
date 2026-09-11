// MIT Copyright (c) 2026 Lovecast Inc.
// Packaged-acceptance regression: the Bots form's "Create Bot" click was
// swallowed by the Sonner toast layer. The failing Playwright log named
// `<li data-sonner-toast="" data-removed="true">` (a toast the user had
// already dismissed, still mounted for its exit animation) and
// `<div data-title>Automation run queued.</div>` as the elements intercepting
// the click, because Sonner leaves `pointer-events` unset on the layer and on
// every toast it keeps mounted while it enters/leaves.
//
// jsdom performs no layout and no hit-testing, so the behavioral proof lives
// in scripts/probe-toast-pointer-bounds.mjs (real Chromium over the oracle
// page, real clicks, real elementFromPoint — 16 checks, two of which fail
// against the pre-fix main.css). This file pins the same contract at the
// shipped-CSS source level, the technique already used by
// sidebar-menu-viewport.test.ts and terminal-scrollbar-style.test.ts for
// guarantees that jsdom cannot measure.
import fs from "node:fs";
import { describe, expect, it } from "vitest";

const mainCss = fs.readFileSync(
  new URL("./main.css", import.meta.url),
  "utf8",
);

function ruleBlock(css: string, selector: string): string {
  const needle = `${selector} {`;
  const start = css.indexOf(needle);
  expect(start, `missing ${selector} rule`).toBeGreaterThanOrEqual(0);
  const open = start + needle.length - 1;
  const end = css.indexOf("\n}", open);
  return css.slice(open, end);
}

/** Same as ruleBlock, for a rule whose selector spans several lines. */
function blockAfter(css: string, marker: string): string {
  const start = css.indexOf(marker);
  expect(start, `missing rule for ${marker}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const end = css.indexOf("\n}", open);
  return css.slice(start, end);
}

describe("toast layer pointer bounds (packaged acceptance regression)", () => {
  it("claims no pointer events on the toaster layer itself", () => {
    // The <ol data-sonner-toaster> is a 26rem-wide fixed box with height 0
    // (its toasts are absolute), but Sonner never opts it out of hit-testing,
    // so the layer's whole box — including the expanded stack's 15px `::after`
    // hover gap — stayed clickable over page content.
    expect(ruleBlock(mainCss, "[data-sonner-toaster]")).toMatch(
      /pointer-events:\s*none\s*;/,
    );
  });

  it("claims no pointer events on a toast card, but keeps its controls live", () => {
    // A Sonner toast is a notification: its text and padding take no input of
    // their own, so on the pre-fix CSS the card swallowed the Create Bot
    // click ("<div data-title>Automation run queued.</div> ... intercepts
    // pointer events"). Every control the card actually offers keeps working.
    expect(
      ruleBlock(mainCss, "[data-sonner-toaster] [data-sonner-toast]"),
    ).toMatch(/pointer-events:\s*none\s*;/);
    const controls = blockAfter(mainCss, "  :is(\n    button,");
    expect(controls).toMatch(/pointer-events:\s*auto\s*;/);
    for (const control of [
      "button",
      "a",
      "input",
      "[data-close-button]",
      "[data-button]",
    ]) {
      expect(controls).toContain(control);
    }
  });

  it("claims no pointer events on a toast the user has dismissed", () => {
    // Sonner keeps a dismissed toast mounted for 200ms with
    // `data-removed='true'` (transparent, but still hit-testable on main).
    // That node is what swallowed the Create Bot click reported by the
    // packaged acceptance, so being unclickable is the contract under test.
    const rule = ruleBlock(
      mainCss,
      "[data-sonner-toaster] [data-sonner-toast][data-removed='true'],\n[data-sonner-toaster] [data-sonner-toast][data-mounted='false'],\n[data-sonner-toaster] [data-sonner-toast][data-visible='false']",
    );
    expect(rule).toMatch(/pointer-events:\s*none\s*;/);
  });
});
