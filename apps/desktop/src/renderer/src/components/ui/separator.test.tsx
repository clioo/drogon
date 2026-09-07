// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Render tests for the orca-drogon separator port
// (src/renderer/src/components/ui/separator.tsx).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";

import { Separator } from "./separator";
import { getSlot } from "./radix-jsdom-stubs";

afterEach(cleanup);

describe("Separator", () => {
  it("renders a decorative horizontal separator by default (role=none)", () => {
    render(<Separator />);
    const el = getSlot("separator");
    // decorative defaults to true in the source, so Radix removes it from
    // the accessibility tree.
    expect(el.getAttribute("role")).toBe("none");
    expect(el.className).toContain("h-px");
  });

  it("renders the vertical orientation recipe with a separator role", () => {
    render(<Separator orientation="vertical" decorative={false} />);
    const el = getSlot("separator");
    expect(el.getAttribute("role")).toBe("separator");
    expect(el.getAttribute("aria-orientation")).toBe("vertical");
    expect(el.className).toContain("w-px");
  });
});
