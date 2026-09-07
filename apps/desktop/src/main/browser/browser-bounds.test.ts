import { describe, expect, test } from "vitest";
import { resolveViewBounds } from "./browser-bounds";

describe("resolveViewBounds", () => {
  const content = { width: 1440, height: 900 };
  test("passes a visible rect through rounded", () => {
    expect(
      resolveViewBounds({ x: 10.7, y: 20.2, width: 800, height: 600 }, content),
    ).toEqual({ x: 10, y: 20, width: 800, height: 600 });
  });
  test("zero-area rects hide the view", () => {
    expect(
      resolveViewBounds({ x: 0, y: 0, width: 0, height: 0 }, content),
    ).toBeNull();
    expect(
      resolveViewBounds({ x: 5, y: 5, width: 100, height: -2 }, content),
    ).toBeNull();
  });
  test("clamps oversized rects into the window", () => {
    expect(
      resolveViewBounds({ x: 1400, y: 850, width: 800, height: 600 }, content),
    ).toEqual({ x: 640, y: 300, width: 800, height: 600 });
  });
  test("non-finite rects hide the view", () => {
    expect(
      resolveViewBounds({ x: NaN, y: 0, width: 100, height: 100 }, content),
    ).toBeNull();
  });
});
