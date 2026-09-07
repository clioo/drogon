// MIT Copyright (c) 2026 Lovecast Inc. Drogon-new tests for the adapted
// TerminalSearch.tsx (rendered with renderToString: no DOM harness exists
// in this repo; interaction semantics ride the ported safe-find and
// query-bounds modules).
import { describe, expect, it, vi } from "vitest";
import { createElement, createRef } from "react";
import { renderToString } from "react-dom/server";
import type { SearchAddon } from "@xterm/addon-search";
import TerminalSearch, {
  type TerminalSearchState,
} from "./TerminalSearch";

function addon(): SearchAddon {
  return {
    findNext: vi.fn(() => true),
    findPrevious: vi.fn(() => true),
    clearDecorations: vi.fn(),
  } as unknown as SearchAddon;
}

function stateRef() {
  return createRef<TerminalSearchState>() as React.RefObject<TerminalSearchState>;
}

describe("TerminalSearch", () => {
  it("renders nothing while closed", () => {
    const html = renderToString(
      createElement(TerminalSearch, {
        isOpen: false,
        onClose: () => {},
        searchAddon: addon(),
        searchStateRef: stateRef(),
      }),
    );
    expect(html).toBe("");
  });

  it("renders the source's overlay chrome with search semantics", () => {
    const html = renderToString(
      createElement(TerminalSearch, {
        isOpen: true,
        onClose: () => {},
        searchAddon: addon(),
        searchStateRef: stateRef(),
      }),
    );
    expect(html).toContain("data-terminal-search-root");
    expect(html).toContain('role="search"');
    expect(html).toContain('placeholder="Search..."');
    expect(html).toContain('aria-label="Search terminal"');
    for (const title of [
      "Case sensitive",
      "Regex",
      "Previous match",
      "Next match",
      "Close",
    ]) {
      expect(html).toContain(`title="${title}"`);
    }
  });
});
