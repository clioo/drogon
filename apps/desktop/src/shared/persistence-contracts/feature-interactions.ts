// Persisted-renderer contract extraction — Lovecast Inc. MIT source
// c97906287bb7a390b25e2025b600d9fb3c25d9c3, src/shared/feature-interactions.ts
// (SHA256 d0f06fea1a436f77584b8bc3c93a944ee0cc1504cb0b12fc08cf49eb2d6dec7a),
// declarations: FeatureInteractionRecord, FeatureInteractionState.
// Type-only extraction.

import type { FeatureInteractionId } from './feature-interaction-catalog'

export type FeatureInteractionRecord = {
  /** Unix timestamp in milliseconds for the first local interaction. */
  firstInteractedAt: number
  /** Number of local interactions recorded for this feature. */
  interactionCount: number
}

export type FeatureInteractionState = Partial<
  Record<FeatureInteractionId, FeatureInteractionRecord>
>
