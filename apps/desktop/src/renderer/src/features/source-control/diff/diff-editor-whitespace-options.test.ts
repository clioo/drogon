// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/editor/diff-editor-whitespace-options.test.ts.
import { describe, expect, it } from "vitest";
import { buildDiffEditorWhitespaceOptions } from "./diff-editor-whitespace-options";

describe("buildDiffEditorWhitespaceOptions", () => {
  it("ignores trim whitespace by default", () => {
    expect(buildDiffEditorWhitespaceOptions(undefined)).toEqual({ ignoreTrimWhitespace: true });
    expect(buildDiffEditorWhitespaceOptions(false)).toEqual({ ignoreTrimWhitespace: true });
  });

  it("includes whitespace in the diff when the preference is on", () => {
    expect(buildDiffEditorWhitespaceOptions(true)).toEqual({ ignoreTrimWhitespace: false });
  });
});
