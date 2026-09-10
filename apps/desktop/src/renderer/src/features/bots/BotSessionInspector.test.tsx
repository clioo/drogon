// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BotSessionInspector } from "./BotSessionInspector";
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
    model: "claude-sonnet-4-5",
    workspaceId: "ws-home-1",
    hostId: "host-1",
    ...overrides,
  };
}

const STARTED_AT = Date.parse("2026-09-10T12:00:00.000Z");

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
    createdAt: new Date(STARTED_AT).toISOString(),
    agentState: "working",
    ...overrides,
  };
}

describe("BotSessionInspector", () => {
  it("renders identity, harness, model and workspace facts from real data", () => {
    render(
      <BotSessionInspector
        meta={meta()}
        session={session()}
        workspacePath="/data/bot-workspaces/arya-stark"
        processId={48921}
        nowMs={STARTED_AT + 4 * 60_000 + 12_000}
      />,
    );
    expect(screen.getByText("Arya Stark")).toBeTruthy();
    expect(screen.getByText("@arya-stark")).toBeTruthy();
    expect(screen.getByText("Autonomous code operator")).toBeTruthy();
    expect(screen.getByTestId("bot-session-row-harness").textContent).toContain(
      "Claude (Anthropic)",
    );
    expect(screen.getByTestId("bot-session-row-model").textContent).toContain(
      "claude-sonnet-4-5",
    );
    expect(screen.getByTestId("bot-session-row-workspace").textContent).toContain(
      "/data/bot-workspaces/arya-stark",
    );
    expect(screen.getByTestId("bot-session-row-workspace").textContent).toContain(
      "Isolated runtime",
    );
    expect(screen.getByTestId("bot-session-row-type").textContent).toContain(
      "Child session",
    );
    expect(screen.getByTestId("bot-session-row-started").textContent).toContain(
      "00:04:12",
    );
    expect(screen.getByTestId("bot-session-row-pid").textContent).toContain(
      "48921",
    );
    expect(screen.getByText(/Workspace isolation/)).toBeTruthy();
  });

  it("prefers the bot's own title over the generic role subtitle", () => {
    render(
      <BotSessionInspector
        meta={meta({ title: "Nightly release captain" })}
        session={session()}
        workspacePath={null}
        processId={null}
        nowMs={STARTED_AT}
      />,
    );
    expect(screen.getByText("Nightly release captain")).toBeTruthy();
  });

  it("renders honest unknown/loading states instead of inventing values", () => {
    render(
      <BotSessionInspector
        meta={meta({ model: null, handle: null })}
        session={session()}
        workspacePath={null}
        processId={null}
        nowMs={STARTED_AT}
      />,
    );
    expect(screen.getByTestId("bot-session-row-model").textContent).toContain(
      "Harness default",
    );
    expect(screen.getByTestId("bot-session-row-pid").textContent).toContain(
      "Unknown",
    );
    expect(screen.getByTestId("bot-session-row-workspace").textContent).toContain(
      "…",
    );
    expect(screen.queryByText("@arya-stark")).toBeNull();
  });
});
