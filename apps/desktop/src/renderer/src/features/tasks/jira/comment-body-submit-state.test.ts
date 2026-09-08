// R17-C: the comment submit-state helper is a verbatim port of the
// fork's lib/comment-body-submit-state.ts.
import { describe, expect, it } from "vitest";
import {
  getCommentBodySubmitState,
  hasBoundedCommentBodyText,
} from "./comment-body-submit-state";

describe("comment body submit state", () => {
  it("marks empty and whitespace-only bodies as empty", () => {
    expect(getCommentBodySubmitState("")).toEqual({ status: "empty" });
    expect(getCommentBodySubmitState("   \n\t ")).toEqual({ status: "empty" });
    expect(hasBoundedCommentBodyText("")).toBe(false);
  });

  it("trims ready bodies", () => {
    expect(getCommentBodySubmitState("  hello world  ")).toEqual({
      status: "ready",
      body: "hello world",
    });
    expect(hasBoundedCommentBodyText("hello world")).toBe(true);
  });

  it("rejects bodies whose leading whitespace scan exceeds the bound", () => {
    const huge = " ".repeat(70 * 1024) + "tail";
    expect(getCommentBodySubmitState(huge)).toEqual({
      status: "too-large-leading-whitespace",
    });
  });

  it("handles astral code points in the scan", () => {
    expect(getCommentBodySubmitState("😀 note")).toEqual({
      status: "ready",
      body: "😀 note",
    });
  });
});
