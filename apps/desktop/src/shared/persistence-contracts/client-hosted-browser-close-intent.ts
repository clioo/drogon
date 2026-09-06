// Persisted-renderer contract extraction — Lovecast Inc. MIT source
// c97906287bb7a390b25e2025b600d9fb3c25d9c3,
// src/shared/client-hosted-browser-close-intent.ts
// (SHA256 1db01720b3fc1d43d3b591c4b8246c99a5ef7986e364ddfc4a471c57cead91dd),
// declarations: ClientHostedBrowserCloseIntent. Type-only extraction; the zod
// schema and replay bounds stay in the pinned source (runtime admission is a
// separate root gate).

/**
 * A close of a client-hosted page that its owning runtime never acknowledged.
 *
 * The runtime persists its client-hosted pages, so without this the next start would faithfully
 * restore a tab the user closed while the host was unreachable -- a resurrection that is worse
 * than the ghost row it replaced. The client records the intent instead and replays the same
 * `browser.tabClose` on reconnect, which is why nothing here is new wire state.
 */
export type ClientHostedBrowserCloseIntent = {
  browserPageId: string
  worktreeId: string
  /** When the user closed it; the only input to the give-up bound. */
  closedAt: number
}
