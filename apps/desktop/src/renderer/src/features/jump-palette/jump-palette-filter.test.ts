import { describe, expect, test } from "vitest";
import {
  jumpQueryTokens,
  jumpTokenScore,
  rankJumpRows,
} from "./jump-palette-filter";

describe("jumpTokenScore", () => {
  test("exact beats prefix beats substring", () => {
    expect(jumpTokenScore(["alpha"], ["alpha"])).toBeGreaterThan(
      jumpTokenScore(["alp"], ["alpha"]),
    );
    expect(jumpTokenScore(["alp"], ["alpha"])).toBeGreaterThan(
      jumpTokenScore(["lph"], ["alpha"]),
    );
  });

  test("multi-word queries must cover most of what was typed", () => {
    expect(jumpTokenScore(["alpha", "zzz"], ["alpha"])).toBe(0);
    expect(jumpTokenScore(["alpha", "beta"], ["alpha beta"])).toBeGreaterThan(0);
  });

  test("filler words do not count against coverage", () => {
    expect(jumpTokenScore(["open", "alpha"], ["alpha"])).toBeGreaterThan(0);
  });
});

describe("rankJumpRows", () => {
  const rows = [
    { id: "a", text: "Create Worktree" },
    { id: "b", text: "New Terminal Tab" },
    { id: "c", text: "Open settings" },
  ];
  test("empty query keeps definition order", () => {
    expect(rankJumpRows(rows, (row) => [row.text], "  ").map((row) => row.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
  test("non-matching rows are dropped and best match leads", () => {
    const ranked = rankJumpRows(rows, (row) => [row.text], "term");
    expect(ranked.map((row) => row.id)).toEqual(["b"]);
  });
  test("tokens dedupe before scoring", () => {
    expect(jumpQueryTokens("alpha  alpha")).toEqual(["alpha"]);
  });
});
