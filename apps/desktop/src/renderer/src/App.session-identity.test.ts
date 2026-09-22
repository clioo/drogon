import { afterEach, describe, expect, test } from "vitest";
import {
  adoptOutOfBandSessions,
  appendOrReplaceSession,
  applyConfirmedClose,
  capabilityDigest,
  contextMatches,
  isPollPageVisible,
  isSlowPollDue,
  removeSessionExact,
  sameBotsLoadResult,
  sameSessions,
  shouldSessionPollTick,
} from "./App";
import type { BotsLoadResult } from "./bots-loader";
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

describe("adoptOutOfBandSessions", () => {
  const never = () => false;
  // Found by scripts/accept-bot-monitors.mjs: a session started through the
  // CLI showed in the sidebar within seconds and never in the tab strip.
  test("a session the shell did not start joins the selected workspace's list", () => {
    const current = [session("s1")];
    const result = adoptOutOfBandSessions(
      current,
      [session("s1"), session("s2", { createdAt: "2026-01-01T00:01:00Z" })],
      "w1",
      never,
    );
    expect(result.map((item) => item.id)).toEqual(["s1", "s2"]);
  });

  test("another workspace's sessions, dismissed ones, and no news leave the list alone", () => {
    const current = [session("s1")];
    expect(
      adoptOutOfBandSessions(current, [session("other", { workspaceId: "w2" })], "w1", never),
    ).toBe(current);
    expect(
      adoptOutOfBandSessions(current, [session("s9")], "w1", (item) => item.id === "s9"),
    ).toBe(current);
    expect(adoptOutOfBandSessions(current, [session("s1")], "w1", never)).toBe(
      current,
    );
  });

  test("a coincident id on another host is a different session, not a duplicate", () => {
    const current = [session("s1")];
    const result = adoptOutOfBandSessions(
      current,
      [session("s1", { hostId: "h2" })],
      "w1",
      never,
    );
    expect(result).toHaveLength(2);
    expect(result[1].hostId).toBe("h2");
  });
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

describe("PERF-03 poll identity (sameSessions)", () => {
  const clone = (items: Session[]): Session[] =>
    items.map((item) => ({ ...item, args: [...item.args] }));

  test("a byte-identical poll reply (fresh objects) keeps the previous array", () => {
    const previous = [session("s1"), session("s2", { verdict: "exited" })];
    expect(sameSessions(previous, clone(previous))).toBe(true);
  });

  test("identical turn proof keeps the previous array; null and absent agree", () => {
    const previous = [
      session("s1", { agentState: "working", agentStateAuthority: "hook" }),
      session("s2", { agentState: "working", agentStateAuthority: null }),
    ];
    expect(sameSessions(previous, clone(previous))).toBe(true);
    // An old daemon's missing field and an explicit null are the same
    // no-proof claim — neither may mint a new array identity.
    expect(
      sameSessions(previous, [
        session("s1", { agentState: "working", agentStateAuthority: "hook" }),
        session("s2", { agentState: "working" }),
      ]),
    ).toBe(true);
  });

  // R2 (#622 follow-up): a metadata-only snapshot delta — a plain shell
  // observed foregrounding a harness, or a busy-close foreground flag
  // flipping — must replace the list, or the sidebar keeps the old rows
  // and hides the observed Pi identity and agent counts.
  test("gaining an observed harness replaces the list; null and absent agree", () => {
    const previous = [session("s1")];
    expect(
      sameSessions(previous, [
        session("s1", {
          observedHarnessId: "pi",
          observedHarnessAt: "2026-01-01T00:01:00Z",
        }),
      ]),
    ).toBe(false);
    // No observation either way is the same claim — neither mints an array.
    expect(sameSessions(previous, [session("s1", { observedHarnessId: null })])).toBe(
      true,
    );
    expect(
      sameSessions(
        [session("s1", { observedHarnessId: null, observedHarnessAt: null })],
        [session("s1")],
      ),
    ).toBe(true);
  });

  test("changing or clearing the observed harness replaces the list", () => {
    const observed = [
      session("s1", {
        observedHarnessId: "pi",
        observedHarnessAt: "2026-01-01T00:01:00Z",
      }),
    ];
    expect(
      sameSessions(observed, [
        session("s1", {
          observedHarnessId: "codex",
          observedHarnessAt: "2026-01-01T00:01:00Z",
        }),
      ]),
    ).toBe(false);
    expect(sameSessions(observed, [session("s1")])).toBe(false);
    expect(
      sameSessions(observed, [session("s1", { observedHarnessId: null })]),
    ).toBe(false);
  });

  test("an observed-harness timestamp-only move replaces the list", () => {
    const previous = [
      session("s1", {
        observedHarnessId: "pi",
        observedHarnessAt: "2026-01-01T00:01:00Z",
      }),
    ];
    expect(
      sameSessions(previous, [
        session("s1", {
          observedHarnessId: "pi",
          observedHarnessAt: "2026-01-01T00:02:00Z",
        }),
      ]),
    ).toBe(false);
  });

  test("foreground enter and leave replace the list; absent reads as idle", () => {
    expect(
      sameSessions(
        [session("s1", { hasForegroundChild: false })],
        [session("s1", { hasForegroundChild: true })],
      ),
    ).toBe(false);
    expect(
      sameSessions(
        [session("s1", { hasForegroundChild: true })],
        [session("s1", { hasForegroundChild: false })],
      ),
    ).toBe(false);
    // An old daemon's missing flag reads as idle, like an explicit false.
    expect(
      sameSessions([session("s1")], [session("s1", { hasForegroundChild: false })]),
    ).toBe(true);
    expect(
      sameSessions(
        [session("s1", { hasForegroundChild: false })],
        [session("s1")],
      ),
    ).toBe(true);
  });

  test("a byte-identical observed/foreground reply keeps the previous array", () => {
    const previous = [
      session("s1", {
        observedHarnessId: "pi",
        observedHarnessAt: "2026-01-01T00:01:00Z",
        hasForegroundChild: true,
      }),
    ];
    expect(sameSessions(previous, clone(previous))).toBe(true);
  });

  test("any field-level change replaces the list", () => {
    const previous = [session("s1")];
    for (const overrides of [
      { verdict: "exited" },
      { agentState: "idle" },
      { agentStateAt: "2026-01-01T00:01:00Z" },
      { incarnation: "inc-2" },
      { exitCode: 1 },
      { harnessId: "claude" },
      { cacheIdleAt: "2026-01-01T00:01:00Z" },
      { agentPromptPreview: "hello" },
      { parentSessionId: "p1" },
      { causedByEventId: "mev_1" },
      { agentSessionId: "native-1" },
      { agentSessionTranscriptPath: "/tmp/rollout.jsonl" },
      { agentResume: "resumed" },
      { command: "/bin/zsh" },
      { cols: 100 },
      { createdAt: "2026-01-02T00:00:00Z" },
      // R1: an authority-only move replaces the list — proof gained or
      // lost with the state unchanged flips the rendered dot, so it must
      // never be discarded as a sameSessions no-op.
      { agentStateAuthority: "hook" },
      { agentState: "working", agentStateAuthority: "hook" },
    ] as Partial<Session>[]) {
      expect(
        sameSessions(previous, [session("s1", overrides)]),
        JSON.stringify(overrides),
      ).toBe(false);
    }
    expect(
      sameSessions(previous, [
        session("s1", { args: ["/bin/sh", "-l"] }),
      ]),
    ).toBe(false);
  });

  test("length changes and reorder replace the list (order is tab order)", () => {
    const previous = [session("s1"), session("s2")];
    expect(sameSessions(previous, [session("s1")])).toBe(false);
    expect(sameSessions(previous, [session("s1"), session("s2"), session("s3")])).toBe(
      false,
    );
    expect(sameSessions(previous, [session("s2"), session("s1")])).toBe(false);
  });

  test("same reference is trivially same", () => {
    const previous = [session("s1")];
    expect(sameSessions(previous, previous)).toBe(true);
  });
});

describe("PERF-04 stable effect keys (capabilityDigest)", () => {
  test("order-insensitive and stable for the same set", () => {
    expect(capabilityDigest(["b.v1", "a.v1"])).toBe(capabilityDigest(["a.v1", "b.v1"]));
    expect(capabilityDigest([])).toBe("");
  });

  test("a withheld/granted capability changes the digest", () => {
    expect(capabilityDigest(["a.v1"])).not.toBe(capabilityDigest(["a.v1", "b.v1"]));
  });
});

describe("PERF-03 Bots snapshot identity (sameBotsLoadResult)", () => {
  const loaded = (): BotsLoadResult => ({
    scope: { hostId: "h1", workspaceId: "", locale: "en" },
    status: "loaded",
    snapshot: { bots: [], history: [] },
    observedLiveness: {},
  });

  test("an identical reload (fresh objects) keeps the previous snapshot", () => {
    expect(sameBotsLoadResult(loaded(), loaded())).toBe(true);
  });

  test("null previous, status change, or content change replaces it", () => {
    const previous: Extract<BotsLoadResult, { status: "loaded" }> = loaded() as Extract<
      BotsLoadResult,
      { status: "loaded" }
    >;
    expect(sameBotsLoadResult(null, previous)).toBe(false);
    expect(
      sameBotsLoadResult(previous, {
        scope: previous.scope,
        status: "error",
        code: "boom",
        message: "boom",
        retryable: true,
      }),
    ).toBe(false);
    expect(
      sameBotsLoadResult(previous, {
        ...previous,
        snapshot: {
          bots: [],
          history: [
            {
              run: {
                id: "run-1",
                botId: "b1",
                responsibilityId: "r1",
                automationId: null,
                automationRunId: null,
                startedAt: 1,
                endedAt: 2,
                recipe: null,
                hostObservation: null,
                invocation: "manual",
              },
              responsibilityName: null,
              automationName: null,
              automationRunNumber: null,
              automationRunStatus: "completed",
            },
          ],
        },
      }),
    ).toBe(false);
  });
});

describe("PERF-03 poll cadence gates", () => {
  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
  });

  test("isSlowPollDue fires on the first tick, then at most every 30s", () => {
    expect(isSlowPollDue(0, 1_000)).toBe(true);
    expect(isSlowPollDue(1_000, 1_000 + 29_999)).toBe(false);
    expect(isSlowPollDue(1_000, 1_000 + 30_000)).toBe(true);
  });

  test("isPollPageVisible is true without a document, else follows visibility", () => {
    expect(isPollPageVisible()).toBe(true);
    (globalThis as { document?: unknown }).document = { visibilityState: "visible" };
    expect(isPollPageVisible()).toBe(true);
    (globalThis as { document?: unknown }).document = { visibilityState: "hidden" };
    expect(isPollPageVisible()).toBe(false);
  });
});

