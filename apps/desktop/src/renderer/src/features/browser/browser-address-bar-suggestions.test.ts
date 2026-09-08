// Suggestions from the workspace's recent URLs plus the fork's search top
// action (ported behavior: bare words search, URL-like input navigates).
// MIT Copyright (c) 2026 Lovecast Inc.
// Test cases ported from Orca's
// src/renderer/src/components/browser-pane/assemble-chrome/browser-address-bar-suggestions.test.ts
// (recents-first blank query, search top action for bare words, scheme
// rejection, prefix-over-substring ranking), adapted to the local
// suggestion model and extended with the fork's #234 search/URL rules.
import { describe, expect, test } from "vitest";
import {
  buildBrowserAddressBarSuggestions,
  MAX_BROWSER_ADDRESS_BAR_SUGGESTIONS,
  normalizeAddressBarInput,
} from "./browser-address-bar-suggestions";
import type { BrowserRecentUrl } from "./browser-recent-urls";

function recent(overrides: Partial<BrowserRecentUrl> & { url: string }): BrowserRecentUrl {
  return {
    title: overrides.url,
    lastVisitedAt: 1_700_000_000_000,
    visitCount: 1,
    ...overrides,
  };
}

describe("browser address-bar suggestions", () => {
  test("an empty query lists recents, newest first, capped", () => {
    const recents = Array.from({ length: 12 }, (_, index) =>
      recent({
        url: `https://example.test/${index}`,
        lastVisitedAt: 1_700_000_000_000 + index,
      }),
    );
    const suggestions = buildBrowserAddressBarSuggestions({ recentUrls: recents, value: "" });
    expect(suggestions).toHaveLength(MAX_BROWSER_ADDRESS_BAR_SUGGESTIONS);
    expect(suggestions[0].url).toBe("https://example.test/11");
    expect(suggestions[0].subtitle).toBe("https://example.test/11");
  });

  test("a bare word becomes a search top action, never https://<word> (#234)", () => {
    const suggestions = buildBrowserAddressBarSuggestions({
      recentUrls: [],
      value: "asdfghghj",
    });
    expect(suggestions[0]).toMatchObject({
      url: "https://www.google.com/search?q=asdfghghj",
      title: "asdfghghj",
      isSearch: true,
    });
    expect(suggestions[0].subtitle).toContain("Google");
    expect(
      suggestions.every((row) => row.url !== "https://asdfghghj/"),
    ).toBe(true);
  });

  test("multi-word input searches on the configured engine", () => {
    const suggestions = buildBrowserAddressBarSuggestions({
      recentUrls: [],
      value: "react hooks",
      searchEngine: "duckduckgo",
    });
    expect(suggestions[0]).toMatchObject({
      url: "https://duckduckgo.com/?q=react%20hooks",
      isSearch: true,
    });
  });

  test("local-dev addresses resolve to http (#234)", () => {
    expect(
      buildBrowserAddressBarSuggestions({ recentUrls: [], value: "localhost:8931" })[0],
    ).toMatchObject({ url: "http://localhost:8931/", isSearch: false });
  });

  test("domain-like input with a path navigates (#234)", () => {
    expect(
      buildBrowserAddressBarSuggestions({ recentUrls: [], value: "example.com/x" })[0],
    ).toMatchObject({ url: "https://example.com/x", isSearch: false });
  });

  test("a query matches recents by substring with prefix first", () => {
    const recents = [
      recent({ url: "https://other.test/review", title: "Other review" }),
      recent({ url: "https://example.test/review-one", title: "Review one" }),
    ];
    const suggestions = buildBrowserAddressBarSuggestions({
      recentUrls: recents,
      value: "review",
    });
    // Top action first (the search), then the matching recents.
    expect(suggestions[0].isSearch).toBe(true);
    expect(suggestions.map((row) => row.url)).toContain("https://example.test/review-one");
    expect(suggestions.map((row) => row.url)).toContain("https://other.test/review");
  });

  test("a typed URL that matches a recent dedupes to the history row", () => {
    const recents = [recent({ url: "https://example.test/", title: "Example" })];
    const suggestions = buildBrowserAddressBarSuggestions({
      recentUrls: recents,
      value: "example.test",
    });
    expect(suggestions.map((row) => row.url)).toEqual(["https://example.test/"]);
  });

  test("bare hosts gain https, rejected schemes yield history only", () => {
    const recents = [recent({ url: "https://example.test/docs", title: "Docs" })];
    expect(
      buildBrowserAddressBarSuggestions({ recentUrls: recents, value: "example.test" })[0].url,
    ).toBe("https://example.test/");
    const blocked = buildBrowserAddressBarSuggestions({
      recentUrls: recents,
      value: "javascript:alert(1)",
    });
    expect(blocked.every((row) => !row.url.startsWith("javascript:"))).toBe(true);
  });

  test("input normalization mirrors the host policy", () => {
    expect(normalizeAddressBarInput("  example.test/a  ")).toBe("https://example.test/a");
    expect(normalizeAddressBarInput("http://localhost:3000/x")).toBe("http://localhost:3000/x");
    expect(normalizeAddressBarInput("asdfghghj")).toBe(
      "https://www.google.com/search?q=asdfghghj",
    );
    expect(normalizeAddressBarInput("localhost:8931")).toBe("http://localhost:8931/");
    expect(normalizeAddressBarInput("example.com/x")).toBe("https://example.com/x");
    expect(normalizeAddressBarInput("")).toBeNull();
    expect(normalizeAddressBarInput("file:///etc/passwd")).toBeNull();
    expect(normalizeAddressBarInput("javascript:alert(1)")).toBeNull();
  });
});
