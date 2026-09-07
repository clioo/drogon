// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/renderer/src/components/browser-pane/assemble-chrome/BrowserAddressBarSuggestionList.tsx
// Adapted: the cmdk Command primitives are a plain listbox — same roles,
// icons and title/subtitle rows. Hover previews the row (the source's
// cmdk value change); mousedown selects before the input's blur closes the
// list; click still picks a row directly.
import { Globe } from "lucide-react";
import { cn } from "../tasks/cn";
import type { BrowserAddressBarSuggestion } from "./browser-address-bar-suggestions";

type BrowserAddressBarSuggestionListProps = {
  suggestions: BrowserAddressBarSuggestion[];
  selectedValue: string;
  onSelectedValueChange: (value: string) => void;
  onSelect: (url: string) => void;
};

export default function BrowserAddressBarSuggestionList({
  suggestions,
  selectedValue,
  onSelectedValueChange,
  onSelect,
}: BrowserAddressBarSuggestionListProps): React.ReactElement {
  return (
    <ul id="browser-history-listbox" role="listbox" className="max-h-64 overflow-y-auto p-1">
      {suggestions.map((entry) => {
        const selected = entry.url === selectedValue;
        return (
          <li
            key={entry.url}
            role="option"
            aria-selected={selected}
            data-value={entry.url}
            className={cn(
              "flex cursor-default items-center gap-2 rounded-md px-3 py-2",
              selected && "bg-black/8 dark:bg-white/14",
            )}
            // Why hover only highlights: the source's cmdk value change
            // moves selection without rewriting the input — previewing
            // stays keyboard-driven so a passing pointer never eats typing.
            onMouseEnter={() => {
              onSelectedValueChange(entry.url);
            }}
            // Why mousedown and not click: the input blurs (and would close
            // the list) before click fires; preventDefault keeps focus so the
            // pick registers.
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(entry.url);
            }}
          >
            {/* Why always the globe: every row here navigates — there is no
                search-engine row in this build, so no row reads as search. */}
            <Globe className="size-3.5 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm">{entry.title}</span>
              {entry.subtitle ? (
                <span className="truncate text-xs text-muted-foreground">
                  {entry.subtitle}
                </span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
