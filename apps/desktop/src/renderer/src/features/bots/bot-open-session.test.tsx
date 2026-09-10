// @vitest-environment jsdom
/* bug-bot-open-session repro: "Open session" on a Bot card must open/create a
   session for the bot instead of silently selecting it. The fork opens a real
   harness tab (launch-drogon-bot-session); this repo's session primitive is
   the daemon's headless `bot.run` chat turn (J8), so the click must dispatch
   `bridge.botRun` with the bot's STORED harness overrides and reload — and
   every failure (withheld bridge, daemon-unreachable transport throw,
   refusal/unsupported outcome) must land in the shared action-error alert
   instead of vanishing. The card itself stays reference-verbatim (static
   Harness text); harness selection lives in the creation form's Agent
   dropdown, which the last case pins. */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { BotsPanel } from "./BotsPanel";
import { BotCreationForm } from "./BotCreationForm";
import { emptyBotCreateForm } from "./bots-page-model";
import type { BotsPanelBot } from "./bots-panel-contracts";

afterEach(cleanup);

const scope = { hostId: "host-1", workspaceId: "ws-1", locale: "en-US" };

function bot(overrides: Partial<BotsPanelBot> = {}): BotsPanelBot {
  return {
    id: "bot-1",
    characterPreset: "jon-snow",
    displayIdentity: { displayName: "Jon Snow", handle: null, title: null },
    harnessPolicy: { defaultHarness: "claude", explicitModel: null },
    instructions: "Guard the realm.",
    memories: [],
    // Default-configured so the expanded card (with its Open-session
    // control) renders; the design collapses unconfigured bots.
    responsibilities: [
      {
        id: "resp-seed",
        name: "Seeded duty",
        instructions: "",
        kind: "scheduled",
        trigger: { kind: "scheduled", automationId: "auto-seed" },
        enabled: true,
        recipe: null,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    currentSession: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function dispatchedReceipt() {
  return {
    ok: true as const,
    result: {
      requestId: "req-1",
      hostId: scope.hostId,
      workspaceId: scope.workspaceId,
      automationRunId: null,
      responsibilityRunId: null,
      messageId: "msg-1",
      session: { sessionId: "sess-1", incarnation: "inc-1" },
      outcome: "dispatched" as const,
      refusal: null,
      reason: null,
      error: null,
      observedAt: null,
      recordedAt: 1,
    },
  };
}

/** Fake bridge over one bot: botRun is captured and its result is
 *  caller-controlled, so the tests pin the dispatch contract without a
 *  daemon. */
function fakeBridge(
  seeded: BotsPanelBot,
  botRunImpl?: (...args: never[]) => Promise<unknown>,
) {
  let snapshots = 0;
  const botRun = vi.fn(
    botRunImpl ??
      (async () => dispatchedReceipt() as unknown as never),
  );
  const bridge = {
    botSnapshot: async () => {
      snapshots += 1;
      return {
        ok: true as const,
        result: { ...scope, bots: [seeded], history: [] },
      };
    },
    botRun,
  };
  return { bridge, botRun, snapshots: () => snapshots };
}

describe("bot open session", () => {
  it("dispatches an open-session turn with NO model prompt, the bot's stored harness, and a reload", async () => {
    const seeded = bot({
      harnessPolicy: {
        defaultHarness: "pi",
        explicitModel: "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4",
      },
    });
    const fake = fakeBridge(seeded);
    render(
      <BotsPanel
        snapshot={{ bots: [seeded], history: [] }}
        bridge={fake.bridge}
        scope={scope}
      />,
    );
    fireEvent.click(await screen.findByTestId("open-session-bot-1"));
    await waitFor(() => expect(fake.botRun).toHaveBeenCalledTimes(1));
    const input = fake.botRun.mock.calls[0]![0] as Record<string, unknown>;
    expect(input.botId).toBe("bot-1");
    // task_e7c183ebc637: opening a session dispatches NO model turn. The
    // seam assertion is on the wire shape itself -- no `prompt` field
    // exists on the dispatch at all, so there is nothing for a model to
    // narrate a status report from.
    expect("prompt" in input && input.prompt !== undefined).toBe(false);
    // bug-bot-a836b4ebf8be65505: Open Session must request a live,
    // interactive session (native's own TUI entrypoint), never the headless
    // one-shot daemon run that made a Bot "session" print one reply and
    // exit immediately.
    expect(input.interactive).toBe(true);
    expect(input.harness).toMatchObject({
      harnessId: "pi",
      provider: "dgx-spark",
      model: "qwen3.8-flash-next-nvidia-nvfp4",
      permissionMode: "unattended",
    });
    // The post-dispatch reload is what lands the new session state.
    await waitFor(() => expect(fake.snapshots()).toBeGreaterThanOrEqual(2));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("surfaces a daemon refusal instead of silence", async () => {
    const seeded = bot();
    const fake = fakeBridge(seeded, async () => ({
      ok: true as const,
      result: { ...dispatchedReceipt().result, outcome: "refused", error: "No harness available." },
    }) as unknown as never);
    render(
      <BotsPanel
        snapshot={{ bots: [seeded], history: [] }}
        bridge={fake.bridge}
        scope={scope}
      />,
    );
    fireEvent.click(await screen.findByTestId("open-session-bot-1"));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "No harness available.",
      ),
    );
  });

  it("surfaces a daemon-unreachable transport failure honestly", async () => {
    const seeded = bot();
    const fake = fakeBridge(seeded, async () => {
      throw new Error("socket hang up");
    });
    render(
      <BotsPanel
        snapshot={{ bots: [seeded], history: [] }}
        bridge={fake.bridge}
        scope={scope}
      />,
    );
    fireEvent.click(await screen.findByTestId("open-session-bot-1"));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "socket hang up",
      ),
    );
  });

  it("explains instead of no-op when the bridge has no botRun", async () => {
    const seeded = bot();
    const snapshots = { count: 0 };
    const readOnly = {
      botSnapshot: async () => {
        snapshots.count += 1;
        return {
          ok: true as const,
          result: { ...scope, bots: [seeded], history: [] },
        };
      },
    };
    render(
      <BotsPanel
        snapshot={{ bots: [seeded], history: [] }}
        bridge={readOnly}
        scope={scope}
      />,
    );
    fireEvent.click(await screen.findByTestId("open-session-bot-1"));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(
        /not connected|unavailable|botRun/i,
      ),
    );
  });

  it("dispatches with the app-global scope instead of refusing (#348/R17-E)", async () => {
    // Reads are app-global and native resolves '' to the bot's owning
    // workspace: the old workspace-selection refusal is gone, the turn
    // rides the live scope verbatim.
    const seeded = bot();
    const fake = fakeBridge(seeded);
    render(
      <BotsPanel
        snapshot={{ bots: [seeded], history: [] }}
        bridge={fake.bridge}
        scope={{ ...scope, workspaceId: "" }}
      />,
    );
    fireEvent.click(await screen.findByTestId("open-session-bot-1"));
    await waitFor(() => expect(fake.botRun).toHaveBeenCalledTimes(1));
    expect(fake.botRun.mock.calls[0]![0]).toMatchObject({
      botId: "bot-1",
      workspaceId: "",
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("hands the real dispatched session to the host for in-app presentation", async () => {
    // Carlos directive: Open session must open the REAL session in-app.
    // The panel's seam is the host callback, fired with native's own
    // session identity (never invented): the host owns tab open/focus.
    const seeded = bot();
    const fake = fakeBridge(seeded);
    const onOpenSession = vi.fn();
    render(
      <BotsPanel
        snapshot={{ bots: [seeded], history: [] }}
        bridge={fake.bridge}
        scope={scope}
        onOpenSession={onOpenSession}
      />,
    );
    fireEvent.click(await screen.findByTestId("open-session-bot-1"));
    await waitFor(() => expect(onOpenSession).toHaveBeenCalledTimes(1));
    expect(onOpenSession).toHaveBeenCalledWith({
      botId: "bot-1",
      sessionId: "sess-1",
      incarnation: "inc-1",
      harness: { harnessId: "claude", explicitModel: null },
      workspaceId: scope.workspaceId,
      hostId: scope.hostId,
      displayName: "Jon Snow",
      handle: null,
      title: null,
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("skips host presentation without a session, never inventing one", async () => {
    const seeded = bot();
    const fake = fakeBridge(seeded, async () => ({
      ok: true as const,
      result: { ...dispatchedReceipt().result, session: null },
    }) as unknown as never);
    const onOpenSession = vi.fn();
    render(
      <BotsPanel
        snapshot={{ bots: [seeded], history: [] }}
        bridge={fake.bridge}
        scope={scope}
        onOpenSession={onOpenSession}
      />,
    );
    fireEvent.click(await screen.findByTestId("open-session-bot-1"));
    await waitFor(() => expect(fake.snapshots()).toBeGreaterThanOrEqual(2));
    expect(onOpenSession).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("explains instead of no-op when no scope is known", async () => {
    const seeded = bot();
    const fake = fakeBridge(seeded);
    render(
      <BotsPanel snapshot={{ bots: [seeded], history: [] }} bridge={fake.bridge} />,
    );
    fireEvent.click(await screen.findByTestId("open-session-bot-1"));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/unavailable/i),
    );
    expect(fake.botRun).not.toHaveBeenCalled();
  });

  it("files create under the host's placement folder, not the global scope", async () => {
    // Native files a new bot under an exact workspace folder (it has no
    // owning bot to resolve one from), so create carries createWorkspaceId
    // while reads stay app-global.
    const seeded = bot();
    const botCreate = vi.fn(async (createInput: {
      body: {
        characterPreset: string;
        displayIdentity: {
          displayName: string;
          handle: string | null;
          title: string | null;
        };
      };
    }) => ({
      ok: true as const,
      result: bot({
        id: "bot-new",
        characterPreset: createInput.body.characterPreset,
        displayIdentity: {
          displayName: createInput.body.displayIdentity.displayName,
          handle: createInput.body.displayIdentity.handle,
          title: createInput.body.displayIdentity.title,
        },
      }),
    }));
    const bridge = {
      botSnapshot: async () => ({
        ok: true as const,
        result: {
          ...scope,
          workspaceId: "",
          bots: [seeded],
          history: [],
        },
      }),
      botCreate,
    };
    render(
      <BotsPanel
        snapshot={{ bots: [seeded], history: [] }}
        bridge={bridge}
        scope={{ ...scope, workspaceId: "" }}
        createWorkspaceId="ws-9"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "New Bot" }));
    fireEvent.change(screen.getByLabelText("Name (optional)"), {
      target: { value: "Placed Bot" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Bot" }));
    await waitFor(() => expect(botCreate).toHaveBeenCalledTimes(1));
    expect(botCreate.mock.calls[0]![0]).toMatchObject({
      workspaceId: "ws-9",
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("refuses create honestly with no placement folder", async () => {
    const seeded = bot();
    const botCreate = vi.fn();
    const bridge = {
      botSnapshot: async () => ({
        ok: true as const,
        result: {
          ...scope,
          workspaceId: "",
          bots: [seeded],
          history: [],
        },
      }),
      botCreate,
    };
    render(
      <BotsPanel
        snapshot={{ bots: [seeded], history: [] }}
        bridge={bridge}
        scope={{ ...scope, workspaceId: "" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "New Bot" }));
    fireEvent.click(screen.getByRole("button", { name: "Create Bot" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Select a workspace before creating a Bot.",
      ),
    );
    expect(botCreate).not.toHaveBeenCalled();
  });

  it("offers the harness picker in the creation form (reference parity)", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <BotCreationForm
        form={emptyBotCreateForm()}
        busy={false}
        onChange={onChange}
        onCancel={() => {}}
        onSubmit={() => {}}
      />,
    );
    const agent = screen.getByLabelText("Agent") as HTMLSelectElement;
    const options = [...agent.options].map((option) => option.textContent);
    expect(options).toEqual(
      expect.arrayContaining(["Claude", "Pi", "OpenCode", "Antigravity", "Codex"]),
    );
    // Model stays harness-default unless Pi is picked.
    expect(
      (screen.getByLabelText("Model") as HTMLInputElement).disabled,
    ).toBe(true);
    fireEvent.change(agent, { target: { value: "pi" } });
    expect(onChange).toHaveBeenCalledWith({ harnessId: "pi", model: "" });
    rerender(
      <BotCreationForm
        form={{ ...emptyBotCreateForm(), harnessId: "pi" }}
        busy={false}
        onChange={onChange}
        onCancel={() => {}}
        onSubmit={() => {}}
      />,
    );
    expect(
      (screen.getByLabelText("Model") as HTMLInputElement).disabled,
    ).toBe(false);
  });
});

/** Gap 2 (task_926fddc5e769): a Bot is bound to ONE session. The default
 *  "Open session" click must focus the recorded session the host confirms
 *  is live instead of spawning a second one; a genuinely exited record
 *  still opens a fresh session. */
describe("bot open session reuse", () => {
  function botWithRecordedSession(): BotsPanelBot {
    return bot({
      currentSession: {
        sessionId: "sess-live",
        harness: "claude",
        model: null,
        startedAt: 1,
        rotatedAt: 1,
      },
    });
  }

  const liveSession = {
    sessionId: "sess-live",
    incarnation: "inc-live",
    workspaceId: "ws-home",
    hostId: "host-1",
    harnessId: "claude",
  };

  it("focuses the live recorded session twice instead of dispatching a second one", async () => {
    const seeded = botWithRecordedSession();
    const fake = fakeBridge(seeded);
    const onOpenSession = vi.fn();
    const resolveBotSession = vi.fn(() => ({
      kind: "focus" as const,
      session: liveSession,
    }));
    render(
      <BotsPanel
        snapshot={{ bots: [seeded], history: [] }}
        bridge={fake.bridge}
        scope={scope}
        resolveBotSession={resolveBotSession}
        onOpenSession={onOpenSession}
      />,
    );
    const button = await screen.findByTestId("open-session-bot-1");
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(onOpenSession).toHaveBeenCalledTimes(2));
    expect(fake.botRun).not.toHaveBeenCalled();
    const expected = {
      botId: "bot-1",
      sessionId: "sess-live",
      incarnation: "inc-live",
      harness: { harnessId: "claude", explicitModel: null },
      workspaceId: "ws-home",
      hostId: "host-1",
      displayName: "Jon Snow",
      handle: null,
      title: null,
    };
    expect(onOpenSession).toHaveBeenNthCalledWith(1, expected);
    expect(onOpenSession).toHaveBeenNthCalledWith(2, expected);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reopens a closed recorded session with the harness resume flag", async () => {
    const seeded = botWithRecordedSession();
    const fake = fakeBridge(seeded);
    const resolveBotSession = vi.fn(() => ({
      kind: "reopen" as const,
      sessionId: "sess-live",
      harnessId: "claude",
    }));
    render(
      <BotsPanel
        snapshot={{ bots: [seeded], history: [] }}
        bridge={fake.bridge}
        scope={scope}
        resolveBotSession={resolveBotSession}
      />,
    );
    fireEvent.click(await screen.findByTestId("open-session-bot-1"));
    await waitFor(() => expect(fake.botRun).toHaveBeenCalledTimes(1));
    const input = fake.botRun.mock.calls[0]![0] as Record<string, unknown>;
    expect(input.resume).toBe(true);
    expect(resolveBotSession).toHaveBeenCalledWith({ bot: seeded });
  });

  it("opens fresh without resume when there is no recorded session", async () => {
    const seeded = bot({ currentSession: null });
    const fake = fakeBridge(seeded);
    const resolveBotSession = vi.fn(() => ({ kind: "open" as const }));
    render(
      <BotsPanel
        snapshot={{ bots: [seeded], history: [] }}
        bridge={fake.bridge}
        scope={scope}
        resolveBotSession={resolveBotSession}
      />,
    );
    fireEvent.click(await screen.findByTestId("open-session-bot-1"));
    await waitFor(() => expect(fake.botRun).toHaveBeenCalledTimes(1));
    const input = fake.botRun.mock.calls[0]![0] as Record<string, unknown>;
    expect("resume" in input).toBe(false);
  });

  it("refuses honestly and dispatches NOTHING when liveness is unknown", async () => {
    const seeded = botWithRecordedSession();
    const fake = fakeBridge(seeded);
    const onOpenSession = vi.fn();
    const resolveBotSession = vi.fn(() => ({ kind: "unknown" as const }));
    render(
      <BotsPanel
        snapshot={{ bots: [seeded], history: [] }}
        bridge={fake.bridge}
        scope={scope}
        resolveBotSession={resolveBotSession}
        onOpenSession={onOpenSession}
      />,
    );
    fireEvent.click(await screen.findByTestId("open-session-bot-1"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("could create a duplicate");
    // The whole point of Defect 1: an unestablished liveness must never
    // fall through to a fresh dispatch.
    expect(fake.botRun).not.toHaveBeenCalled();
    expect(onOpenSession).not.toHaveBeenCalled();
  });

  it("says a harness cannot resume rather than pretending a blank session is a continuation", async () => {
    const seeded = botWithRecordedSession();
    const fake = fakeBridge(seeded);
    const resolveBotSession = vi.fn(() => ({
      kind: "reopen" as const,
      sessionId: "sess-live",
      harnessId: "gemini",
    }));
    render(
      <BotsPanel
        snapshot={{ bots: [seeded], history: [] }}
        bridge={fake.bridge}
        scope={scope}
        resolveBotSession={resolveBotSession}
      />,
    );
    fireEvent.click(await screen.findByTestId("open-session-bot-1"));
    await waitFor(() => expect(fake.botRun).toHaveBeenCalledTimes(1));
    const input = fake.botRun.mock.calls[0]![0] as Record<string, unknown>;
    expect("resume" in input).toBe(false);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("cannot reopen its previous conversation");
  });

  it("New session forces a fresh dispatch even when a live session is resumable", async () => {
    const seeded = botWithRecordedSession();
    const fake = fakeBridge(seeded);
    const onOpenSession = vi.fn();
    const resolveBotSession = vi.fn(() => ({
      kind: "focus" as const,
      session: liveSession,
    }));
    render(
      <BotsPanel
        snapshot={{ bots: [seeded], history: [] }}
        bridge={fake.bridge}
        scope={scope}
        resolveBotSession={resolveBotSession}
        onOpenSession={onOpenSession}
      />,
    );
    fireEvent.click(await screen.findByTestId("new-session-bot-1"));
    await waitFor(() => expect(fake.botRun).toHaveBeenCalledTimes(1));
    expect(onOpenSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "sess-1" }),
    );
  });

  it("shows the New session control only when a session could be resumed", async () => {
    const seeded = bot();
    const fresh = fakeBridge(seeded);
    const { unmount } = render(
      <BotsPanel
        snapshot={{ bots: [seeded], history: [] }}
        bridge={fresh.bridge}
        scope={scope}
      />,
    );
    await screen.findByTestId("open-session-bot-1");
    expect(screen.queryByTestId("new-session-bot-1")).toBeNull();
    unmount();

    const resumed = botWithRecordedSession();
    render(
      <BotsPanel
        snapshot={{ bots: [resumed], history: [] }}
        bridge={fakeBridge(resumed).bridge}
        scope={scope}
      />,
    );
    await screen.findByTestId("open-session-bot-1");
    expect(screen.getByTestId("new-session-bot-1")).toBeTruthy();
  });
});
