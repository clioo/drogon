// AutomationsPageSurface chrome parity (list header, refresh label,
// create button, local-time note). Effects never run under renderToString,
// so this pins the loading chrome: the header, toolbar and loading copy
// render before any bridge call.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AutomationsPanel } from "./AutomationsPanel";
import type { AutomationBridge } from "../../../../shared/automation-contract";
import type { Status, Workspace } from "../../../../shared/session-contract";

function render(): string {
  return renderToString(
    createElement(AutomationsPanel, {
      bridge: {} as AutomationBridge,
      workspace: { id: "ws-1", name: "ws", path: "/tmp/ws" } as Workspace,
      status: { hostId: "host-1" } as Status,
      listWorkspaces: () =>
        Promise.resolve({
          ok: false as const,
          error: { code: "x", message: "x", retryable: false },
        }),
      listHarnesses: () =>
        Promise.resolve({
          ok: false as const,
          error: { code: "x", message: "x", retryable: false },
        }),
    }),
  ).replace(/<!-- -->/g, "");
}

describe("AutomationsPanel header and action copy", () => {
  it("heads the page with an h1 Automations like the reference top bar", () => {
    const html = render();
    expect(html).toContain("<h1");
    expect(html).toContain(">Automations</h1>");
  });

  it("labels refresh and create exactly like the reference toolbar", () => {
    const html = render();
    expect(html).toContain('aria-label="Refresh automations"');
    expect(html).toContain("New Automation");
    expect(html).not.toContain("New automation</");
  });

  it("renders the source's bare list heading with no subtitle paragraph", () => {
    const html = render();
    expect(html).toContain(">Automations</h1>");
    expect(html).not.toContain("Local automations.");
  });

  it("renders the search field and the loading state", () => {
    const html = render();
    expect(html).toContain('aria-label="Search automations"');
    expect(html).toContain("Loading automations…");
  });
});
