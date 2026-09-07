// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/main/ipc/shell.ts (`shell:openUrl`) and
// src/preload/api/shell-bridge.ts (`openUrl`): the http(s)-only gate lives
// in shared/shell-contract.ts so main and its tests share one predicate.
import { describe, expect, it } from "vitest";
import {
  isExternalUrlAllowed,
  SHELL_OPEN_EXTERNAL_CHANNEL,
} from "./shell-contract";

describe("isExternalUrlAllowed", () => {
  it("allows http(s) URLs", () => {
    expect(isExternalUrlAllowed("https://github.com/clioo/drogon")).toBe(true);
    expect(isExternalUrlAllowed("http://127.0.0.1:9445/")).toBe(true);
    expect(isExternalUrlAllowed("HTTPS://EXAMPLE.COM/x")).toBe(true);
  });
  it("refuses dangerous schemes", () => {
    expect(isExternalUrlAllowed("javascript:alert(1)")).toBe(false);
    expect(isExternalUrlAllowed("file:///etc/passwd")).toBe(false);
    expect(isExternalUrlAllowed("data:text/html,<h1>x</h1>")).toBe(false);
    expect(isExternalUrlAllowed("ftp://example.com/x")).toBe(false);
  });
  it("refuses non-URLs and non-strings", () => {
    expect(isExternalUrlAllowed("not a url")).toBe(false);
    expect(isExternalUrlAllowed("")).toBe(false);
    expect(isExternalUrlAllowed("//example.com/path")).toBe(false);
    expect(isExternalUrlAllowed(null)).toBe(false);
    expect(isExternalUrlAllowed(undefined)).toBe(false);
    expect(isExternalUrlAllowed(42)).toBe(false);
    expect(isExternalUrlAllowed({ url: "https://example.com" })).toBe(false);
  });
  it("pins the channel name the preload and main sides share", () => {
    expect(SHELL_OPEN_EXTERNAL_CHANNEL).toBe("drogon:openExternal");
  });
});
