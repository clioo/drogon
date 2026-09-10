import { z } from "zod";

export const WORKTREE_ISSUE_LINKS_CAPABILITY = "worktree.issue-links.v1";
export const issueProviderSchema = z.enum(["linear", "jira"]);
const text = (max: number) => z.string().max(max).refine((value) => value.length <= max && new TextEncoder().encode(value).length <= max && !value.includes("\0"));
function safeIssueUrl(value: string): URL | null {
  try {
    if (/[\\\s\u0000-\u001f\u007f-\u009f]/.test(value)) return null;
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url : null;
  } catch { return null; }
}
const issueShape = {
  provider: issueProviderSchema,
  identifier: z.string().max(128).regex(/^[A-Za-z][A-Za-z0-9_]*-\d+$/),
  title: text(4096),
  siteId: text(256).nullable().default(null),
  url: text(2048).refine((value) => safeIssueUrl(value) !== null).nullable().default(null),
  stateName: text(256).nullable().default(null),
  labels: z.array(text(128)).max(32).default([]),
};
const validProviderUrl = (value: { provider: string; url: string | null }) => {
  if (value.provider !== "linear" || !value.url) return true;
  const url = safeIssueUrl(value.url);
  return url !== null && url.hostname === "linear.app" && url.port === "";
};
export const issueDetailsSchema = z.object(issueShape).strict().refine(validProviderUrl);
export const worktreeIssueLinkSchema = z.object({ worktreeId: z.string().min(1).max(256), ...issueShape }).refine(validProviderUrl);
export type IssueDetails = z.infer<typeof issueDetailsSchema>;
export type WorktreeIssueLink = z.infer<typeof worktreeIssueLinkSchema>;
