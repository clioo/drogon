// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
   Sidebar nav: the Meetings row is a real destination now. The row was
   ported from the fork dark (product-mode gate off) and this suite pins the
   two things flipping it on must guarantee — the row is visible for the
   surface the owner can actually use, and it routes to the branded
   `meetings` route id App mounts the page at. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SidebarNav } from "./SidebarNav";
import { MEETINGS_ROUTE_ID } from "../../meetings-mount";
import { isDrogonProductSurfaceVisible } from "./product-mode";

afterEach(cleanup);

describe("SidebarNav Meetings row", () => {
  it("shows the Meetings row and routes to the meetings page", () => {
    // The surface gate is on: the row is no longer code kept behind it.
    expect(isDrogonProductSurfaceVisible("meetings")).toBe(true);
    const onSelectRoute = vi.fn();
    render(
      <SidebarNav
        route={null}
        onSelectRoute={onSelectRoute}
        onOpenPalette={() => {}}
      />,
    );
    const row = screen.getByRole("button", { name: "Meetings" });
    expect(row.getAttribute("aria-current")).toBeNull();
    fireEvent.click(row);
    expect(onSelectRoute).toHaveBeenCalledWith(MEETINGS_ROUTE_ID);
  });

  it("marks the row current while the meetings page is open", () => {
    render(
      <SidebarNav
        route={MEETINGS_ROUTE_ID}
        onSelectRoute={() => {}}
        onOpenPalette={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Meetings" }).getAttribute("aria-current"),
    ).toBe("page");
    // The other rows are not current: exactly one page owns the sidebar.
    expect(
      screen.getByRole("button", { name: "Bots" }).getAttribute("aria-current"),
    ).toBeNull();
  });
});
