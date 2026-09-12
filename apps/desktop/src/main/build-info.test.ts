import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { readBuildInfo } from "./build-info";

function tempResourcesDir(): string {
  return mkdtempSync(path.join(tmpdir(), "drogon-build-info-"));
}

describe("packaged build-info reader", () => {
  test("reads a valid build-info.json", () => {
    const dir = tempResourcesDir();
    writeFileSync(
      path.join(dir, "build-info.json"),
      JSON.stringify({
        revision: "abc123",
        builtAt: "2026-01-01T00:00:00Z",
        version: "0.1.0",
        channel: "release",
        signed: "local-ad-hoc-not-notarized",
      }),
    );
    expect(readBuildInfo(dir)).toEqual({
      revision: "abc123",
      builtAt: "2026-01-01T00:00:00Z",
      version: "0.1.0",
      channel: "release",
      signed: "local-ad-hoc-not-notarized",
    });
  });
  test("a missing file (development) reads as null, not an error", () => {
    expect(readBuildInfo(tempResourcesDir())).toBeNull();
  });
  test("malformed JSON reads as null", () => {
    const dir = tempResourcesDir();
    writeFileSync(path.join(dir, "build-info.json"), "not json");
    expect(readBuildInfo(dir)).toBeNull();
  });
  test("an unknown channel or signing claim reads as null", () => {
    const dir = tempResourcesDir();
    writeFileSync(
      path.join(dir, "build-info.json"),
      JSON.stringify({
        revision: "abc123",
        builtAt: "2026-01-01T00:00:00Z",
        version: "0.1.0",
        channel: "unknown",
      }),
    );
    expect(readBuildInfo(dir)).toBeNull();
    writeFileSync(
      path.join(dir, "build-info.json"),
      JSON.stringify({
        revision: "abc123",
        builtAt: "2026-01-01T00:00:00Z",
        version: "0.1.0",
        signed: "claimed-notarized",
      }),
    );
    expect(readBuildInfo(dir)).toBeNull();
  });
  test("a shape missing required fields reads as null, never a partial guess", () => {
    const dir = tempResourcesDir();
    writeFileSync(
      path.join(dir, "build-info.json"),
      JSON.stringify({ revision: "abc123" }),
    );
    expect(readBuildInfo(dir)).toBeNull();
  });
});
