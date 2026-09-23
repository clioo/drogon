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

export type AdmittedObservation = {
  seq: number;
  snapshot: ObservationSnapshot | null;
};

export type ObservationLedger = {
  /** True when `seq` is newer than whatever last wrote `key` (or nothing did). */
  shouldApply(key: string, seq: number): boolean;
  /** Records that `seq` wrote `key` and the exact admitted value. Callers check
   *  `shouldApply` first, so the stored proof only ever moves forward. */
  markApplied(key: string, seq: number, snapshot?: ObservationSnapshot | null): void;
  /** The exact value admitted for this key, bounded and pruned with the proof. */
  admitted(key: string): AdmittedObservation | null;
  /** Drops admitted values for keys outside `keep` (normally the live
   *  selected copy) while retiring their seq into the stale-write floor.
   *  Values stay bounded by selection size/history, but an older in-flight
   *  request cannot treat pruned proof as if no newer read existed. */
  prune(keep: ReadonlySet<string>): void;
  readonly size: number;
};

/**
 * Per-session last-write proof for observation metadata. Admitted values are
 * bounded oldest-first, but forgotten proof retires into a monotonic floor:
 * values can be evicted/pruned, stale in-flight reads still lose. The floor
 * advances only when proof is actually forgotten, not on every successful
 * admission, so unrelated keys remain admissible until a real retirement
 * creates a known lower bound.
 */
export function createObservationLedger(
  maxEntries: number = OBSERVATION_LEDGER_MAX_ENTRIES,
): ObservationLedger {
  const applied = new Map<string, AdmittedObservation>();
  // Global read-order floor for keys whose bounded value proof was evicted
  // or pruned. Values remain bounded by `applied`, but an older in-flight
  // request can never treat forgotten proof as if no newer read existed.
  let floorSeq = 0;
  const bound = Math.max(1, Math.floor(maxEntries));
  return {
    shouldApply(key, seq) {
      const last = applied.get(key);
      if (last !== undefined) return seq > last.seq;
      return seq > floorSeq;
    },
    markApplied(key, seq, snapshot = null) {
      const last = applied.get(key);
      if (last !== undefined && seq <= last.seq) return;
      if (last === undefined && seq < floorSeq) return;
      if (!applied.has(key)) {
        while (applied.size >= bound) {
          const oldest = applied.keys().next();
          if (oldest.done) break;
          const evicted = applied.get(oldest.value);
          applied.delete(oldest.value);
          if (evicted) floorSeq = Math.max(floorSeq, evicted.seq);
        }
      } else {
        applied.delete(key);
      }
      applied.set(key, { seq, snapshot });
    },
    admitted(key) {
      const value = applied.get(key);
      return value ? { seq: value.seq, snapshot: value.snapshot } : null;
    },
    prune(keep) {
      for (const key of [...applied.keys()]) {
        if (!keep.has(key)) {
          const forgotten = applied.get(key);
          applied.delete(key);
          if (forgotten) floorSeq = Math.max(floorSeq, forgotten.seq);
        }
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
