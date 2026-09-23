import { describe, expect, test } from "vitest";
import { MAX_BROWSER_URL_CHARS } from "../../shared/browser-contract";
import { resolveViewBounds } from "./browser-bounds";
import { mapGuestLoadError } from "./browser-errors";
import { normalizeBrowserUrl } from "./browser-url";

describe("normalizeBrowserUrl edges", () => {
  test("about:blank never reaches the guest (the host special-cases home)", () => {
    const result = normalizeBrowserUrl("about:blank");
    expect(result.kind).toBe("blocked");
    expect((result as { reason: string }).reason).toContain("about:");
  });
  test("uppercase schemes still load", () => {
    const result = normalizeBrowserUrl("HTTP://example.test/page");
    expect(result.kind).toBe("load");
  });
  test("the length limit is exact: max loads, max-plus-one blocks", () => {
    const head = "https://example.test/?q=";
    const atMax = head + "x".repeat(MAX_BROWSER_URL_CHARS - head.length);
    expect(atMax).toHaveLength(MAX_BROWSER_URL_CHARS);
    expect(normalizeBrowserUrl(atMax).kind).toBe("load");
    expect(normalizeBrowserUrl(`${atMax}x`)).toEqual({
      kind: "blocked",
      reason: "URL is too long.",
    });
  });
  test("a hostless http-shaped input never loads (no host survives parsing)", () => {
    // WHATWG URL rejects hostless http(s), so this reports unparseable;
    // either way the guest never sees it.
    expect(normalizeBrowserUrl("http://?foo")).toEqual({
      kind: "blocked",
      reason: "URL could not be parsed.",
    });
  });
  test("script URLs stay script-blocked even with surrounding whitespace", () => {
    expect(normalizeBrowserUrl("  javascript:alert(1)  ")).toEqual({
      kind: "blocked",
      reason: "Blocked: script URLs cannot load.",
    });
  });
});

describe("mapGuestLoadError edges", () => {
  test("blocked loads name the policy, insecure content names the cause", () => {
    expect(mapGuestLoadError({ errorCode: -20, errorDescription: "", validatedURL: "" })).toBe(
      "Blocked: the page was blocked from loading.",
    );
    expect(mapGuestLoadError({ errorCode: -501, errorDescription: "", validatedURL: "" })).toBe(
      "Blocked: insecure content cannot load here.",
    );
  });
  test("empty descriptions fall back to the code, empty URLs to the page", () => {
    expect(
      mapGuestLoadError({ errorCode: -105, errorDescription: "", validatedURL: "" }),
    ).toBe("Could not reach the page (error -105).");
    expect(
      mapGuestLoadError({ errorCode: -9999, errorDescription: "", validatedURL: "" }),
    ).toBe("The page failed to load (error -9999).");
  });
  test("unreachable codes name the attempted URL", () => {
    for (const errorCode of [-2, -7, -106, -109, -118, -102, -104, -6]) {
      const message = mapGuestLoadError({
        errorCode,
        errorDescription: "timed out",
        validatedURL: "https://missing.test/",
      });
      expect(message).toContain("https://missing.test/");
    }
  });
});

describe("resolveViewBounds edges", () => {
  test("negative origins clamp to zero, floors round down", () => {
    expect(
      resolveViewBounds({ x: -12.7, y: -3.2, width: 200.9, height: 100.4 }, { width: 1440, height: 900 }),
    ).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  });
  test("a rect larger than the window clamps inside it", () => {
    expect(
      resolveViewBounds({ x: 1300, y: 800, width: 400, height: 400 }, { width: 1440, height: 900 }),
    ).toEqual({ x: 1040, y: 500, width: 400, height: 400 });
  });
  test("negative sizes hide the view like zero sizes do", () => {
    expect(
      resolveViewBounds({ x: 0, y: 0, width: -10, height: 100 }, { width: 1440, height: 900 }),
    ).toBeNull();
  });
});
