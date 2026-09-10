// MIT Copyright (c) 2026 Lovecast Inc. C06: renderer mirror of the daemon's
// stable Jira task identity (crates/drogon-core/src/jira/identity.rs). Two
// explicit tiers, never conflated:
//
// - PROVISIONAL: a stable ENDPOINT LABEL derived from the configured site
//   URL (same domain-separated sha-256, authority case-folded). It proves
//   which endpoint was configured — never which Jira instance answered.
// - SOURCE-BACKED (identity of record): an identifier read from an actual
//   instance response payload with provenance (Cloud tenant id from an
//   accessible-resources-style payload; Server/DC server-attested
//   serverInfo baseUrl). Producers are pure payload parsers, covered by
//   fixture payloads — no network, no credential probing.
//
// The immutable REST issue id is required for any task identity: an issue
// that cannot produce one stays unresolved (null), and neither the account
// email nor the legacy per-account site id is ever an identity input.

/** Domain separation, identical to the daemon's `ENDPOINT_ID_DOMAIN`. */
const ENDPOINT_ID_DOMAIN = "drogon-jira-endpoint-v1";

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
  const scheme = normalized.slice(0, normalized.length - withoutScheme.length);
  return `${scheme}${host.toLowerCase()}${path}`;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256(text: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return new Uint8Array(digest);
}

/**
 * Stable PROVISIONAL endpoint label: base64url(sha256(domain + "\n" +
 * canonical url)) truncated to 24 chars — byte-identical to the daemon's
 * `provisional_endpoint_id`. A configured URL alone never proves the
 * actual instance. Null when the site URL cannot be normalized.
 */
export async function provisionalEndpointId(siteUrl: string): Promise<string | null> {
  const normalized = normalizeJiraSiteUrl(siteUrl);
  if (!normalized) return null;
  const canonical = foldAuthorityCase(normalized);
  const digest = await sha256(`${ENDPOINT_ID_DOMAIN}\n${canonical}`);
  return base64Url(digest).slice(0, 24);
}

/** Provenance of a source-backed instance identifier. */
export type InstanceIdentitySource = "cloud-tenant-id" | "server-attested-base-url";

/** How the Jira instance is known (daemon: `JiraInstanceIdentity`). */
export type JiraInstanceIdentity =
  | {
      kind: "provisional";
      endpointId: string;
      endpointUrl: string;
    }
  | {
      /** ENDPOINT continuity evidence only: a moved endpoint can keep the
       * same installation, so this is unresolved for immutable-instance
       * continuity — never presented as verified stable identity. */
      kind: "endpoint-attested";
      attestedUrl: string;
      observedAt: string;
    }
  | {
      /** The identity of record (Cloud tenant id — immutable installation
       * continuity). */
      kind: "source-backed";
      instanceKey: string;
      source: InstanceIdentitySource;
      endpointUrl: string;
      observedAt: string;
    };

/**
 * Namespaced composite key: the three tiers live in DIFFERENT namespaces,
 * so a weaker tier can never masquerade as a stronger one (daemon:
 * `JiraInstanceIdentity::key`).
 */
export function jiraInstanceKey(instance: JiraInstanceIdentity): string {
  switch (instance.kind) {
    case "provisional":
      return `provisional:${instance.endpointId}`;
    case "endpoint-attested":
      return `attested:${instance.attestedUrl}`;
    case "source-backed":
      return `${instance.source === "cloud-tenant-id" ? "cloudid" : "server"}:${instance.instanceKey}`;
  }
}

/** True only for immutable installation continuity (Cloud tenant id). */
export function isImmutableInstanceIdentity(instance: JiraInstanceIdentity): boolean {
  return instance.kind === "source-backed" && instance.source === "cloud-tenant-id";
}

/** The stable external identity of a Jira task (daemon: `JiraTaskIdentity`). */
export type JiraTaskIdentity = {
  instance: JiraInstanceIdentity;
  /** Immutable Jira REST id — survives key renames and project moves. */
  issueId: string;
  /** Display key (`DROG-42`); never part of the identity comparison. */
  key: string;
};

/** Deterministic composite link id (tier-namespaced; daemon: `link_id`). */
export function jiraTaskLinkId(identity: JiraTaskIdentity): string {
  return `${jiraInstanceKey(identity.instance)}:${identity.issueId}`;
}

function validateTaskParts(
  issueId: string,
  key: string,
): { issueId: string; key: string } | null {
  const id = issueId?.trim() ?? "";
  if (!id || id.length > 64) return null;
  const k = key?.trim() ?? "";
  if (!k || k.length > 64) return null;
  return { issueId: id, key: k };
}

