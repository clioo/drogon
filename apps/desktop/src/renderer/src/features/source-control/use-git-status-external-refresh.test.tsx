// @vitest-environment jsdom
// R16-AS: the Changes panel must track git state it did not mutate itself —
// a files-changed tick for its workspace (someone edited or staged from a
// terminal) and the fork's 60s safety poll (useGitStatusPolling.ts
// STATUS_SAFETY_INTERVAL_MS) both re-run git.status. Before this the panel
// only refreshed after its own mutations, so `git add`, `git commit` or
// `git push -u` from a terminal never appeared.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import {
  GIT_STATUS_SAFETY_INTERVAL_MS,
  useGitStatusExternalRefresh,
} from "./use-git-status-external-refresh";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (window as unknown as { drogon?: unknown }).drogon;
});

type TickListener = (tick: { workspaceId: string }) => void;

let tickListener: TickListener | null = null;

beforeEach(() => {
  tickListener = null;
  // The hook subscribes through the file-explorer helper, which reads
  // `window.drogon.filesWatch` with a null fallback; install a stub that
  // records the listener so the test can fire ticks.
  (window as unknown as { drogon: unknown }).drogon = {
    filesWatch: {
      onFilesChanged(listener: TickListener) {
        tickListener = listener;
        return () => {
          tickListener = null;
        };
      },
    },
  };
});

/** Probe component: records every refresh call the hook makes. */
function Probe({
  workspaceId,
  calls,
}: {
  workspaceId: string;
  calls: { count: number };
}) {
  useGitStatusExternalRefresh(workspaceId, () => {
    calls.count += 1;
  });
  return null;
}

describe("useGitStatusExternalRefresh", () => {
  it("subscribes to files-changed ticks for its workspace", () => {
    const calls = { count: 0 };
    render(createElement(Probe, { workspaceId: "ws-1", calls }));
    expect(tickListener).not.toBeNull();
  });

  it("a tick for its workspace refreshes; a tick for another does not", async () => {
    const calls = { count: 0 };
    render(createElement(Probe, { workspaceId: "ws-1", calls }));

    tickListener?.({ workspaceId: "ws-1" });
    await waitFor(() => expect(calls.count).toBe(1));

    tickListener?.({ workspaceId: "ws-other" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls.count).toBe(1);
  });

  it("an absent preload channel subscribes to nothing and never crashes", async () => {
    delete (window as unknown as { drogon?: unknown }).drogon;
    const calls = { count: 0 };
    render(createElement(Probe, { workspaceId: "ws-1", calls }));
    expect(tickListener).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls.count).toBe(0);
  });

  it("polls on the fork's 60s safety interval", async () => {
    vi.useFakeTimers();
    const calls = { count: 0 };
    render(createElement(Probe, { workspaceId: "ws-1", calls }));
    await vi.advanceTimersByTimeAsync(GIT_STATUS_SAFETY_INTERVAL_MS - 1_000);
    expect(calls.count).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls.count).toBe(1);
  });

  it("stops refreshing after unmount", async () => {
    const calls = { count: 0 };
    const view = render(createElement(Probe, { workspaceId: "ws-1", calls }));
    view.unmount();
    tickListener?.({ workspaceId: "ws-1" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls.count).toBe(0);
  });
});
