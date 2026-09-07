// Suggestions from the workspace's recent URLs only (no remote sources).
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

  test("a query matches recents by substring with prefix first", () => {
    const recents = [
      recent({ url: "https://other.test/review", title: "Other review" }),
      recent({ url: "https://example.test/review-one", title: "Review one" }),
    ];
    const suggestions = buildBrowserAddressBarSuggestions({
      recentUrls: recents,
      value: "review",
    });
    // Top action first (the typed destination), then the matching recents.
    expect(suggestions[0].url).toBe("https://review/");
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
    expect(normalizeAddressBarInput("")).toBeNull();
    expect(normalizeAddressBarInput("file:///etc/passwd")).toBeNull();
    expect(normalizeAddressBarInput("javascript:alert(1)")).toBeNull();
  });
});
