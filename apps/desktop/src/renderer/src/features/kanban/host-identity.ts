/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca
   src/shared/worktree/host-qualified-identity.ts at pinned source c9790628
   (clioo/drogon-orca). Adaptation: Orca parses an ExecutionHostId union out of
   the host segment; a Drogon host id is already a plain string (Workspace /
   Project `hostId`), so compose/get keep the exact `host|id` shape and the
   empty-host bucket without the parse step. */

/**
 * Separator between the host and the workspace id.
 *
 * Printable on purpose: these identities become React keys and DOM attribute
 * values, and HTML attribute parsing replaces U+0000 with U+FFFD — a NUL
 * separator would not survive the round trip an anchor comparison depends on.
 *
 * `|` is safe as a delimiter because a host id cannot contain one: it is
 * `local`, or a fixed prefix followed by an `encodeURIComponent`-escaped part
 * (which encodes `|` as `%7C`). Putting the host first therefore makes the
 * split unambiguous even though the workspace id — a project id and a
 * filesystem path — may contain anything.
 */
const HOST_SEPARATOR = "|";

/**
 * Stable key for one workspace on one host (STA-4343).
 *
 * `worktreeId` is `projectId::path` with no host component, so a project
 * registered on two execution hosts publishes the same id twice for two
 * different workspaces. Any map, set or React key that must keep them apart
 * keys on this instead.
 *
 * An unqualified row gets its own bucket rather than being folded into a host:
 * it may well BE one of them, but nothing here can prove which.
 */
export function getWorktreeHostIdentity(worktree: {
  id: string;
  hostId?: string | null;
}): string {
  return composeWorktreeHostIdentity(worktree.hostId, worktree.id);
}

export function composeWorktreeHostIdentity(
  hostId: string | null | undefined,
  worktreeId: string,
): string {
  return `${hostId ?? ""}${HOST_SEPARATOR}${worktreeId}`;
}

/**
 * The host back out of an identity, when the identity names one.
 *
 * An empty prefix (`|<worktreeId>`) stays undefined rather than defaulting to
 * `local`: an unqualified row may be on any host, and callers use this to pick
 * the host a destructive action runs against.
 */
export function getExecutionHostIdFromWorktreeHostIdentity(
  identity: string,
): string | undefined {
  const separatorIndex = identity.indexOf(HOST_SEPARATOR);
  if (separatorIndex <= 0) {
    return undefined;
  }
  return identity.slice(0, separatorIndex);
}

/**
 * The workspace id back out of an identity.
 *
 * Exact, not best-effort: the host cannot contain the separator (see above), so
 * everything after the first one is the id. That lets an index recover the id
 * from its own key instead of re-reading `worktree.id`, which matters because
 * retained selectors assert that getter is read exactly once per snapshot.
 */
export function getWorktreeIdFromHostIdentity(identity: string): string {
  return identity.slice(identity.indexOf(HOST_SEPARATOR) + 1);
}

/** True only for the canonical host-qualified form, not a legacy id containing `|`. */
export function isWorktreeHostIdentity(identity: string): boolean {
  const separator = identity.indexOf(HOST_SEPARATOR);
  return separator === 0 || separator > 0;
}
