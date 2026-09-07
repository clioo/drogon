import { describe, expect, test } from "vitest";
import {
  applyBrowserNavAction,
  initialBrowserNavState,
  runNavigate,
  type BrowserNavAction,
  type BrowserNavState,
} from "./browser-nav-state";
import type {
  BrowserAuthoritySource,
  NavDecision,
} from "./browser-authority-source";
import type { BrowserTabDescriptor } from "./browser-tab";
import type { Result } from "../../../../shared/session-contract";

const TAB: BrowserTabDescriptor = {
  tabId: "tab-1",
  url: "https://example.test/docs",
  title: "Docs",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function loading(generation = 1, url = TAB.url): BrowserNavState {
  return applyBrowserNavAction(initialBrowserNavState(), {
    type: "navigate-started",
    tabId: TAB.tabId,
    url,
    generation,
  });
}

describe("navigation state", () => {
  test("a navigate request enters loading and records its generation fence", () => {
    const state = loading(7);
    expect(state.phase).toBe("loading");
    expect(state.generation).toBe(7);
    expect(state.url).toBe(TAB.url);
    expect(state.canRetry).toBe(false);
  });

  test("a host commit for the current generation reaches ready with the committed URL", () => {
    const state = applyBrowserNavAction(loading(7), {
      type: "committed",
      tabId: TAB.tabId,
      url: "https://example.test/docs/redirected",
      generation: 7,
    });
    expect(state.phase).toBe("ready");
    expect(state.url).toBe("https://example.test/docs/redirected");
  });

  test("a late commit after the navigation was superseded is dropped by identity", () => {
    // Navigate, then supersede with a newer request before the first commits.
    let state = loading(1);
    state = applyBrowserNavAction(state, {
      type: "navigate-started",
      tabId: TAB.tabId,
      url: "https://example.test/other",
      generation: 2,
    });
    const superseded = applyBrowserNavAction(state, {
      type: "committed",
      tabId: TAB.tabId,
      url: "https://example.test/docs",
      generation: 1,
    });
    expect(superseded).toBe(state);
    expect(superseded.phase).toBe("loading");
    expect(superseded.url).toBe("https://example.test/other");
  });

  test("a commit for another tab never marks this tab ready", () => {
    const before = loading(1);
    const state = applyBrowserNavAction(before, {
      type: "committed",
      tabId: "tab-2",
      url: TAB.url,
      generation: 1,
    });
    expect(state).toBe(before);
    expect(state.phase).toBe("loading");
  });

  test("a failure keeps the tab id, surfaces the message and offers retry", () => {
    const state = applyBrowserNavAction(loading(3), {
      type: "failed",
      tabId: TAB.tabId,
      generation: 3,
      message: "renderer crashed",
    });
    expect(state.phase).toBe("error");
    expect(state.message).toBe("renderer crashed");
    expect(state.canRetry).toBe(true);
  });
});

describe("blocked-by-policy", () => {
  test("a policy refusal marks the tab blocked with the reason and no retry", () => {
    const state = applyBrowserNavAction(loading(4), {
      type: "blocked-by-policy",
      tabId: TAB.tabId,
      url: "file:///etc/passwd",
      generation: 4,
      reason: "Privileged navigation policy denies file: URLs.",
    });
    expect(state.phase).toBe("blocked");
    expect(state.message).toBe("Privileged navigation policy denies file: URLs.");
    expect(state.canRetry).toBe(false);
  });

  test("a blocked request never loads: its late commit is dropped and it stays blocked", () => {
    let state = applyBrowserNavAction(loading(4, "file:///etc/passwd"), {
      type: "blocked-by-policy",
      tabId: TAB.tabId,
      url: "file:///etc/passwd",
      generation: 4,
      reason: "denied",
    });
    // The host's commit event for the blocked request arrives anyway:
    const unaffected = applyBrowserNavAction(state, {
      type: "committed",
      tabId: TAB.tabId,
      url: "file:///etc/passwd",
      generation: 4,
    });
    expect(unaffected).toBe(state);
    expect(unaffected.phase).toBe("blocked");
    // A retry affordance does not exist for policy blocks…
    expect(unaffected.canRetry).toBe(false);
    const retried = applyBrowserNavAction(unaffected, { type: "retry-started" });
    expect(retried.phase).toBe("blocked");
    // …but a fresh navigation to an admissible URL is a new generation.
    const next = applyBrowserNavAction(unaffected, {
      type: "navigate-started",
      tabId: TAB.tabId,
      url: "https://example.test",
      generation: 5,
    });
    expect(next.phase).toBe("loading");
    expect(next.generation).toBe(5);
  });

  test("a blocked event for a superseded generation is dropped", () => {
    const before = loading(2);
    const state = applyBrowserNavAction(before, {
      type: "blocked-by-policy",
      tabId: TAB.tabId,
      url: TAB.url,
      generation: 1,
      reason: "stale fence",
    });
    expect(state).toBe(before);
    expect(state.phase).toBe("loading");
  });
});

describe("error recovery via retry", () => {
  test("retry from error restarts loading and a fresh commit completes it", () => {
    let state = applyBrowserNavAction(loading(1), {
      type: "failed",
      tabId: TAB.tabId,
      generation: 1,
      message: "transport reset",
    });
    state = applyBrowserNavAction(state, { type: "retry-started" });
    expect(state.phase).toBe("loading");
    expect(state.message).toBe("");
    state = applyBrowserNavAction(state, {
      type: "committed",
      tabId: TAB.tabId,
      url: TAB.url,
      generation: 1,
    });
    expect(state.phase).toBe("ready");
  });

  test("retry is refused outside the error phase", () => {
    const state = applyBrowserNavAction(loading(1), { type: "retry-started" });
    expect(state.phase).toBe("loading");
  });
});

describe("runNavigate with deferred fakes", () => {
  const dispatchList = () => {
    const dispatched: BrowserNavAction[] = [];
    return {
      dispatched,
      dispatch: (action: BrowserNavAction) => dispatched.push(action),
    };
  };

  test("a block decision dispatches blocked-by-policy with the service reason", async () => {
    const { dispatched, dispatch } = dispatchList();
    const source: BrowserAuthoritySource = {
      requestNavigation: () =>
        Promise.resolve({
          ok: true,
          result: { outcome: "block", reason: "scheme not admitted" },
        } satisfies Result<NavDecision>),
      requestWindowOpen: () => Promise.reject(new Error("unused")),
    };
    await runNavigate({
      tabId: TAB.tabId,
      url: "javascript:alert(1)",
      generation: 1,
      source,
      isCurrent: () => true,
      dispatch,
    });
    expect(dispatched).toEqual([
      {
        type: "navigate-started",
        tabId: TAB.tabId,
        url: "javascript:alert(1)",
        generation: 1,
      },
      {
        type: "blocked-by-policy",
        tabId: TAB.tabId,
        url: "javascript:alert(1)",
        generation: 1,
        reason: "scheme not admitted",
      },
    ]);
  });

  test("an allow decision keeps loading; the host commit completes it", async () => {
    const { dispatched, dispatch } = dispatchList();
    const gate = deferred<Result<NavDecision>>();
    const source: BrowserAuthoritySource = {
      requestNavigation: () => gate.promise,
      requestWindowOpen: () => Promise.reject(new Error("unused")),
    };
    const pending = runNavigate({
      tabId: TAB.tabId,
      url: TAB.url,
      generation: 9,
      source,
      isCurrent: () => true,
      dispatch,
    });
    expect(dispatched).toEqual([
      {
        type: "navigate-started",
        tabId: TAB.tabId,
        url: TAB.url,
        generation: 9,
      },
    ]);
    gate.resolve({ ok: true, result: { outcome: "allow" } });
    await pending;
    expect(dispatched).toHaveLength(1);
    // Host commit event arrives out-of-band:
    let state = dispatched.reduce(applyBrowserNavAction, initialBrowserNavState());
    state = applyBrowserNavAction(state, {
      type: "committed",
      tabId: TAB.tabId,
      url: TAB.url,
      generation: 9,
    });
    expect(state.phase).toBe("ready");
  });

  test("a decision arriving after the navigation was superseded is dropped", async () => {
    const { dispatched, dispatch } = dispatchList();
    const gate = deferred<Result<NavDecision>>();
    const source: BrowserAuthoritySource = {
      requestNavigation: () => gate.promise,
      requestWindowOpen: () => Promise.reject(new Error("unused")),
    };
    let current = true;
    const pending = runNavigate({
      tabId: TAB.tabId,
      url: TAB.url,
      generation: 1,
      source,
      isCurrent: () => current,
      dispatch,
    });
    // A newer navigation supersedes the request before its decision lands.
    current = false;
    gate.resolve({
      ok: true,
      result: { outcome: "block", reason: "late policy verdict" },
    });
    await pending;
    expect(dispatched).toEqual([
      {
        type: "navigate-started",
        tabId: TAB.tabId,
        url: TAB.url,
        generation: 1,
      },
    ]);
  });

  test("a transport rejection becomes a retryable failure; late rejections are dropped", async () => {
    const { dispatched, dispatch } = dispatchList();
    const source: BrowserAuthoritySource = {
      requestNavigation: () => Promise.reject(new Error("bridge closed")),
      requestWindowOpen: () => Promise.reject(new Error("unused")),
    };
    await runNavigate({
      tabId: TAB.tabId,
      url: TAB.url,
      generation: 2,
      source,
      isCurrent: () => true,
      dispatch,
    });
    expect(dispatched[1]).toEqual({
      type: "failed",
      tabId: TAB.tabId,
      generation: 2,
      message: "bridge closed",
    });
    let state = dispatched.reduce(applyBrowserNavAction, initialBrowserNavState());
    expect(state.phase).toBe("error");
    expect(state.canRetry).toBe(true);

    const lateDispatched: BrowserNavAction[] = [];
    const gate = deferred<never>();
    const lateSource: BrowserAuthoritySource = {
      requestNavigation: () => gate.promise,
      requestWindowOpen: () => Promise.reject(new Error("unused")),
    };
    let current = false;
    const late = runNavigate({
      tabId: TAB.tabId,
      url: TAB.url,
      generation: 3,
      source: lateSource,
      isCurrent: () => current,
      dispatch: (action) => lateDispatched.push(action),
    });
    gate.reject(new Error("superseded transport died"));
    await late;
    expect(lateDispatched).toEqual([
      {
        type: "navigate-started",
        tabId: TAB.tabId,
        url: TAB.url,
        generation: 3,
      },
    ]);
  });
});
