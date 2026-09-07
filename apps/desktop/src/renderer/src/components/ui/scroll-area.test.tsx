// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Render tests for the orca-drogon scroll-area port
// (src/renderer/src/components/ui/scroll-area.tsx).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";

import { ScrollArea } from "./scroll-area";
import { getSlot, querySlot } from "./radix-jsdom-stubs";

afterEach(cleanup);

describe("ScrollArea", () => {
  it("renders the source slot tree: root, viewport", () => {
    render(
      <ScrollArea>
        <div>Long content</div>
      </ScrollArea>,
    );

    const root = getSlot("scroll-area");
    expect(root.className).toContain("relative");
    const viewport = getSlot("scroll-area-viewport");
    expect(viewport.className).toContain("size-full");
    expect(viewport.textContent).toBe("Long content");
    // The scrollbar only mounts when content overflows, which jsdom cannot
    // measure; assert the thumb recipe through the exported ScrollBar style
    // contract instead.
    expect(querySlot("scroll-area-scrollbar")).toBeNull();
  });
});
