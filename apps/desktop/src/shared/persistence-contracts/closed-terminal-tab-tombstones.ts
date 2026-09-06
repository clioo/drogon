// Persisted-renderer contract extraction — Lovecast Inc. MIT source
// c97906287bb7a390b25e2025b600d9fb3c25d9c3,
// src/shared/closed-terminal-tab-tombstones.ts
// (SHA256 19b72f09734d8f1877a9d204f71dac5781697e2dd6ebebf5a7e08bdd32cb9e4b),
// declarations: ClosedTerminalTabTombstone,
// ClosedTerminalTabTombstonesByTabId. Type-only extraction; the zod schema,
// TTL constants and prune/record helpers stay in the pinned source.

/** A client's own record that the user closed a terminal tab.
 *
 *  Why it must exist: absence alone cannot distinguish "the host was never told" from "the user
 *  closed it", so the merge keeps the tab — and a `pty.kill` that died on the transport means the
 *  host keeps listing it forever. This is the close signal that outlives the failed RPC.
 *  Safe because tab ids are uuids: a tombstoned id never legitimately returns. */
export type ClosedTerminalTabTombstone = {
  closedAt: number
  worktreeId: string
  /** Newest host revision seen for this tab's scope since the close. Retirement needs a STRICTLY
   *  newer snapshot that omits the tab, so a pull already in flight when the user closed cannot
   *  acknowledge a close it predates. */
  ackRevision?: number
}

export type ClosedTerminalTabTombstonesByTabId = Record<string, ClosedTerminalTabTombstone>
