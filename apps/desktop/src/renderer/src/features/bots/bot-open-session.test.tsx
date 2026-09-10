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
    responsibilities: [],
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
  it("dispatches a bot.run chat turn with the bot's stored harness and reloads", async () => {
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
    expect(typeof input.prompt).toBe("string");
    expect((input.prompt as string).trim().length).toBeGreaterThan(0);
    expect(input.harness).toMatchObject({
      harnessId: "pi",
      provider: "dgx-spark",
      model: "qwen3.8-flash-next-nvidia-nvfp4",
      permissionMode: "unattended",
    });
    // bug-bot-a836b4ebf8be65505: Open Session must request a live,
    // interactive session (native's own TUI entrypoint), never the headless
    // one-shot daemon run that made a Bot "session" print one reply and
    // exit immediately.
    expect(input.interactive).toBe(true);
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
