import { describe, expect, test } from "vitest";
import type { Session } from "../../../../shared/session-contract";
import {
  loadLastKnownMainSession,
  saveLastKnownMainSession,
} from "./last-known-main-session";

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

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    workspaceId: "ws1",
    hostId: "h1",
    incarnation: "inc-1",
    command: "/bin/sh",
    args: [],
    cols: 80,
    rows: 24,
    verdict: "exited",
    exitCode: 0,
    createdAt: "2026-01-01T00:00:00Z",
    harnessId: "claude",
    ...overrides,
  };
}

describe("last-known main session view state", () => {
  test("a saved session round-trips for its own workspace", () => {
    const storage = fakeStorage();
    saveLastKnownMainSession("ws1", session(), storage);
    expect(loadLastKnownMainSession("ws1", storage)).toEqual(session());
  });

  test("no entry yet reads honestly as null, never fabricated", () => {
    const storage = fakeStorage();
    expect(loadLastKnownMainSession("ws1", storage)).toBeNull();
  });

  test("a different workspace's entry is a distinct identity", () => {
    const storage = fakeStorage();
    saveLastKnownMainSession("ws1", session({ workspaceId: "ws1" }), storage);
    expect(loadLastKnownMainSession("ws2", storage)).toBeNull();
  });

  test("tampered or malformed storage is treated as absent, never trusted", () => {
    const storage = fakeStorage();
    storage.setItem(
      "drogon:orchestrator:last-known-main-session:ws1",
      "not json at all",
    );
    expect(loadLastKnownMainSession("ws1", storage)).toBeNull();
    storage.setItem(
      "drogon:orchestrator:last-known-main-session:ws1",
      JSON.stringify({ id: "s1" }),
    );
    expect(loadLastKnownMainSession("ws1", storage)).toBeNull();
    storage.setItem(
      "drogon:orchestrator:last-known-main-session:ws1",
      JSON.stringify(session({ verdict: "definitely-not-a-verdict" as never })),
    );
    expect(loadLastKnownMainSession("ws1", storage)).toBeNull();
  });

  test("an entry whose own workspaceId does not match the key is refused, never mismatched", () => {
    const storage = fakeStorage();
    // Simulates a corrupted/hand-edited entry: the KEY says ws1 but the
    // stored payload claims a different workspace.
    storage.setItem(
      "drogon:orchestrator:last-known-main-session:ws1",
      JSON.stringify(session({ workspaceId: "ws2" })),
    );
    expect(loadLastKnownMainSession("ws1", storage)).toBeNull();
  });

  test("saving again overwrites the previous entry for that workspace", () => {
    const storage = fakeStorage();
    saveLastKnownMainSession("ws1", session({ verdict: "live" }), storage);
    saveLastKnownMainSession("ws1", session({ verdict: "exited" }), storage);
    expect(loadLastKnownMainSession("ws1", storage)?.verdict).toBe("exited");
  });

  test("a storage write failure never throws — best-effort only", () => {
    const throwing: Pick<Storage, "setItem"> = {
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };
    expect(() => saveLastKnownMainSession("ws1", session(), throwing)).not.toThrow();
  });

  test("a storage read failure never throws — reads as absent", () => {
    const throwing: Pick<Storage, "getItem"> = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadLastKnownMainSession("ws1", throwing)).toBeNull();
  });
});
