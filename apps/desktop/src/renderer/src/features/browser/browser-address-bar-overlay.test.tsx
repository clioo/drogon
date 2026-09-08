// @vitest-environment jsdom
// Address bar overlay (#114): a squeezed slot keeps the globe affordance
// inline, and focusing the input expands the form over the toolbar row so the
// typed URL stays visible; a roomy slot never overlays.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, useState } from "react";
import BrowserAddressBar from "./browser-address-bar";

type ResizeCallback = () => void;

let resizeCallback: ResizeCallback | null = null;
let slotWidth = 48;

function slotRect(): DOMRect {
  return {
    x: 0,
    y: 0,
    width: slotWidth,
    height: 28,
    top: 0,
    left: 0,
    right: slotWidth,
    bottom: 28,
    toJSON: () => {},
  } as DOMRect;
}

function renderBar(initialValue = "https://example.com/"): void {
  const inputRef = createRef<HTMLInputElement>();
  function Harness(): React.ReactElement {
    const [value, setValue] = useState(initialValue);
    return (
      <BrowserAddressBar
        value={value}
        onChange={setValue}
        onSubmit={() => {}}
        onNavigate={() => {}}
        inputRef={inputRef as React.RefObject<HTMLInputElement | null>}
        recentUrls={[]}
      />
    );
  }
  render(<Harness />);
}

function addressForm(): HTMLElement {
  return screen.getByLabelText("Address", { exact: true }).closest("form")!;
}

beforeEach(() => {
  resizeCallback = null;
  slotWidth = 48;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeCallback) {
        resizeCallback = callback;
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(slotRect);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("browser address bar overlay", () => {
  it("stays inline while a collapsed bar is unfocused", () => {
    renderBar();
    const form = addressForm();
    expect(form.getAttribute("data-drogon-browser-address-bar-overlay")).toBeNull();
    expect(form.className).toContain("flex-1");
    expect(form.className).not.toContain("absolute");
  });

  it("overlays the toolbar row when a collapsed bar is focused", () => {
    renderBar();
    fireEvent.focus(screen.getByLabelText("Address", { exact: true }));
    const form = addressForm();
    expect(form.getAttribute("data-drogon-browser-address-bar-overlay")).toBe("true");
    expect(form.className).toContain("absolute");
    expect(form.className).toContain("inset-x-3");
  });

  it("keeps typed text in the input while overlaid", () => {
    vi.useFakeTimers();
    try {
      renderBar("");
      fireEvent.focus(screen.getByLabelText("Address", { exact: true }));
      const input = screen.getByLabelText("Address", { exact: true }) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "https://example.com/typed" } });
      expect(input.value).toBe("https://example.com/typed");
      expect(
        addressForm().getAttribute("data-drogon-browser-address-bar-overlay"),
      ).toBe("true");
    } finally {
      vi.useRealTimers();
    }
  });

  it("never overlays a bar that already fits", () => {
    slotWidth = 640;
    renderBar();
    act(() => {
      resizeCallback?.();
    });
    fireEvent.focus(screen.getByLabelText("Address", { exact: true }));
    const form = addressForm();
    expect(form.getAttribute("data-drogon-browser-address-bar-overlay")).toBeNull();
    expect(form.className).toContain("flex-1");
  });

  it("returns inline when focus leaves the collapsed bar", () => {
    vi.useFakeTimers();
    try {
      renderBar();
      const input = screen.getByLabelText("Address", { exact: true });
      fireEvent.focus(input);
      expect(
        addressForm().getAttribute("data-drogon-browser-address-bar-overlay"),
      ).toBe("true");
      fireEvent.blur(input);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(
        addressForm().getAttribute("data-drogon-browser-address-bar-overlay"),
      ).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
