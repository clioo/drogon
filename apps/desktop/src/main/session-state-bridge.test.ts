import { describe, expect, it } from "vitest";
import { notificationsIpcChannels } from "../shared/notifications-contract";
import {
  baseBackoffMs,
  nextBackoff,
  resetSessionStatePushForTests,
  shouldForwardSessionEvent,
  startSessionStatePush,
  type SessionDaemonCall,
} from "./session-state-bridge";

type Sent = { channel: string; event: unknown };

function fakeWindow() {
  const sent: Sent[] = [];
  return {
    sent,
    window: {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, event: unknown) => {
          sent.push({ channel, event });
        },
      },
    },
  };
}

const working = (seq: number, at: string | null = "2026-09-08T07:00:00Z") => ({
  seq,
  sessionId: "s-1",
  workspaceId: "w-1",
  agentState: "working",
  agentStateAt: at,
});

function pollOk(bootId: string, events: unknown[], nextSeq: number) {
  return { ok: true as const, result: { bootId, events, nextSeq } };
}

async function waitFor(calls: { count: number }, n: number): Promise<void> {
  const deadline = Date.now() + 5000;
  while (calls.count < n) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${n} calls`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  // Let the loop's post-call microtasks (send/next round) settle.
  await new Promise((resolve) => setTimeout(resolve, 10));
}

describe("shouldForwardSessionEvent", () => {
  it("forwards first sightings and moves, drops repeats", () => {
    const known = new Map<string, { state: string; at: string | null }>();
    expect(shouldForwardSessionEvent(known, working(1))).toBe(true);
    known.set("s-1", { state: "working", at: "2026-09-08T07:00:00Z" });
    expect(shouldForwardSessionEvent(known, working(2))).toBe(false);
    expect(
      shouldForwardSessionEvent(known, { ...working(3), agentState: "idle" }),
    ).toBe(true);
    expect(
      shouldForwardSessionEvent(known, {
        ...working(4),
        agentStateAt: "2026-09-08T07:00:01Z",
      }),
    ).toBe(true);
  });
});

describe("startSessionStatePush", () => {
  it("forwards pushed events over the existing state-changed channel", async () => {
    resetSessionStatePushForTests();
    const { sent, window } = fakeWindow();
    const calls = { count: 0 };
    const call: SessionDaemonCall = async () => {
      calls.count += 1;
      return pollOk("boot-1", [working(1)], 1);
    };
    const observed: unknown[] = [];
    const stop = startSessionStatePush({
      getWindow: () => window as never,
      onEvent: (event) => observed.push(event),
      call,
      maxRounds: 2,
      log: () => {},
    });
    await waitFor(calls, 2);
    stop();
    // One forward for the transition; the resend on round two dedupes.
    expect(observed).toHaveLength(1);
    expect(sent).toEqual([
      {
        channel: notificationsIpcChannels.stateChanged,
        event: {
          sessionId: "s-1",
          workspaceId: "w-1",
          agentState: "working",
          agentStateAt: "2026-09-08T07:00:00Z",
        },
      },
    ]);
  });

  it("resyncs from zero when the daemon boot id moves", async () => {
    resetSessionStatePushForTests();
    const { sent, window } = fakeWindow();
    const calls = { count: 0 };
    const seen: number[] = [];
    const call: SessionDaemonCall = async (_method, params) => {
      calls.count += 1;
      seen.push((params as { afterSeq: number }).afterSeq);
      const boot = calls.count === 1 ? "boot-1" : "boot-2";
      const at = `2026-09-08T07:00:0${calls.count}Z`;
      return pollOk(boot, [working(calls.count, at)], calls.count);
    };
    const stop = startSessionStatePush({
      getWindow: () => window as never,
      call,
      maxRounds: 3,
      log: () => {},
    });
    await waitFor(calls, 3);
    stop();
    // Restart resets the daemon sequence: the loop notices the new boot id,
    // resyncs from zero on the next round, and forwards the truth again
    // instead of waiting on a stale cursor.
    expect(seen).toEqual([0, 1, 0]);
    expect(sent).toHaveLength(3);
  });

  it("retries slow on an old daemon without sending anything", async () => {
    resetSessionStatePushForTests();
    const { sent, window } = fakeWindow();
    const calls = { count: 0 };
    const logged: string[] = [];
    const call: SessionDaemonCall = async () => {
      calls.count += 1;
      return {
        ok: false as const,
        error: { code: "method_not_found", message: "nope", retryable: false },
      };
    };
    const stop = startSessionStatePush({
      getWindow: () => window as never,
      call,
      maxRounds: 1,
      log: (message) => logged.push(message),
    });
    await waitFor(calls, 1);
    stop();
    expect(sent).toEqual([]);
    expect(logged.some((line) => line.includes("old daemon"))).toBe(true);
  });

  it("survives a refused poll answer and a throwing transport", async () => {
    resetSessionStatePushForTests();
    const { sent, window } = fakeWindow();
    const calls = { count: 0 };
    const call: SessionDaemonCall = async () => {
      calls.count += 1;
      if (calls.count === 1) throw new Error("socket gone");
      if (calls.count === 2) return { ok: true as const, result: { nope: 1 } };
      return pollOk("boot-1", [working(9)], 9);
    };
    const stop = startSessionStatePush({
      getWindow: () => window as never,
      call,
      maxRounds: 3,
      log: () => {},
    });
    await waitFor(calls, 3);
    stop();
    expect(sent).toHaveLength(1);
  });
});

describe("backoff", () => {
  it("doubles to the cap", () => {
    expect(nextBackoff(baseBackoffMs())).toBe(baseBackoffMs() * 2);
    expect(nextBackoff(1_000_000)).toBe(15_000);
  });
});
