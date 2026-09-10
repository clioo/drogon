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

/** Linear identifier shape (`STA-335`): shared with the renderer-side
 *  Linear provider so the dialog save gate and the link payload builder
 *  parse identically. Uppercase-normalized on parse. */
export const LINEAR_IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

export type ParsedLinearIssueInput = {
  identifier: string;
  organizationUrlKey?: string;
};

/** Parses a bare Linear key or a linear.app issue URL. Returns the
 *  uppercased identifier plus the URL's org key when present; a bare key
 *  carries no org key (it cannot name one). Null when unparseable. */
export function parseLinearIssueInput(input: string): ParsedLinearIssueInput | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (LINEAR_IDENTIFIER_PATTERN.test(trimmed)) {
    return { identifier: trimmed.toUpperCase() };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.hostname !== "linear.app") return null;
  const parts = parsed.pathname.split("/").filter(Boolean);
  const issueIndex = parts.indexOf("issue");
  const organizationUrlKey = parts[0];
  const rawIdentifier = issueIndex !== -1 ? parts[issueIndex + 1] : undefined;
  if (!organizationUrlKey || !rawIdentifier) return null;
  let identifier: string;
  try {
    identifier = decodeURIComponent(rawIdentifier).split(/[/?#]/)[0] ?? "";
  } catch {
    return null;
  }
  if (!LINEAR_IDENTIFIER_PATTERN.test(identifier)) return null;
  let orgKey: string;
  try {
    orgKey = decodeURIComponent(organizationUrlKey);
  } catch {
    return null;
  }
  return { identifier: identifier.toUpperCase(), organizationUrlKey: orgKey };
}

/** Builds the canonical linear.app issue URL. Null unless both the
 *  identifier and the org key are present (a bare key has no URL). */
export function buildLinearIssueUrl(args: {
  identifier?: string | null;
  organizationUrlKey?: string | null;
}): string | null {
  const identifier = args.identifier?.trim();
  const organizationUrlKey = args.organizationUrlKey?.trim();
  if (!identifier || !organizationUrlKey) return null;
  if (!LINEAR_IDENTIFIER_PATTERN.test(identifier)) return null;
  return `https://linear.app/${encodeURIComponent(organizationUrlKey)}/issue/${encodeURIComponent(identifier.toUpperCase())}`;
}

/** Reads the org key (first path segment) off a linear.app issue URL.
 *  Null for anything else. */
export function getLinearOrganizationUrlKeyFromIssueUrl(issueUrl?: string | null): string | null {
  if (!issueUrl) return null;
  try {
    const parsed = new URL(issueUrl);
    if (parsed.hostname !== "linear.app") return null;
    return parsed.pathname.split("/").find(Boolean) ?? null;
  } catch {
    return null;
  }
}
export type IssueDetails = z.infer<typeof issueDetailsSchema>;
export type WorktreeIssueLink = z.infer<typeof worktreeIssueLinkSchema>;
