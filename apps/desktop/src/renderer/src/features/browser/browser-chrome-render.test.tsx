// Chrome render smoke: the navigation row, banners and viewport overlays
// render server-side with the reference copy and ARIA (no portals open).
import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { BrowserNavigationControlRow } from "./browser-navigation-control-row";
import { BrowserChromeBanners } from "./browser-chrome-banners";
import { BrowserViewportOverlays } from "./browser-viewport-overlays";

function navRow(): string {
  return renderToString(
    createElement(BrowserNavigationControlRow, {
      controls: {
        canGoBack: true,
        canGoForward: false,
        loading: false,
        goBack: () => {},
        goForward: () => {},
        reload: () => {},
        navigate: () => {},
      },
      addressSlot: createElement("span", null, "identity"),
    }),
  );
}

describe("browser chrome render", () => {
  test("the navigation row carries history controls and the identity slot", () => {
    const html = navRow();
    expect(html).toContain('aria-label="Back"');
    expect(html).toContain('aria-label="Forward"');
    expect(html).toContain('aria-label="Reload"');
    expect(html).toContain("data-drogon-browser-address-slot");
    expect(html).toContain("identity");
  });

  test("history buttons disable from the host depth", () => {
    const html = renderToString(
      createElement(BrowserNavigationControlRow, {
        controls: {
          canGoBack: false,
          canGoForward: false,
          loading: true,
          goBack: () => {},
          goForward: () => {},
          reload: () => {},
          navigate: () => {},
        },
        addressSlot: createElement("span", null, "identity"),
        reloadLabel: "Stop",
      }),
    );
    expect(html).toContain("disabled");
    expect(html).toContain('aria-label="Stop"');
  });

  test("the failed banner offers retry with the host copy", () => {
    const html = renderToString(
      createElement(BrowserChromeBanners, {
        banner: {
          kind: "failed",
          title: "Can't reach missing.test",
          description: "ERR_NAME_NOT_RESOLVED",
          canOpenExternal: true,
        },
        onRetry: () => {},
        onCopyAddress: () => {},
        onOpenExternal: () => {},
        onDismiss: () => {},
      }),
    );
    expect(html).toContain("Can&#x27;t reach missing.test");
    expect(html).toContain("Retry");
    expect(html).toContain("Copy Address");
    expect(html).toContain("Open Externally");
  });

  test("the blocked banner names the policy, never a broken page", () => {
    const html = renderToString(
      createElement(BrowserChromeBanners, {
        banner: { kind: "blocked", reason: 'Blocked: "file:" URLs cannot load in the pane.' },
        onRetry: () => {},
        onCopyAddress: () => {},
        onOpenExternal: () => {},
        onDismiss: () => {},
      }),
    );
    expect(html).toContain("Blocked navigation");
    expect(html).not.toContain("Retry");
  });

  test("viewport overlays cover blank, loading and failed", () => {
    const render = (viewport: Parameters<typeof BrowserViewportOverlays>[0]["viewport"]) =>
      renderToString(
        createElement(BrowserViewportOverlays, {
          viewport,
          onRetry: () => {},
          onCopyAddress: () => {},
          onOpenExternal: () => {},
        }),
      );
    expect(render({ kind: "blank" })).toContain("New Tab");
    expect(render({ kind: "loading", url: "https://a.test/" })).toContain("Loading…");
    const failed = render({
      kind: "failed",
      title: "Can't load this page",
      description: "refused",
      canOpenExternal: false,
    });
    expect(failed).toContain("Retry");
    expect(failed).not.toContain("Open Externally");
    expect(render({ kind: "page" })).not.toContain("New Tab");
  });
});
