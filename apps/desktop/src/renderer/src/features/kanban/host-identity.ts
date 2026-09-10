/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca
   src/shared/worktree/host-qualified-identity.ts at pinned source c9790628
   (clioo/drogon-orca), adapted to Drogon's data boundary.

   Drogon contract (differs from the source by necessity): a host id is an
   OPAQUE daemon string — drogon-core mints a UUID v4 per data dir
   (crates/drogon-core/src/db.rs read_or_create_host_id) and stores it as
   plain TEXT on projects/workspaces — so the source's ExecutionHostId
   charset guarantee (a `local` literal, or `ssh:`/`runtime:` prefixes whose
   payloads are encodeURIComponent-escaped and therefore cannot contain a
   literal `|`) does not transfer. This module restores the SAME guarantee
   at the composition boundary instead of assuming it:

   - compose percent-encodes the host part, so a host containing `|` (or any
     other reserved character) can never collide with or rebind onto another
     host's identities; the workspace-id part stays raw exactly like the
     source ("the workspace id may contain anything"; the split recovers it
     from the FIRST separator).
   - an absent host composes the canonical unqualified form `|<id>`: its own
     bucket, never folded into any host and never defaulted to `local`
     (Drogon has no `local` literal at all).
   - parsing is strict: a malformed encoded host fails honestly (undefined /
     null), never a guessed host or a silently re-scoped id.

   AUTHORITY RULE (structural, not string-derived): the identity string is a
   KEY for DOM attributes, maps, sets and React trees. Host provenance for
   any destructive action must come from the record's raw `hostId` field
   (KanbanWorktree.hostId), never from parsing this string — a raw
   pipe-bearing string is syntactically indistinguishable from a composed
   identity of a host literally named that way, so no parser may arbitrate
   it. */

/**
 * Separator between the encoded host and the workspace id.
 *
 * Printable on purpose: these identities become React keys and DOM attribute
 * values, and HTML attribute parsing replaces U+0000 with U+FFFD — a NUL
 * separator would not survive the round trip an anchor comparison depends on.
 * `|` is safe as a delimiter because the composed host part is
 * percent-encoded and therefore cannot contain a literal `|` (the workspace
 * id after the first separator stays raw, exactly like the source).
 */
const HOST_SEPARATOR = "|";

/** The source's identity encoder, applied to Drogon's opaque host strings. */
function encodeHostPart(hostId: string): string {
  return encodeURIComponent(hostId);
}

/**
 * Stable key for one workspace on one host (STA-4343).
 *
 * A workspace id repeats across hosts, so any map, set or React key that must
 * keep two hosts' rows apart keys on this instead. The host part is
 * percent-encoded, making the first separator an unambiguous split even
 * though the workspace id may contain anything.
 *
 * Throws on an empty workspace id (source workspace ids are never empty):
 * a silent `|<empty>` key would collide across every workspace.
 */
export function composeWorktreeHostIdentity(
  hostId: string | null | undefined,
  worktreeId: string,
): string {
  if (worktreeId.length === 0) {
    throw new TypeError(
      "composeWorktreeHostIdentity: workspace id must be a non-empty string.",
    );
  }
  return `${hostId ? encodeHostPart(hostId) : ""}${HOST_SEPARATOR}${worktreeId}`;
}

function splitIdentity(
  identity: string,
): { hostPart: string; worktreeId: string } | null {
  const separatorIndex = identity.indexOf(HOST_SEPARATOR);
  if (separatorIndex === -1) {
    return null;
  }
  const hostPart = identity.slice(0, separatorIndex);
  const worktreeId = identity.slice(separatorIndex + HOST_SEPARATOR.length);
  if (worktreeId.length === 0) {
    return null;
  }
  return { hostPart, worktreeId };
}

function decodeHostPart(hostPart: string): string | null {
  if (hostPart.length === 0) {
    return null;
  }
  try {
    return decodeURIComponent(hostPart);
  } catch {
    // A malformed percent-escape is unsupported input: fail honestly rather
    // than handing back a guessed host.
    return null;
  }
}

/** Parsed view of one identity, or `null` when the string is not a
 *  well-formed canonical identity (no separator, empty workspace id, or a
 *  host part that is absent from the composer's output space — including raw
 *  characters compose would have percent-encoded). `host` is `null` exactly
 *  for the canonical unqualified form `|<id>` — an unknown host, never
 *  defaulted to any host. */
export function parseWorktreeHostIdentity(
  identity: string,
): { host: string | null; worktreeId: string; qualified: boolean } | null {
  const split = splitIdentity(identity);
  if (!split) {
    return null;
  }
  if (split.hostPart.length === 0) {
    return { host: null, worktreeId: split.worktreeId, qualified: false };
  }
  const host = decodeHostPart(split.hostPart);
  // Canonical-host check: compose would have percent-encoded the host, so a
  // part that does not round-trip was not written by this module. Fail
  // honestly instead of returning a host derived from foreign input.
  if (host === null || encodeHostPart(host) !== split.hostPart) {
    return null;
  }
  return { host, worktreeId: split.worktreeId, qualified: true };
}

/**
 * Stable key for one workspace row. Reads the row's own host field; an
 * unqualified row composes the canonical `|<id>` form.
 */
export function getWorktreeHostIdentity(worktree: {
  id: string;
  hostId?: string | null;
}): string {
  return composeWorktreeHostIdentity(worktree.hostId, worktree.id);
}

/**
 * The host back out of an identity, when the identity names one.
 *
 * An unqualified identity (`|<worktreeId>`) stays undefined rather than
 * defaulting to any host, and a malformed encoded host returns undefined
 * instead of a guessed value. Any returned host is display/routing DATA for
 * a record whose raw `hostId` field is the authority (see the module rule).
 */
export function getExecutionHostIdFromWorktreeHostIdentity(
  identity: string,
): string | undefined {
  const parsed = parseWorktreeHostIdentity(identity);
  return parsed?.qualified ? (parsed.host ?? undefined) : undefined;
}

/**
 * The workspace id back out of an identity.
 *
 * Exact, not best-effort: the encoded host part cannot contain the
 * separator, so everything after the first one is the id. That lets an index
 * recover the id from its own key instead of re-reading `worktree.id`, which
 * matters because retained selectors assert that getter is read exactly once
 * per snapshot. (Source behavior preserved: a string without the separator
 * returns the whole string.)
 */
export function getWorktreeIdFromHostIdentity(identity: string): string {
  return identity.slice(identity.indexOf(HOST_SEPARATOR) + 1);
}

/**
 * True only for the canonical composed form: one separator, a non-empty
 * workspace id, and a host part that is either empty (canonical unqualified)
 * or round-trips through decode -> encode unchanged (so raw spaces and other
 * characters compose would have encoded are rejected as non-canonical).
 *
 * This is a SYNTACTIC check for key hygiene. It cannot — and must not —
 * arbitrate whether a pipe-bearing string is a legacy raw id or a composed
 * identity of a host literally named that way; host authority always comes
 * from the record's raw `hostId` field, never from this classification.
 */
export function isWorktreeHostIdentity(identity: string): boolean {
  return parseWorktreeHostIdentity(identity) !== null;
}
