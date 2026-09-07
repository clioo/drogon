// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/renderer/src/components/browser-pane/assemble-chrome/browser-address-bar-suggestions.ts
// Adapted: the source merges browserUrlHistory, workspace-doc history and a
// search-engine top action; this build has no doc history, no search engine
// and no remote sources — suggestions come from the workspace's recent URLs
// only, and the top action navigates to the typed text itself.

import type { BrowserRecentUrl } from "./browser-recent-urls";

export const MAX_BROWSER_ADDRESS_BAR_SUGGESTIONS = 8;

export type BrowserAddressBarSuggestion = {
  url: string;
  title: string;
  subtitle: string;
  lastVisitedAt: number;
};

/** Normalizes typed text the way the host will: bare hosts gain https://. */
export function normalizeAddressBarInput(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const candidate =
    /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("about:blank")
      ? trimmed
      : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.hostname) return null;
    return parsed.toString();
  } catch {
    return null;
  }
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
}): BrowserAddressBarSuggestion[] {
  const { recentUrls, value } = input;
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
    }));

  const normalized = normalizeAddressBarInput(trimmed);
  // Why: rejected schemes must use the submit path's validation error;
  // a synthetic row would hand the raw string straight to the guest.
  if (!normalized) return historySuggestions.slice(0, MAX_BROWSER_ADDRESS_BAR_SUGGESTIONS);
  // Why: the history row gives Enter the same target while showing real page metadata.
  if (historySuggestions.some((row) => row.url === normalized)) {
    return historySuggestions.slice(0, MAX_BROWSER_ADDRESS_BAR_SUGGESTIONS);
  }
  return [
    { url: normalized, title: trimmed, subtitle: "", lastVisitedAt: 0 },
    ...historySuggestions,
  ].slice(0, MAX_BROWSER_ADDRESS_BAR_SUGGESTIONS);
}
