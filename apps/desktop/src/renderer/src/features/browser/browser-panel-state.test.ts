// Pane state mapping: banners and viewport overlays read the failure
// before the blank URL, so a failed load never renders as a fresh tab.
import { describe, expect, test } from "vitest";
import type { BrowserTabState } from "../../../../shared/browser-contract";
import { bannerFor, viewportFor } from "./browser-panel";

function tab(overrides: Partial<BrowserTabState> = {}): BrowserTabState {
  return {
    tabId: "t1",
    workspaceId: "w1",
    url: "about:blank",
    title: "",
    loading: false,
    canGoBack: false,
    canGoForward: false,
    error: null,
    ...overrides,
  };
}

describe("browser pane failure mapping", () => {
  test("an error on a blank URL still renders the failure, not New Tab", () => {
    const failed = tab({
      url: "about:blank",
      error: "Could not reach http://127.0.0.1:9/ (ERR_UNSAFE_PORT).",
      loadError: {
        kind: "failed",
        code: -301,
        description: "ERR_UNSAFE_PORT",
        url: "http://127.0.0.1:9/",
      },
    });
    expect(viewportFor({ active: failed, externalUrl: null }).kind).toBe("failed");
    expect(
      bannerFor({ active: failed, notice: "", dismissedBanner: null })?.kind,
    ).toBe("failed");
  });

  test("a blocked blank-tab navigation reads as blocked", () => {
    const blocked = tab({
      url: "file:///etc/passwd",
      error: 'Blocked: "file:" URLs cannot load in the pane.',
      loadError: {
        kind: "blocked",
        code: null,
        description: 'Blocked: "file:" URLs cannot load in the pane.',
        url: "file:///etc/passwd",
      },
    });
    expect(viewportFor({ active: blocked, externalUrl: null })).toMatchObject({
      kind: "failed",
      title: "Blocked navigation",
    });
    expect(
      bannerFor({ active: blocked, notice: "", dismissedBanner: null }),
    ).toEqual({ kind: "blocked", reason: blocked.error });
  });

  test("a clean blank tab still renders New Tab", () => {
    expect(viewportFor({ active: tab(), externalUrl: null })).toEqual({ kind: "blank" });
    expect(bannerFor({ active: tab(), notice: "", dismissedBanner: null })).toBeNull();
  });

  test("a notice wins over tab state and dismisses honestly", () => {
    const failed = tab({ error: "boom" });
    expect(
      bannerFor({ active: failed, notice: "The browser is not ready yet.", dismissedBanner: null }),
    ).toEqual({ kind: "notice", text: "The browser is not ready yet." });
    expect(
      bannerFor({ active: failed, notice: "", dismissedBanner: "t1:boom" }),
    ).toBeNull();
    // A different error is not covered by the dismissal.
    expect(
      bannerFor({ active: tab({ error: "other" }), notice: "", dismissedBanner: "t1:boom" })?.kind,
    ).toBe("failed");
  });

  test("reloads of committed pages keep the page, fresh loads show progress", () => {
    expect(
      viewportFor({
        active: tab({ url: "https://a.test/", loading: true, committed: true }),
        externalUrl: null,
      }),
    ).toEqual({ kind: "page" });
    expect(
      viewportFor({
        active: tab({ url: "https://a.test/", loading: true, committed: false }),
        externalUrl: null,
      }),
    ).toEqual({ kind: "loading", url: "https://a.test/" });
  });
});