/**
 * Resolves the task identity at the PROVISIONAL tier: the endpoint is
 * known only from configuration, so the result is explicitly provisional —
 * never presented as a verified instance. Returns null — unresolved —
 * when the instance URL or the immutable issue id is missing, so a legacy
 * issue list can never silently fall back to the account email or the
 * display key.
 */
export async function resolveProvisionalJiraTaskIdentity(
  issue: { issueId: string; key: string },
  siteUrl: string | null | undefined,
): Promise<JiraTaskIdentity | null> {
  const parts = validateTaskParts(issue.issueId, issue.key);
  if (!parts) return null;
  const normalized = normalizeJiraSiteUrl(siteUrl ?? "");
  if (!normalized) return null;
  const endpointId = await provisionalEndpointId(normalized);
  if (!endpointId) return null;
  return {
    instance: { kind: "provisional", endpointId, endpointUrl: foldAuthorityCase(normalized) },
    issueId: parts.issueId,
    key: parts.key,
  };
}

/**
 * Resolves the task identity at the SOURCE-BACKED tier — the identity of
 * record. `identifier` must come from one of the producers below, never
 * from user configuration.
 */
export function resolveSourceBackedJiraTaskIdentity(
  source: InstanceIdentitySource,
  identifier: string,
  endpointUrl: string,
  observedAt: string,
  issue: { issueId: string; key: string },
): JiraTaskIdentity | null {
  const id = identifier?.trim() ?? "";
  if (!id || id.length > 256) return null;
  const parts = validateTaskParts(issue.issueId, issue.key);
  if (!parts) return null;
  const normalized = normalizeJiraSiteUrl(endpointUrl);
  if (!normalized) return null;
  return {
    instance: {
      kind: "source-backed",
      instanceKey: id,
      source,
      endpointUrl: foldAuthorityCase(normalized),
      observedAt,
    },
    issueId: parts.issueId,
    key: parts.key,
  };
}

/**
 * Extracts the Cloud tenant id (`cloudId`) for the configured site from an
 * accessible-resources-style payload (`[{id, url, ...}]`) — the
 * deterministic producer for the `cloud-tenant-id` source. Pure parsing.
 */
export function cloudTenantIdFromAccessibleResources(
  payload: unknown,
  siteUrl: string,
): string | null {
  const endpoint = foldAuthorityCase(normalizeJiraSiteUrl(siteUrl) ?? "");
  if (!endpoint || !Array.isArray(payload)) return null;
  for (const entry of payload) {
    const id = typeof entry?.id === "string" ? entry.id.trim() : "";
    const url = typeof entry?.url === "string" ? entry.url : "";
    const entryUrl = foldAuthorityCase(normalizeJiraSiteUrl(url) ?? "");
    if (id && id.length <= 128 && entryUrl && entryUrl === endpoint) {
      return id;
    }
  }
  return null;
}

/**
 * Extracts the Server/DC server-attested base URL from a serverInfo
 * payload — the deterministic producer for the `endpoint-attested` tier.
 * Returns the normalized URL the SERVER attests (which may differ from
 * what the user configured). ATTENTION: endpoint continuity evidence only
 * — a moved endpoint can keep the same installation, so this is
 * unresolved for immutable-instance continuity, never verified stable
 * identity. Pure parsing.
 */
export function serverAttestedBaseUrlFromServerInfo(payload: unknown): string | null {
  const baseUrl =
    typeof (payload as { baseUrl?: unknown })?.baseUrl === "string"
      ? (payload as { baseUrl: string }).baseUrl
      : null;
  if (!baseUrl) return null;
  const normalized = normalizeJiraSiteUrl(baseUrl);
  return normalized ? foldAuthorityCase(normalized) : null;
}

/**
 * Resolves the task identity from a server-attested endpoint URL (see
 * `serverAttestedBaseUrlFromServerInfo`). ENDPOINT continuity only:
 * `isImmutableInstanceIdentity` is false on the result.
 */
export function resolveEndpointAttestedJiraTaskIdentity(
  attestedUrl: string,
  observedAt: string,
  issue: { issueId: string; key: string },
): JiraTaskIdentity | null {
  const parts = validateTaskParts(issue.issueId, issue.key);
  if (!parts) return null;
  const normalized = normalizeJiraSiteUrl(attestedUrl);
  if (!normalized) return null;
  return {
    instance: {
      kind: "endpoint-attested",
      attestedUrl: foldAuthorityCase(normalized),
      observedAt,
    },
    issueId: parts.issueId,
    key: parts.key,
  };
}

/** Same stable task, regardless of display-key drift. */
export function sameJiraTaskIdentity(a: JiraTaskIdentity, b: JiraTaskIdentity): boolean {
  return (
    jiraInstanceKey(a.instance) === jiraInstanceKey(b.instance) &&
    a.issueId === b.issueId
  );
}
