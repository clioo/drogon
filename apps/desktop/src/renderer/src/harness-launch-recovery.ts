import { bridgeSchemas } from "../../shared/bridge-validation";
import type {
  Harness,
  HarnessLaunchInput,
} from "../../shared/session-contract";
import { ALLOWED_EFFORT_LEVELS } from "./harness-launch-form";

const STORAGE_KEY = "drogon:pending-harness-launch";
// Bounds unbounded growth across many workspaces/hosts; oldest entries drop first.
const MAX_ENTRIES = 20;

type PendingEntry = {
  hostId: string;
  input: HarnessLaunchInput;
  savedAt: number;
};

function isNonemptyBoundedString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

/**
 * A stored entry's identity is host+workspace+requestId — never just
 * workspace. Without the host, a retry on a *different* execution host
 * (a future multi-host connection) could replay someone else's intent
 * there; without the requestId, an unrelated later attempt for the same
 * workspace could be mistaken for the one being cleared.
 */
function sameIntent(
  a: { hostId: string; workspaceId: string; requestId: string },
  b: { hostId: string; workspaceId: string; requestId: string },
): boolean {
  return (
    a.hostId === b.hostId &&
    a.workspaceId === b.workspaceId &&
    a.requestId === b.requestId
  );
}

/**
 * Individually validates each entry rather than trusting or discarding the
 * whole array on one bad element — one tampered/legacy entry must not cost
 * every other workspace's recoverable intent. An entry with no (or
 * malformed) `hostId` is a pre-host-scoping legacy record, or tampering;
 * either way it is dropped entirely here, never offered for *any* host.
 */
function readAll(storage: Pick<Storage, "getItem">): PendingEntry[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is PendingEntry => {
      if (!entry || typeof entry !== "object") return false;
      const e = entry as Record<string, unknown>;
      return (
        isNonemptyBoundedString(e.hostId) &&
        typeof e.savedAt === "number" &&
        bridgeSchemas.startHarness.safeParse(e.input).success
      );
    });
  } catch {
    return [];
  }
}

function writeAll(
  storage: Pick<Storage, "setItem">,
  entries: PendingEntry[],
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // Best-effort recovery aid; a write failure must not block the launch.
  }
}

/**
 * Called right before the launch attempt, before its outcome is known.
 * Supersedes any existing entry for this exact host+workspace (a new
 * attempt — whether a genuine retry or changed params — replaces the prior
 * pending intent there) while entries for every *other* workspace or host
 * are left untouched, unlike a single global key that would silently
 * overwrite them.
 */
export function savePendingHarnessLaunch(
  hostId: string,
  input: HarnessLaunchInput,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): void {
  const remaining = readAll(storage).filter(
    (entry) =>
      !(
        entry.hostId === hostId && entry.input.workspaceId === input.workspaceId
      ),
  );
  writeAll(storage, [...remaining, { hostId, input, savedAt: Date.now() }]);
}

/**
 * Called only once a launch is *confirmed* (never merely attempted), and
 * only removes the one entry matching this exact host+workspace+requestId.
 * An older, already-superseded response resolving late (out of order)
 * carries its own stale requestId, so it can never blindly delete a newer
 * intent saved for the same workspace since.
 */
export function clearPendingHarnessLaunch(
  hostId: string,
  input: HarnessLaunchInput,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): void {
  const target = {
    hostId,
    workspaceId: input.workspaceId,
    requestId: input.requestId,
  };
  const remaining = readAll(storage).filter(
    (entry) =>
      !sameIntent(
        {
          hostId: entry.hostId,
          workspaceId: entry.input.workspaceId,
          requestId: entry.input.requestId,
        },
        target,
      ),
  );
  writeAll(storage, remaining);
}

/**
 * Returns the pending intent for this exact host+workspace only —
 * corrupted, tampered, cross-workspace, or cross-host storage is never
 * surfaced as something to recover. This never auto-launches anything; it
 * only makes an exact, explicit retry possible.
 */
export function loadPendingHarnessLaunch(
  hostId: string,
  workspaceId: string,
  storage: Pick<Storage, "getItem"> = localStorage,
): HarnessLaunchInput | null {
  const entries = readAll(storage);
  // Most recently saved match wins if more than one somehow exists.
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.hostId === hostId && entry.input.workspaceId === workspaceId)
      return entry.input;
  }
  return null;
}

/**
 * Whether a stored pending intent is still honestly recoverable against
 * the CURRENT harness list: the harness must still be listed as
 * `available` (host fencing — a binary removed or disabled since the
 * save must not be re-offered), the provider must still be Pi-only, and
 * the effort must still be advertised for the harness. Unknown ids stay
 * recoverable (manual-unverified, never refuted without a real host
 * catalog). Pure data adapter for the held menu handover; `load*`
 * behavior above is unchanged.
 */
export function isPendingLaunchRecoverable(
  input: HarnessLaunchInput,
  harnesses: Pick<Harness, "harnessId" | "availability">[],
): boolean {
  const listed = harnesses.find(
    (harness) => harness.harnessId === input.harnessId,
  );
  if (!listed || listed.availability !== "available") return false;
  if (input.provider !== undefined && input.harnessId !== "pi") return false;
  if (
    input.effort !== undefined &&
    !ALLOWED_EFFORT_LEVELS[input.harnessId].includes(input.effort)
  )
    return false;
  return true;
}
