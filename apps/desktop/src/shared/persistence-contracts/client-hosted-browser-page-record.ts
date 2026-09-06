// Persisted-renderer contract extraction — Lovecast Inc. MIT source
// c97906287bb7a390b25e2025b600d9fb3c25d9c3,
// src/shared/client-hosted-browser-page-record.ts
// (SHA256 e0690807d2a71b2e59c5f4519c90ae80f1299298823f095f8d681106af6f0bd8),
// declarations: CLIENT_HOSTED_BROWSER_PAGE_RECORD_VERSION,
// PersistedClientHostedBrowserPage, ForbiddenAuthorityField compile-time
// proof. Type/constant extraction; the zod schema and age bounds stay in the
// pinned source (runtime admission is a separate root gate).

/** Row-level schema version constant, referenced by the durable record's `v`. */
export const CLIENT_HOSTED_BROWSER_PAGE_RECORD_VERSION = 1

/**
 * Durable form of a client-hosted logical page.
 *
 * The runtime owns the page identity; the paired desktop owns the engine that renders it. Losing
 * the runtime's record therefore loses the page for everyone, because no other participant can
 * name it: a restarted client's guests are gone too, so its inventory has nothing to adopt from.
 *
 * What is stored here is deliberately only what outlives an authority: identity, last committed
 * metadata, browser profile, and the durable device that hosted it. Live authority -- connection
 * ids, lease and page generations, WebContents ids -- is unrepresentable in this type on purpose.
 * Every runtime start mints a new authority epoch, so a persisted generation could only ever be a
 * forgery of one.
 *
 * `executionHostKey` is absent for the same reason even though it reads like a durable address:
 * it is the route FENCING key, and its native and WSL forms name the runtime's per-process id and
 * boot time. A client asked to place a page under a predecessor's key answers
 * `browser_client_network_route_authority_mismatch`, so recovery re-resolves the workspace's
 * current key rather than replaying this one.
 */
export type PersistedClientHostedBrowserPage = {
  /** Row-level schema version. A row naming a version this build does not know is dropped. */
  v: typeof CLIENT_HOSTED_BROWSER_PAGE_RECORD_VERSION
  browserPageId: string
  workspaceId: string
  browserProfileId: string
  url: string
  title: string
  /**
   * Preferred placement: the durable paired device that hosted the page. Deliberately not
   * `browserHostClientId`, which a desktop re-mints per process and which therefore names nothing
   * a relaunched client would answer to.
   */
  pairedDeviceId: string
  /** When the row was last written; the only input to never-returning-host expiry. */
  savedAt: number
}

/**
 * Compile-time proof that no live-authority field can be persisted.
 *
 * A reviewer's first question about restoring rows is whether a stored generation could ever be
 * replayed as authority. It cannot, because the durable type has nowhere to put one: adding any of
 * these names to `PersistedClientHostedBrowserPage` fails the build rather than the review.
 */
type ForbiddenAuthorityField = Extract<
  keyof PersistedClientHostedBrowserPage,
  | 'browserHostClientId'
  | 'browserHostGeneration'
  | 'executionHostKey'
  | 'pageHostGeneration'
  | 'placement'
  | 'connectionId'
  | 'authorityEpoch'
  | 'authorityRuntimeId'
  | 'webContentsId'
>
const noPersistedAuthority: [ForbiddenAuthorityField] extends [never] ? true : never = true
void noPersistedAuthority
