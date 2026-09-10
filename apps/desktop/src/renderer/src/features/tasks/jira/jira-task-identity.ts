// MIT Copyright (c) 2026 Lovecast Inc. C06: renderer mirror of the daemon's
// stable Jira task identity (crates/drogon-core/src/jira/identity.rs). The
// SAME derivation (domain-separated sha-256 over the authority-case-folded
// normalized site URL) so the renderer and the daemon agree on which Jira
// instance — never which credential — an issue belongs to. The immutable
// REST issue id is required: an issue that cannot produce one stays
// unresolved (null), and neither the account email nor the legacy per-
// account site id is ever an identity input.

/** Domain separation, identical to the daemon's `INSTANCE_ID_DOMAIN`. */
const INSTANCE_ID_DOMAIN = "drogon-jira-instance-v1";

/** The fork's `normalizeJiraSiteUrl` (identity.rs port): default scheme,
 * strip query/fragment and trailing slash, keep origin+path. Returns null
 * when the fork's normalizer would reject the input. */
export function normalizeJiraSiteUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withProtocol = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  const schemeMatch = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/(.*)$/s.exec(withProtocol);
  if (!schemeMatch) return null;
  const scheme = schemeMatch[1].toLowerCase();
  const rest = schemeMatch[2];
  if (!rest) return null;
  const authorityAndPath = rest.split(/[?#]/, 1)[0] ?? "";
  const slashIndex = authorityAndPath.indexOf("/");
  const authority = slashIndex >= 0 ? authorityAndPath.slice(0, slashIndex) : authorityAndPath;
  const path = slashIndex >= 0 ? authorityAndPath.slice(slashIndex) : "";
  const host = authority.split("@").pop() ?? "";
  if (!host) return null;
  return `${scheme}://${host}${path.replace(/\/+$/, "")}`;
}

/** Lowercase the authority segment; path case is significant. */
function foldAuthorityCase(normalized: string): string {
  const withoutScheme = normalized.replace(/^[^:]+:\/\//, "");
  const slashIndex = withoutScheme.indexOf("/");
  const host = slashIndex >= 0 ? withoutScheme.slice(0, slashIndex) : withoutScheme;
  const path = slashIndex >= 0 ? withoutScheme.slice(slashIndex) : "";
  return `${normalized.slice(0, normalized.length - withoutScheme.length)}${host.toLowerCase()}${path}`;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(text: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return new Uint8Array(digest);
}

/**
 * Stable, account-independent instance id: base64url(sha256(domain + "\n" +
 * canonical url)) truncated to 24 chars — byte-identical to the daemon's
 * `jira_instance_id`. Null when the site URL cannot be normalized.
 */
export async function jiraInstanceId(siteUrl: string): Promise<string | null> {
  const normalized = normalizeJiraSiteUrl(siteUrl);
  if (!normalized) return null;
  const canonical = foldAuthorityCase(normalized);
  const digest = await sha256Hex(`${INSTANCE_ID_DOMAIN}\n${canonical}`);
  return base64Url(digest).slice(0, 24);
}

/** The stable external identity of a Jira task (daemon: `JiraTaskIdentity`). */
export type JiraTaskIdentity = {
  provider: "jira";
  instanceId: string;
  /** Canonical (authority-case-folded) instance URL. */
  instanceUrl: string;
  /** Immutable Jira REST id — survives key renames and project moves. */
  issueId: string;
  /** Display key (`DROG-42`); never part of the identity comparison. */
  key: string;
};

/**
 * Resolves the identity from the issue's immutable id and the ACTUAL
 * instance site URL (e.g. `site.siteUrl` from `jira.status`). Returns null
 * — unresolved — when either is missing, so a legacy issue list can never
 * silently fall back to the account email or the display key.
 */
export async function getJiraTaskIdentity(
  issue: Pick<JiraTaskIdentity, "issueId" | "key">,
  siteUrl: string | null | undefined,
): Promise<JiraTaskIdentity | null> {
  const issueId = issue.issueId?.trim() ?? "";
  if (!issueId || issueId.length > 64) return null;
  const key = issue.key?.trim() ?? "";
  if (!key || key.length > 64) return null;
  if (!siteUrl) return null;
  const instanceUrl = foldAuthorityCase(normalizeJiraSiteUrl(siteUrl) ?? "");
  if (!instanceUrl) return null;
  const instanceId = await jiraInstanceId(instanceUrl);
  if (!instanceId) return null;
  return { provider: "jira", instanceId, instanceUrl, issueId, key };
}

/** Deterministic composite link id (daemon: `link_id`). */
export function jiraTaskLinkId(identity: JiraTaskIdentity): string {
  return `${identity.instanceId}:${identity.issueId}`;
}

/** Same stable task, regardless of display-key drift. */
export function sameJiraTaskIdentity(a: JiraTaskIdentity, b: JiraTaskIdentity): boolean {
  return a.instanceId === b.instanceId && a.issueId === b.issueId;
}
