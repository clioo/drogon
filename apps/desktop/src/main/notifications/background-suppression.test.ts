import { describe, expect, it } from "vitest";
import { nativeNotificationsSuppressed } from "./background-suppression";

describe("nativeNotificationsSuppressed", () => {
  it("suppresses native banners only for background (test) instances", () => {
    expect(nativeNotificationsSuppressed({ DROGON_BACKGROUND_WINDOW: "1" })).toBe(true);
    expect(nativeNotificationsSuppressed({ DROGON_BACKGROUND_WINDOW: "0" })).toBe(false);
    expect(nativeNotificationsSuppressed({})).toBe(false);
  });
});
