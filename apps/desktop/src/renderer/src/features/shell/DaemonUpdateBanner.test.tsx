// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Toaster, toast } from "sonner";
import { DaemonUpdateBanner } from "./DaemonUpdateBanner";

const pending = {
  kind: "pending" as const,
  revision: "0123456789ab",
  reason: "runtime_busy",
};
/**
 * True once no toast node remains. Gives up after 2s with zero progress: that
 * means a neighbour file replaced requestAnimationFrame with a no-op, so no
 * removal timer is even pending and unmounting clears everything. Caps at 10s
 * so a pathological runner cannot hang the suite.
 */
async function toastHostSettled(): Promise<boolean> {
  const start = Date.now();
  let lastCount = -1;
  let lastChange = start;
  for (;;) {
    const count = document.querySelectorAll("[data-sonner-toast]").length;
    const now = Date.now();
    if (count === 0) return true;
    if (count !== lastCount) {
      lastCount = count;
      lastChange = now;
    }
    if (now - lastChange > 2_000 || now - start > 10_000) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

afterEach(async () => {
  // The safety-poll test leaves fake timers on; the flush below needs the
  // real clock.
  vi.useRealTimers();
  // Dismiss while the Toaster is still mounted so the dismissal flows through
  // its subscriber instead of into the void.
  toast.dismiss();
  // Await the actual removal: sonner removes a dismissed toast on a
  // rAF-deferred publish plus deleteToast's 200ms exit timer
  // (TIME_BEFORE_UNMOUNT), neither of which unmounting cancels. A test ending
  // first strands those timers past the file; with `isolate: false` they fire
  // after this file's jsdom is torn down and crash a later node-env file with
  // `ReferenceError: window is not defined` (sonner setTimeout ->
  // removeToast setToasts -> dispatchSetState -> resolveUpdatePriority).
  if (await toastHostSettled()) {
    // A dismiss that races an in-flight auto-close schedules TWO exit timers
    // (the auto-close path plus the delete-flag effect path); the first
    // removal unmounts the toast while the second is still pending. Let it
    // fire while the host is still mounted.
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  cleanup();
});

describe("DaemonUpdateBanner", () => {
  it("uses a dismissible toast without taking up shell space or repeating on refresh", async () => {
    const view = render(
      <>
        <Toaster />
        <DaemonUpdateBanner state={pending} onRestarted={() => {}} />
      </>,
    );
    expect(await screen.findByText("Service update pending")).toBeTruthy();
    expect(view.container.querySelector(".daemon-update-banner")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close toast" }));
    await waitFor(() =>
      expect(screen.queryByText("Service update pending")).toBeNull(),
    );
    view.rerender(
      <>
        <Toaster />
        <DaemonUpdateBanner state={{ ...pending }} onRestarted={() => {}} />
      </>,
    );
    expect(screen.queryByText("Service update pending")).toBeNull();
    view.rerender(
      <>
        <Toaster />
        <DaemonUpdateBanner
          state={{ ...pending, revision: "new" }}
          onRestarted={() => {}}
        />
      </>,
    );
    expect(await screen.findByText("Service update pending")).toBeTruthy();
  });

  it("makes successful updates dismissible too", async () => {
    render(
      <>
        <Toaster />
        <DaemonUpdateBanner
          state={{ kind: "updated", revision: "done", note: "updated" }}
          onRestarted={() => {}}
        />
      </>,
    );
    expect(await screen.findByText("Drogon updated")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close toast" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Restart service" }),
    ).toBeNull();
  });

  it.each([true, false, "throw"])(
    "only restarts on request and reports outcome %s",
    async (outcome) => {
      const onRestarted = vi.fn();
      const restart =
        outcome === "throw"
          ? vi.fn().mockRejectedValue(new Error("offline"))
          : vi
              .fn()
              .mockResolvedValue({
                restarted: outcome,
                reason: "The daemon did not stop; it was left running.",
              });
      const original = window.drogon;
      // @ts-expect-error test seam
      window.drogon = { daemon: { restart } };
      try {
        render(
          <>
            <Toaster />
            <DaemonUpdateBanner state={pending} onRestarted={onRestarted} />
          </>,
        );
        const button = await screen.findByRole("button", {
          name: "Restart service",
        });
        expect(restart).not.toHaveBeenCalled();
        fireEvent.click(button);
        await waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
        if (outcome === true) {
          await waitFor(() => expect(onRestarted).toHaveBeenCalledTimes(1));
        } else {
          expect(
            await screen.findByText(
              outcome === false
                ? "The daemon did not stop; it was left running."
                : "The service could not be restarted from here.",
            ),
          ).toBeTruthy();
          expect(onRestarted).not.toHaveBeenCalled();
        }
      } finally {
        window.drogon = original;
      }
    },
  );
});
