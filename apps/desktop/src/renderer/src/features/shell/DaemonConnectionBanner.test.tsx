// @vitest-environment jsdom
// DaemonConnectionBanner: legacy error passthrough while connected,
// fork-literal retrying/disconnected cards while down, single
// down→up reload, and the disconnect toast lifecycle.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { DaemonConnectionBanner } from "./DaemonConnectionBanner";
import {
  __resetDaemonConnectionMonitorForTests,
  ensureDaemonConnectionMonitor,
} from "./daemon-connection-store";

vi.mock("sonner", () => ({
  toast: { warning: vi.fn(), dismiss: vi.fn() },
}));

const warning = vi.mocked(toast.warning);
const dismiss = vi.mocked(toast.dismiss);

let releaseOuter: (() => void) | null = null;

function seedMonitor(probe: () => Promise<string | null>): void {
  releaseOuter = ensureDaemonConnectionMonitor({ probe, random: () => 0 });
}

async function settle(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  __resetDaemonConnectionMonitorForTests();
});

afterEach(() => {
  cleanup();
  releaseOuter?.();
  releaseOuter = null;
  __resetDaemonConnectionMonitorForTests();
  vi.useRealTimers();
  vi.clearAllMocks();
});

function renderBanner(overrides?: {
  error?: string;
  onRetry?: () => void;
  onReconnected?: () => void;
}) {
  return render(
    <DaemonConnectionBanner
      error={overrides?.error ?? ""}
      retryDisabled={false}
      onRetry={overrides?.onRetry ?? (() => {})}
      onReconnected={overrides?.onReconnected ?? (() => {})}
    />,
  );
}

describe("DaemonConnectionBanner", () => {
  it("stays hidden while connected with no error", async () => {
    seedMonitor(() => Promise.resolve(null));
    const { container } = renderBanner();
    await settle(0);
    expect(container.innerHTML).toBe("");
    expect(warning).not.toHaveBeenCalled();
  });

  it("keeps the legacy error banner for unrelated errors while connected", async () => {
    seedMonitor(() => Promise.resolve(null));
    const onRetry = vi.fn();
    renderBanner({ error: "Copy failed.", onRetry });
    await settle(0);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Copy failed.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows the retrying card and warns while the daemon is down", async () => {
    seedMonitor(() => Promise.resolve("refused"));
    renderBanner();
    await settle(0);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Reconnecting to Drogon service");
    expect(status.textContent).toContain("retrying automatically");
    // Retries never stop, so the manual affordance stays next to the
    // spinner instead of waiting for a stopped phase.
    expect(
      screen.getByRole("button", { name: "Reconnect" }),
    ).not.toBeNull();
    expect(warning).toHaveBeenCalledWith(
      "Can't reach Drogon service",
      expect.objectContaining({ description: expect.any(String) }),
    );
  });

  it("keeps retrying past the ladder cap, and Reconnect restarts it", async () => {
    seedMonitor(() => Promise.resolve("refused"));
    const onRetry = vi.fn();
    renderBanner({ onRetry });
    await settle(0);
    // Run out the whole ladder and past the 15s cap: still retrying.
    await settle(500 + 1000 + 2000 + 4000 + 8000 + 15000 + 15000);
    expect(screen.getByRole("status").textContent).toContain(
      "Reconnecting to Drogon service",
    );
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toContain(
      "Reconnecting to Drogon service",
    );
  });

  it("reloads once when the service returns and dismisses the toast", async () => {
    let down = true;
    seedMonitor(() => Promise.resolve(down ? "refused" : null));
    const onReconnected = vi.fn();
    renderBanner({ onReconnected });
    await settle(0);
    expect(onReconnected).not.toHaveBeenCalled();
    down = false;
    await settle(500);
    expect(onReconnected).toHaveBeenCalledTimes(1);
    expect(dismiss).toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