describe("PERF-03b session poll fast tick", () => {
  // Regression for the sidebar-consumer gate: with the sidebar collapsed
  // and the route anywhere but Bots, an out-of-band session (CLI-created,
  // Bot-created, another window) took up to 30s to reach the tab strip.
  // The gate takes no sidebar/route input, so this shapes the only two
  // inputs it has: a visible page always fast-ticks.
  test("a visible page fast-ticks even with a recent poll (sidebar state is not an input)", () => {
    expect(shouldSessionPollTick(true, 1_000, 1_000 + 3_000)).toBe(true);
    expect(shouldSessionPollTick(true, 1_000, 1_000 + 29_999)).toBe(true);
  });

  test("a hidden page skips fast ticks and keeps the 30s slow fallback", () => {
    expect(shouldSessionPollTick(false, 1_000, 1_000 + 3_000)).toBe(false);
    expect(shouldSessionPollTick(false, 1_000, 1_000 + 29_999)).toBe(false);
    expect(shouldSessionPollTick(false, 1_000, 1_000 + 30_000)).toBe(true);
    expect(shouldSessionPollTick(false, 0, 1_000)).toBe(true);
  });

  // End-to-end of the regression at unit level: the fast tick fires while
  // the sidebar is closed, the host-wide reply arrives, and the adopt
  // effect merges the CLI-created session into the tab strip's list —
  // all within one fast cadence, never waiting on the slow fallback.
  test("an out-of-band session reaches the tab strip on a fast tick while the sidebar is closed", () => {
    // shouldSessionPollTick takes no sidebar/route input by design, so
    // there is nothing here to set to "closed"/"away" — that absence is
    // the regression lock.
    const lastPollMs = 1_000;
    const fastTickMs = lastPollMs + 3_000;
    // The tick decision consults only page visibility: closed sidebar and
    // non-Bots route cannot suppress it.
    expect(shouldSessionPollTick(true, lastPollMs, fastTickMs)).toBe(true);
    // The reply it fetches adopts the session the shell did not start.
    const tabStrip = [session("s1")];
    const hostWide = [
      session("s1"),
      session("cli-created", { createdAt: "2026-01-01T00:01:00Z" }),
    ];
    const merged = adoptOutOfBandSessions(tabStrip, hostWide, "w1", () => false);
    expect(merged.map((item) => item.id)).toEqual(["s1", "cli-created"]);
  });
});
