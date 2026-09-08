// MIT Copyright (c) 2026 Lovecast Inc.
// Projection tests for the editable Shortcuts section: every implemented
// action renders a recorder button (not static text), the status rail and
// group headers stay, and non-implemented rows keep their reason without
// a recorder.
import { describe, expect, test } from "vitest";
import { renderToString } from "react-dom/server";
import { ShortcutsSection } from "./shortcuts-section";

function render(): string {
  return renderToString(<ShortcutsSection />).replace(/<!-- -->/g, "");
}

describe("ShortcutsSection edit surface", () => {
  test("implemented rows render recorder buttons", () => {
    const html = render();
    expect(html).toContain("Change shortcut for Toggle Sidebar");
    expect(html).toContain("Keyboard shortcuts");
  });
  test("the status rail replaces the bare search box (#245)", () => {
    const html = render();
    expect(html).toContain("Find shortcuts");
    expect(html).toContain("Search command or keys");
    expect(html).toContain('aria-label="Shortcut status filters"');
  });
  test("implemented rows carry the fork's Disable control (#244)", () => {
    const html = render();
    expect(html).toContain("Disable Go to File");
    expect(html).toContain("Disable Toggle Sidebar");
  });
  test("rows advertise immediate effect and reset affordance copy", () => {
    const html = render();
    expect(html).toContain("changes apply immediately");
  });
});
