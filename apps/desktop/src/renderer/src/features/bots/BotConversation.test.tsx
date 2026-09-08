// @vitest-environment jsdom
// R16-S: the conversation reply renders PTY bytes as readable text, and a
// chat turn carries the bot's stored provider/model overrides.
import { describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach } from "vitest";
import { BotConversation, readableTerminalText } from "./BotConversation";

afterEach(cleanup);

const scope = { hostId: "host-1", workspaceId: "ws-1", locale: "en-US" };

describe("readableTerminalText", () => {
  it("strips CSI, OSC and charset sequences from harness TUI output", () => {
    const raw =
      "\u001b[?2004h\u001b[>7u\u001b[?u\u001b[c\u001b[?25lHello\u001b[0m\n\u001b]8;;https://x\u0007link\u001b]8;;\u0007\n\u001b(Bplain";
    expect(readableTerminalText(raw)).toBe("Hello\nlink\nplain");
  });

  it("collapses consecutive duplicate status lines from spinner redraws", () => {
    const frame = "── ⠹ Working ──";
    const raw = [frame, frame, frame, "done", "done", "", ""].join("\n");
    expect(readableTerminalText(raw)).toBe(
      [frame, "done", "", ""].join("\n"),
    );
  });

  it("leaves plain text (and blank-line runs) untouched", () => {
    expect(readableTerminalText("a\n\nb\n")).toBe("a\n\nb\n");
    expect(readableTerminalText("")).toBe("");
  });
});

describe("BotConversation send", () => {
  it("sends the stored provider/model as bot.run overrides for a Pi bot", async () => {
    const calls: unknown[] = [];
    const bridge = {
      botSnapshot: async () => ({
        ok: true as const,
        result: { ...scope, bots: [], history: [] },
      }),
      botHistory: async () => ({
        ok: true as const,
        result: { ...scope, botId: "bot-1", messages: [] },
      }),
      botRun: async (input: unknown) => {
        calls.push(input);
        return {
          ok: true as const,
          result: {
            requestId: "r",
            hostId: scope.hostId,
            workspaceId: scope.workspaceId,
            automationRunId: null,
            responsibilityRunId: null,
            messageId: "m-1",
            session: null,
            outcome: "dispatched" as const,
            refusal: null,
            reason: null,
            error: null,
            observedAt: null,
            recordedAt: 0,
          },
        };
      },
    };
    render(
      <BotConversation
        botId="bot-1"
        harnessId="pi"
        explicitModel="dgx-spark/qwen3.8-flash-next-nvidia-nvfp4"
        scope={scope}
        bridge={bridge}
      />,
    );
    fireEvent.change(await screen.findByLabelText("Message"), {
      target: { value: "Hello bot" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      botId: "bot-1",
      prompt: "Hello bot",
      harness: {
        harnessId: "pi",
        provider: "dgx-spark",
        model: "qwen3.8-flash-next-nvidia-nvfp4",
        permissionMode: "unattended",
      },
    });
  });
});
