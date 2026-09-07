// Find-bar state: session flags over the guest findInPage and the query bound.
import { describe, expect, test } from "vitest";
import { nextFindRequest } from "./browser-find-bar";
import { getFindRequestQuery } from "../terminal/find-query-bounds";

describe("browser find state", () => {
  test("a new query starts a new guest session", () => {
    expect(
      nextFindRequest({ requestQuery: "needle", activeQuery: null, direction: "start" }),
    ).toEqual({ query: "needle", forward: true, findNext: true });
  });

  test("advancing keeps the session open in both directions", () => {
    expect(
      nextFindRequest({ requestQuery: "needle", activeQuery: "needle", direction: "next" }),
    ).toEqual({ query: "needle", forward: true, findNext: false });
    expect(
      nextFindRequest({ requestQuery: "needle", activeQuery: "needle", direction: "previous" }),
    ).toEqual({ query: "needle", forward: false, findNext: false });
  });

  test("Enter on a changed query starts the new session, not a follow-up", () => {
    expect(
      nextFindRequest({ requestQuery: "thread", activeQuery: "needle", direction: "next" }),
    ).toEqual({ query: "thread", forward: true, findNext: true });
    expect(
      nextFindRequest({ requestQuery: "thread", activeQuery: "needle", direction: "previous" }),
    ).toEqual({ query: "thread", forward: false, findNext: true });
  });

  test("a settled debounce repeat and an empty query send nothing", () => {
    expect(
      nextFindRequest({ requestQuery: "needle", activeQuery: "needle", direction: "start" }),
    ).toBeNull();
    expect(
      nextFindRequest({ requestQuery: null, activeQuery: "needle", direction: "next" }),
    ).toBeNull();
  });

  test("oversized queries never reach the guest", () => {
    expect(getFindRequestQuery("ok")).toBe("ok");
    expect(getFindRequestQuery("x".repeat(3 * 1024))).toBeNull();
  });
});
