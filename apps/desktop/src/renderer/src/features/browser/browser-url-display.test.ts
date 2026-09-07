// Ported from the Orca reference (read-only):
//   src/renderer/src/components/browser-pane/describe-page/browser-page-url-display.test.ts
// Adapted: no Kagi redaction or blank sentinel (blank tabs are "" here),
// external URLs are https-only per the shell bridge policy.
import { describe, expect, test } from "vitest";
import {
  getBrowserDisplayTitle,
  getOpenableExternalUrl,
  hostOfUrl,
  isBlankBrowserUrl,
  toDisplayUrl,
} from "./browser-url-display";

describe("browser URL display rules", () => {
  test("blank tabs display empty and title as New Tab", () => {
    expect(toDisplayUrl("")).toBe("");
    expect(toDisplayUrl("about:blank")).toBe("");
    expect(toDisplayUrl("https://example.test/a")).toBe("https://example.test/a");
    expect(getBrowserDisplayTitle("Example", "https://example.test/")).toBe("Example");
    expect(getBrowserDisplayTitle(null, "about:blank")).toBe("New Tab");
    expect(getBrowserDisplayTitle("about:blank", "https://example.test/")).toBe("New Tab");
    expect(getBrowserDisplayTitle("", "https://example.test/")).toBe("New Tab");
  });

  test("blank detection covers empty and about:blank only", () => {
    expect(isBlankBrowserUrl("")).toBe(true);
    expect(isBlankBrowserUrl("about:blank")).toBe(true);
    expect(isBlankBrowserUrl("https://example.test/")).toBe(false);
  });

  test("only https URLs may leave the app", () => {
    expect(getOpenableExternalUrl("https://example.test/a")).toBe(
      "https://example.test/a",
    );
    expect(getOpenableExternalUrl("http://example.test/")).toBeNull();
    expect(getOpenableExternalUrl("about:blank")).toBeNull();
    expect(getOpenableExternalUrl("")).toBeNull();
    expect(getOpenableExternalUrl("not a url")).toBeNull();
  });

  test("host label feeds the Can't reach copy", () => {
    expect(hostOfUrl("https://missing.test:8443/a")).toBe("missing.test:8443");
    expect(hostOfUrl("not a url")).toBeNull();
  });
});
