// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Render tests for the orca-drogon textarea port
// (src/renderer/src/components/ui/textarea.tsx).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";

import { Textarea } from "./textarea";
import { getSlot } from "./radix-jsdom-stubs";

afterEach(cleanup);

describe("Textarea", () => {
  it("renders a textarea with the source recipe", () => {
    render(<Textarea placeholder="Prompt…" rows={3} />);
    const el = getSlot("textarea");
    expect(el.tagName).toBe("TEXTAREA");
    expect(el.className).toContain("min-h-16");
    expect(el.className).toContain("border-input");
    expect(el.getAttribute("placeholder")).toBe("Prompt…");
  });
});
