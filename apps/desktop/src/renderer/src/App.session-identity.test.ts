import { describe, expect, test } from "vitest";
import {
  appendOrReplaceSession,
  applyConfirmedClose,
  contextMatches,
  removeSessionExact,
} from "./App";
import type { Session } from "../../shared/session-contract";

const session = (id: string, overrides: Partial<Session> = {}): Session => ({
  id,
  workspaceId: "w1",
  hostId: "h1",
  incarnation: "inc-1",
  command: "/bin/sh",
  args: [],
  cols: 80,
  rows: 24,
  verdict: "live",
  exitCode: null,
  createdAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

describe("appendOrReplaceSession", () => {
  test("a new session id is appended", () => {
    const items = [session("s1")];
    const result = appendOrReplaceSession(items, session("s2"));
    expect(result.map((item) => item.id)).toEqual(["s1", "s2"]);
  });

  // Regression: a retry recovering an already-listed session/incarnation
  // (the service's idempotency ledger returning the same session for a
  // reused requestId) must update that tab in place, never add a second one.
  test("an already-listed session id, host and incarnation is replaced in place, not duplicated", () => {
    const items = [session("s1", { verdict: "live" }), session("s2")];
    const recovered = session("s1", { verdict: "exited", exitCode: 0 });
    const result = appendOrReplaceSession(items, recovered);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(recovered);
    expect(result[1].id).toBe("s2");
  });

  // Regression: ids are only guaranteed unique per host; a coincident id
  // from a *different* host is not the same session and must never
  // overwrite it.
  test("a matching id from a different host is appended alongside, never overwriting the unrelated entry", () => {
    const items = [session("s1", { hostId: "h1" })];
    const other = session("s1", { hostId: "h2" });
    const result = appendOrReplaceSession(items, other);
    expect(result).toHaveLength(2);
    expect(result.some((item) => item.hostId === "h1")).toBe(true);
    expect(result.some((item) => item.hostId === "h2")).toBe(true);
  });

  // Regression: a matching id with a *different* incarnation means the
  // listed entry has since moved on (e.g. a restart); a late/historic
  // receipt for the id's earlier incarnation must never clobber it.
  test("a matching id with a different (stale) incarnation is dropped, never replacing the newer entry", () => {
    const current = session("s1", { incarnation: "inc-new", verdict: "live" });
    const items = [current];
    const stale = session("s1", {
      incarnation: "inc-old",
      verdict: "exited",
      exitCode: 0,
    });
    const result = appendOrReplaceSession(items, stale);
    expect(result).toEqual([current]);
  });

  // Regression (was RED): `.find` on id alone can land on a *different*
  // host's coincident id first in list order — the exact target (same
  // host, matching further down the list) must still be found and updated
  // in place, never producing a duplicate for the exact target.
  test("an other-host coincident id listed before the exact target still updates the exact target once, never duplicating it", () => {
    const otherHost = session("s1", { hostId: "h2", incarnation: "other-inc" });
    const exactTarget = session("s1", {
      hostId: "h1",
      incarnation: "inc-1",
      verdict: "live",
    });
    const items = [otherHost, exactTarget];
    const recovered = session("s1", {
      hostId: "h1",
      incarnation: "inc-1",
      verdict: "exited",
      exitCode: 0,
    });
    const result = appendOrReplaceSession(items, recovered);
    expect(result).toHaveLength(2);
    expect(
      result.filter((item) => item.hostId === "h1" && item.id === "s1"),
    ).toEqual([recovered]);
    expect(result.find((item) => item.hostId === "h2")).toEqual(otherHost);
  });
});

describe("removeSessionExact", () => {
  test("removes only the matching host+id+incarnation entry", () => {
    const items = [
      session("s1", { hostId: "h1", incarnation: "inc-1" }),
      session("s2", { hostId: "h1", incarnation: "inc-1" }),
    ];
    const result = removeSessionExact(items, {
      hostId: "h1",
      id: "s1",
      incarnation: "inc-1",
    });
    expect(result.map((item) => item.id)).toEqual(["s2"]);
  });

  // Regression: a coincident id from a different host must survive removal
  // targeted at the actual session.
  test("a coincident id from a different host is never removed", () => {
    const items = [
      session("s1", { hostId: "h1", incarnation: "inc-1" }),
      session("s1", { hostId: "h2", incarnation: "inc-1" }),
    ];
    const result = removeSessionExact(items, {
      hostId: "h1",
      id: "s1",
      incarnation: "inc-1",
    });
    expect(result).toHaveLength(1);
    expect(result[0].hostId).toBe("h2");
  });

  // Regression (was RED): a confirmed reply for an *old* incarnation must
  // never remove the current entry once it has moved to a *newer*
  // incarnation under the same host+id (e.g. a restart raced the close).
  test("a stale (old) incarnation target never removes the current, newer incarnation", () => {
    const current = session("s1", { hostId: "h1", incarnation: "inc-new" });
    const items = [current];
    const result = removeSessionExact(items, {
      hostId: "h1",
      id: "s1",
      incarnation: "inc-old",
    });
    expect(result).toEqual([current]);
  });
});

describe("contextMatches", () => {
  test("identical host+workspace matches", () => {
    expect(
      contextMatches(
        { hostId: "h1", workspaceId: "w1" },
        { hostId: "h1", workspaceId: "w1" },
      ),
    ).toBe(true);
  });
  test("a different current host does not match", () => {
    expect(
      contextMatches(
        { hostId: "h1", workspaceId: "w1" },
        { hostId: "h2", workspaceId: "w1" },
      ),
    ).toBe(false);
  });
  test("a different current workspace does not match", () => {
    expect(
      contextMatches(
        { hostId: "h1", workspaceId: "w1" },
        { hostId: "h1", workspaceId: "w2" },
      ),
    ).toBe(false);
  });
});

describe("applyConfirmedClose", () => {
  const target = { hostId: "h1", id: "s1", incarnation: "inc-1" };

  test("removes the exact target and reselects when it was active", () => {
    const items = [
      session("s1", { hostId: "h1", incarnation: "inc-1" }),
      session("s2"),
    ];
    const result = applyConfirmedClose(items, target, "s1");
    expect(result?.sessions.map((item) => item.id)).toEqual(["s2"]);
    expect(result?.active).toBe("s2");
  });

  test("leaves active untouched when a different tab was active", () => {
    const items = [
      session("s1", { hostId: "h1", incarnation: "inc-1" }),
      session("s2"),
    ];
    const result = applyConfirmedClose(items, target, "s2");
    expect(result?.active).toBe("s2");
  });

  // Regression (was RED, only reachable via the inline close() logic
  // before this fix): a confirmed close for an incarnation that has since
  // been superseded (same host+id, newer incarnation now listed) must be a
  // no-op — never remove the newer entry or change `active`.
  test("a superseded (stale-incarnation) target is a no-op — nothing removed, active unchanged", () => {
    const items = [
      session("s1", { hostId: "h1", incarnation: "inc-new" }),
      session("s2"),
    ];
    const result = applyConfirmedClose(items, target, "s1");
    expect(result).toBeNull();
  });

  test("a target already absent (e.g. a duplicate close) is a no-op, not an error", () => {
    const items = [session("s2")];
    const result = applyConfirmedClose(items, target, "s2");
    expect(result).toBeNull();
  });
});
