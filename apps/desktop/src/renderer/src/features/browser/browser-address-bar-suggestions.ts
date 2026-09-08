// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/renderer/src/components/browser-pane/assemble-chrome/browser-address-bar-suggestions.ts
// Adapted: suggestions come from the workspace's recent URLs only (no
// browserUrlHistory store, no workspace-doc rows, no Kagi session link —
// the top search action always uses the plain engine URL); the search top
// action keeps the fork's shape (typed text as title, engine search URL as
// target, isSearch row). normalizeAddressBarInput resolves through the
// shared fork classifier, so bare words become a search URL and never
// https://<word>.

import {
  buildSearchUrl,
  DEFAULT_SEARCH_ENGINE,
  looksLikeSearchQuery,
  normalizeBrowserNavigationUrl,
  SEARCH_ENGINE_LABELS,
  type SearchEngine,
} from "../../../../shared/browser-url";
import type { BrowserRecentUrl } from "./browser-recent-urls";

export const MAX_BROWSER_ADDRESS_BAR_SUGGESTIONS = 8;

export type BrowserAddressBarSuggestion = {
  url: string;
  title: string;
  subtitle: string;
  lastVisitedAt: number;
  /** True for the engine-search top action (renders the Search icon). */
  isSearch: boolean;
};

/**
 * Normalizes typed text the way the host will, with the fork's search
 * fallback: URL-like input (hosts, paths, localhost:port) resolves to a
 * navigation URL; bare words resolve to a search URL on `searchEngine`
 * (default google). Only http(s) outcomes are returned — other schemes
 * (javascript:, file:) stay null so the submit path shows its error.
 */
export function normalizeAddressBarInput(
  value: string,
  searchEngine: SearchEngine = DEFAULT_SEARCH_ENGINE,
): string | null {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "about:blank") return null;
  const resolved = normalizeBrowserNavigationUrl(trimmed, searchEngine);
  if (!resolved) return null;
  if (!resolved.startsWith("http://") && !resolved.startsWith("https://")) {
    return null;
  }
  return resolved;
}

function rankMatch(entry: BrowserRecentUrl, query: string): number {
  const haystacks = [entry.url.toLowerCase(), entry.title.toLowerCase()];
  if (haystacks.some((hay) => hay.startsWith(query))) return 0;
  if (haystacks.some((hay) => hay.includes(query))) return 1;
  return -1;
}

export function buildBrowserAddressBarSuggestions(input: {
  recentUrls: readonly BrowserRecentUrl[];
  value: string;
  searchEngine?: SearchEngine;
}): BrowserAddressBarSuggestion[] {
  const { recentUrls, value, searchEngine = DEFAULT_SEARCH_ENGINE } = input;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "about:blank") {
    return [...recentUrls]
      .sort((a, b) => b.lastVisitedAt - a.lastVisitedAt)
      .slice(0, MAX_BROWSER_ADDRESS_BAR_SUGGESTIONS)
      .map((entry) => ({
        url: entry.url,
        title: entry.title,
        subtitle: entry.url,
        lastVisitedAt: entry.lastVisitedAt,
        isSearch: false,
      }));
  }
  const query = trimmed.toLowerCase();
  const historySuggestions = recentUrls
    .map((entry) => ({ entry, rank: rankMatch(entry, query) }))
    .filter(
      (row): row is { entry: BrowserRecentUrl; rank: number } => row.rank >= 0,
    )
    .sort(
      (a, b) => a.rank - b.rank || b.entry.lastVisitedAt - a.entry.lastVisitedAt,
    )
    .slice(0, MAX_BROWSER_ADDRESS_BAR_SUGGESTIONS - 1)
    .map(({ entry }) => ({
      url: entry.url,
      title: entry.title,
      subtitle: entry.url,
      lastVisitedAt: entry.lastVisitedAt,
      isSearch: false,
    }));

  // Why: the top action mirrors the fork — a query row ("Search <engine>
  // for <text>") for bare words, a navigation row for URL-like input.
  // Rejected schemes yield no row so the submit path owns the error and no
  // synthetic row can hand a raw string to the guest.
  let topAction: BrowserAddressBarSuggestion | null;
  if (looksLikeSearchQuery(trimmed)) {
    topAction = {
      url: buildSearchUrl(trimmed, searchEngine),
      title: trimmed,
      subtitle: `Search ${SEARCH_ENGINE_LABELS[searchEngine]} for ${trimmed}`,
      lastVisitedAt: 0,
      isSearch: true,
    };
  } else {
    const normalized = normalizeAddressBarInput(trimmed, searchEngine);
    topAction = normalized
      ? {
          url: normalized,
          title: trimmed,
          subtitle: "",
          lastVisitedAt: 0,
          isSearch: false,
        }
      : null;
  }
  if (!topAction) {
    return historySuggestions.slice(0, MAX_BROWSER_ADDRESS_BAR_SUGGESTIONS);
  }
  // Why: the history row gives Enter the same target while showing real page metadata.
  if (historySuggestions.some((row) => row.url === topAction.url)) {
    return historySuggestions.slice(0, MAX_BROWSER_ADDRESS_BAR_SUGGESTIONS);
  }
  return [topAction, ...historySuggestions].slice(
    0,
    MAX_BROWSER_ADDRESS_BAR_SUGGESTIONS,
  );
}
