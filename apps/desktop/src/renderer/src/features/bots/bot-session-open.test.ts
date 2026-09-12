// MIT Copyright (c) 2026 Lovecast Inc.
// Install-resilience P4: the open-session dispatcher is the single choke
// point for the `interactive: true` field — an old daemon's raw
// `unknown field interactive` refusal must come back as the restart-
// directed message, while other refusals keep their verbatim text.
import { describe, expect, test } from "vitest";
import { dispatchOpenBotSession } from "./bot-session-open";
import type {
  BotBridge,
  BotScope,
  BotsPanelBot,
} from "./bots-panel-contracts";

const scope: BotScope & { locale: string } = {
  workspaceId: "w1",
  hostId: "h1",
  locale: "en",
};
const bot = {
  id: "bot-1",
  harnessPolicy: { defaultHarness: "pi", explicitModel: null },
} as unknown as BotsPanelBot;

function bridge(
  run: NonNullable<BotBridge["botRun"]>,
): Pick<BotBridge, "botRun"> {
  return { botRun: run };
}

describe("dispatchOpenBotSession skew classification", () => {
  test("an old daemon's unknown-field refusal is rewritten to restart-directed copy", async () => {
    const sent: unknown[] = [];
    const result = await dispatchOpenBotSession({
      bridge: bridge(async (input) => {
        sent.push(input);
        return {
          ok: false,
          error: {
            code: "invalid_argument",
            message: "unknown field interactive",
            retryable: false,
          },
        };
      }),
      scope,
      bot,
      requestId: "req-1",
    });
    expect(sent).toHaveLength(1);
    expect(result?.ok).toBe(false);
    if (!result || result.ok)
      throw new Error("expected a failure result from the dispatch");
    expect(result.error.code).toBe("invalid_argument");
    expect(result.error.message).toContain("newer than its background service");
    expect(result.error.message).toContain("Restart Drogon's service");
    expect(result.error.message).not.toContain("unknown field");
  });

  test("a genuine malformed-request refusal keeps its verbatim message", async () => {
    const result = await dispatchOpenBotSession({
      bridge: bridge(async () => ({
        ok: false,
        error: {
          code: "invalid_argument",
          message: "an open-session turn must not carry a prompt",
          retryable: false,
        },
      })),
      scope,
      bot,
      requestId: "req-2",
    });
    expect(result?.ok).toBe(false);
    if (!result || result.ok)
      throw new Error("expected a failure result from the dispatch");
    expect(result.error.message).toBe(
      "an open-session turn must not carry a prompt",
    );
  });

  test("success and missing bridge behavior are unchanged", async () => {
    const receipt = { runId: "r1" } as never;
    const okResult = await dispatchOpenBotSession({
      bridge: bridge(async () => ({ ok: true, result: receipt })),
      scope,
      bot,
      requestId: "req-3",
    });
    expect(okResult).toEqual({ ok: true, result: receipt });
    expect(
      await dispatchOpenBotSession({ scope, bot, requestId: "req-4" }),
    ).toBeNull();
  });
});
