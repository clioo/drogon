// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Render tests for the orca-drogon tabs port, including the required
// keyboard check: arrow navigation moves focus and selection.
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";
import { getSlot } from "./radix-jsdom-stubs";

// Radix RovingFocusGroup defers arrow-key focus moves to a setTimeout.
const flushDeferredFocus = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

afterEach(cleanup);

function mount() {
  return render(
    <Tabs defaultValue="one">
      <TabsList>
        <TabsTrigger value="one">Terminal</TabsTrigger>
        <TabsTrigger value="two">Files</TabsTrigger>
        <TabsTrigger value="three">Browser</TabsTrigger>
      </TabsList>
      <TabsContent value="one">term</TabsContent>
      <TabsContent value="two">files</TabsContent>
      <TabsContent value="three">browser</TabsContent>
    </Tabs>,
  );
}

describe("Tabs", () => {
  it("renders the source slots, tablist roles and default variant recipe", () => {
    mount();

    const root = getSlot("tabs");
    expect(root.getAttribute("data-orientation")).toBe("horizontal");
    const list = getSlot("tabs-list");
    expect(list.getAttribute("role")).toBe("tablist");
    expect(list.getAttribute("data-variant")).toBe("default");
    expect(list.className).toContain("bg-muted");
    const triggers = document.querySelectorAll('[data-slot="tabs-trigger"]');
    expect(triggers.length).toBe(3);
    expect(triggers[0].getAttribute("role")).toBe("tab");
    expect(triggers[0].getAttribute("aria-selected")).toBe("true");
    expect(triggers[1].getAttribute("aria-selected")).toBe("false");
    const panel = getSlot("tabs-content");
    expect(panel.getAttribute("role")).toBe("tabpanel");
  });

  it("line variant applies the transparent list recipe", () => {
    render(
      <Tabs defaultValue="one">
        <TabsList variant="line">
          <TabsTrigger value="one">A</TabsTrigger>
        </TabsList>
        <TabsContent value="one">a</TabsContent>
      </Tabs>,
    );
    const list = getSlot("tabs-list");
    expect(list.getAttribute("data-variant")).toBe("line");
    expect(list.className).toContain("bg-transparent");
  });

  it("ArrowRight moves focus and selection to the next tab", async () => {
    mount();

    const triggers = () =>
      document.querySelectorAll('[data-slot="tabs-trigger"]') as NodeListOf<HTMLElement>;
    triggers()[0].focus();
    expect(document.activeElement).toBe(triggers()[0]);

    fireEvent.keyDown(triggers()[0], { key: "ArrowRight" });
    await flushDeferredFocus();
    expect(document.activeElement).toBe(triggers()[1]);
    expect(triggers()[1].getAttribute("aria-selected")).toBe("true");
    expect(triggers()[0].getAttribute("aria-selected")).toBe("false");

    fireEvent.keyDown(triggers()[1], { key: "ArrowRight" });
    await flushDeferredFocus();
    expect(document.activeElement).toBe(triggers()[2]);
    expect(triggers()[2].getAttribute("aria-selected")).toBe("true");
  });
});
