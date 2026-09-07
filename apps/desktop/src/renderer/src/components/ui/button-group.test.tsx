// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Render tests for the orca-drogon button-group port
// (src/renderer/src/components/ui/button-group.tsx).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";

import { ButtonGroup } from "./button-group";
import { Button } from "./button";
import { getSlot } from "./radix-jsdom-stubs";

afterEach(cleanup);

describe("ButtonGroup", () => {
  it("renders role=group with the source data-slot and joined horizontal classes", () => {
    const screen = render(
      <ButtonGroup>
        <Button>One</Button>
        <Button>Two</Button>
      </ButtonGroup>,
    );
    const group = getSlot("button-group");
    expect(group.getAttribute("role")).toBe("group");
    // The source only sets data-orientation when the prop is given.
    expect(group.hasAttribute("data-orientation")).toBe(false);
    expect(group.className).toContain("items-stretch");
    expect(group.className).toContain("rounded-l-none");
  });

  it("stacks children when orientation=vertical", () => {
    render(
      <ButtonGroup orientation="vertical">
        <Button>One</Button>
        <Button>Two</Button>
      </ButtonGroup>,
    );
    const group = getSlot("button-group");
    expect(group.getAttribute("data-orientation")).toBe("vertical");
    expect(group.className).toContain("flex-col");
    expect(group.className).toContain("rounded-t-none");
  });
});
