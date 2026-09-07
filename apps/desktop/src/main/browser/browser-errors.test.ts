import { describe, expect, test } from "vitest";
import { mapGuestLoadError } from "./browser-errors";

describe("mapGuestLoadError", () => {
  test("aborts are stops, not failures", () => {
    expect(
      mapGuestLoadError({ errorCode: -3, errorDescription: "", validatedURL: "" }),
    ).toBeNull();
  });
  test("unreachable hosts name the URL", () => {
    const message = mapGuestLoadError({
      errorCode: -105,
      errorDescription: "ERR_NAME_NOT_RESOLVED",
      validatedURL: "https://missing.test/",
    });
    expect(message).toContain("https://missing.test/");
    expect(message).toContain("ERR_NAME_NOT_RESOLVED");
  });
  test("blocked loads stay blocked", () => {
    expect(
      mapGuestLoadError({ errorCode: -20, errorDescription: "", validatedURL: "" }),
    ).toMatch(/Blocked/);
  });
  test("unknown codes still report honestly", () => {
    expect(
      mapGuestLoadError({ errorCode: -999, errorDescription: "", validatedURL: "" }),
    ).toMatch(/failed to load/);
  });
});
