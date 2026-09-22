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
    // Evicting a live key only costs one redundant fresh re-apply, never a
    // stale write: the evicted key reads as never-seen again.
    expect(ledger.shouldApply("h1:a:1", 4)).toBe(true);
    expect(ledger.shouldApply("h1:b:1", 2)).toBe(false);
    expect(OBSERVATION_LEDGER_MAX_ENTRIES).toBeGreaterThan(2);
  });
});

describe("isStalePollSettlement", () => {
  test("an older request settling after a newer one is stale", () => {
    expect(isStalePollSettlement(5, 6)).toBe(true);
    expect(isStalePollSettlement(6, 6)).toBe(false);
    expect(isStalePollSettlement(7, 6)).toBe(false);
  });
});
