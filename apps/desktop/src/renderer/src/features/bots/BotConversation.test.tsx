// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BotConversation } from "./BotConversation";
import type {
  ConversationMessageView,
  ConversationView,
} from "./bot-conversation-state";

afterEach(cleanup);

function conversation(
  overrides: Partial<ConversationView> = {},
): ConversationView {
  return {
    id: "bot-1:proj-a",
    botId: "bot-1",
    projectId: "proj-a",
    hostId: "host-1",
    botName: "Watcher",
    effectiveHarness: "pi",
    effectiveProvider: "dgx-spark",
    effectiveModel: "qwen",
    originatingRunId: "req-1",
    contextVersion: 5,
    contextHash: "a1b2c3d4e5f6",
    identityVersion: 3,
    nativeSessionId: "sess-1",
    nativeIncarnation: "inc-1",
    liveness: "live",
    ...overrides,
  };
}

function message(
  overrides: Partial<ConversationMessageView> = {},
): ConversationMessageView {
  return {
    id: "msg-1",
    prompt: "Summarize the run",
    requestId: "req-1",
    sessionId: "sess-1",
    incarnation: "inc-1",
    hostObservation: "live",
    error: null,
    startedAt: 1,
    endedAt: 2,
    ...overrides,
  };
}

describe("BotConversation", () => {
  it("renders the empty state with an open control", () => {
    const onOpen = vi.fn();
    render(
      <BotConversation
        conversation={null}
        messages={[]}
        replies={{}}
        deliveries={[]}
        onOpen={onOpen}
      />,
    );
    expect(screen.getByTestId("bot-conversation-empty")).toBeTruthy();
    fireEvent.click(screen.getByTestId("bot-conversation-open"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("shows results, context version and reply text", () => {
    render(
      <BotConversation
        conversation={conversation()}
        messages={[message()]}
        replies={{ "msg-1": "All checks passed." }}
        deliveries={[]}
      />,
    );
    expect(
      screen.getByTestId("bot-conversation-bot-1:proj-a"),
    ).toBeTruthy();
    expect(screen.getByText("Summarize the run")).toBeTruthy();
    expect(screen.getByText("All checks passed.")).toBeTruthy();
    expect(screen.getByText(/identity v3/)).toBeTruthy();
    expect(screen.getByText(/pi/)).toBeTruthy();
  });

  it("marks stale native links as unverifiable, never live", () => {
    render(
      <BotConversation
        conversation={conversation({ liveness: "unverifiable" })}
        messages={[]}
        replies={{}}
        deliveries={[]}
      />,
    );
    expect(screen.getByText("unverifiable")).toBeTruthy();
    expect(screen.getByText(/stale/)).toBeTruthy();
  });

  it("queues input and steers only with an active turn", () => {
    const onQueue = vi.fn();
    const onSteer = vi.fn();
    const active = message({ id: "m-active", endedAt: null });
    const { rerender } = render(
      <BotConversation
        conversation={conversation()}
        messages={[message()]}
        replies={{}}
        deliveries={[]}
        onQueue={onQueue}
        onSteer={onSteer}
      />,
    );
    const queueInput = screen.getByTestId(
      "bot-conversation-queue-input-bot-1:proj-a",
    ) as HTMLInputElement;
    fireEvent.change(queueInput, { target: { value: "follow up" } });
    fireEvent.click(
      screen.getByTestId("bot-conversation-queue-send-bot-1:proj-a"),
    );
    expect(onQueue).toHaveBeenCalledWith("follow up");

    // No active turn: steer stays disabled.
    expect(
      (
        screen.getByTestId(
          "bot-conversation-steer-send-bot-1:proj-a",
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    rerender(
      <BotConversation
        conversation={conversation()}
        messages={[active]}
        replies={{}}
        deliveries={[]}
        onQueue={onQueue}
        onSteer={onSteer}
      />,
    );
    const steerInput = screen.getByTestId(
      "bot-conversation-steer-input-bot-1:proj-a",
    ) as HTMLInputElement;
    fireEvent.change(steerInput, { target: { value: "pivot now" } });
    fireEvent.click(
      screen.getByTestId("bot-conversation-steer-send-bot-1:proj-a"),
    );
    expect(onSteer).toHaveBeenCalledWith("pivot now");
  });

  it("renders delivery recovery controls", () => {
    const onReconcile = vi.fn();
    render(
      <BotConversation
        conversation={conversation()}
        messages={[]}
        replies={{}}
        deliveries={[
          {
            id: "del-9",
            conversationId: "bot-1:proj-a",
            runId: "req-9",
            state: "uncertain",
            attempts: 1,
            updatedAt: 2,
          },
        ]}
        onReconcileDelivery={onReconcile}
      />,
    );
    expect(screen.getByTestId("delivery-del-9")).toBeTruthy();
    fireEvent.click(screen.getByTestId("delivery-reconcile-accepted-del-9"));
    expect(onReconcile).toHaveBeenCalledWith("del-9", true);
  });
});
