import { describe, expect, test } from "vitest";
import { classifyWindowOpenRequest } from "./window-open-authority";
import { requestWindowOpenDecision } from "./browser-nav-state";
import type { BrowserAuthoritySource, NavDecision } from "./browser-authority-source";
import type { WindowOpenDecision } from "./window-open-authority";
import type { Result } from "../../../../shared/session-contract";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("classifyWindowOpenRequest (renderer proposal only)", () => {
  test("web URLs are never proposed as new renderer windows — request in-tab instead", () => {
    for (const url of [
      "https://example.test/a",
      "http://example.test/",
      "HTTPS://example.test/caps",
    ]) {
      const proposal = classifyWindowOpenRequest(url);
      expect(proposal.outcome).toBe("block");
      expect(proposal.reason).toContain("host-owned");
    }
  });

  test("external protocols are proposed to the system handler, never rendered in-app", () => {
    const proposal = classifyWindowOpenRequest("mailto:someone@example.test");
    expect(proposal.outcome).toBe("open-in-system");
    expect(proposal.reason).toContain("mailto");
    expect(classifyWindowOpenRequest("ssh:host").outcome).toBe("open-in-system");
  });

  test("schemeless URLs are proposed blocked", () => {
    const proposal = classifyWindowOpenRequest("not-a-url");
    expect(proposal.outcome).toBe("block");
    expect(proposal.reason).toContain("no admissible scheme");
  });

  test("the proposal vocabulary is exactly the host's decision vocabulary", () => {
    const outcomes = new Set(
      [
        classifyWindowOpenRequest("https://x"),
        classifyWindowOpenRequest("mailto:x"),
        classifyWindowOpenRequest("junk"),
      ].map((decision) => decision.outcome),
    );
    // "allow" is absent: only the host can grant an in-app window.
    expect(outcomes.has("allow")).toBe(false);
    expect([...outcomes].sort()).toEqual(["block", "open-in-system"]);
  });
});

describe("requestWindowOpenDecision with a deferred fake", () => {
  test("a host decision is delivered verbatim to the caller", async () => {
    const gate = deferred<Result<WindowOpenDecision>>();
    const source: BrowserAuthoritySource = {
      requestNavigation: () => Promise.reject(new Error("unused")),
      requestWindowOpen: () => gate.promise,
    };
    const decisions: WindowOpenDecision[] = [];
    const errors: string[] = [];
    const pending = requestWindowOpenDecision({
      tabId: "tab-1",
      url: "https://example.test/popout",
      source,
      onDecision: (decision) => decisions.push(decision),
      onError: (message) => errors.push(message),
    });
    // The HOST may grant what the renderer may not propose:
    gate.resolve({
      ok: true,
      result: { outcome: "allow", reason: "host-managed mirror window" },
    });
    await pending;
    expect(decisions).toEqual([
      { outcome: "allow", reason: "host-managed mirror window" },
    ]);
    expect(errors).toEqual([]);
  });

  test("a service refusal reaches onError with the service message", async () => {
    const source: BrowserAuthoritySource = {
      requestNavigation: () => Promise.reject(new Error("unused")),
      requestWindowOpen: () =>
        Promise.resolve({
          ok: false,
          error: { code: "policy", message: "window opens disabled", retryable: false },
        }),
    };
    const errors: string[] = [];
    await requestWindowOpenDecision({
      tabId: "tab-1",
      url: "https://example.test/popout",
      source,
      onDecision: () => {},
      onError: (message) => errors.push(message),
    });
    expect(errors).toEqual(["window opens disabled"]);
  });

  test("a transport rejection becomes an error message, not a crash", async () => {
    const source: BrowserAuthoritySource = {
      requestNavigation: () => Promise.reject(new Error("unused")),
      requestWindowOpen: () => Promise.reject(new Error("bridge down")),
    };
    const errors: string[] = [];
    await requestWindowOpenDecision({
      tabId: "tab-1",
      url: "https://example.test/popout",
      source,
      onDecision: () => {},
      onError: (message) => errors.push(message),
    });
    expect(errors).toEqual(["bridge down"]);
  });
});
