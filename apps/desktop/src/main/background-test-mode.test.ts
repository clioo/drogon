import { describe, expect, it, vi } from "vitest";
import {
  isBackgroundTestMode,
  suppressForegroundSideEffect,
} from "./background-test-mode";

describe("background test mode", () => {
  it("is on only for DROGON_BACKGROUND_WINDOW=1", () => {
    expect(isBackgroundTestMode({ DROGON_BACKGROUND_WINDOW: "1" })).toBe(true);
    expect(isBackgroundTestMode({ DROGON_BACKGROUND_WINDOW: "0" })).toBe(false);
    expect(isBackgroundTestMode({})).toBe(false);
  });

  it("suppresses and logs foreground side effects only in test mode", () => {
    const log = vi.fn();
    expect(
      suppressForegroundSideEffect("openExternal", "https://x", { DROGON_BACKGROUND_WINDOW: "1" }, log),
    ).toBe(true);
    expect(log).toHaveBeenCalledWith("[background] suppressed openExternal: https://x");
    expect(suppressForegroundSideEffect("openExternal", "https://x", {}, log)).toBe(false);
    expect(log).toHaveBeenCalledTimes(1);
  });
});
