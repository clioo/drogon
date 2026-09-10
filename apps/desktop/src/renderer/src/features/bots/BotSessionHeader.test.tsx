// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BotSessionHeader } from "./BotSessionHeader";
import type { BotSessionMeta } from "./bot-session-chrome";
import type { Session } from "../../../../shared/session-contract";

afterEach(cleanup);

function meta(overrides: Partial<BotSessionMeta> = {}): BotSessionMeta {
  return {
    botId: "bot-1",
    incarnation: "inc-1",
    displayName: "Arya Stark",
    handle: "arya-stark",
    title: null,
    harnessId: "claude",
    model: null,
    workspaceId: "ws-home-1",
    hostId: "host-1",
    ...overrides,
  };
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "sess-1",
    workspaceId: "ws-home-1",
    hostId: "host-1",
    incarnation: "inc-1",
    command: "claude",
    args: [],
    cols: 80,
    rows: 24,
    verdict: "live",
    exitCode: null,
    createdAt: new Date().toISOString(),
    agentState: "working",
    ...overrides,
  };
}

describe("BotSessionHeader", () => {
  it("renders the breadcrumb, title, status pill and workspace chip", () => {
    render(
      <BotSessionHeader
        meta={meta()}
        session={session()}
        workspacePath="/data/bot-workspaces/arya-stark"
        onStop={() => {}}
        stopping={false}
        onOpenBots={() => {}}
      />,
    );
    expect(screen.getByTestId("bot-session-title").textContent).toBe(
      "Arya Stark · Claude",
    );
    expect(screen.getByText("Bots")).toBeTruthy();
    expect(screen.getByText("Terminal")).toBeTruthy();
    expect(screen.getByTestId("bot-session-status-pill").textContent).toContain(
      "Working",
    );
    expect(screen.getByText("/data/bot-workspaces/arya-stark")).toBeTruthy();
    expect(screen.getByText("@arya-stark")).toBeTruthy();
  });

  it("wires Stop to the caller and disables it once the session has exited", () => {
    const onStop = vi.fn();
    const { rerender } = render(
      <BotSessionHeader
        meta={meta()}
        session={session()}
        workspacePath={null}
        onStop={onStop}
        stopping={false}
        onOpenBots={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("bot-session-stop"));
    expect(onStop).toHaveBeenCalledTimes(1);

    rerender(
      <BotSessionHeader
        meta={meta()}
        session={session({ verdict: "exited", exitCode: 0, agentState: "exited" })}
        workspacePath={null}
        onStop={onStop}
        stopping={false}
        onOpenBots={() => {}}
      />,
    );
    expect(
      (screen.getByTestId("bot-session-stop") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("navigates back to Bots from the breadcrumb", () => {
    const onOpenBots = vi.fn();
    render(
      <BotSessionHeader
        meta={meta()}
        session={session()}
        workspacePath={null}
        onStop={() => {}}
        stopping={false}
        onOpenBots={onOpenBots}
      />,
    );
    fireEvent.click(screen.getByText("Bots"));
    expect(onOpenBots).toHaveBeenCalledTimes(1);
  });

  it("renders the workspace chip and title from the REAL bot facts -- they change when those change", () => {
    // task_e7c183ebc637: every app-rendered line above the terminal must be
    // derived from values the app actually knows (the bot's real home path,
    // real harness), never hardcoded and never model prose. Rerendering
    // with different inputs must move every one of them.
    const { rerender } = render(
      <BotSessionHeader
        meta={meta()}
        session={session()}
        workspacePath="/Users/carlos/Drogon/bots/arya-stark"
        onStop={() => {}}
        stopping={false}
        onOpenBots={() => {}}
      />,
    );
    expect(screen.getByText("/Users/carlos/Drogon/bots/arya-stark")).toBeTruthy();
    expect(screen.getByTestId("bot-session-title").textContent).toBe(
      "Arya Stark · Claude",
    );
    rerender(
      <BotSessionHeader
        meta={meta({
          displayName: "Watcher on the Wall",
          handle: null,
          harnessId: "pi",
        })}
        session={session()}
        workspacePath="/Users/carlos/Drogon/bots/watcher"
        onStop={() => {}}
        stopping={false}
        onOpenBots={() => {}}
      />,
    );
    expect(screen.getByText("/Users/carlos/Drogon/bots/watcher")).toBeTruthy();
    expect(
      screen.queryByText("/Users/carlos/Drogon/bots/arya-stark"),
    ).toBeNull();
    expect(screen.getByTestId("bot-session-title").textContent).toBe(
      "Watcher on the Wall · Pi",
    );
  });
});
