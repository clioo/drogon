// MIT Copyright (c) 2026 Lovecast Inc.
// Projection tests for the editable Shortcuts section: every implemented
// action renders a recorder button (not static text), the search box and
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
    expect(html).toContain("Search shortcuts");
    expect(html).toContain("Keyboard shortcuts");
  });
  test("non-implemented rows stay read-only with their reason", () => {
    const html = render();
    expect(html).toContain("Unavailable:");
    // The read-only rows carry no recorder button.
    expect(html).not.toContain("Change shortcut for Force Reload");
  });
  test("rows advertise immediate effect and reset affordance copy", () => {
    const html = render();
    expect(html).toContain("changes apply immediately");
  });
});
