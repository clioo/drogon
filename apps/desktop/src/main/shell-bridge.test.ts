import { describe, expect, it, vi } from "vitest";
import { dispatchOpenExternal, isOpenExternalUrlAllowed } from "./shell-bridge";

describe("shell bridge admission", () => {
  it("allows only https URLs", () => {
    expect(isOpenExternalUrlAllowed("https://github.com/clioo/drogon")).toBe(
      true,
    );
    for (const blocked of [
      "http://github.com/clioo/drogon",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "not a url",
      "",
      null,
      undefined,
      42,
    ])
      expect(isOpenExternalUrlAllowed(blocked)).toBe(false);
  });

  it("opens allowed URLs through the injected opener", async () => {
    const open = vi.fn(async (_url: string) => undefined);
    const result = await dispatchOpenExternal(
      "https://github.com/clioo/drogon",
      open,
    );
    expect(result).toEqual({ ok: true });
    expect(open).toHaveBeenCalledWith("https://github.com/clioo/drogon");
  });

  it("rejects without calling the opener", async () => {
    const open = vi.fn(async (_url: string) => undefined);
    const result = await dispatchOpenExternal("file:///etc/passwd", open);
    expect(result.ok).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
