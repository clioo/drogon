// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// The Mentu inspector's Harness / backend select must render the real
// registered-harness catalog, honestly reflect a failed load, and support
// an explicit manual refresh — never invent harnesses or silently retry
// into fiction.

import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { Harness } from "../../../../shared/session-contract";
import { useHarnessCatalog } from "./mentu-harness-catalog";

afterEach(() => {
  cleanup();
  // @ts-expect-error test-only teardown of the injected bridge
  delete window.drogon;
});

const CLAUDE: Harness = {
  harnessId: "claude",
  displayName: "Claude Code",
  availability: "available",
  executable: "/usr/local/bin/claude",
};

function bridge(harnesses = vi.fn().mockResolvedValue({ ok: true, result: { hostId: "h", harnesses: [CLAUDE] } })) {
  window.drogon = { harnesses } as unknown as typeof window.drogon;
  return { harnesses };
}

describe("useHarnessCatalog", () => {
  test("loads the real registered-harness catalog on mount", async () => {
    const { harnesses } = bridge();
    const view = renderHook(() => useHarnessCatalog());
    expect(view.result.current.loading).toBe(true);
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(view.result.current.harnesses).toEqual([CLAUDE]);
    expect(view.result.current.error).toBeNull();
    expect(harnesses).toHaveBeenCalledTimes(1);
  });

  test("surfaces a failed load honestly instead of an empty silent catalog", async () => {
    bridge(
      vi.fn().mockResolvedValue({
        ok: false,
        error: { code: "internal_error", message: "daemon unreachable", retryable: true },
      }),
    );
    const view = renderHook(() => useHarnessCatalog());
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(view.result.current.harnesses).toEqual([]);
    expect(view.result.current.error).toBe("daemon unreachable");
  });

  test("reports unavailable when the bridge has no harnesses method at all", async () => {
    window.drogon = {} as unknown as typeof window.drogon;
    const view = renderHook(() => useHarnessCatalog());
    expect(view.result.current.loading).toBe(false);
    expect(view.result.current.harnesses).toEqual([]);
    expect(view.result.current.error).toMatch(/unavailable/i);
  });

  test("refresh() re-issues the real call rather than reusing a stale answer", async () => {
    const { harnesses } = bridge();
    const view = renderHook(() => useHarnessCatalog());
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    view.result.current.refresh();
    await waitFor(() => expect(harnesses).toHaveBeenCalledTimes(2));
  });
});
