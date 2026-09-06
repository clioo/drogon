// Persisted-renderer contract extraction — Lovecast Inc. MIT source
// c97906287bb7a390b25e2025b600d9fb3c25d9c3,
// src/shared/agents-view-thread-filters.ts
// (SHA256 0d20a03449f279aae478c2593cd1a5207466cc3062b4f684edf805ca3a343d1f),
// declarations: THREAD_READ_FILTER_VALUES, ACTIVITY_GROUP_BY_VALUES,
// ThreadReadFilter, ActivityGroupBy. Constant/type extraction; the
// normalizers stay in the pinned source.

/** The two filter value domains, in menu order. The types below, the client
 *  schema's `z.enum`s and the normalizers all derive from these, so a new value
 *  cannot drift out of any of them. */
export const THREAD_READ_FILTER_VALUES = ['all', 'unread'] as const
export const ACTIVITY_GROUP_BY_VALUES = ['none', 'status', 'project', 'worktree', 'agent'] as const

export type ThreadReadFilter = (typeof THREAD_READ_FILTER_VALUES)[number]
export type ActivityGroupBy = (typeof ACTIVITY_GROUP_BY_VALUES)[number]
