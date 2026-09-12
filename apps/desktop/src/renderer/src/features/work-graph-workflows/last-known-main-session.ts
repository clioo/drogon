// MIT Copyright (c) 2026 Lovecast Inc.
// The Orchestrator's Main agent node is a live projection of the
// workspace's real session (`OrchestratorCanvas.tsx`'s Part 4 note) — but
// the daemon's session list drops a session once it is fully torn down, so
// `mainSession` itself goes back to null the moment a session exits AND
// the renderer re-fetches the list, which a plain in-memory `useRef` does
// not survive: a real page/app reload wipes it exactly like the bug it
// would otherwise fix. Persisting the last-observed record here (one entry
// per workspace) is what makes the honest exited/unverifiable state
// survive a reload too, not only an in-app navigation.
//
// Storage is read defensively: anything not exactly the expected shape is
// treated as absent rather than trusted, the same rule
// `dismissed-sessions.ts` follows — this file only redraws a node, so a
// tampered or stale entry must never be able to fabricate a session that
// was never observed.

import type { Session, Verdict } from "../../../../shared/session-contract";

const STORAGE_PREFIX = "drogon:orchestrator:last-known-main-session:";

const KNOWN_VERDICTS: ReadonlySet<string> = new Set<Verdict>([
  "live",
  "unverifiable",
  "exited",
]);

function isPersistableSession(value: unknown): value is Session {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.incarnation === "string" &&
    typeof record.workspaceId === "string" &&
    typeof record.verdict === "string" &&
    KNOWN_VERDICTS.has(record.verdict) &&
    (record.harnessId === undefined ||
      record.harnessId === null ||
      typeof record.harnessId === "string")
  );
}

/** Reads the last session observed live for this workspace, or null when
 *  none was ever recorded (or storage is unavailable/corrupted). */
export function loadLastKnownMainSession(
  workspaceId: string,
  storage: Pick<Storage, "getItem"> = localStorage,
): Session | null {
  try {
    const raw = storage.getItem(STORAGE_PREFIX + workspaceId);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isPersistableSession(parsed)) return null;
    if (parsed.workspaceId !== workspaceId) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Records the most recently observed main session for this workspace.
 *  Called for every non-null `mainSession` render, live or already
 *  exited — whichever the renderer most recently saw is the fact worth
 *  keeping. */
export function saveLastKnownMainSession(
  workspaceId: string,
  session: Session,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  try {
    storage.setItem(STORAGE_PREFIX + workspaceId, JSON.stringify(session));
  } catch {
    // Best-effort view state; a write failure must not block rendering.
  }
}
