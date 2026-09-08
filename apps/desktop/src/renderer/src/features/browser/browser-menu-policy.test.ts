// Menu and context-menu policy: which rows the chrome may offer, and when.
// The dropdown/context components themselves need a DOM; the policy that
// gates every row is pure and tested here.
import { describe, expect, test } from "vitest";
import { resolveBrowserToolbarMenuPolicy } from "./browser-menu-policy";
import {
  isBrowserPageMenuCopyRow,
  isBrowserPageMenuLinkRow,
} from "./browser-page-context-menu";
import { getOpenableExternalUrl } from "./browser-url-display";

describe("browser toolbar menu policy", () => {
  test("the system-browser row needs an https page", () => {
    const https = resolveBrowserToolbarMenuPolicy({
      pageUrl: "https://example.test/",
      externalUrl: getOpenableExternalUrl("https://example.test/"),
      zoomPercent: 100,
    });
    expect(https.externalUrl).toBe("https://example.test/");
    const blank = resolveBrowserToolbarMenuPolicy({
      pageUrl: "about:blank",
      externalUrl: getOpenableExternalUrl("about:blank"),
      zoomPercent: 100,
    });
    expect(blank.externalUrl).toBeNull();
    const plain = resolveBrowserToolbarMenuPolicy({
      pageUrl: "http://intranet.test/",
      externalUrl: getOpenableExternalUrl("http://intranet.test/"),
      zoomPercent: 100,
    });
    expect(plain.externalUrl).toBeNull();
  });

  test("zoom percent rides the host state", () => {
    expect(
      resolveBrowserToolbarMenuPolicy({ pageUrl: "https://a.test/", externalUrl: null, zoomPercent: 120 }).zoomPercent,
    ).toBe(120);
  });
});

describe("browser context-menu policy", () => {
  test("link rows show only for a link target", () => {
    expect(
      isBrowserPageMenuLinkRow({ x: 0, y: 0, linkUrl: "https://a.test/", pageUrl: "https://b.test/", selectionText: "" }),
    ).toBe(true);
    expect(
      isBrowserPageMenuLinkRow({ x: 0, y: 0, linkUrl: "", pageUrl: "https://b.test/", selectionText: "" }),
    ).toBe(false);
  });

  test("the copy row shows only for a non-blank selection", () => {
    expect(
      isBrowserPageMenuCopyRow({ x: 0, y: 0, linkUrl: "", pageUrl: "https://b.test/", selectionText: "hi" }),
    ).toBe(true);
    expect(
      isBrowserPageMenuCopyRow({ x: 0, y: 0, linkUrl: "", pageUrl: "https://b.test/", selectionText: "   " }),
    ).toBe(false);
  });
});
