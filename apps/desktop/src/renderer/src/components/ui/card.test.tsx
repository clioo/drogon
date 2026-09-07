// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Render tests for the orca-drogon card port
// (src/renderer/src/components/ui/card.tsx).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card";
import { getSlot } from "./radix-jsdom-stubs";

afterEach(cleanup);

describe("Card", () => {
  it("renders the full source slot tree with the source recipes", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Title</CardTitle>
          <CardDescription>Description</CardDescription>
        </CardHeader>
        <CardContent>Content</CardContent>
      </Card>,
    );

    const card = getSlot("card");
    expect(card.className).toContain("rounded-xl");
    expect(card.className).toContain("border-border/50");
    expect(card.className).toContain("bg-card");

    const header = getSlot("card-header");
    expect(header.className).toContain("@container/card-header");
    const title = getSlot("card-title");
    expect(title.className).toContain("font-semibold");
    expect(title.textContent).toBe("Title");
    const description = getSlot("card-description");
    expect(description.className).toContain("text-muted-foreground");
    const content = getSlot("card-content");
    expect(content.className).toContain("px-6");
    expect(content.textContent).toBe("Content");
  });
});
