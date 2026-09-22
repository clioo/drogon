/* MIT Copyright (c) 2026 Lovecast Inc.
   Client-side provenance for sidebar observation metadata (R3). The
   daemon's rows carry no poll identity: `observedHarnessAt` stamps only
   positive observations (a null clear has nothing to stamp) and
   `hasForegroundChild` has no timestamp at all, so `observedHarnessAt`
   alone cannot order a clear or a foreground flip. The shell therefore
   numbers its own successful reads (poll request order) and remembers,
   per exact session, which read last wrote the selected copy: only a
   newer successful read may move it again. Retained collector rows still
   render unselected last-known cards, but they carry no read proof and
   are never applied as new facts. Bounded: the ledger evicts the oldest
   proof first, which can only cost one redundant fresh re-apply. */
import type { HarnessId, Session } from "../../../../shared/session-contract";

/** Exact identity a poll row must match before its observation metadata
 *  may refresh a selected copy: a coincident id from another host, or a
 *  same-id/different-incarnation row, is a different session. */
export function observationKey(
  hostId: string,
  id: string,
  incarnation: string,
): string {
  return `${hostId}:${id}:${incarnation}`;
}

export function observationKeyOf(
  session: Pick<Session, "hostId" | "id" | "incarnation">,
): string {
  return observationKey(session.hostId, session.id, session.incarnation);
}

/** The three observation fields normalized: absent reads as the idle claim
 *  (null observation, no foreground child), matching an older daemon whose
 *  rows carry neither field; false and true never agree. */
export type ObservationSnapshot = {
  observedHarnessId: HarnessId | null;
  observedHarnessAt: string | null;
  hasForegroundChild: boolean;
};

export function readObservationSnapshot(
  session: Partial<Pick<Session, "observedHarnessId" | "observedHarnessAt" | "hasForegroundChild">>,
): ObservationSnapshot {
  return {
    observedHarnessId: session.observedHarnessId ?? null,
    observedHarnessAt: session.observedHarnessAt ?? null,
    hasForegroundChild: session.hasForegroundChild ?? false,
  };
}

export function sameObservation(
  left: ObservationSnapshot,
  right: ObservationSnapshot,
): boolean {
  return (
    left.observedHarnessId === right.observedHarnessId &&
    left.observedHarnessAt === right.observedHarnessAt &&
    left.hasForegroundChild === right.hasForegroundChild
  );
}

/** Bound on per-session ordering proofs (see the ledger below). */
export const OBSERVATION_LEDGER_MAX_ENTRIES = 1024;

export type ObservationLedger = {
  /** True when `seq` is newer than whatever last wrote `key` (or nothing did). */
  shouldApply(key: string, seq: number): boolean;
  /** Records that `seq` wrote `key`. Callers check `shouldApply` first, so
   *  the stored proof only ever moves forward. */
  markApplied(key: string, seq: number): void;
  /** Drops proof for keys outside `keep` (normally the live selected copy),
   *  so retained state stays bounded by selection size instead of history.
   *  Pruning an unselected key only costs one redundant fresh re-apply when
   *  its workspace is next selected; it never lets a stale write win for a
   *  live key because live keys are always kept. */
  prune(keep: ReadonlySet<string>): void;
  readonly size: number;
};

/**
 * Per-session last-write proof for observation metadata. Eviction is oldest
 * first: forgetting a key re-arms it for ANY seq, including a stale one, so
 * callers must never rely on eviction being harmless on its own. In the
 * shell this is safe for two structural reasons, both pinned by regression:
 * globally stale polls/fetches are dropped by request order before they
 * reach the ledger, and the adopt path prunes to the live selected copy so
 * a live key is never the eviction victim while its row can still be
 * overwritten. A re-apply after prune/eviction still applies only
 * freshly-read rows.
 */
export function createObservationLedger(
  maxEntries: number = OBSERVATION_LEDGER_MAX_ENTRIES,
): ObservationLedger {
  const applied = new Map<string, number>();
  const bound = Math.max(1, Math.floor(maxEntries));
  return {
    shouldApply(key, seq) {
      const last = applied.get(key);
      return last === undefined || seq > last;
    },
    markApplied(key, seq) {
      const last = applied.get(key);
      if (last !== undefined && seq <= last) return;
      if (!applied.has(key)) {
        while (applied.size >= bound) {
          const oldest = applied.keys().next();
          if (oldest.done) break;
          applied.delete(oldest.value);
        }
      } else {
        applied.delete(key);
      }
      applied.set(key, seq);
    },
    prune(keep) {
      for (const key of [...applied.keys()]) {
        if (!keep.has(key)) applied.delete(key);
      }
    },
    get size() {
      return applied.size;
    },
  };
}

/**
 * Poll settlement ordering for overlapping polls: requests are numbered in
 * start order, so a response whose request predates the last settled one
 * arrived out of order and must not replace what the newer poll committed.
 * Equal (a retry settling twice) is not stale.
 */
export function isStalePollSettlement(
  requestSeq: number,
  lastSettledSeq: number,
): boolean {
  return requestSeq < lastSettledSeq;
}
