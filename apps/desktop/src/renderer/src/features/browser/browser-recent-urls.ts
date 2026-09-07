// Workspace-scoped recent URLs backing the address-bar suggestions.
// The reference reads the app store's browserUrlHistory plus workspace-doc
// and Kagi rows; this build keeps history local only (no remote sources):
// one capped list per workspace in localStorage, recorded on commit.

export type BrowserRecentUrl = {
  url: string;
  title: string;
  lastVisitedAt: number;
  visitCount: number;
};

export const MAX_BROWSER_RECENT_URLS = 50;

function storageKey(workspaceId: string): string {
  return `drogon.browser.recentUrls.${workspaceId}`;
}

function readStorage(workspaceId: string): BrowserRecentUrl[] {
  try {
    const raw = window.localStorage.getItem(storageKey(workspaceId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is BrowserRecentUrl =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as BrowserRecentUrl).url === "string" &&
        typeof (entry as BrowserRecentUrl).lastVisitedAt === "number",
    );
  } catch {
    return [];
  }
}

function writeStorage(workspaceId: string, entries: BrowserRecentUrl[]): void {
  try {
    window.localStorage.setItem(storageKey(workspaceId), JSON.stringify(entries));
  } catch {
    // A denied storage write keeps memory-only recents; never blocks navigation.
  }
}

/**
 * Records one committed page visit. Blank tabs and non-http(s) URLs are
 * never history; a revisit bumps the visit count and the timestamp.
 */
export function recordBrowserRecentUrl(input: {
  workspaceId: string;
  url: string;
  title: string;
  now?: number;
}): BrowserRecentUrl[] {
  const { workspaceId, url, title } = input;
  if (!/^https?:\/\//i.test(url)) return readStorage(workspaceId);
  const now = input.now ?? Date.now();
  const stored = readStorage(workspaceId);
  const previous = stored.find((entry) => entry.url === url);
  const entries = stored.filter((entry) => entry.url !== url);
  entries.unshift({
    url,
    title: title || url,
    lastVisitedAt: now,
    visitCount: (previous?.visitCount ?? 0) + 1,
  });
  const capped = entries.slice(0, MAX_BROWSER_RECENT_URLS);
  writeStorage(workspaceId, capped);
  return capped;
}

/** Most-recent-first recents for one workspace. */
export function readBrowserRecentUrls(workspaceId: string): BrowserRecentUrl[] {
  return readStorage(workspaceId).sort((a, b) => b.lastVisitedAt - a.lastVisitedAt);
}
