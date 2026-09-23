import { afterEach, describe, expect, test } from "vitest";
import {
  adoptOutOfBandSessions,
  applyQueuedAdopt,
  applySelectedFetch,
  chooseActiveAfterSelectedFetch,
  commitObservationProof,
  planAdoptOutOfBandSessions,
  planQueuedAdopt,
  planSelectedFetch,
  pruneObservationProofForSessions,
  appendOrReplaceSession,
  applyConfirmedClose,
  capabilityDigest,
  contextMatches,
  isPollPageVisible,
  isSlowPollDue,
  isStaleWorkspaceRead,
  markWorkspaceReadProof,
  removeSessionExact,
  sameBotsLoadResult,
  sameSessions,
  settleSelectedWorkspaceFetch,
  settleSidebarPoll,
  shouldSessionPollTick,
} from "./App";
import type { BotsLoadResult } from "./bots-loader";
import type { Session } from "../../shared/session-contract";
import {
  createSidebarSessionCollector,
  pollSidebarSessions,
  type SidebarSessionCollector,
} from "./features/shell/sidebar-session-source";
import {
  createObservationLedger,
  isStalePollSettlement,
  observationKeyOf,
  type ObservationLedger,
} from "./features/shell/sidebar-session-observation";

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

describe("adoptOutOfBandSessions selected-copy observation refresh (R2)", () => {
  const never = () => false;

  test("a listed row gains the poll's observation; push state, sizing and command are preserved", () => {
    const current = [
      session("s1", {
        agentState: "working",
        agentStateAuthority: "hook",
        cols: 100,
        command: "/bin/zsh",
      }),
    ];
    const result = adoptOutOfBandSessions(
      current,
      [
        session("s1", {
          observedHarnessId: "pi",
          observedHarnessAt: "2026-01-01T00:01:00Z",
          hasForegroundChild: true,
        }),
      ],
      "w1",
      never,
    );
    expect(result).toHaveLength(1);
    expect(result[0].observedHarnessId).toBe("pi");
    expect(result[0].observedHarnessAt).toBe("2026-01-01T00:01:00Z");
    expect(result[0].hasForegroundChild).toBe(true);
    // The selected list's own facts are not clobbered by the poll copy.
    expect(result[0].agentState).toBe("working");
    expect(result[0].agentStateAuthority).toBe("hook");
    expect(result[0].cols).toBe(100);
    expect(result[0].command).toBe("/bin/zsh");
    expect(result).not.toBe(current);
  });

  test("an explicit observation clear lands; stale selected data never revives it", () => {
    const current = [
      session("s1", {
        observedHarnessId: "pi",
        observedHarnessAt: "2026-01-01T00:01:00Z",
        hasForegroundChild: true,
      }),
    ];
    const result = adoptOutOfBandSessions(
      current,
      [session("s1", { hasForegroundChild: false })],
      "w1",
      never,
    );
    expect(result[0].observedHarnessId).toBeNull();
    expect(result[0].observedHarnessAt).toBeNull();
    expect(result[0].hasForegroundChild).toBe(false);
  });

  test("a foreground-only flip propagates both ways", () => {
    const entered = adoptOutOfBandSessions(
      [session("s1", { hasForegroundChild: false })],
      [session("s1", { hasForegroundChild: true })],
      "w1",
      never,
    );
    expect(entered[0].hasForegroundChild).toBe(true);
    const left = adoptOutOfBandSessions(
      [session("s1", { hasForegroundChild: true })],
      [session("s1", { hasForegroundChild: false })],
      "w1",
      never,
    );
    expect(left[0].hasForegroundChild).toBe(false);
  });

  test("a same-id/different-incarnation poll row never refreshes the newer entry", () => {
    const current = [session("s1", { incarnation: "inc-new" })];
    const result = adoptOutOfBandSessions(
      current,
      [
        session("s1", {
          incarnation: "inc-old",
          observedHarnessId: "pi",
          observedHarnessAt: "2026-01-01T00:01:00Z",
          hasForegroundChild: true,
        }),
      ],
      "w1",
      never,
    );
    expect(result).toBe(current);
  });

  test("a coincident id from a different host never refreshes the unrelated entry", () => {
    const current = [session("s1", { hostId: "h1" })];
    const result = adoptOutOfBandSessions(
      current,
      [
        session("s1", {
          hostId: "h2",
          observedHarnessId: "pi",
          observedHarnessAt: "2026-01-01T00:01:00Z",
        }),
      ],
      "w1",
      never,
    );
    // The h2 row is adopted alongside; the h1 row keeps no observation.
    expect(result).toHaveLength(2);
    expect(result[0].observedHarnessId ?? null).toBeNull();
    expect(result[1].observedHarnessId).toBe("pi");
  });

  test("no news returns the identical array — no observation churn, no re-render", () => {
    const current = [
      session("s1", {
        observedHarnessId: "pi",
        observedHarnessAt: "2026-01-01T00:01:00Z",
        hasForegroundChild: true,
      }),
    ];
    const clone = current.map((item) => ({ ...item, args: [...item.args] }));
    expect(adoptOutOfBandSessions(current, clone, "w1", never)).toBe(current);
    // Absent and false read as the same idle claim on both sides.
    expect(
      adoptOutOfBandSessions(current, [session("s1")], "w1", never),
    ).not.toBe(current);
    const idle = [session("s1")];
    expect(
      adoptOutOfBandSessions(
        idle,
        [session("s1", { hasForegroundChild: false })],
        "w1",
        never,
      ),
    ).toBe(idle);
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

describe("R3 observation freshness (retained rows are not new facts)", () => {
  // Every composition below runs the REAL collector (retained rows on
  // failure, rotating scoped reads) into the REAL adopt: the stale-fact
  // path the reviewer found, not a mock of it. Provenance (which rows a
  // poll actually read, and that poll's request order) rides alongside.
  const never = () => false;
  const target = (overrides: Partial<Session> = {}) =>
    session("s1", { workspaceId: "w1", ...overrides });
  const other = (id: string, overrides: Partial<Session> = {}) =>
    session(id, { workspaceId: "w2", ...overrides });
  const freshPi = {
    observedHarnessId: "pi" as const,
    observedHarnessAt: "2026-01-01T00:02:00Z",
    hasForegroundChild: true,
  };
  // The shell's commit path: the pure plan runs (and may replay) without
  // touching the ledger; its proof commits exactly once with its sessions.
  const adoptAndCommit = (
    current: Session[],
    hostWide: readonly Session[],
    provenance: {
      freshKeys: ReadonlySet<string>;
      seq: number;
      ledger: ObservationLedger;
    },
  ): Session[] => {
    const plan = planAdoptOutOfBandSessions(
      current,
      hostWide,
      "w1",
      never,
      provenance,
    );
    commitObservationProof(provenance.ledger, plan.appliedKeys, provenance.seq);
    return plan.sessions;
  };

  // A degraded poll whose target workspace failed while another progressed.
  // Returns the view the shell would commit (retained target + fresh other).
  async function degradedViewWithStuckTarget(): Promise<
    ReturnType<SidebarSessionCollector["view"]>
  > {
    const collector = createSidebarSessionCollector();
    collector.noteHostWide([target(), other("o1")]);
    await pollSidebarSessions({
      collector,
      workspaceIds: ["w1", "w2"],
      fetchHostWide: async () => ({ ok: false }),
      fetchScoped: async (workspaceId) =>
        workspaceId === "w2"
          ? { ok: true, sessions: [other("o1"), other("o2")] }
          : { ok: false },
    });
    return collector.view();
  }

  test("a retained target row cannot erase a fresher selected Pi while another workspace progresses", async () => {
    const view = await degradedViewWithStuckTarget();
    expect(view.degraded).toBe(true);
    // The selected list moved on via its own fresh read (newer Pi stamp).
    const selected = [target(freshPi)];
    const ledger = createObservationLedger();
    const result = adoptOutOfBandSessions(selected, view.sessions, "w1", never, {
      freshKeys: view.freshKeys,
      seq: 7,
      ledger,
    });
    expect(result).toBe(selected);
    expect(result[0].observedHarnessId).toBe("pi");
    expect(result[0].observedHarnessAt).toBe("2026-01-01T00:02:00Z");
    expect(result[0].hasForegroundChild).toBe(true);
  });

  test("a retained old Pi cannot revive a fresh explicit clear", async () => {
    const collector = createSidebarSessionCollector();
    collector.noteHostWide([target(freshPi), other("o1")]);
    await pollSidebarSessions({
      collector,
      workspaceIds: ["w1", "w2"],
      fetchHostWide: async () => ({ ok: false }),
      fetchScoped: async (workspaceId) =>
        workspaceId === "w2"
          ? { ok: true, sessions: [other("o1"), other("o2")] }
          : { ok: false },
    });
    const view = collector.view();
    // The daemon positively cleared the observation on the selected read.
    const selected = [target({ hasForegroundChild: false })];
    const ledger = createObservationLedger();
    const result = adoptOutOfBandSessions(selected, view.sessions, "w1", never, {
      freshKeys: view.freshKeys,
      seq: 7,
      ledger,
    });
    expect(result).toBe(selected);
    expect(result[0].observedHarnessId ?? null).toBeNull();
    expect(result[0].observedHarnessAt ?? null).toBeNull();
  });

  test("a retained idle flag cannot downgrade a fresh foreground true", async () => {
    const view = await degradedViewWithStuckTarget();
    const selected = [target({ hasForegroundChild: true })];
    const ledger = createObservationLedger();
    const result = adoptOutOfBandSessions(selected, view.sessions, "w1", never, {
      freshKeys: view.freshKeys,
      seq: 7,
      ledger,
    });
    expect(result).toBe(selected);
    expect(result[0].hasForegroundChild).toBe(true);
  });

  test("an older poll arriving after a newer one cannot roll the selection back", () => {
    const ledger = createObservationLedger();
    const idle = [target({ hasForegroundChild: false })];
    const newerKeys = new Set([observationKeyOf(target(freshPi))]);
    const gained = adoptAndCommit(idle, [target(freshPi)], {
      freshKeys: newerKeys,
      seq: 6,
      ledger,
    });
    expect(gained[0].observedHarnessId).toBe("pi");
    // The older response settles late with a stale positive AND a stale
    // null; neither may move the selection that already saw seq 6.
    const olderKeys = new Set([observationKeyOf(target())]);
    const rolled = adoptAndCommit(gained, [target()], {
      freshKeys: olderKeys,
      seq: 5,
      ledger,
    });
    expect(rolled).toBe(gained);
    expect(rolled[0].observedHarnessId).toBe("pi");
    const olderPositive = adoptAndCommit(
      gained,
      [
        target({
          observedHarnessId: "codex",
          observedHarnessAt: "2026-01-01T00:01:00Z",
        }),
      ],
      { freshKeys: olderKeys, seq: 5, ledger },
    );
    expect(olderPositive).toBe(gained);
    // A genuinely newer poll still moves the selection afterwards.
    const moved = adoptAndCommit(gained, [target({ hasForegroundChild: false })], {
      freshKeys: newerKeys,
      seq: 8,
      ledger,
    });
    expect(moved).not.toBe(gained);
    expect(moved[0].observedHarnessId ?? null).toBeNull();
    expect(moved[0].hasForegroundChild).toBe(false);
  });

  test("fresh gains, changes, clears and foreground flips still apply under provenance", () => {
    const ledger = createObservationLedger();
    const keys = new Set([observationKeyOf(target())]);
    const at = (n: string) => `2026-01-01T00:0${n}:00Z`;
    // Gain.
    const gained = adoptAndCommit([target()], [target(freshPi)], {
      freshKeys: keys,
      seq: 1,
      ledger,
    });
    expect(gained[0].observedHarnessId).toBe("pi");
    // Change.
    const changed = adoptAndCommit(
      gained,
      [target({ observedHarnessId: "codex", observedHarnessAt: at("3") })],
      { freshKeys: keys, seq: 2, ledger },
    );
    expect(changed[0].observedHarnessId).toBe("codex");
    // Clear (null carries no timestamp; the poll order is the proof).
    const cleared = adoptAndCommit(changed, [target()], {
      freshKeys: keys,
      seq: 3,
      ledger,
    });
    expect(cleared[0].observedHarnessId ?? null).toBeNull();
    // Foreground enter and leave (no timestamp at all).
    const entered = adoptAndCommit(
      cleared,
      [target({ hasForegroundChild: true })],
      { freshKeys: keys, seq: 4, ledger },
    );
    expect(entered[0].hasForegroundChild).toBe(true);
    const left = adoptAndCommit(entered, [target({ hasForegroundChild: false })], {
      freshKeys: keys,
      seq: 5,
      ledger,
    });
    expect(left[0].hasForegroundChild).toBe(false);
  });

  test("stale, wrong-host and wrong-incarnation rows never apply under provenance", () => {
    const ledger = createObservationLedger();
    const selected = [target(freshPi)];
    const keys = new Set([observationKeyOf(target())]);
    // Not actually read by this poll (retained): skipped even with a seq.
    expect(
      adoptOutOfBandSessions(selected, [target()], "w1", never, {
        freshKeys: new Set(),
        seq: 9,
        ledger,
      }),
    ).toBe(selected);
    // A coincident id from another host is adopted alongside, never merged.
    const otherHost = adoptOutOfBandSessions(
      selected,
      [target({ hostId: "h2", ...freshPi })],
      "w1",
      never,
      {
        freshKeys: new Set([observationKeyOf(target({ hostId: "h2" }))]),
        seq: 9,
        ledger,
      },
    );
    expect(otherHost).toHaveLength(2);
    expect(otherHost[0].observedHarnessId).toBe("pi");
    // A same-id/different-incarnation row is neither adopted over nor merged.
    expect(
      adoptOutOfBandSessions(selected, [target({ incarnation: "inc-old" })], "w1", never, {
        freshKeys: keys,
        seq: 9,
        ledger,
      }),
    ).toBe(selected);
  });

  test("a retained unknown id is not adopted as news, and no-op keeps the array", async () => {
    const view = await degradedViewWithStuckTarget();
    const ledger = createObservationLedger();
    // o2 is fresh (just read) but belongs to w2: never adopted into w1.
    // The retained w1 target row carries no observation news either.
    const selected = [target()];
    const result = adoptOutOfBandSessions(selected, view.sessions, "w1", never, {
      freshKeys: view.freshKeys,
      seq: 7,
      ledger,
    });
    expect(result).toBe(selected);
  });

  test("out-of-order settlement is stale past the last settled poll", () => {
    expect(isStalePollSettlement(5, 6)).toBe(true);
    expect(isStalePollSettlement(6, 6)).toBe(false);
    expect(isStalePollSettlement(7, 6)).toBe(false);
  });

  test("an unchanged successful read still advances ordering proof without minting a new array", () => {
    // A byte-identical re-read (fresh objects) is still a successful
    // observation: its request order is new evidence for null clears and
    // foreground flips, which carry no timestamp of their own.
    const previous = [target(freshPi)];
    const reread = previous.map((item) => ({ ...item, args: [...item.args] }));
    expect(reread).not.toBe(previous);
    const keys = new Set([observationKeyOf(target())]);
    const settled = settleSidebarPoll(previous, {
      sessions: reread,
      degraded: false,
      freshKeys: keys,
      freshWorkspaceIds: new Set(["w1"]),
    }, 7);
    expect(settled.seq).toBe(7);
    expect(settled.freshKeys).toBe(keys);
    expect(settled.dataChanged).toBe(false);
    expect(settled.sessions).toBe(previous);
  });

  test("a changed read commits the new array with its proof", () => {
    const previous = [target({ hasForegroundChild: false })];
    const next = [target(freshPi)];
    const keys = new Set([observationKeyOf(target())]);
    const settled = settleSidebarPoll(previous, {
      sessions: next,
      degraded: false,
      freshKeys: keys,
      freshWorkspaceIds: new Set(["w1"]),
    }, 7);
    expect(settled.dataChanged).toBe(true);
    expect(settled.sessions).toBe(next);
    expect(settled.seq).toBe(7);
    expect(settled.freshKeys).toBe(keys);
  });

  test("an unchanged successful read re-proves the selected copy after a stale selected-fetch overwrite", () => {
    const ledger = createObservationLedger();
    const keys = new Set([observationKeyOf(target())]);
    // Poll 1 (seq 6) observes Pi; the selected copy adopts and commits.
    const observed = adoptAndCommit([target({ hasForegroundChild: false })], [target(freshPi)], {
      freshKeys: keys,
      seq: 6,
      ledger,
    });
    expect(observed[0].observedHarnessId).toBe("pi");
    // A stale selected fetch overwrites the selected copy with older idle
    // rows (its snapshot was stamped at completion, not request order).
    const staleSelected = [target({ hasForegroundChild: false })];
    // Poll 2 (seq 7) succeeds with byte-identical content to poll 1's
    // commit — but its proof is new evidence, so it must still advance.
    const reread = [target(freshPi)];
    const settled = settleSidebarPoll(observed, {
      sessions: reread,
      degraded: false,
      freshKeys: keys,
      freshWorkspaceIds: new Set(["w1"]),
    }, 7);
    expect(settled.sessions).toBe(observed);
    // Reconciling the stale selected copy against the fresh proof restores
    // the Pi the stale fetch erased.
    const healed = adoptAndCommit(staleSelected, settled.sessions, {
      freshKeys: settled.freshKeys,
      seq: settled.seq,
      ledger,
    });
    expect(healed).not.toBe(staleSelected);
    expect(healed[0].observedHarnessId).toBe("pi");
    expect(healed[0].hasForegroundChild).toBe(true);
  });

  test("a late older selected fetch cannot erase a newer poll observation", () => {
    const ledger = createObservationLedger();
    const keys = new Set([observationKeyOf(target())]);
    // A newer poll (seq 8) observed Pi and committed it into the selected
    // copy while the selected fetch (requested at order 5) was in flight.
    const selected = adoptAndCommit(
      [target({ hasForegroundChild: false })],
      [target(freshPi)],
      { freshKeys: keys, seq: 8, ledger },
    );
    expect(selected[0].observedHarnessId).toBe("pi");
    // The older fetch settles late with idle rows. Its request order is
    // stale past the last settled poll, so the shell drops the snapshot —
    // and even planned at its own request order it could not move the copy.
    expect(isStalePollSettlement(5, 8)).toBe(true);
    const late = planAdoptOutOfBandSessions(
      selected,
      [target({ hasForegroundChild: false })],
      "w1",
      never,
      { freshKeys: keys, seq: 5, ledger },
    );
    expect(late.sessions).toBe(selected);
    expect(late.appliedKeys).toEqual([]);
    expect(selected[0].observedHarnessId).toBe("pi");
  });

  test("replaying the adopt updater with identical inputs applies identically (StrictMode replay)", () => {
    // The shell commits adopt inside a React setState updater, which React
    // may invoke twice with the same current state. The updater must be
    // pure: replaying it with identical inputs must produce the identical
    // result, never lose the fresh observation the first pass applied.
    const current = [target({ hasForegroundChild: false })];
    const hostWide = [target(freshPi)];
    const keys = new Set([observationKeyOf(target())]);
    const ledger = createObservationLedger();
    const updater = (items: Session[]) =>
      adoptOutOfBandSessions(items, hostWide, "w1", never, {
        freshKeys: keys,
        seq: 6,
        ledger,
      });
    const first = updater(current);
    expect(first[0].observedHarnessId).toBe("pi");
    const second = updater(current);
    expect(second).toEqual(first);
    expect(second[0].observedHarnessId).toBe("pi");
    // The plan never writes the ledger itself: replay leaves no trace, and
    // the committer records the proof exactly once with its sessions.
    expect(ledger.size).toBe(0);
    const plan = planAdoptOutOfBandSessions(current, hostWide, "w1", never, {
      freshKeys: keys,
      seq: 6,
      ledger,
    });
    expect(plan.sessions).toEqual(first);
    commitObservationProof(ledger, plan.appliedKeys, 6);
    expect(ledger.shouldApply(observationKeyOf(target()), 6)).toBe(false);
    expect(ledger.shouldApply(observationKeyOf(target()), 7)).toBe(true);
  });

  test("pruning to the selected rows keeps live proof under unrelated retained history", () => {
    const ledger = createObservationLedger(2);
    const live = target(freshPi);
    const keys = new Set([observationKeyOf(live)]);
    const projection = planQueuedAdopt([live], "w1", never, {
      freshKeys: keys,
      seq: 6,
      ledger,
    });
    commitObservationProof(ledger, projection.appliedKeys, 6);
    pruneObservationProofForSessions(ledger, [live]);

    // A degraded poll that only read w2 renders retained/other rows but
    // admits no w1 proof, so it cannot fill the tiny ledger and re-arm the
    // live key. This mirrors the App effect: prune runs after selected state
    // commits, while `planQueuedAdopt` filters by the selected workspace.
    const unrelated = planQueuedAdopt([other("o1"), other("o2")], "w1", never, {
      freshKeys: new Set([observationKeyOf(other("o1")), observationKeyOf(other("o2"))]),
      seq: 7,
      ledger,
    });
    expect(unrelated.appliedKeys).toEqual([]);
    commitObservationProof(ledger, unrelated.appliedKeys, 7);
    expect(ledger.shouldApply(observationKeyOf(live), 5)).toBe(false);
  });

  test("a queued local sizing update survives a following observation adoption", () => {
    // The shell's queue, through PRODUCTION code: successful-read facts
    // admitted outside React (`planQueuedAdopt` over the poll rows, never a
    // React mirror), proof committed once, pure projection
    // (`applyQueuedAdopt`) through the functional updater form onto the
    // ACTUAL current sessions — so queued local updates (push state,
    // renames, sizing) are never discarded. No ledger is read and no outbox
    // mutated inside the updater, so replay with identical inputs always
    // agrees, even after the proof committed or a later admission landed.
    const ledger = createObservationLedger();
    const keys = new Set([observationKeyOf(target())]);
    const hostWidePi = [target(freshPi)];
    // A queued local update from elsewhere in the shell (sizing/push).
    const localSizing = (items: Session[]): Session[] =>
      items.map((item) =>
        item.id === "s1" ? { ...item, cols: 120, command: "/bin/zsh" } : item,
      );
    // React applies queued updaters in order against actual current state.
    // Admission never sees this actual state: the frozen facts below heal it
    // even when a lagging mirror already equaled the fresh read.
    const afterLocal = localSizing([target({ hasForegroundChild: false })]);
    const projection = planQueuedAdopt(hostWidePi, "w1", never, {
      freshKeys: keys,
      seq: 6,
      ledger,
    });
    expect(projection.appliedKeys).toEqual([observationKeyOf(target())]);
    commitObservationProof(ledger, projection.appliedKeys, 6);
    const first = applyQueuedAdopt(afterLocal, projection);
    // Replay with identical inputs agrees — including AFTER the proof
    // committed above (the updater reads no ledger, mutates no outbox).
    const replayed = applyQueuedAdopt(afterLocal, projection);
    expect(replayed).toEqual(first);
    expect(replayed[0].observedHarnessId).toBe("pi");
    expect(replayed[0].cols).toBe(120);
    // The committed state carries BOTH the local update and the adoption.
    expect(first[0].cols).toBe(120);
    expect(first[0].command).toBe("/bin/zsh");
    expect(first[0].observedHarnessId).toBe("pi");
    expect(first[0].hasForegroundChild).toBe(true);
    // Replay stays pure after a LATER admission committed different proof:
    // identical inputs still agree (ordering across queues comes from React's
    // updater order, never from a read inside the updater).
    const later = planQueuedAdopt(
      [target({ hasForegroundChild: false })],
      "w1",
      never,
      { freshKeys: keys, seq: 7, ledger },
    );
    commitObservationProof(ledger, later.appliedKeys, 7);
    expect(applyQueuedAdopt(afterLocal, projection)).toEqual(first);
    // A second queueing of the same proof (effect + poll settlement both
    // firing) is deduped by the ledger: nothing left to apply or commit.
    const again = planQueuedAdopt(hostWidePi, "w1", never, {
      freshKeys: keys,
      seq: 6,
      ledger,
    });
    expect(again.appliedKeys).toEqual([]);
    expect(again.observations).toEqual([]);
    expect(applyQueuedAdopt(first, again)).toBe(first);
    // A stale poll queued after the commit cannot move what seq 7 wrote.
    const stale = planQueuedAdopt(
      [target({ hasForegroundChild: false })],
      "w1",
      never,
      { freshKeys: keys, seq: 5, ledger },
    );
    expect(stale.appliedKeys).toEqual([]);
    expect(stale.observations).toEqual([]);
    expect(applyQueuedAdopt(first, stale)).toBe(first);
  });

  test("an equal-valued successful read still admits proof and heals a diverged actual", () => {
    // The central invariant: a read with identical values is still newer
    // evidence (null clears and foreground flips carry no timestamp). The
    // old mirror-diff admission dropped it; the frozen-facts admission keeps
    // it, so a stale actual the mirror never saw still heals.
    const ledger = createObservationLedger();
    const keys = new Set([observationKeyOf(target())]);
    const fresh = [target(freshPi)];
    const first = planQueuedAdopt(fresh, "w1", never, {
      freshKeys: keys,
      seq: 6,
      ledger,
    });
    expect(first.appliedKeys).toHaveLength(1);
    commitObservationProof(ledger, first.appliedKeys, 6);
    // Byte-identical re-read at a newer order: proof advances even though no
    // displayed value changed.
    const reread = [target({ ...freshPi })];
    const second = planQueuedAdopt(reread, "w1", never, {
      freshKeys: keys,
      seq: 7,
      ledger,
    });
    expect(second.appliedKeys).toHaveLength(1);
    expect(second.observations).toHaveLength(1);
    commitObservationProof(ledger, second.appliedKeys, 7);
    expect(ledger.shouldApply(observationKeyOf(target()), 7)).toBe(false);
    expect(ledger.shouldApply(observationKeyOf(target()), 8)).toBe(true);
    // A stale actual (idle) the mirror never showed still heals from the
    // frozen second batch, even though the mirror already equaled it.
    const healed = applyQueuedAdopt(
      [target({ hasForegroundChild: false })],
      second,
    );
    expect(healed[0].observedHarnessId).toBe("pi");
    expect(healed[0].hasForegroundChild).toBe(true);
    // The same equal-read path through the legacy planner also advances
    // proof without minting a new array.
    const planLedger = createObservationLedger();
    const idle = [target({ hasForegroundChild: false })];
    const gained = planAdoptOutOfBandSessions(idle, fresh, "w1", never, {
      freshKeys: keys,
      seq: 6,
      ledger: planLedger,
    });
    commitObservationProof(planLedger, gained.appliedKeys, 6);
    const equal = planAdoptOutOfBandSessions(gained.sessions, fresh, "w1", never, {
      freshKeys: keys,
      seq: 7,
      ledger: planLedger,
    });
    expect(equal.appliedKeys).toHaveLength(1);
    expect(equal.sessions).toBe(gained.sessions);
    commitObservationProof(planLedger, equal.appliedKeys, 7);
    expect(planLedger.shouldApply(observationKeyOf(target()), 7)).toBe(false);
  });

  test("poll and selected fetch settle in either order without losing the newer observation", () => {
    // Production queue simulation: both paths commit proof outside React and
    // project through functional updaters, so React's updater order plus the
    // frozen facts decide — never a whole-snapshot drop.
    const runOrders = (pollSeq: number, fetchSeq: number) => {
      const ledger = createObservationLedger();
      const keys = new Set([observationKeyOf(target())]);
      const start = [target({ hasForegroundChild: false })];
      // Poll observes Pi; fetch observes idle (older read).
      const pollProjection = planQueuedAdopt([target(freshPi)], "w1", never, {
        freshKeys: keys,
        seq: pollSeq,
        ledger,
      });
      commitObservationProof(ledger, pollProjection.appliedKeys, pollSeq);
      const fetchPlan = planSelectedFetch(
        [target({ hasForegroundChild: false })],
        fetchSeq,
        ledger,
      );
      commitObservationProof(ledger, fetchPlan.appliedKeys, fetchSeq);
      const pollUpdate = (items: Session[]) => applyQueuedAdopt(items, pollProjection);
      const fetchUpdate = (items: Session[]) => applySelectedFetch(items, fetchPlan);
      // Poll queued first, fetch second (late fetch settles after the poll).
      const pollFirst = fetchUpdate(pollUpdate(start));
      // Fetch queued first, poll second (poll settles after the fetch).
      const fetchFirst = pollUpdate(fetchUpdate(start));
      return { pollFirst, fetchFirst };
    };
    // Newer poll (8) beats older fetch (5) in both queue orders.
    const newerPoll = runOrders(8, 5);
    expect(newerPoll.pollFirst[0].observedHarnessId).toBe("pi");
    expect(newerPoll.fetchFirst[0].observedHarnessId).toBe("pi");
    // Newer fetch (8) beats older poll (5) in both queue orders: the fetch is
    // a successful selected read at its own order, and the older poll cannot
    // revive the clear it never saw.
    const newerFetchLedger = createObservationLedger();
    const keys = new Set([observationKeyOf(target())]);
    const start = [target(freshPi)];
    const oldPoll = planQueuedAdopt([target(freshPi)], "w1", never, {
      freshKeys: keys,
      seq: 5,
      ledger: newerFetchLedger,
    });
    commitObservationProof(newerFetchLedger, oldPoll.appliedKeys, 5);
    const afterOldPoll = applyQueuedAdopt(start, oldPoll);
    const newFetch = planSelectedFetch(
      [target({ hasForegroundChild: false })],
      8,
      newerFetchLedger,
    );
    commitObservationProof(newerFetchLedger, newFetch.appliedKeys, 8);
    const final = applySelectedFetch(afterOldPoll, newFetch);
    expect(final[0].observedHarnessId ?? null).toBeNull();
  });

  test("an unrelated workspace success while a selected load is pending no longer drops the selected response", async () => {
    // Degraded poll reads only w2; the selected w1 target row is retained
    // (renders) but not fresh, so its observation must not move. A selected
    // fetch requested before that poll is globally older but still the
    // newest successful read of w1, so the production guard must admit it.
    const collector = createSidebarSessionCollector();
    collector.noteHostWide([target(), other("o1")]);
    const selectedRequestSeq = 5;
    const pollSeq = 6;
    const view = await pollSidebarSessions({
      collector,
      workspaceIds: ["w1", "w2"],
      fetchHostWide: async () => ({ ok: false }),
      fetchScoped: async (workspaceId) =>
        workspaceId === "w2"
          ? { ok: true, sessions: [other("o1"), other("o2")] }
          : { ok: false },
    });
    expect(view.degraded).toBe(true);
    expect(view.freshKeys.has(observationKeyOf(target()))).toBe(false);
    expect(view.freshWorkspaceIds).toEqual(new Set(["w2"]));
    const workspaceProof = new Map<string, number>();
    markWorkspaceReadProof(workspaceProof, view.freshWorkspaceIds, pollSeq);
    expect(isStalePollSettlement(selectedRequestSeq, pollSeq)).toBe(true);
    expect(isStaleWorkspaceRead(workspaceProof, "w1", selectedRequestSeq)).toBe(false);

    const ledger = createObservationLedger();
    const selected = [target(freshPi)];
    const projection = planQueuedAdopt(view.sessions, "w1", never, {
      freshKeys: view.freshKeys,
      seq: pollSeq,
      ledger,
    });
    expect(projection.appliedKeys).toEqual([]);
    expect(projection.observations).toEqual([]);
    expect(applyQueuedAdopt(selected, projection)).toBe(selected);

    const fetchPlan = planSelectedFetch(
      [target({ observedHarnessId: "codex", observedHarnessAt: "2026-01-01T00:04:00Z" })],
      selectedRequestSeq,
      ledger,
    );
    commitObservationProof(ledger, fetchPlan.appliedKeys, selectedRequestSeq);
    markWorkspaceReadProof(workspaceProof, ["w1"], selectedRequestSeq);
    const fetched = applySelectedFetch(selected, fetchPlan);
    expect(fetched[0].observedHarnessId).toBe("codex");
    expect(fetched[0].observedHarnessAt).toBe("2026-01-01T00:04:00Z");
  });

  test("a newer successful read of the same workspace fences an older selected response", () => {
    const workspaceProof = new Map<string, number>();
    markWorkspaceReadProof(workspaceProof, ["w1"], 8);
    expect(isStaleWorkspaceRead(workspaceProof, "w1", 5)).toBe(true);
    expect(isStaleWorkspaceRead(workspaceProof, "w2", 5)).toBe(false);
  });

  test("a selected fetch reconciles per identity instead of dropping the snapshot", () => {
    // Production fetch path: `planSelectedFetch` at settle, proof committed
    // once, `applySelectedFetch` through the functional updater form.
    const ledger = createObservationLedger();
    const live = target({
      cols: 120,
      command: "/bin/zsh",
      agentState: "working",
      agentStateAt: "2026-01-01T00:03:00Z",
      agentStateAuthority: "hook",
      ...freshPi,
    });
    const closed = session("s9", { workspaceId: "w1" });
    const current = [live, closed];
    // The fetch read the daemon before the local sizing and the newer push
    // landed: older sizing, an older push stamp, the same observation — plus
    // a brand-new session. The closed session is gone from the daemon.
    const fetched = [
      target({
        agentState: "working",
        agentStateAt: "2026-01-01T00:01:00Z",
        ...freshPi,
      }),
      session("s2", { workspaceId: "w1", createdAt: "2026-01-01T00:04:00Z" }),
    ];
    const plan = planSelectedFetch(fetched, 9, ledger);
    expect(plan.appliedKeys).toHaveLength(2);
    commitObservationProof(ledger, plan.appliedKeys, 9);
    const next = applySelectedFetch(current, plan);
    // Membership follows the fetch: the new session joins, the closed one
    // leaves, fetch order wins.
    expect(next.map((item) => item.id)).toEqual(["s1", "s2"]);
    const kept = next[0]!;
    // Daemon truth from the fetch for the fields it owns …
    expect(kept.cols).toBe(80);
    expect(kept.command).toBe("/bin/sh");
    expect(kept.observedHarnessId).toBe("pi");
    expect(kept.hasForegroundChild).toBe(true);
    // … but the newer queued push still wins over the fetch's older stamp.
    expect(kept.agentState).toBe("working");
    expect(kept.agentStateAt).toBe("2026-01-01T00:03:00Z");
    expect(kept.agentStateAuthority).toBe("hook");
  });

  test("a fetch older than committed proof keeps the newer observation", () => {
    // Two overlapping selected fetches: the newer read settles first. The
    // older fetch still passes the global stale check (fetches never advance
    // the poll settlement order), so only the per-key proof may save the
    // metadata it would otherwise roll back.
    const ledger = createObservationLedger();
    const newer = target(freshPi);
    const older = target({ hasForegroundChild: false });
    const firstPlan = planSelectedFetch([newer], 9, ledger);
    commitObservationProof(ledger, firstPlan.appliedKeys, 9);
    const selected = applySelectedFetch(
      [target({ hasForegroundChild: false })],
      firstPlan,
    );
    expect(selected[0].observedHarnessId).toBe("pi");
    const latePlan = planSelectedFetch([older], 8, ledger);
    expect(latePlan.appliedKeys).toEqual([]);
    commitObservationProof(ledger, latePlan.appliedKeys, 8);
    const kept = applySelectedFetch(selected, latePlan);
    expect(kept[0].observedHarnessId).toBe("pi");
    expect(kept[0].hasForegroundChild).toBe(true);
  });

  test("a restarted incarnation is fetch truth wholesale", () => {
    const ledger = createObservationLedger();
    const current = [target(freshPi)];
    const restarted = target({
      incarnation: "inc-2",
      hasForegroundChild: false,
    });
    const plan = planSelectedFetch([restarted], 9, ledger);
    commitObservationProof(ledger, plan.appliedKeys, 9);
    const next = applySelectedFetch(current, plan);
    expect(next).toHaveLength(1);
    expect(next[0].incarnation).toBe("inc-2");
    expect(next[0].observedHarnessId ?? null).toBeNull();
    expect(next[0].hasForegroundChild).toBe(false);
  });

  test("production selected settlement reaches active tab even after an equal poll", () => {
    // Production selected-fetch boundary: the poll/adopt path can populate
    // the selected rows before the selected workspace's own first load
    // returns. A host-wide poll of the same workspace is observation proof,
    // not selected-membership proof, so it must not trip a whole-response
    // early return before active tab selection.
    const ledger = createObservationLedger();
    const rows = [target(freshPi)];
    const workspaceProof = new Map<string, number>();
    const input = [target(freshPi)];
    const settlement = settleSelectedWorkspaceFetch({
      visible: rows,
      workspaceId: "w1",
      requestSeq: 5,
      ledger,
      workspaceProof,
    });
    expect(settlement.stale).toBe(false);
    expect(settlement.plan).not.toBeNull();
    expect(applySelectedFetch(input, settlement.plan!)).toBe(input);
    expect(chooseActiveAfterSelectedFetch("", rows)).toBe("s1");
    expect(ledger.admitted(observationKeyOf(target()))?.snapshot).toEqual(freshPi);
  });

  test("production selected settlement removes previous-workspace rows", () => {
    // Poll adoption never owns selected-tab membership. The selected
    // workspace fetch remains authoritative for the tab strip: rows missing
    // from this scoped read leave, listed rows enter, and active is chosen
    // from the fetched membership.
    const ledger = createObservationLedger();
    const workspaceProof = new Map<string, number>();
    const previousWorkspace = session("old", { workspaceId: "w-old" });
    const fetched = [target({ id: "fresh" })];
    const settlement = settleSelectedWorkspaceFetch({
      visible: fetched,
      workspaceId: "w1",
      requestSeq: 9,
      ledger,
      workspaceProof,
    });
    expect(settlement.stale).toBe(false);
    const reconciled = applySelectedFetch([previousWorkspace], settlement.plan!);
    expect(reconciled.map((item) => item.id)).toEqual(["fresh"]);
    expect(chooseActiveAfterSelectedFetch("old", fetched)).toBe("fresh");
  });

  test("production selected settlement stores admitted values on equal rereads", () => {
    const ledger = createObservationLedger();
    const workspaceProof = new Map<string, number>();
    const rows = [target(freshPi)];
    const first = settleSelectedWorkspaceFetch({
      visible: rows,
      workspaceId: "w1",
      requestSeq: 6,
      ledger,
      workspaceProof,
    });
    expect(first.stale).toBe(false);
    expect(ledger.admitted(observationKeyOf(target()))).toEqual({
      seq: 6,
      snapshot: freshPi,
    });
    const second = settleSelectedWorkspaceFetch({
      visible: rows.map((row) => ({ ...row })),
      workspaceId: "w1",
      requestSeq: 7,
      ledger,
      workspaceProof,
    });
    expect(second.stale).toBe(false);
    expect(ledger.admitted(observationKeyOf(target()))).toEqual({
      seq: 7,
      snapshot: freshPi,
    });
  });

  test("production selected settlement fences older selected membership only", () => {
    const ledger = createObservationLedger();
    const workspaceProof = new Map<string, number>();
    const newer = settleSelectedWorkspaceFetch({
      visible: [target({ id: "new" })],
      workspaceId: "w1",
      requestSeq: 9,
      ledger,
      workspaceProof,
    });
    expect(newer.stale).toBe(false);
    const older = settleSelectedWorkspaceFetch({
      visible: [target({ id: "old" })],
      workspaceId: "w1",
      requestSeq: 8,
      ledger,
      workspaceProof,
    });
    expect(older).toEqual({ stale: true, plan: null });
  });

  test("workspace selected-read proof is bounded", () => {
    const proof = new Map<string, number>();
    markWorkspaceReadProof(proof, ["w1"], 1, 2);
    markWorkspaceReadProof(proof, ["w2"], 2, 2);
    markWorkspaceReadProof(proof, ["w3"], 3, 2);
    expect([...proof.entries()]).toEqual([
      ["w2", 2],
      ["w3", 3],
    ]);
  });

  test("an unchanged fetch commits nothing new", () => {
    const ledger = createObservationLedger();
    const rows = [target(freshPi)];
    const plan = planSelectedFetch(rows, 9, ledger);
    commitObservationProof(ledger, plan.appliedKeys, 9);
    const input = [target(freshPi)];
    // Field-equal: the input array keeps its identity, so the shell does
    // not re-render on an idle fetch.
    expect(applySelectedFetch(input, plan)).toBe(input);
  });
});
