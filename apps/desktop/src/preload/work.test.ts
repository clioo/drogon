// `window.drogon.work.*`: every bridge method is one `{ op, params }`
// invoke on the single Work channel, with the op the main bridge maps onto
// its daemon method (see main/work-bridge.ts), so no method can drift from
// the contract's op table.
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn(async (..._args: unknown[]) => ({ ok: true, result: {} }));
vi.mock("electron", () => ({ ipcRenderer: { invoke: (...args: unknown[]) => invoke(...args) } }));

import { WORK_OPS, type WorkOp } from "../shared/work-contract";
import { work } from "./work";

beforeEach(() => invoke.mockClear());

describe("preload work bridge", () => {
  it("exposes exactly one method per contract op", () => {
    expect(Object.keys(work).sort()).toEqual(Object.keys(WORK_OPS).sort());
  });

  it("sends each method as its op with the caller's params on drogon:work", async () => {
    const params = { ticketId: "APP-128", boardId: "b7" };
    for (const op of Object.keys(WORK_OPS) as WorkOp[]) {
      invoke.mockClear();
      await (work[op] as (input: object) => Promise<unknown>)(params);
      // `sources` takes no input.
      expect(invoke).toHaveBeenCalledWith("drogon:work", { op, params: op === "sources" ? {} : params });
    }
  });

  it("defaults the optional inputs to empty params", async () => {
    await work.board();
    expect(invoke).toHaveBeenLastCalledWith("drogon:work", { op: "board", params: {} });
    await work.providerBoards();
    expect(invoke).toHaveBeenLastCalledWith("drogon:work", { op: "providerBoards", params: {} });
    await work.sources();
    expect(invoke).toHaveBeenLastCalledWith("drogon:work", { op: "sources", params: {} });
  });
});
