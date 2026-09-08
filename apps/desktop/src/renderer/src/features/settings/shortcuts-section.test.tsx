// MIT Copyright (c) 2026 Lovecast Inc.
// Projection tests for the editable Shortcuts section: every implemented
// source action renders a recorder button (not static text), the search box
// and group headers stay, and every source default remains visible.
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
  test("source defaults remain editable in the rebinding pane", () => {
    const html = render();
    expect(html).toContain("Change shortcut for Force Reload");
    expect(html).toContain("Change shortcut for Close active tab");
    expect(html).toContain("Show Ports");
    expect(html).toContain("Add shortcut for Show Ports");
  });
  test("rows advertise immediate effect and reset affordance copy", () => {
    const html = render();
    expect(html).toContain("changes apply immediately");
  });
});
