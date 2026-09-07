// MIT Copyright (c) 2026 Lovecast Inc. Ported from
// src/renderer/src/components/TerminalSearch.tsx.
// Adapted: translate() calls are plain English strings (Drogon has no i18n
// catalog), SearchState is declared locally (no keyboard-handlers module),
// and the icon buttons are plain <button>s with the source's Tailwind recipe
// (Drogon Button has no icon-xs size). Search semantics — decoration colors,
// incremental find, safe-find guard, Escape/Enter/Shift+Enter, ref sync for
// Cmd+G-style handlers — are unchanged.
import { useCallback, useEffect, useState } from "react";
import { CaseSensitive, ChevronDown, ChevronUp, Regex, X } from "lucide-react";
import type { SearchAddon } from "@xterm/addon-search";
import { getFindRequestQuery } from "./find-query-bounds";
import { safeFind } from "./terminal-search-safe-find";

export type TerminalSearchState = {
  query: string;
  caseSensitive: boolean;
  regex: boolean;
};

type TerminalSearchProps = {
  isOpen: boolean;
  onClose: () => void;
  searchAddon: SearchAddon | null;
  searchStateRef: React.RefObject<TerminalSearchState>;
};

function clearTerminalSearch(searchAddon: SearchAddon | null): void {
  if (!searchAddon) {
    return;
  }
  searchAddon.clearDecorations();
  // Why: xterm keeps the active match selected after decorations are cleared.
  searchAddon.findNext("");
}

export default function TerminalSearch({
  isOpen,
  onClose,
  searchAddon,
  searchStateRef,
}: TerminalSearchProps): React.JSX.Element | null {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const requestQuery = getFindRequestQuery(query);

  // Why: the default xterm SearchAddon highlights blend into common
  // terminal backgrounds. Providing explicit decoration colors gives all
  // matches a visible yellow background and the current match a brighter
  // orange. xterm requires #RRGGBB format for the background colors.
  const searchOptions = useCallback(
    (incremental = false) => ({
      caseSensitive,
      regex,
      incremental,
      decorations: {
        matchBackground: "#5c4a00",
        matchBorder: "#5c4a00",
        matchOverviewRuler: "#ffcc00",
        activeMatchBackground: "#c4580e",
        activeMatchBorder: "#ffcf6b",
        activeMatchColorOverviewRuler: "#ff9900",
      },
    }),
    [caseSensitive, regex],
  );

  const findNext = useCallback(() => {
    if (searchAddon && requestQuery) {
      safeFind(
        (term, options) => searchAddon.findNext(term, options),
        requestQuery,
        searchOptions(),
      );
    }
  }, [searchAddon, requestQuery, searchOptions]);

  const findPrevious = useCallback(() => {
    if (searchAddon && requestQuery) {
      safeFind(
        (term, options) => searchAddon.findPrevious(term, options),
        requestQuery,
        searchOptions(),
      );
    }
  }, [searchAddon, requestQuery, searchOptions]);

  const handleInputRef = useCallback((input: HTMLInputElement | null): void => {
    input?.focus();
  }, []);

  useEffect(
    () => () => {
      clearTerminalSearch(searchAddon);
    },
    [searchAddon],
  );

  useEffect(() => {
    // Keep the ref in sync so a keyboard handler (Cmd+G / Cmd+Shift+G)
    // can read the current search state without lifting it to parent state.
    searchStateRef.current = {
      query: requestQuery ?? "",
      caseSensitive,
      regex,
    };

    if (!isOpen) {
      clearTerminalSearch(searchAddon);
      return;
    }
    if (!requestQuery) {
      clearTerminalSearch(searchAddon);
      return;
    }
    if (searchAddon) {
      safeFind(
        (term, options) => searchAddon.findNext(term, options),
        requestQuery,
        searchOptions(true),
      );
    }
  }, [
    requestQuery,
    searchAddon,
    isOpen,
    caseSensitive,
    regex,
    searchStateRef,
    searchOptions,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation();

      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Enter" && e.shiftKey) {
        findPrevious();
      } else if (e.key === "Enter") {
        findNext();
      }
    },
    [onClose, findNext, findPrevious],
  );

  if (!isOpen) {
    return null;
  }

  return (
    <div
      data-terminal-search-root
      role="search"
      aria-label="Terminal search"
      className="absolute top-2 right-2 z-50 flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800/95 px-2 py-1 shadow-lg backdrop-blur-sm"
      style={{ width: 300 }}
      onKeyDown={handleKeyDown}
    >
      <input
        ref={handleInputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search..."
        aria-label="Search terminal"
        className="min-w-0 flex-1 border-none bg-transparent text-sm text-white outline-none placeholder:text-zinc-500"
      />

      <button
        type="button"
        onClick={() => setCaseSensitive((v) => !v)}
        aria-pressed={caseSensitive}
        className={`flex size-6 shrink-0 items-center justify-center rounded ${
          caseSensitive
            ? "bg-zinc-700/50 text-blue-400"
            : "text-zinc-400 hover:text-zinc-200"
        }`}
        title="Case sensitive"
      >
        <CaseSensitive size={14} />
      </button>

      <button
        type="button"
        onClick={() => setRegex((v) => !v)}
        aria-pressed={regex}
        className={`flex size-6 shrink-0 items-center justify-center rounded ${
          regex
            ? "bg-zinc-700/50 text-blue-400"
            : "text-zinc-400 hover:text-zinc-200"
        }`}
        title="Regex"
      >
        <Regex size={14} />
      </button>

      <div className="mx-0.5 h-4 w-px bg-zinc-700" />

      <button
        type="button"
        onClick={findPrevious}
        className="flex size-6 shrink-0 items-center justify-center rounded text-zinc-400 hover:text-zinc-200"
        title="Previous match"
      >
        <ChevronUp size={14} />
      </button>

      <button
        type="button"
        onClick={findNext}
        className="flex size-6 shrink-0 items-center justify-center rounded text-zinc-400 hover:text-zinc-200"
        title="Next match"
      >
        <ChevronDown size={14} />
      </button>

      <div className="mx-0.5 h-4 w-px bg-zinc-700" />

      <button
        type="button"
        onClick={onClose}
        className="flex size-6 shrink-0 items-center justify-center rounded text-zinc-400 hover:text-zinc-200"
        title="Close"
      >
        <X size={14} />
      </button>
    </div>
  );
}
