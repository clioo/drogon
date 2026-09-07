// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Render tests for the orca-drogon checkbox port
// (src/renderer/src/components/ui/checkbox.tsx).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";

import { Checkbox } from "./checkbox";
import { getSlot } from "./radix-jsdom-stubs";

afterEach(cleanup);

describe("Checkbox", () => {
  it("renders role=checkbox with the source recipe and toggles on click", () => {
    render(<Checkbox aria-label="Pin" />);
    const box = getSlot("checkbox");
    expect(box.getAttribute("role")).toBe("checkbox");
    expect(box.getAttribute("aria-checked")).toBe("false");
    expect(box.className).toContain("rounded-[4px]");
    expect(box.className).toContain("data-[state=checked]:bg-primary");

    fireEvent.click(box);
    expect(box.getAttribute("aria-checked")).toBe("true");
    expect(box.getAttribute("data-state")).toBe("checked");
    expect(getSlot("checkbox-indicator").querySelector("svg")).toBeTruthy();
  });

  it("shows the minus icon in the indeterminate state", () => {
    render(<Checkbox aria-label="Pin" checked="indeterminate" />);
    const box = getSlot("checkbox");
    expect(box.getAttribute("aria-checked")).toBe("mixed");
    expect(box.getAttribute("data-state")).toBe("indeterminate");
    expect(getSlot("checkbox-indicator").querySelector("svg")).toBeTruthy();
  });
});
