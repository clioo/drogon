// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ComposerSparseCheckout } from "./composer-sparse-checkout";

afterEach(cleanup);

// Why: cmdk scrolls the active item into view; jsdom has no such method.
if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView;
}

// Why: Radix Popover measures its trigger; jsdom has no ResizeObserver.
const realResizeObserver = (globalThis as Record<string, unknown>)
  .ResizeObserver;
beforeEach(() => {
  (globalThis as Record<string, unknown>).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});
afterEach(() => {
  if (realResizeObserver === undefined) {
    delete (globalThis as Record<string, unknown>).ResizeObserver;
  } else {
    (globalThis as Record<string, unknown>).ResizeObserver =
      realResizeObserver;
  }
});

const props = {
  presets: [],
  selectedPresetId: null,
  onSelectPreset: vi.fn(),
  onSavePreset: vi.fn(async () => null),
};

describe("sparse preset draft inputs", () => {
  it("marks the name/directories draft fields as identifiers, not prose", async () => {
    render(<ComposerSparseCheckout {...props} />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByText("New preset"));
    // Why: the draft form is the only input-bearing surface in the
    // popover (source SparseCheckoutPresetDraftForm: name has maxLength
    // 80, autoComplete off, spellCheck off; directories spellCheck off —
    // identifiers and paths, not prose).
    const popover = await screen.findByRole("dialog");
    const nameInput = popover.querySelector("input") as HTMLInputElement;
    expect(nameInput.getAttribute("spellcheck")).toBe("false");
    expect(nameInput.getAttribute("autocomplete")).toBe("off");
    expect(nameInput.getAttribute("maxlength")).toBe("80");
    const directories = popover.querySelector(
      "textarea",
    ) as HTMLTextAreaElement;
    expect(directories.getAttribute("spellcheck")).toBe("false");
  });
});
