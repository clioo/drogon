import { describe, expect, test } from "vitest";
import { normalizeBrowserUrl } from "./browser-url";

describe("normalizeBrowserUrl", () => {
  test("adds https to bare hosts", () => {
    expect(normalizeBrowserUrl("example.test")).toEqual({
      kind: "load",
      url: "https://example.test/",
    });
  });
  test("keeps explicit http loopback", () => {
    const result = normalizeBrowserUrl("http://127.0.0.1:8080/page");
    expect(result).toEqual({ kind: "load", url: "http://127.0.0.1:8080/page" });
  });
  test("trims whitespace", () => {
    expect(normalizeBrowserUrl("  example.test  ")).toEqual({
      kind: "load",
      url: "https://example.test/",
    });
  });
  test("blocks javascript: urls", () => {
    expect(normalizeBrowserUrl("javascript:alert(1)").kind).toBe("blocked");
  });
  test("blocks file: urls", () => {
    const result = normalizeBrowserUrl("file:///etc/passwd");
    expect(result.kind).toBe("blocked");
  });
  test("blocks data: urls", () => {
    expect(normalizeBrowserUrl("data:text/html,<h1>x</h1>").kind).toBe("blocked");
  });
  test("blocks custom protocols", () => {
    expect(normalizeBrowserUrl("drogon://open").kind).toBe("blocked");
  });
  test("blocks empty input", () => {
    expect(normalizeBrowserUrl("   ").kind).toBe("blocked");
  });
  test("blocks unparseable input", () => {
    expect(normalizeBrowserUrl("https://").kind).toBe("blocked");
  });
});
