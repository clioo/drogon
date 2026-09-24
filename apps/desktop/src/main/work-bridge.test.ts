import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock("./native-client", () => ({ callNative: vi.fn() }));

import { dispatchWorkRequest } from "./work-bridge";

const column = {
  id: "c1", name: "Review", icon: "review", position: 2, sendOnEnter: true, cron: null,
  prWatch: false, message: "m", recipients: "all", harnessId: null, nextRunAt: null,
  ticketCount: 0, lastSentAt: null, lastSentCount: 0,
};

describe("work bridge", () => {
  it("maps each op onto its daemon method with the renderer's params", async () => {
    const call = vi.fn(async () => ({ ok: true as const, result: column }));
    const result = await dispatchWorkRequest(
      { op: "columnUpdate", params: { columnId: "c1", sendOnEnter: true } },
      call,
    );
    expect(call).toHaveBeenCalledWith("work.column_update", { columnId: "c1", sendOnEnter: true });
    expect(result).toEqual({ ok: true, result: column });
  });

  it("maps every op to a work.* method", async () => {
    const seen: string[] = [];
    const call = vi.fn(async (method: string) => {
      seen.push(method);
      return { ok: false as const, error: { code: "x", message: "x", retryable: false } };
    });
    for (const op of [
      "board", "ticketShow", "sends", "preview", "columnCreate", "columnUpdate", "columnDelete",
      "columnSend", "ticketCreate", "ticketUpdate", "ticketMove", "ticketDelete", "linkSession",
      "unlinkSession", "sessionOpen", "providerBoards", "importPreview", "boardImport", "boardSync",
      "boardPush", "boardDelete", "ticketPush", "ticketResolve", "ticketSprint", "ticketSessionStart",
      "ticketSessionRename",
    ]) {
      await dispatchWorkRequest({ op, params: {} }, call);
    }
    expect(seen).toEqual([
      "work.board", "work.ticket_show", "work.sends", "work.column_preview", "work.column_create",
      "work.column_update", "work.column_delete", "work.column_send", "work.ticket_create",
      "work.ticket_update", "work.ticket_move", "work.ticket_delete", "work.ticket_link_session",
      "work.ticket_unlink_session", "work.session_open", "work.provider_boards", "work.import_preview",
      "work.board_import", "work.board_sync", "work.board_push", "work.board_delete", "work.ticket_push",
      "work.ticket_resolve", "work.ticket_sprint", "work.ticket_session_start", "work.ticket_session_rename",
    ]);
  });

  it("refuses unknown ops without calling the daemon", async () => {
    const call = vi.fn();
    const result = await dispatchWorkRequest({ op: "rpc", params: { method: "session.stop" } }, call);
    expect(call).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });

  it("refuses a daemon answer that breaks the contract", async () => {
    const call = vi.fn(async () => ({ ok: true as const, result: { columns: "nope" } }));
    const result = await dispatchWorkRequest({ op: "board" }, call);
    expect(result).toMatchObject({ ok: false, error: { code: "internal_error" } });
  });

  it("passes daemon errors through unchanged", async () => {
    const error = { code: "not_found", message: "ticket DRG-9 not found", retryable: false };
    const call = vi.fn(async () => ({ ok: false as const, error }));
    expect(await dispatchWorkRequest({ op: "ticketShow", params: { ticketId: "DRG-9" } }, call)).toEqual({
      ok: false,
      error,
    });
  });

  it("accepts an imported board's view and validates the sync answer", async () => {
    const board = {
      columns: [{ ...column, boardId: "b1", statuses: [{ id: "10100", name: "In Review", category: "indeterminate" }] }],
      tickets: [],
      projects: [],
      board: { id: "b1", provider: "jira", name: "Platform Delivery", kind: "scrum", pendingCount: 1, ticketCount: 3 },
      boards: [
        { id: "local", provider: null, name: "My work", kind: "local", pendingCount: 0, ticketCount: 0 },
        { id: "b1", provider: "jira", name: "Platform Delivery", kind: "scrum", pendingCount: 1, ticketCount: 3 },
      ],
      view: { kind: "sprint", readOnly: false, promptsPaused: false, sprints: [{ id: "25", name: "Sprint 25", state: "active" }] },
    };
    const ok = await dispatchWorkRequest(
      { op: "board", params: { boardId: "b1", sprintId: "25" } },
      vi.fn(async () => ({ ok: true as const, result: board })),
    );
    expect(ok).toEqual({ ok: true, result: board });
    const broken = await dispatchWorkRequest(
      { op: "boardSync", params: { boardId: "b1" } },
      vi.fn(async () => ({ ok: true as const, result: { board: board.board, updated: "3" } })),
    );
    expect(broken).toMatchObject({ ok: false, error: { code: "internal_error" } });
  });

  it("still reads a daemon that predates imported boards", async () => {
    const legacy = { columns: [column], tickets: [], projects: [] };
    const result = await dispatchWorkRequest({ op: "board" }, vi.fn(async () => ({ ok: true as const, result: legacy })));
    expect(result).toEqual({ ok: true, result: legacy });
  });
});
