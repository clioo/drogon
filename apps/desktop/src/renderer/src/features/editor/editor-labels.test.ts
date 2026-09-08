import { describe, expect, it } from "vitest";
import { basename, getEditorDisplayLabel } from "./editor-labels";

describe("basename", () => {
  it("returns the last path segment", () => {
    expect(basename("src/features/editor/EditorPane.tsx")).toBe("EditorPane.tsx");
  });

  it("returns the whole value with no separators", () => {
    expect(basename("README.md")).toBe("README.md");
  });

  it("ignores a trailing slash", () => {
    expect(basename("src/features/editor/")).toBe("editor");
  });
});

describe("getEditorDisplayLabel", () => {
  it("defaults to the file name variant", () => {
    expect(getEditorDisplayLabel("docs/README.md")).toBe("README.md");
  });

  it("returns the full relative path when requested", () => {
    expect(getEditorDisplayLabel("docs/README.md", "relativePath")).toBe("docs/README.md");
  });

  it("handles a root-level file identically in both variants", () => {
    expect(getEditorDisplayLabel("README.md", "fileName")).toBe("README.md");
    expect(getEditorDisplayLabel("README.md", "relativePath")).toBe("README.md");
  });
});
