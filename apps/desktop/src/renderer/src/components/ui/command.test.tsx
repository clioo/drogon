// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Render tests for the orca-drogon command port
// (src/renderer/src/components/ui/command.tsx).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./command";
import { getSlot, installRadixJsdomStubs } from "./radix-jsdom-stubs";
import { beforeEach } from "vitest";

// cmdk reads ResizeObserver while mounting its list.
beforeEach(installRadixJsdomStubs);
afterEach(cleanup);

describe("Command", () => {
  it("renders the source data-slots, listbox role and item recipes", () => {
    render(
      <Command>
        <CommandInput placeholder="Search…" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Workspaces">
            <CommandItem>r10-a</CommandItem>
            <CommandItem>r9-b</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>,
    );

    const root = getSlot("command");
    expect(root.className).toContain("bg-popover");
    const input = getSlot("command-input");
    expect(input.tagName).toBe("INPUT");
    expect(input.getAttribute("role")).toBe("combobox");
    const list = getSlot("command-list");
    expect(list.getAttribute("role")).toBe("listbox");
    expect(list.className).toContain("max-h-[min(400px,60vh)]");
    const items = document.querySelectorAll('[data-slot="command-item"]');
    expect(items.length).toBe(2);
    expect(items[0].getAttribute("role")).toBe("option");
    expect(items[0].className).toContain("data-[selected=true]:bg-accent");
  });

  it("filters items from the input", () => {
    render(
      <Command>
        <CommandInput placeholder="Search…" />
        <CommandList>
          <CommandGroup>
            <CommandItem>r10-a</CommandItem>
            <CommandItem>r9-b</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>,
    );

    fireEvent.change(getSlot("command-input"), { target: { value: "r10" } });
    const items = document.querySelectorAll('[data-slot="command-item"]');
    expect(items.length).toBe(1);
    expect(items[0].textContent).toBe("r10-a");
  });
});
