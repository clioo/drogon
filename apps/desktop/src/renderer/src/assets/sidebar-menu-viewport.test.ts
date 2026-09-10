// MIT Copyright (c) 2026 Lovecast Inc.
// Packaged-acceptance regression: a real Playwright locator.click() on the
// "Add Project" menuitem inside the "Workspace options" dropdown failed
// with "element is outside of the viewport" at the app's real tested size
// (>=720px wide, 600px tall).
// The dropdown's real DOM/CSS container (.sidebar-menu, ProjectList.tsx)
// had no height bound and no scroll affordance, so once the Workspace
// options body (Group by/Sort by/Project order/Card layout/Show
// properties/Hide) grew past the available space, trailing items --
// "Add Project" and the filter textbox -- were laid out off-screen with
// nothing to scroll them into view. jsdom performs no real layout, so
// this can't be reproduced as a pixel-geometry test; it is pinned
// against the actual shipped CSS source instead, the same technique
// already used by terminal-scrollbar-style.test.ts for an analogous
// unmeasurable-in-jsdom layout guarantee.
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

describe(".sidebar-menu viewport bounding (packaged acceptance regression)", () => {
  it("bounds its own height to Radix's real measured available space", () => {
    const rule = ruleBlock(mainCss, ".sidebar-menu");
    // Radix sets --radix-dropdown-menu-content-available-height on the
    // real Content element (the same primitive the already-working
    // ui/dropdown-menu.tsx DropdownMenuContent wrapper reads) to the
    // actual on-screen space left between the trigger and the window
    // edge -- never taller than the real viewport, at any zoom level.
    expect(rule).toMatch(
      /max-height:\s*var\(--radix-dropdown-menu-content-available-height\)\s*;/,
    );
    // A max-height with no way to reach the overflow is just clipping,
    // which is exactly as unreachable as the original bug -- the
    // trailing items must be able to scroll into view instead.
    expect(rule).toMatch(/overflow-y:\s*auto\s*;/);
  });

  it("does not clip horizontally, only vertically", () => {
    const rule = ruleBlock(mainCss, ".sidebar-menu");
    expect(rule).toMatch(/overflow-x:\s*hidden\s*;/);
  });
});
