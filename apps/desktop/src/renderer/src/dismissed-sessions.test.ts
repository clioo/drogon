import { describe, expect, test } from "vitest";
import {
  isSessionDismissed,
  loadDismissedSessions,
  markSessionDismissed,
} from "./dismissed-sessions";

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

const session = (
  id: string,
  incarnation: string,
  verdict: "exited" | "live" | "unverifiable" = "exited",
) => ({
  id,
  workspaceId: "w1",
  hostId: "h1",
  incarnation,
  command: "/bin/sh",
  args: [],
  cols: 80,
  rows: 24,
  verdict,
  exitCode: verdict === "exited" ? 0 : null,
  createdAt: "2026-01-01T00:00:00Z",
});

describe("dismissed session view state", () => {
  test("a dismissed session stays hidden across a fresh load, scoped by host+id+incarnation", () => {
    const storage = fakeStorage();
    markSessionDismissed("h1", "s1", "inc-1", storage);
    const loaded = loadDismissedSessions(storage);
    expect(isSessionDismissed(loaded, "h1", session("s1", "inc-1"))).toBe(true);
  });
  test("a session the user never closed is never treated as dismissed", () => {
    const storage = fakeStorage();
    const loaded = loadDismissedSessions(storage);
    expect(isSessionDismissed(loaded, "h1", session("s1", "inc-1"))).toBe(
      false,
    );
  });
  test("a different host, id, or incarnation is a distinct identity", () => {
    const storage = fakeStorage();
    markSessionDismissed("h1", "s1", "inc-1", storage);
    const loaded = loadDismissedSessions(storage);
    expect(isSessionDismissed(loaded, "h2", session("s1", "inc-1"))).toBe(
      false,
    );
    expect(isSessionDismissed(loaded, "h1", session("s2", "inc-1"))).toBe(
      false,
    );
    expect(isSessionDismissed(loaded, "h1", session("s1", "inc-2"))).toBe(
      false,
    );
  });
  test("tampered storage is treated as empty, never trusted", () => {
    const storage = fakeStorage();
    storage.setItem("drogon:dismissed-sessions", '{"not":"an array"}');
    expect(loadDismissedSessions(storage).size).toBe(0);
    storage.setItem("drogon:dismissed-sessions", "not json at all");
    expect(loadDismissedSessions(storage).size).toBe(0);
  });
  // Regression: a matching identity in dismissal storage (tampered, or a
  // reused id/incarnation) must never hide a session that is actually
  // `live` or `unverifiable` — only a positively `exited` session can ever
  // be treated as dismissed.
  test("a matching identity never hides a live or unverifiable session, even if present in dismissal storage", () => {
    const storage = fakeStorage();
    markSessionDismissed("h1", "s1", "inc-1", storage);
    const loaded = loadDismissedSessions(storage);
    expect(
      isSessionDismissed(loaded, "h1", session("s1", "inc-1", "live")),
    ).toBe(false);
    expect(
      isSessionDismissed(loaded, "h1", session("s1", "inc-1", "unverifiable")),
    ).toBe(false);
    expect(
      isSessionDismissed(loaded, "h1", session("s1", "inc-1", "exited")),
    ).toBe(true);
  });

  test("entries are bounded rather than growing without limit", () => {
    const storage = fakeStorage();
    for (let i = 0; i < 510; i += 1)
      markSessionDismissed("h1", `s${i}`, "inc", storage);
    expect(loadDismissedSessions(storage).size).toBeLessThanOrEqual(500);
    // The most recent dismissal must survive the bound.
    expect(
      isSessionDismissed(
        loadDismissedSessions(storage),
        "h1",
        session("s509", "inc"),
      ),
    ).toBe(true);
  });
});
