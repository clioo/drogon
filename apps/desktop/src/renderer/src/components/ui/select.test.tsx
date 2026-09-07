// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Render tests for the orca-drogon select port, including the required
// keyboard check: open the listbox and select an item with the keyboard.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import { getSlot, installRadixJsdomStubs } from "./radix-jsdom-stubs";

// Radix defers open/highlight focus work to a setTimeout.
const flushDeferredFocus = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

beforeEach(installRadixJsdomStubs);
afterEach(cleanup);

describe("Select", () => {
  it("renders the source trigger recipe with the size attribute", () => {
    render(
      <Select defaultValue="a">
        <SelectTrigger aria-label="Harness">
          <SelectValue placeholder="Choose…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">claude</SelectItem>
          <SelectItem value="b">pi</SelectItem>
        </SelectContent>
      </Select>,
    );

    const trigger = getSlot("select-trigger");
    expect(trigger.getAttribute("role")).toBe("combobox");
    expect(trigger.getAttribute("data-size")).toBe("default");
    expect(trigger.className).toContain("data-[size=default]:h-9");
    // SelectValue renders the selected item text.
    expect(trigger.textContent).toContain("claude");
  });

  it("sm size applies the compact height", () => {
    render(
      <Select defaultValue="a">
        <SelectTrigger size="sm" aria-label="Harness">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">claude</SelectItem>
        </SelectContent>
      </Select>,
    );
    expect(getSlot("select-trigger").getAttribute("data-size")).toBe("sm");
  });

  it("opens with the keyboard and selects an item", async () => {
    const onValueChange = vi.fn();
    render(
      <Select onValueChange={onValueChange}>
        <SelectTrigger aria-label="Harness">
          <SelectValue placeholder="Choose…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="claude">claude</SelectItem>
          <SelectItem value="pi">pi</SelectItem>
        </SelectContent>
      </Select>,
    );

    const trigger = getSlot("select-trigger");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    // Enter opens the listbox.
    fireEvent.keyDown(trigger, { key: "Enter" });
    await flushDeferredFocus();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const listbox = getSlot("select-content");
    expect(listbox.getAttribute("role")).toBe("listbox");
    const items = document.querySelectorAll('[data-slot="select-item"]');
    expect(items.length).toBe(2);
    expect(items[0].getAttribute("role")).toBe("option");

    // ArrowDown highlights, Enter selects.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "ArrowDown" });
    await flushDeferredFocus();
    expect(items[1].getAttribute("data-highlighted")).toBe("");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Enter" });
    await flushDeferredFocus();

    expect(onValueChange).toHaveBeenCalledWith("pi");
  });
});
