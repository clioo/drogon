// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Terminal pane Manage Sessions: lists daemon sessions through the existing
// window.drogon workspaces()/sessions()/stop() surface, refreshes on
// demand, and kills one/all sessions with an inline arm-to-confirm (the
// fork confirms through dialogs; the effect — stop RPC per session — is
// the same). A missing bridge renders the honest unavailable state.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Session, Workspace } from "../../../../shared/session-contract";
import { TerminalSection } from "./terminal-section";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    workspaceId: "w1",
    hostId: "h",
    incarnation: "i1",
    command: "sh",
    args: [],
    cols: 80,
    rows: 24,
    verdict: "live",
    exitCode: null,
    createdAt: "2026-09-08T00:00:00Z",
    agentState: "working",
    ...overrides,
  };
}

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "w1",
    path: "/repo",
    ...overrides,
  } as Workspace;
}

afterEach(() => {
  cleanup();
  delete (window as { drogon?: unknown }).drogon;
});

describe("terminal manage sessions", () => {
  test("renders the fork pane title and the manage-sessions group", () => {
    render(<TerminalSection />);
    expect(screen.getByRole("heading", { name: "Terminal" })).toBeDefined();
    expect(
      screen.getByText("Shells, renderer, sessions, and terminal behavior."),
    ).toBeDefined();
    expect(screen.getByText("Manage Sessions")).toBeDefined();
  });

  test("a missing bridge reports unavailable instead of an empty table", async () => {
    render(<TerminalSection />);
    expect(
      await screen.findByText("Not available: the desktop bridge is missing"),
    ).toBeDefined();
  });

  test("lists sessions with workspace path, state and count", async () => {
    (window as { drogon?: unknown }).drogon = {
      workspaces: async () => ({ ok: true, result: { workspaces: [workspace()] } }),
      sessions: async () => ({
        ok: true,
        result: { sessions: [session(), session({ id: "s2", agentState: "idle" })] },
      }),
      stop: vi.fn(async () => ({ ok: true, result: session() })),
    };
    render(<TerminalSection />);
    expect(await screen.findByText("(2)")).toBeDefined();
    expect(screen.getAllByText("/repo")).toHaveLength(2);
    expect(screen.getByTitle("s1")).toBeDefined();
    expect(screen.getByTitle("s2")).toBeDefined();
    expect(screen.getByRole("button", { name: "Kill session s1" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Kill all sessions" })).toBeDefined();
  });

  test("kill arms first, then stops and reports", async () => {
    const stop = vi.fn(async () => ({ ok: true, result: session() }));
    (window as { drogon?: unknown }).drogon = {
      workspaces: async () => ({ ok: true, result: { workspaces: [workspace()] } }),
      sessions: async () => ({ ok: true, result: { sessions: [session()] } }),
      stop,
    };
    render(<TerminalSection />);
    const kill = await screen.findByRole("button", { name: "Kill session s1" });
    fireEvent.click(kill);
    // Armed: the label switches to the confirm wording, nothing stopped yet.
    expect(stop).not.toHaveBeenCalled();
    const confirm = await screen.findByRole("button", {
      name: "Confirm kill session s1",
    });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(stop).toHaveBeenCalledWith({ sessionId: "s1", incarnation: "i1" }),
    );
    expect(await screen.findByText("Killed session.")).toBeDefined();
  });

  test("a failed stop reports honestly", async () => {
    (window as { drogon?: unknown }).drogon = {
      workspaces: async () => ({ ok: true, result: { workspaces: [workspace()] } }),
      sessions: async () => ({ ok: true, result: { sessions: [session()] } }),
      stop: async () => ({ ok: false, error: { message: "gone" } }),
    };
    render(<TerminalSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Kill session s1" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm kill session s1" }),
    );
    expect(await screen.findByText("gone")).toBeDefined();
  });

  test("kill-all stops every listed session sequentially", async () => {
    const stop = vi.fn(async () => ({ ok: true, result: session() }));
    (window as { drogon?: unknown }).drogon = {
      workspaces: async () => ({ ok: true, result: { workspaces: [workspace()] } }),
      sessions: async () => ({
        ok: true,
        result: { sessions: [session(), session({ id: "s2" })] },
      }),
      stop,
    };
    render(<TerminalSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Kill all sessions" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm kill all sessions" }),
    );
    await waitFor(() => expect(stop).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Killed all sessions.")).toBeDefined();
  });

  test("refresh re-lists after sessions change", async () => {
    let ids = ["s1"];
    (window as { drogon?: unknown }).drogon = {
      workspaces: async () => ({ ok: true, result: { workspaces: [workspace()] } }),
      sessions: async () => ({
        ok: true,
        result: { sessions: ids.map((id) => session({ id })) },
      }),
      stop: vi.fn(async () => ({ ok: true, result: session() })),
    };
    render(<TerminalSection />);
    expect(await screen.findByText("(1)")).toBeDefined();
    ids = ["s1", "s2"];
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("(2)")).toBeDefined();
  });
});
