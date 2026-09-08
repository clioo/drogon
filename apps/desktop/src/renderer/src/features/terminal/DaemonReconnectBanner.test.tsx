// @vitest-environment jsdom
// DaemonReconnectBanner: the fork-literal pane overlay — spinner card with
// the terminal-scoped retry copy and role=status. There is no stopped phase
// (retries never give up), so there is no button to test.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DaemonReconnectBanner } from "./DaemonReconnectBanner";

afterEach(cleanup);

describe("DaemonReconnectBanner", () => {
  it("renders the retrying card over the stalled pane", () => {
    const { container } = render(<DaemonReconnectBanner />);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Reconnecting to Drogon service");
    expect(status.textContent).toContain("This terminal will resume");
    expect(
      container.firstElementChild?.getAttribute(
        "data-daemon-reconnect-banner",
      ),
    ).toBe("reconnecting");
  });
});
