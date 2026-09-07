// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Render tests for the orca-drogon hover-card port
// (src/renderer/src/components/ui/hover-card.tsx).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "./hover-card";
import { getSlot, installRadixJsdomStubs } from "./radix-jsdom-stubs";

beforeEach(installRadixJsdomStubs);
afterEach(cleanup);

describe("HoverCard", () => {
  it("renders trigger and portaled content with the source recipe", () => {
    render(
      <HoverCard open>
        <HoverCardTrigger>@orca</HoverCardTrigger>
        <HoverCardContent>Orca 1.4.197</HoverCardContent>
      </HoverCard>,
    );

    // HoverCard.Root is context-only (no DOM node), so the trigger carries
    // the mount-level assertions. Radix renders the trigger as an anchor.
    const trigger = getSlot("hover-card-trigger");
    expect(trigger.tagName).toBe("A");
    const content = getSlot("hover-card-content");
    expect(content.className).toContain("w-64");
    expect(content.className).toContain("backdrop-blur-2xl");
    expect(content.textContent).toBe("Orca 1.4.197");
  });
});
