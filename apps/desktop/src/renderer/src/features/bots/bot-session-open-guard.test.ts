// Per-Bot open-session dispatch guard (adversarial-report regression:
// "two surfaces, one bot, two sessions"). The Bots page's "Open session"
// button and the sidebar Chats row raced in the same tick on an
// `unverifiable` Bot session and produced 2 live sessions, 3/3. The old
// in-flight guard was per-surface (the page's own `busy`); the shared
// dispatcher must be per-Bot, so ANY pair of surfaces racing for the same
// Bot resolves to one dispatch and the loser JOINS it instead of opening a
// second session.
//
// FAILS on unmodified main: the bridge's `botRun` is invoked once per
// caller (2 calls) and each caller holds its own promise.
import { describe, expect, it } from "vitest";
import { dispatchOpenBotSession } from "./bot-session-open";
import type { BotRunReceipt, BotsPanelBot } from "./bots-panel-contracts";
import type { Result } from "../../../../shared/session-contract";

const scope = { hostId: "host-1", workspaceId: "ws-1", locale: "en-US" };

function bot(id: string): BotsPanelBot {
  return {
    id,
    characterPreset: "none",
    displayIdentity: { displayName: `Bot ${id}`, handle: null, title: null },
    harnessPolicy: { defaultHarness: "claude", explicitModel: null },
    instructions: "",
    memories: [],
    responsibilities: [],
    currentSession: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function receipt(): Result<BotRunReceipt> {
  return {
    ok: true,
    result: {
      requestId: "req-1",
      hostId: scope.hostId,
      workspaceId: scope.workspaceId,
      automationRunId: null,
      responsibilityRunId: null,
      messageId: "msg-1",
      session: { sessionId: "sess-1", incarnation: "inc-1" },
      outcome: "dispatched",
      refusal: null,
      reason: null,
      error: null,
      observedAt: null,
      recordedAt: 1,
      homeNotice: null,
    },
  };
}

describe("dispatchOpenBotSession", () => {
  it("two surfaces racing for the same bot join one dispatch", async () => {
    const resolvers: Array<(value: Result<BotRunReceipt>) => void> = [];
    let calls = 0;
    const bridge = {
      botRun: () => {
        calls += 1;
        return new Promise<Result<BotRunReceipt>>((resolve) => {
          resolvers.push(resolve);
        });
      },
    };

    // The Bots page and the sidebar click in the SAME tick.
    const pageClick = dispatchOpenBotSession({
      bridge,
      scope,
      bot: bot("bot-race"),
      requestId: "req-page",
    });
    const sidebarClick = dispatchOpenBotSession({
      bridge,
      scope,
      bot: bot("bot-race"),
      requestId: "req-sidebar",
    });

    expect(calls).toBe(1);

    // The loser joins the winner's dispatch: both surfaces hold the SAME
    // promise and both observe the SAME receipt (the one live session).
    expect(sidebarClick).toBe(pageClick);
    resolvers.forEach((resolve) => resolve(receipt()));
    const shared = await pageClick;
    expect(await sidebarClick).toEqual(shared);
    expect(shared?.ok).toBe(true);
    expect(calls).toBe(1);
  });

  it("dispatches independently for different bots", async () => {
    let calls = 0;
    const bridge = {
      botRun: async (): Promise<Result<BotRunReceipt>> => {
        calls += 1;
        return receipt();
      },
    };
    const first = await dispatchOpenBotSession({
      bridge,
      scope,
      bot: bot("bot-1"),
      requestId: "req-1",
    });
    const second = await dispatchOpenBotSession({
      bridge,
      scope,
      bot: bot("bot-2"),
      requestId: "req-2",
    });
    expect(calls).toBe(2);
    expect(first?.ok).toBe(true);
    expect(second?.ok).toBe(true);
  });

  it("clears the guard when the dispatch settles so a later open dispatches", async () => {
    let calls = 0;
    const bridge = {
      botRun: async (): Promise<Result<BotRunReceipt>> => {
        calls += 1;
        return receipt();
      },
    };
    const input = {
      bridge,
      scope,
      bot: bot("bot-settle"),
      requestId: "req-1",
    };
    await dispatchOpenBotSession(input);
    await dispatchOpenBotSession(input);
    expect(calls).toBe(2);
  });
});
