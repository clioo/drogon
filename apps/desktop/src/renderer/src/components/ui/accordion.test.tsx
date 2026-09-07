// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Render tests for the orca-drogon accordion port
// (src/renderer/src/components/ui/accordion.tsx).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./accordion";
import { getSlot } from "./radix-jsdom-stubs";

afterEach(cleanup);

function mount() {
  return render(
    <Accordion type="single" collapsible>
      <AccordionItem value="a">
        <AccordionTrigger>Section</AccordionTrigger>
        <AccordionContent>Body copy</AccordionContent>
      </AccordionItem>
    </Accordion>,
  );
}

describe("Accordion", () => {
  it("renders the source data-slots and opens on trigger click", () => {
    const screen = mount();

    expect(getSlot("accordion")).toBeTruthy();
    const item = getSlot("accordion-item");
    expect(item.className).toContain("border-b");
    const trigger = getSlot("accordion-trigger");
    expect(trigger.getAttribute("data-state")).toBe("closed");
    expect(trigger.textContent).toContain("Section");
    expect(getSlot("accordion-content")).toBeTruthy();
    expect(trigger.querySelector("svg")).toBeTruthy();

    fireEvent.click(trigger);
    expect(trigger.getAttribute("data-state")).toBe("open");
  });
});
