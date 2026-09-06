import { describe, expect, test } from "vitest";
import {
  clearPendingHarnessLaunch,
  loadPendingHarnessLaunch,
  savePendingHarnessLaunch,
} from "./harness-launch-recovery";
import type { HarnessLaunchInput } from "../../shared/session-contract";

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage;
}

const input: HarnessLaunchInput = {
  workspaceId: "w1",
  harnessId: "claude",
  permissionMode: "inherit",
  requestId: "11111111-1111-1111-1111-111111111111",
};

describe("harness launch recovery", () => {
  test("a saved intent is recoverable for its exact host and workspace", () => {
    const storage = fakeStorage();
    savePendingHarnessLaunch("h1", input, storage);
    expect(loadPendingHarnessLaunch("h1", "w1", storage)).toEqual(input);
  });
  test("an intent scoped to a different workspace is not offered", () => {
    const storage = fakeStorage();
    savePendingHarnessLaunch("h1", input, storage);
    expect(loadPendingHarnessLaunch("h1", "w2", storage)).toBeNull();
  });
  test("an intent scoped to a different host is not offered, even for the same workspace", () => {
    const storage = fakeStorage();
    savePendingHarnessLaunch("h1", input, storage);
    expect(loadPendingHarnessLaunch("h2", "w1", storage)).toBeNull();
  });
  test("clearing the exact matching entry removes it so a confirmed launch never re-offers", () => {
    const storage = fakeStorage();
    savePendingHarnessLaunch("h1", input, storage);
    clearPendingHarnessLaunch("h1", input, storage);
    expect(loadPendingHarnessLaunch("h1", "w1", storage)).toBeNull();
  });
  test("no intent saved is simply absent, not an error", () => {
    expect(loadPendingHarnessLaunch("h1", "w1", fakeStorage())).toBeNull();
  });
  test("tampered or malformed storage is discarded, never trusted", () => {
    const storage = fakeStorage();
    storage.setItem(
      "drogon:pending-harness-launch",
      JSON.stringify([
        { hostId: "h1", input: { harnessId: "claude" }, savedAt: 1 },
      ]),
    );
    expect(loadPendingHarnessLaunch("h1", "w1", storage)).toBeNull();
    storage.setItem("drogon:pending-harness-launch", "not json");
    expect(loadPendingHarnessLaunch("h1", "w1", storage)).toBeNull();
    storage.setItem(
      "drogon:pending-harness-launch",
      JSON.stringify([
        {
          hostId: "h1",
          input: { ...input, harnessId: "rm -rf /" },
          savedAt: 1,
        },
      ]),
    );
    expect(loadPendingHarnessLaunch("h1", "w1", storage)).toBeNull();
  });

  // Regression: the original draft used one global storage key, so a save
  // for a second workspace silently overwrote the first workspace's
  // pending entry entirely.
  test("saving a pending intent for one workspace never overwrites another workspace's pending intent", () => {
    const storage = fakeStorage();
    const w2Input: HarnessLaunchInput = {
      ...input,
      workspaceId: "w2",
      requestId: "2".repeat(32),
    };
    savePendingHarnessLaunch("h1", input, storage);
    savePendingHarnessLaunch("h1", w2Input, storage);
    expect(loadPendingHarnessLaunch("h1", "w1", storage)).toEqual(input);
    expect(loadPendingHarnessLaunch("h1", "w2", storage)).toEqual(w2Input);
  });

  // Regression: the original draft's `clearPendingHarnessLaunch` removed
  // the entire storage key unconditionally — an old, already-superseded
  // completion resolving late (out of order) would wipe out whatever the
  // *current* pending intent was, even for a totally different attempt.
  test("clearing one (now-stale) intent never deletes a newer intent saved for the same workspace since", () => {
    const storage = fakeStorage();
    const staleAttempt = input;
    savePendingHarnessLaunch("h1", staleAttempt, storage);
    const newerAttempt: HarnessLaunchInput = {
      ...input,
      prompt: "a different prompt",
      requestId: "22222222-2222-2222-2222-222222222222",
    };
    savePendingHarnessLaunch("h1", newerAttempt, storage);
    // The late, stale completion clears using the *old* requestId.
    clearPendingHarnessLaunch("h1", staleAttempt, storage);
    // The newer intent (a distinct requestId) must still be recoverable.
    expect(loadPendingHarnessLaunch("h1", "w1", storage)).toEqual(newerAttempt);
  });

  // Regression: a legacy record saved before host-scoping existed (or a
  // tampered entry with no hostId) must never be replayed on *any* host —
  // not "the current host", every host.
  test("a hostless legacy/tampered entry is never offered for recovery on any host", () => {
    const storage = fakeStorage();
    storage.setItem(
      "drogon:pending-harness-launch",
      JSON.stringify([{ input, savedAt: 1 }]),
    );
    expect(loadPendingHarnessLaunch("h1", "w1", storage)).toBeNull();
    expect(loadPendingHarnessLaunch("h2", "w1", storage)).toBeNull();
  });

  test("one malformed entry does not discard other, otherwise-valid entries in the same array", () => {
    const storage = fakeStorage();
    storage.setItem(
      "drogon:pending-harness-launch",
      JSON.stringify([
        { hostId: "h1", input: { harnessId: "claude" }, savedAt: 1 },
        { hostId: "h1", input, savedAt: 2 },
      ]),
    );
    expect(loadPendingHarnessLaunch("h1", "w1", storage)).toEqual(input);
  });

  test("entries are bounded rather than growing without limit", () => {
    const storage = fakeStorage();
    for (let i = 0; i < 25; i += 1) {
      savePendingHarnessLaunch(
        "h1",
        {
          ...input,
          workspaceId: `w${i}`,
          requestId: String(i).padStart(32, "0"),
        },
        storage,
      );
    }
    // The most recent workspace's entry must survive the bound.
    expect(loadPendingHarnessLaunch("h1", "w24", storage)).not.toBeNull();
    // The earliest ones are evicted.
    expect(loadPendingHarnessLaunch("h1", "w0", storage)).toBeNull();
  });
});
