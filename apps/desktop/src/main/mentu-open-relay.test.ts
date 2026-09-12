import { afterEach, describe, expect, test, vi } from "vitest";
import {
  MENTU_OPEN_ACK_TIMEOUT_MS,
  openMentuTabInRenderer,
  resetMentuOpenRelay,
  settleMentuOpenTab,
} from "./mentu-open-relay";
import {
  MENTU_OPEN_TAB_CHANNEL,
  mentuOpenTabRequestSchema,
} from "../shared/mentu-contract";

function fakeWindow() {
  const sent: unknown[][] = [];
  const window = {
    webContents: {
      send: (channel: string, payload: unknown) => {
        sent.push([channel, payload]);
      },
    },
  };
  return { window, sent };
}

afterEach(() => {
  resetMentuOpenRelay();
});

describe("mentu open relay", () => {
  test("forwards the request to the window and resolves on the renderer's verdict", async () => {
    const { window, sent } = fakeWindow();
    const pending = openMentuTabInRenderer(
      window as never,
      "w1",
      "hello",
    );
    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toBe(MENTU_OPEN_TAB_CHANNEL);
    const request = mentuOpenTabRequestSchema.parse(sent[0][1]);
    expect(request.workspaceId).toBe("w1");
    expect(request.recipeId).toBe("hello");

    expect(settleMentuOpenTab({ requestId: request.requestId, ok: true })).toBe(true);
    await expect(pending).resolves.toEqual({
      ok: true,
      result: {
        requestId: request.requestId,
        ok: true,
        workspaceId: "w1",
        recipeId: "hello",
        opened: true,
      },
    });
  });

  test("omits recipeId when none was asked for", async () => {
    const { window, sent } = fakeWindow();
    const pending = openMentuTabInRenderer(window as never, "w1");
    const request = mentuOpenTabRequestSchema.parse(sent[0][1]);
    expect(request.recipeId).toBeUndefined();
    settleMentuOpenTab({ requestId: request.requestId, ok: true });
    const outcome = await pending;
    expect(outcome).toMatchObject({
      ok: true,
      result: { workspaceId: "w1", opened: true },
    });
    expect("recipeId" in (outcome as { result: object }).result).toBe(false);
  });

  test("a renderer refusal becomes a typed error, never a silent success", async () => {
    const { window, sent } = fakeWindow();
    const pending = openMentuTabInRenderer(window as never, "missing");
    const request = mentuOpenTabRequestSchema.parse(sent[0][1]);
    settleMentuOpenTab({
      requestId: request.requestId,
      ok: false,
      code: "mentu_workspace_unknown",
      message: "No workspace 'missing' is registered.",
    });
    await expect(pending).resolves.toEqual({
      ok: false,
      error: {
        code: "mentu_workspace_unknown",
        message: "No workspace 'missing' is registered.",
      },
    });
  });

  test("no window is desktop_unavailable, not a claim that the tab opened", async () => {
    await expect(openMentuTabInRenderer(null, "w1")).resolves.toEqual({
      ok: false,
      error: {
        code: "desktop_unavailable",
        message: "No Drogon window is loaded to open the Work Graph tab in.",
      },
    });
  });

  test("a silent renderer times out with its own typed code", async () => {
    vi.useFakeTimers();
    try {
      const { window } = fakeWindow();
      const pending = openMentuTabInRenderer(window as never, "w1", undefined, 25);
      await vi.advanceTimersByTimeAsync(30);
      await expect(pending).resolves.toEqual({
        ok: false,
        error: {
          code: "mentu_open_timeout",
          message: "The Drogon window did not confirm the Work Graph tab within 25ms.",
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("an unknown or duplicate verdict never resolves anything twice", async () => {
    const { window, sent } = fakeWindow();
    const pending = openMentuTabInRenderer(window as never, "w1");
    const request = mentuOpenTabRequestSchema.parse(sent[0][1]);
    expect(settleMentuOpenTab({ requestId: "forged", ok: true })).toBe(false);
    expect(settleMentuOpenTab({ requestId: request.requestId, ok: true })).toBe(true);
    expect(settleMentuOpenTab({ requestId: request.requestId, ok: false })).toBe(false);
    await expect(pending).resolves.toMatchObject({ ok: true });
  });

  test("a send failure is reported instead of hanging", async () => {
    const window = {
      webContents: {
        send: () => {
          throw new Error("destroyed");
        },
      },
    };
    await expect(openMentuTabInRenderer(window as never, "w1")).resolves.toEqual({
      ok: false,
      error: {
        code: "mentu_open_unsupported",
        message: "The Drogon window could not receive the Work Graph request: destroyed",
      },
    });
  });

  test("the ack budget stays inside the daemon relay's own timeout", () => {
    expect(MENTU_OPEN_ACK_TIMEOUT_MS).toBeLessThan(15_000);
  });
});
