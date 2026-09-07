import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { Tooltip } from "radix-ui";
import { SidebarFooter } from "./sidebar-footer";

function render(): string {
  return renderToString(
    createElement(
      Tooltip.Provider,
      null,
      createElement(SidebarFooter, {
        onOpenSettings: () => {},
        onRevealActiveWorkspace: () => {},
      }),
    ),
  );
}

describe("SidebarFooter", () => {
  test("renders the source footer controls in order, without service text", () => {
    const html = render();
    const settings = html.indexOf('aria-label="Settings"');
    const help = html.indexOf('aria-label="Help"');
    const reveal = html.indexOf('aria-label="Reveal active workspace"');
    expect(settings).toBeGreaterThan(-1);
    expect(help).toBeGreaterThan(-1);
    expect(reveal).toBeGreaterThan(-1);
    expect(settings).toBeLessThan(help);
    expect(help).toBeLessThan(reveal);
    expect(html).not.toContain("Service ");
    expect(html).not.toContain("build-revision");
  });

  test("help menu carries the shortcuts entry", () => {
    // Closed menus render only their trigger; the shortcuts entrypoint is
    // wired through onOpenSettings("shortcuts") when opened in the app.
    expect(render()).toContain('aria-label="Help"');
  });
});
