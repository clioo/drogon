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
afterEach(() => {
  cleanup();
  toast.dismiss();
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
