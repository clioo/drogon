/* MIT Copyright (c) 2026 Lovecast Inc.
   Linear workspace naming: display title plus git-safe seed, mirroring the
   Jira seed shape (`KEY Subject` → slug). */
import { slugifyForWorkspaceName } from "../jira/jira-workspace-seed";

function titleSubject(title: string): string {
  return title
    .trim()
    .replace(/^(?:issue|ticket)\s*[#!]?\S+\s*[:-]\s*/i, "")
    .trim();
}

export function getLinearLinkedWorkItemWorkspaceName(issue: {
  identifier: string;
  title: string;
}): { displayName: string; seedName: string } | null {
  const identifier = issue.identifier.trim().toUpperCase();
  if (!identifier) return null;
  const subject = titleSubject(issue.title).replace(
    new RegExp(`^${identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:-]?\\s*`, "i"),
    "",
  ).trim();
  const displayName =
    [identifier, subject].filter(Boolean).join(" ") || identifier;
  const seedName = slugifyForWorkspaceName(displayName);
  if (!seedName) return null;
  return { displayName, seedName };
}

/** The fork's workspace-name seed for a Linear issue (branch-safe). */
export function getLinearIssueWorkspaceSeed(issue: {
  identifier: string;
  title: string;
}): string {
  return (
    getLinearLinkedWorkItemWorkspaceName(issue)?.seedName ??
    slugifyForWorkspaceName(`${issue.identifier} ${issue.title}`.trim())
  );
}

/** Suggested branch name for the copy affordance (`eng-123-slug`). */
export function buildLinearBranchName(issue: {
  identifier: string;
  title: string;
}): string {
  const slug = slugifyForWorkspaceName(issue.title).slice(0, 52);
  const key = issue.identifier.trim().toLowerCase();
  return slug ? `${key}-${slug}` : key;
}
