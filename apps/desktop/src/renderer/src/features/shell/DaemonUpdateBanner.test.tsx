// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// DaemonUpdateBanner (install-resilience P5): the user must SEE that a
// restart happened and why; the pending state names the reason and offers
// the restart action; the action reports failure honestly.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DaemonUpdateBanner } from "./DaemonUpdateBanner";

afterEach(cleanup);

describe("DaemonUpdateBanner", () => {
  it("shows the updated notice naming the revision (never a silent restart)", () => {
    render(
      <DaemonUpdateBanner
        state={{
          kind: "updated",
          revision: "0123456789ab",
          note: "Drogon updated to 0123456789ab; restarting its background service.",
        }}
        onRestarted={() => {}}
      />,
    );
    expect(
      screen.getByText(
        "Drogon updated to 0123456789ab; restarting its background service.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows the honest pending state with the refusal reason and a restart action", async () => {
    const onRestarted = vi.fn();
    const restart = vi.fn().mockResolvedValue({
      restarted: true,
      managed: true,
      reason: null,
      stoppedSessions: 3,
    });
    const original = window.drogon;
    // @ts-expect-error test seam
    window.drogon = { daemon: { restart } };
    try {
      render(
        <DaemonUpdateBanner
          state={{
            kind: "pending",
            revision: "0123456789ab",
            reason:
              "The running service could not quiesce (runtime_busy): one or more sessions are pending, live or unverifiable",
          }}
          onRestarted={onRestarted}
        />,
      );
      expect(screen.getByText(/update pending/)).toBeTruthy();
      expect(
        screen.getByText(/could not quiesce \(runtime_busy\)/),
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Restart service" }));
      await waitFor(() => expect(onRestarted).toHaveBeenCalledTimes(1));
      expect(restart).toHaveBeenCalledTimes(1);
    } finally {
      window.drogon = original;
    }
  });

  it("keeps the banner and shows the reason when the user-chosen restart fails", async () => {
    const onRestarted = vi.fn();
    const restart = vi.fn().mockResolvedValue({
      restarted: false,
      managed: true,
      reason: "The daemon did not stop; it was left running.",
      stoppedSessions: 0,
    });
    const original = window.drogon;
    // @ts-expect-error test seam
    window.drogon = { daemon: { restart } };
    try {
      render(
        <DaemonUpdateBanner
          state={{
            kind: "pending",
            revision: null,
            reason: "the old service stays attached",
          }}
          onRestarted={onRestarted}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Restart service" }));
      await waitFor(() =>
        expect(screen.getByText(/daemon did not stop/)).toBeTruthy(),
      );
      expect(onRestarted).not.toHaveBeenCalled();
    } finally {
      window.drogon = original;
    }
  });
});
