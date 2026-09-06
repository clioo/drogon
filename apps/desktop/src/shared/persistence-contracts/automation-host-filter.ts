// Persisted-renderer contract extraction — Lovecast Inc. MIT source
// c97906287bb7a390b25e2025b600d9fb3c25d9c3,
// src/shared/automation-host-filter.ts
// (SHA256 b82d3598d10eecde2f03e32cd46fbbfe59cc7d206fa7dd233143fff3d7d7bd48),
// declarations: PersistedAutomationHostFilter. Type-only extraction; the
// AutomationHostFilter union, converters and parser stay in the pinned source.

/** On-disk shape: the canonical `hostStableKey` string plus a discriminator. */
export type PersistedAutomationHostFilter = { kind: 'all' } | { kind: 'host'; hostKey: string }
