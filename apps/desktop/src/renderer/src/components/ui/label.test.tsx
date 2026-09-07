// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Render tests for the orca-drogon label port
// (src/renderer/src/components/ui/label.tsx).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";

import { Label } from "./label";
import { getSlot } from "./radix-jsdom-stubs";

afterEach(cleanup);

describe("Label", () => {
  it("renders a label tied to its control with the source recipe", () => {
    render(
      <>
        <Label htmlFor="recipe">Recipe</Label>
        <input id="recipe" />
      </>,
    );

    const label = getSlot("label");
    expect(label.tagName).toBe("LABEL");
    expect(label.getAttribute("for")).toBe("recipe");
    expect(label.className).toContain("text-sm");
    expect(label.className).toContain("font-medium");
    expect(label.textContent).toBe("Recipe");
  });
});
