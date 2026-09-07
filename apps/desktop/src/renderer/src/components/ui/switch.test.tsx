// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Render tests for the orca-drogon switch port
// (src/renderer/src/components/ui/switch.tsx).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";

import { Switch, SwitchIndicator } from "./switch";
import { getSlot } from "./radix-jsdom-stubs";

afterEach(cleanup);

describe("Switch", () => {
  it("renders role=switch with the source track recipe and toggles on click", () => {
    render(<Switch aria-label="Awake" />);
    const track = getSlot("switch");
    expect(track.getAttribute("role")).toBe("switch");
    expect(track.getAttribute("aria-checked")).toBe("false");
    expect(track.className).toContain("h-5");
    expect(track.className).toContain("w-9");
    const thumb = getSlot("switch-thumb");
    expect(thumb.className).toContain("data-[state=checked]:translate-x-4");

    fireEvent.click(track);
    expect(track.getAttribute("aria-checked")).toBe("true");
    expect(track.getAttribute("data-state")).toBe("checked");
  });

  it("SwitchIndicator renders a static state marker", () => {
    render(<SwitchIndicator checked size="compact" aria-hidden />);
    const track = getSlot("switch-indicator");
    expect(track.getAttribute("data-state")).toBe("checked");
    expect(track.className).toContain("h-3.5");
    expect(track.className).toContain("w-6");
    expect(getSlot("switch-thumb").getAttribute("data-state")).toBe("checked");
  });
});
