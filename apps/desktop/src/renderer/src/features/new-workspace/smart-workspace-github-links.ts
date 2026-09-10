/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/shared/github/links.ts (the subset the smart name field needs: issue /
   PR numbers, `#N`, and full GitHub issue/pull URLs). Hosted (GHES) slugs
   keep their URL host so the fork's cross-repo matching can compare slugs. */

const GH_ITEM_PATH_RE = /^\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)(?:\/.*)?$/i;

export type RepoSlug = {
  owner: string;
  repo: string;
  host?: string;
};

export type GitHubIssueOrPRLink = {
  slug: RepoSlug;
  number: number;
  type: "issue" | "pr";
};

function matchGitHubItemPath(url: URL): RegExpExecArray | null {
  return GH_ITEM_PATH_RE.exec(url.pathname.replace(/\/+$/, ""));
}

function parseGitHubItemNumber(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return parsed > 0 ? parsed : null;
}

/**
 * Parses a GitHub issue/PR reference from plain input.
 * Supports issue/PR numbers (e.g. "42"), "#42", and full GitHub URLs.
 */
export function parseGitHubIssueOrPRNumber(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const numeric = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  if (/^\d+$/.test(numeric)) {
    return parseGitHubItemNumber(numeric);
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }

  const match = matchGitHubItemPath(url);
  if (!match) {
    return null;
  }

  return parseGitHubItemNumber(match[4]);
}

/**
 * Parses an owner/repo slug plus issue/PR number from a GitHub URL. Returns
 * null for anything that isn't a recognizable GitHub-shaped issue or pull
 * URL.
 */
export function parseGitHubIssueOrPRLink(input: string): GitHubIssueOrPRLink | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }

  const match = matchGitHubItemPath(url);
  if (!match) {
    return null;
  }
  const number = parseGitHubItemNumber(match[4]);
  if (number === null) {
    return null;
  }

  return {
    slug: { owner: match[1], repo: match[2], host: url.host },
    type: match[3].toLowerCase() === "pull" ? "pr" : "issue",
    number,
  };
}

/** True when the link's owner/repo (+host) matches a project's slug
 *  (`owner/repo` from the daemon's tasks remotes). */
export function sameSlug(a: RepoSlug, b: { owner: string; repo: string }): boolean {
  return (
    a.owner.toLowerCase() === b.owner.toLowerCase() &&
    a.repo.toLowerCase() === b.repo.toLowerCase()
  );
}
