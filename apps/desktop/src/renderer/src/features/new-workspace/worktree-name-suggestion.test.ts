import { describe, expect, test } from "vitest";
import {
  getSuggestedCreatureName,
  selectSuggestedCreatureName,
  normalizeSuggestedName,
  suggestionPathBasename,
  MARINE_CREATURES,
} from "./worktree-name-suggestion";

describe("worktree-name-suggestion (the fork's blank-name fallback)", () => {
  test("the pool is the source's marine-creature list", () => {
    expect(MARINE_CREATURES.length).toBe(552);
    expect(MARINE_CREATURES[0]).toBe("Nautilus");
  });

  test("picks a lowercase pool name when nothing is used", () => {
    const name = selectSuggestedCreatureName([], () => 0);
    expect(name).toBe("nautilus");
  });

  test("skips used names and degrades to tiered variants", () => {
    const used = MARINE_CREATURES.map((name) => name.toLowerCase());
    const name = selectSuggestedCreatureName(used, () => 0);
    // Every tier-1 name is spent: the pool degrades to `name-2`.
    expect(name).toBe("nautilus-2");
  });

  test("dedupes on the path basename across platforms", () => {
    expect(suggestionPathBasename("/tmp/repos/nautilus/")).toBe("nautilus");
    expect(suggestionPathBasename("C:\\repos\\nautilus")).toBe("nautilus");
    const used = new Set([normalizeSuggestedName("nautilus")]);
    const pick = selectSuggestedCreatureName(used, () => 0.5);
    expect(pick).not.toBe("nautilus");
  });

  test("getSuggestedCreatureName reads worktree paths", () => {
    const worktrees = [{ path: "/tmp/wt/seahorse" }, { path: "/wt/starfish" }];
    const pick = getSuggestedCreatureName(worktrees, () => 0);
    expect(pick).not.toBe("seahorse");
    expect(pick).not.toBe("starfish");
  });
});
