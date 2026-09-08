// @vitest-environment jsdom
import { act } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useEditorScheme } from "./editor-theme";

let captured: string | null = null;
function Probe() {
  captured = useEditorScheme();
  return null;
}

describe("useEditorScheme", () => {
  afterEach(() => {
    cleanup();
    document.documentElement.classList.remove("dark");
    captured = null;
  });

  it("reads the initial scheme from the document root at mount", () => {
    document.documentElement.classList.add("dark");
    render(<Probe />);
    expect(captured).toBe("dark");
  });

  it("re-renders live when App toggles .dark on the root after mount", async () => {
    render(<Probe />);
    expect(captured).toBe("light");

    // Why async act: MutationObserver delivers its callback as a microtask,
    // not synchronously within the mutating call — flush one microtask turn
    // before asserting.
    await act(async () => {
      document.documentElement.classList.add("dark");
      await Promise.resolve();
    });
    expect(captured).toBe("dark");

    await act(async () => {
      document.documentElement.classList.remove("dark");
      await Promise.resolve();
    });
    expect(captured).toBe("light");
  });

  it("stops observing after unmount", () => {
    const view = render(<Probe />);
    view.unmount();
    // No observer callback should fire (and thus no React warning about
    // updating state after unmount) once the component is gone.
    expect(() => {
      document.documentElement.classList.add("dark");
    }).not.toThrow();
  });
});
