// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Render tests for the orca-drogon input port
// (src/renderer/src/components/ui/input.tsx).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";

import { Input } from "./input";
import { getSlot } from "./radix-jsdom-stubs";

afterEach(cleanup);

describe("Input", () => {
  it("renders an input with the source recipe and forwards type", () => {
    render(<Input type="password" placeholder="Token" />);
    const el = getSlot("input");
    expect(el.tagName).toBe("INPUT");
    expect(el.getAttribute("type")).toBe("password");
    expect(el.className).toContain("h-9");
    expect(el.className).toContain("border-input");
    expect(el.className).toContain("placeholder:text-muted-foreground/60");
    expect(el.getAttribute("placeholder")).toBe("Token");
  });
});
