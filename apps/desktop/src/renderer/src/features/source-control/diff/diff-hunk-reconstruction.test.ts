import { describe, expect, it } from "vitest";
import { reconstructDiffContent } from "./diff-hunk-reconstruction";

describe("reconstructDiffContent", () => {
  it("reconstructs both sides from a single hunk", () => {
    const diff = [
      "diff --git a/f.ts b/f.ts",
      "index 111..222 100644",
      "--- a/f.ts",
      "+++ b/f.ts",
      "@@ -1,3 +1,3 @@",
      " line one",
      "-line two",
      "+line TWO",
      " line three",
    ].join("\n");

    const result = reconstructDiffContent(diff);
    expect(result.hasContent).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.original).toBe("line one\nline two\nline three");
    expect(result.modified).toBe("line one\nline TWO\nline three");
  });

  it("inserts an identical gap marker between non-adjacent hunks on both sides", () => {
    const diff = [
      "diff --git a/f.ts b/f.ts",
      "@@ -1,2 +1,2 @@",
      "-a",
      "+A",
      " b",
      "@@ -50,2 +50,2 @@",
      " y",
      "-z",
      "+Z",
    ].join("\n");

    const result = reconstructDiffContent(diff);
    expect(result.original).toBe("a\nb\n⋯\ny\nz");
    expect(result.modified).toBe("A\nb\n⋯\ny\nZ");
  });

  it("drops added-only lines from the original side and deleted-only lines from the modified side", () => {
    const diff = ["@@ -1,1 +1,2 @@", " kept", "+brand new line"].join("\n");
    const result = reconstructDiffContent(diff);
    expect(result.original).toBe("kept");
    expect(result.modified).toBe("kept\nbrand new line");
  });

  it("ignores file-header and no-newline-at-eof marker lines", () => {
    const diff = [
      "diff --git a/f.ts b/f.ts",
      "index 1..2 100644",
      "--- a/f.ts",
      "+++ b/f.ts",
      "@@ -1,1 +1,1 @@",
      "-old",
      "\\ No newline at end of file",
      "+new",
    ].join("\n");
    const result = reconstructDiffContent(diff);
    expect(result.original).toBe("old");
    expect(result.modified).toBe("new");
  });

  it("reports no content for an empty diff (e.g. an untracked file)", () => {
    const result = reconstructDiffContent("");
    expect(result.hasContent).toBe(false);
    expect(result.original).toBe("");
    expect(result.modified).toBe("");
  });
});
