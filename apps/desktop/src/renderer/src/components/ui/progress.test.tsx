// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Render tests for the orca-drogon progress port
// (src/renderer/src/components/ui/progress.tsx).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";

import { Progress } from "./progress";
import { getSlot } from "./radix-jsdom-stubs";

afterEach(cleanup);

describe("Progress", () => {
  it("renders a progressbar with the source value math and recipe", () => {
    render(<Progress value={40} />);

    const root = getSlot("progress");
    expect(root.getAttribute("role")).toBe("progressbar");
    expect(root.getAttribute("aria-valuenow")).toBe("40");
    expect(root.className).toContain("bg-primary/20");
    const indicator = getSlot("progress-indicator");
    expect(indicator.style.transform).toBe("translateX(-60%)");
    expect(indicator.className).toContain("bg-primary");
  });
});
