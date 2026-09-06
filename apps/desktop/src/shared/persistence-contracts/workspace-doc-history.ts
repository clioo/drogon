// Persisted-renderer contract extraction — Lovecast Inc. MIT source
// c97906287bb7a390b25e2025b600d9fb3c25d9c3, src/shared/workspace-doc-history.ts
// (SHA256 995d983d1d514b906e647823abfb33d0fd017b425c37d7aac09a76d8b1566aea),
// declarations: WorkspaceDocHistoryEntry. Type-only extraction; the
// normalizers and the browser-page-doc-location equality helper stay in the
// pinned source.

import type { BrowserPageDocLocation } from './browser-workspace-types'

/**
 * A previewed workspace document the URL-bar dropdown can offer again. The document is the whole
 * identity — there is deliberately no url field, so the grant URL a preview is served over has
 * nowhere to land in history: confinement by absence, like the registry split.
 */
export type WorkspaceDocHistoryEntry = {
  docLocation: BrowserPageDocLocation
  title: string
  lastVisitedAt: number
  visitCount: number
}
