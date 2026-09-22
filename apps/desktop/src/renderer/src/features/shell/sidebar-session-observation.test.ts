// MIT Copyright (c) 2026 Lovecast Inc.
// R3: client-side provenance for sidebar observation metadata. The daemon's
// rows carry no poll identity: `observedHarnessAt` stamps only positive
// observations (a null clear has nothing to stamp) and `hasForegroundChild`
// has no timestamp at all. So the shell numbers its own successful reads
// and remembers, per exact session, which read last wrote the selected
// copy — only a newer successful read may move it again.
import { describe, expect, test } from "vitest";
import {
  OBSERVATION_LEDGER_MAX_ENTRIES,
  createObservationLedger,
  isStalePollSettlement,
  observationKey,
  observationKeyOf,
  readObservationSnapshot,
  sameObservation,
} from "./sidebar-session-observation";

describe("observationKey", () => {
  test("exact host+id+incarnation identity, never a bare id", () => {
    expect(observationKey("h1", "s1", "inc-1")).toBe("h1:s1:inc-1");
    expect(observationKeyOf({ hostId: "h1", id: "s1", incarnation: "inc-1" })).toBe(
      "h1:s1:inc-1",
    );
    expect(observationKey("h1", "s1", "inc-2")).not.toBe(
      observationKey("h1", "s1", "inc-1"),
    );
    expect(observationKey("h2", "s1", "inc-1")).not.toBe(
      observationKey("h1", "s1", "inc-1"),
    );
  });
});

describe("readObservationSnapshot", () => {
  test("absent reads as the idle claim, matching an older daemon's rows", () => {
    expect(readObservationSnapshot({})).toEqual({
      observedHarnessId: null,
      observedHarnessAt: null,
      hasForegroundChild: false,
    });
    expect(
      sameObservation(
        readObservationSnapshot({}),
        readObservationSnapshot({
          observedHarnessId: null,
          observedHarnessAt: null,
          hasForegroundChild: false,
        }),
      ),
    ).toBe(true);
  });

  test("a positive observation round-trips; false and true never agree", () => {
    const positive = readObservationSnapshot({
      observedHarnessId: "pi",
      observedHarnessAt: "2026-01-01T00:01:00Z",
      hasForegroundChild: true,
    });
    expect(positive.observedHarnessId).toBe("pi");
    expect(
      sameObservation(positive, readObservationSnapshot({ hasForegroundChild: false })),
    ).toBe(false);
    expect(
      sameObservation(
        readObservationSnapshot({ hasForegroundChild: true }),
        readObservationSnapshot({ hasForegroundChild: false }),
      ),
    ).toBe(false);
  });
});

describe("createObservationLedger", () => {
  test("the first write wins until a newer poll proves more", () => {
    const ledger = createObservationLedger();
    expect(ledger.shouldApply("h1:s1:inc-1", 6)).toBe(true);
    ledger.markApplied("h1:s1:inc-1", 6);
    expect(ledger.shouldApply("h1:s1:inc-1", 6)).toBe(false);
    expect(ledger.shouldApply("h1:s1:inc-1", 5)).toBe(false);
    expect(ledger.shouldApply("h1:s1:inc-1", 7)).toBe(true);
  });

  test("keys are independent and incarnation-exact", () => {
    const ledger = createObservationLedger();
    ledger.markApplied("h1:s1:inc-1", 6);
    expect(ledger.shouldApply("h1:s1:inc-2", 6)).toBe(true);
    expect(ledger.shouldApply("h2:s1:inc-1", 6)).toBe(true);
    expect(ledger.shouldApply("h1:s2:inc-1", 6)).toBe(true);
  });

  test("state stays bounded: the oldest proof is evicted first", () => {
    const ledger = createObservationLedger(2);
    ledger.markApplied("h1:a:1", 1);
    ledger.markApplied("h1:b:1", 2);
    expect(ledger.size).toBe(2);
    ledger.markApplied("h1:c:1", 3);
    expect(ledger.size).toBe(2);
    // Eviction re-arms the evicted key for ANY seq — including a stale one.
    // The shell never relies on eviction being harmless: stale poll
    // settlements and stale selected-workspace reads are fenced by read
    // provenance before they reach the ledger, and the adopt path prunes to
    // the live selected copy so unrelated history cannot evict a live key.
    expect(ledger.shouldApply("h1:a:1", 4)).toBe(true);
    expect(ledger.shouldApply("h1:b:1", 2)).toBe(false);
    expect(OBSERVATION_LEDGER_MAX_ENTRIES).toBeGreaterThan(2);
  });

  test("an evicted key re-arms for a stale seq: the global order gate must block it first", () => {
    // Regression: with a tiny bound, admitting a newer fact for a live key
    // and then evicting it with unrelated keys lets an older seq win again.
    // Production never lets that older seq reach the ledger when a newer
    // read of the same authority already settled.
    const ledger = createObservationLedger(2);
    ledger.markApplied("h1:live:1", 6);
    expect(ledger.shouldApply("h1:live:1", 5)).toBe(false);
    ledger.markApplied("h1:other:1", 7);
    ledger.markApplied("h1:third:1", 8);
    expect(ledger.size).toBe(2);
    // The live proof was the oldest eviction victim: the stale seq wins the
    // ledger check again — which is why the shell fences seq 5 before
    // consulting the ledger once seq 8 settled for the same source.
    expect(ledger.shouldApply("h1:live:1", 5)).toBe(true);
    expect(isStalePollSettlement(5, 8)).toBe(true);
  });

  test("prune keeps live selected proof and drops only unselected history", () => {
    const ledger = createObservationLedger();
    ledger.markApplied("h1:live:1", 6);
    ledger.markApplied("h1:gone:1", 6);
    expect(ledger.size).toBe(2);
    ledger.prune(new Set(["h1:live:1"]));
    expect(ledger.size).toBe(1);
    // Live proof survives: a stale write still loses.
    expect(ledger.shouldApply("h1:live:1", 5)).toBe(false);
    expect(ledger.shouldApply("h1:live:1", 7)).toBe(true);
    // Pruned history only costs one redundant fresh re-apply.
    expect(ledger.shouldApply("h1:gone:1", 7)).toBe(true);
  });
});

describe("isStalePollSettlement", () => {
  test("an older request settling after a newer one is stale", () => {
    expect(isStalePollSettlement(5, 6)).toBe(true);
    expect(isStalePollSettlement(6, 6)).toBe(false);
    expect(isStalePollSettlement(7, 6)).toBe(false);
  });
});
