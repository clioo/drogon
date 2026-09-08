// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/shared/workspace-name.ts and src/shared/workspace-name-text-scanner.ts
// (slugifyForWorkspaceName, getLinkedWorkItemTitleSubject,
// getLinkedWorkItemSuggestedName, getLinkedWorkItemWorkspaceName) plus
// src/renderer/src/components/task-page-source-context.tsx
// (getJiraIssueWorkspaceSeed) — verbatim logic; the daemon ports the same
// functions for `jira.startIssue` (crates/drogon-core/src/jira/start_issue.rs)
// and both sides must agree, so this stays a literal port.
function normalizeApostrophes(input: string): string {
  return input.replace(/[‘’]/g, "'");
}

// Why: contractions and possessives should not become stray `t` / `s` tokens
// in display names or extra hyphen segments in branch-safe workspace seeds.
function removeIntraWordApostrophes(input: string): string {
  return normalizeApostrophes(input).replace(
    /([\p{L}\p{N}])'(?=[\p{L}\p{N}])/gu,
    "$1",
  );
}

// Port of workspace-name-text-scanner.ts `isWorkspaceNameWhitespace` — the
// explicit whitespace code list (not `/\s/`) so NBSP and friends fold too.
function isWorkspaceNameWhitespace(code: number): boolean {
  return (
    code === 32 ||
    (code >= 9 && code <= 13) ||
    code === 160 ||
    code === 5760 ||
    (code >= 8192 && code <= 8202) ||
    code === 8232 ||
    code === 8233 ||
    code === 8239 ||
    code === 8287 ||
    code === 12288 ||
    code === 65279
  );
}

// Port of `foldWorkspaceNameWhitespaceToHyphen` — one hyphen per whitespace
// run, no leading hyphen.
function foldWorkspaceNameWhitespaceToHyphen(input: string): string {
  let result = "";
  let pendingHyphen = false;
  for (let index = 0; index < input.length; index += 1) {
    if (isWorkspaceNameWhitespace(input.charCodeAt(index))) {
      pendingHyphen = true;
      continue;
    }
    if (pendingHyphen) {
      result += "-";
      pendingHyphen = false;
    }
    result += input[index];
  }
  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function slugifyForWorkspaceName(input: string): string {
  const normalized = removeIntraWordApostrophes(input)
    .trim()
    .toLowerCase()
    .replace(/[\\/]+/g, "-");
  return foldWorkspaceNameWhitespaceToHyphen(normalized)
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    // Why: git check-ref-format rejects any ref containing `..`, so previews
    // must match the main-process sanitizer before workspace creation.
    .replace(/\.{2,}/g, ".")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 48)
    .replace(/[-._]+$/g, "");
}

function getLinkedWorkItemTitleSubject(item: { title: string }): string {
  return item.title
    .trim()
    .replace(/^(?:issue|pr|pull request|mr|merge request)\s*[#!]?\d+\s*[:-]\s*/i, "")
    .replace(/^#\d+\s*[:-]\s*/, "")
    .replace(/\([#!]?\d+\)/g, "")
    .replace(/\b#\d+\b/g, "")
    .trim();
}

export function getLinkedWorkItemSuggestedName(item: { title: string }): string {
  const seed = getLinkedWorkItemTitleSubject(item) || item.title.trim();
  return slugifyForWorkspaceName(seed);
}

export type JiraWorkItemSeed = {
  displayName: string;
  seedName: string;
};

/**
 * The fork's `getLinkedWorkItemWorkspaceName` for Jira work items: builds
 * the display title (`KEY Subject`, identifier uppercased, title-prefix
 * de-duplicated) and the git-safe seed together so folder, branch, and
 * sidebar name cannot drift before work has started.
 */
export function getJiraLinkedWorkItemWorkspaceName(issue: {
  key: string;
  title: string;
}): JiraWorkItemSeed | null {
  const identifier = issue.key;
  const compositeTitle = `${issue.key} ${issue.title}`;
  let subject = getLinkedWorkItemTitleSubject({ title: compositeTitle }) || compositeTitle.trim();
  if (identifier) {
    subject = subject
      .replace(new RegExp(`^${escapeRegex(identifier)}\\s*[:-]?\\s*`, "i"), "")
      .trim();
  }
  const displayName =
    [identifier.toUpperCase(), subject].filter(Boolean).join(" ") ||
    identifier.toUpperCase();
  const seedName = slugifyForWorkspaceName(displayName);
  if (!seedName) {
    return null;
  }
  return { displayName, seedName };
}

/** The fork's `getJiraIssueWorkspaceSeed`: the seed string only. */
export function getJiraIssueWorkspaceSeed(issue: {
  key: string;
  title: string;
}): string {
  return (
    getJiraLinkedWorkItemWorkspaceName(issue)?.seedName ??
    getLinkedWorkItemSuggestedName(issue)
  );
}
